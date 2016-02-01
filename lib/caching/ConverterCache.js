/**
 * @module MTA_Subway_GTFS-Realtime_to_SIRI_Converter
 */

'use strict';

var async     = require('async')     ,

    msgChunks   = require('./CachedMessageTemplateChunks'),
    msgBufferer = require('./CachedMessageBufferers') ,
    timeUtils   = require('MTA_Subway_GTFS-Realtime_Toolkit').TimeUtils;

// TODO
// The SIRI SituationExchangeDelivery element only appears when there is a service alert 
// active for a route or stop being called on. 
// It is used by the responses to both the VehicleMonitoring and StopMonitoring calls.
// May need to add a method on the converter to determine if a route or stop has an alert.


var ConverterCache = function (converter) {
    try {
        var vehicleMonitoringResponse = converter.getCompleteVehicleMonitoringResponse(),
            vehicleActivity = vehicleMonitoringResponse.Siri.ServiceDelivery.VehicleMonitoringDelivery.VehicleActivity,
            situationExchangeDelivery = vehicleMonitoringResponse.Siri.ServiceDelivery.SituationExchangeDelivery,

            validUntilTimestamp = vehicleMonitoringResponse.Siri.ServiceDelivery.VehicleMonitoringDelivery.ValidUntil;

        //console.log(JSON.stringify(vehicleMonitoringResponse, null, 4));

        this.validUntil = new Buffer(validUntilTimestamp);

        // The following order is important as msgBufferer.bufferMonitoredVehicleJourneys mutates the objects.
        this.bufferedCalls = msgBufferer.bufferCalls(vehicleActivity);
        this.bufferedMonitoredVehicleJourneys = msgBufferer.bufferMonitoredVehicleJourneys(vehicleActivity);
        this.bufferedSituationExchange = msgBufferer.bufferSituationExchange(converter, situationExchangeDelivery);

        this.trainsWithAlertFilterObject = converter.getTrainsWithAlertFilterObject();
        this.routesWithAlertFilterObject = converter.getRoutesWithAlertFilterObject();
        this.stopsWithAlertsFilterObject = converter.getStopsWithAlertFilterObject();

        this.responseCache = {};
    } catch (e) {
        console.error(e.stack);
    }
};


/*
+-----------------------------+-----------------------------------------------------------------------+
| key                         |  your MTA Bus Time developer API key (required).  Go here to get one. |
+-----------------------------+-----------------------------------------------------------------------+
| OperatorRef                 |  the GTFS agency ID to be monitored (optional).  Currently,           |
|                             |  all stops have operator/agency ID of MTA. If left out,               |
|                             |  the system will make a best guess. Usage of the OperatorRef          |
|                             |  is suggested, as calls will return faster when populated.            |
+-----------------------------+-----------------------------------------------------------------------+
| MonitoringRef               |  the GTFS stop ID of the stop to be monitored (required).             |
|                             |  For example, 308214 for the stop at 5th Avenue                       |
|                             |  and Union St towards Bay Ridge.                                      |
+-----------------------------+-----------------------------------------------------------------------+
| LineRef                     |  A filter by 'fully qualified' route name,                            |
|                             |  GTFS agency ID + route ID (e.g. MTA NYCT_B63).                       |
+-----------------------------+-----------------------------------------------------------------------+
| DirectionRef                |  A filter by GTFS direction ID (optional).  Either 0 or 1.            |
+-----------------------------+-----------------------------------------------------------------------+
| StopMonitoringDetailLevel   |  Determines whether or not the response will include the stops        |
|                             |  ("calls" in SIRI-speak) each vehicle is going to make *after*        |
|                             |  it serves the selected stop (optional). To get calls data,           |
|                             |  use value calls, otherwise use value normal (default is normal).     |    
+-----------------------------+-----------------------------------------------------------------------+
| MaximumNumberOfCallsOnwards |  Limits the number of OnwardCall elements returned in the query.      |
| ----------------------------+-----------------------------------------------------------------------|
| MaximumStopVisits           |  an upper bound on the number of buses to return in the results.      |
+-----------------------------+-----------------------------------------------------------------------+
| MinimumStopVisitsPerLine    |  A lower bound on the number of buses to return in the results        |
|                             |  per line/route (assuming that many are available)                    |
+ ----------------------------+-----------------------------------------------------------------------+ */
ConverterCache.prototype.getStopMonitoringResponse = function (getParams, dataFormat, callback) {
    var getParams                 = getParams || {} /* jshint ignore:line */        ,
        stopMonitoringDetailLevel = getParams.stopmonitoringdetaillevel             ,
        maxOnwardCalls            = parseInt(getParams.maximumnumberofcallsonwards) ,
        route_id                  = getParams.lineref                               ,
        stop_id                   = ((typeof getParams.monitoringref) === 'string') ? 
                                        getParams.monitoringref.trim() : null ,
        requestedTrains,
        includeSituationExchangeDelivery;
    
    requestedTrains = getRequestedTrainsForStopMonitoringResponse.call(this, stop_id, getParams);

    stopMonitoringDetailLevel = ((typeof stopMonitoringDetailLevel) === 'string') ? 
                                    stopMonitoringDetailLevel.trim() : null;

    maxOnwardCalls = (!isNaN(maxOnwardCalls)) ? maxOnwardCalls : Number.POSITIVE_INFINITY;
    maxOnwardCalls = (maxOnwardCalls >= 0) ? maxOnwardCalls : 0;

    includeSituationExchangeDelivery = !!this.stopsWithAlertsFilterObject[stop_id];

    if (route_id) {
        includeSituationExchangeDelivery = 
            !!(includeSituationExchangeDelivery && this.routesWithAlertFilterObject[route_id]);
    } 

    buildResponse.call(this, requestedTrains, 'stopMonitoring', stopMonitoringDetailLevel, 
                       maxOnwardCalls, stop_id, includeSituationExchangeDelivery, dataFormat, 
                       responseHandler.bind(null, 'stopMonitoring', callback, dataFormat, getParams));
};

/*
+-----------------------------+-----------------------------------------------------------------------+
| key                         |  your MTA Bus Time developer API key (required).  Go here to get one. |
+-----------------------------+-----------------------------------------------------------------------+
| OperatorRef                 |  the GTFS agency ID to be monitored (optional).  Currently,           |
|                             |  all stops have operator/agency ID of MTA. If left out,               |
|                             |  the system will make a best guess. Usage of the OperatorRef          |
|                             |  is suggested, as calls will return faster when populated.            |
+-----------------------------+-----------------------------------------------------------------------+
| VehicleRef                  |  The ID of the vehicle to be monitored (optional).                    |
|                             |  This is the 4-digit number painted on the side of the bus,           |
|                             |  for example 7560. Response will include all buses if not included.   |
+-----------------------------+-----------------------------------------------------------------------+
| LineRef                     |  A filter by 'fully qualified' route name,                            |
|                             |  GTFS agency ID + route ID (e.g. MTA NYCT_B63).                       |
+-----------------------------+-----------------------------------------------------------------------+
| DirectionRef                |  A filter by GTFS direction ID (optional).  Either 0 or 1.            |
+-----------------------------+-----------------------------------------------------------------------+
| VehicleMonitoringDetailLevel|  Determines whether or not the response will include the stops        |
|                             |  ("calls" in SIRI-speak) each vehicle is going to make (optional).    |
|                             |  To get calls data, use value calls, otherwise use value normal       |
|                             |  (default is normal).                                                 |
+-----------------------------+-----------------------------------------------------------------------+
| MaximumNumberOfCallsOnwards |  Limits the number of OnwardCall elements returned in the query.      |
| ----------------------------+-----------------------------------------------------------------------|
| MaximumStopVisits           |  an upper bound on the number of buses to return in the results.      |
+-----------------------------+-----------------------------------------------------------------------+
| MinimumStopVisitsPerLine    |  A lower bound on the number of buses to return in the results        |
|                             |  per line/route (assuming that many are available)                    |
+ ----------------------------+-----------------------------------------------------------------------+ */
ConverterCache.prototype.getVehicleMonitoringResponse = function (getParams, dataFormat, callback) {
    var getParams                    = getParams || {}  /* jshint ignore:line */             ,
        train_id                     = (getParams.vehicleref) && getParams.vehicleref.trim() ,
        vehicleMonitoringDetailLevel = getParams.vehiclemonitoringdetaillevel                ,
        route_id                     = getParams.lineref                                     ,
        maxOnwardCalls               = parseInt(getParams.maximumnumberofcallsonwards)       ,

        requestedTrains              = getRequestedTrainsForVehicleMonitoringResponse.call(this, getParams),

        includeSituationExchangeDelivery;

    console.log("== requestedTrains ==", requestedTrains);

    vehicleMonitoringDetailLevel = ((typeof vehicleMonitoringDetailLevel) === 'string') ? 
                                        vehicleMonitoringDetailLevel.trim() : null;
    maxOnwardCalls               = (!isNaN(maxOnwardCalls)) ? maxOnwardCalls : Number.POSITIVE_INFINITY;
    maxOnwardCalls               = (maxOnwardCalls >= 0) ? maxOnwardCalls : 0;

    includeSituationExchangeDelivery = !train_id || this.trainsWithAlertFilterObject[train_id];

    if (includeSituationExchangeDelivery) {
        includeSituationExchangeDelivery = !route_id || this.routesWithAlertFilterObject[route_id];
    }

    buildResponse.call(this, requestedTrains, 'vehicleMonitoring', vehicleMonitoringDetailLevel, 
                       maxOnwardCalls, null, includeSituationExchangeDelivery,
                       dataFormat, responseHandler.bind(null, 'vehicleMonitoring', callback, dataFormat, getParams));
};


function responseHandler (callType, callback, dataFormat, getParams, err, response) {
    if (err) {
        callback(err);
    } else {
        try {
            applyTimestamps(callType, dataFormat, response);
        } catch (e) {
            console.log(e.stack || e);
        } 
        callback(null, response);
    }
}


function applyTimestamps (deliveryType, dataFormat, res) {
    var responseTimestamp = new Buffer(timeUtils.getTimestamp());

    responseTimestamp.copy(res, msgChunks.firstTimestampOffset[deliveryType][dataFormat]);
    responseTimestamp.copy(res, msgChunks.secondTimestampOffset[deliveryType][dataFormat]);
}


function buildResponse (requestedTrains, 
                        deliveryType,         /* stopMonitoring or vehicleMonitoring */
                        detailLevel,          /* normal/null/undefined or calls */ 
                        maxOnwardCalls, 
                        stop_id,              /* null for VehicleMonitoring */
                        includeSituationExchangeDelivery,
                        dataFormat, 
                        respCallback) {

    /* jshint validthis: true */

    var that = this;

    var responseChunks = msgChunks.responseLevel[deliveryType][dataFormat],
        respBuffer;

    // FIXME: need defense.
    var memoizationKey = requestedTrains.slice().sort().join('|') + '||' + 
                         Array.prototype.slice.call(arguments).slice(1,7).join('|');

    var memo;
    var totalCalls = 0;

    if ( this.responseCache[memoizationKey] ) {
        memo = this.responseCache[memoizationKey][0];
        if ((memo === undefined) || ((typeof memo) === 'function')) {
            this.responseCache[memoizationKey].push(respCallback);
        } else {
            respCallback.apply(null, this.responseCache[memoizationKey]);
        }
        return;
    } else {
        this.responseCache[memoizationKey] = [];
    }


    function getLengthOfResponse (callback) {
        try {
            var minLength = msgChunks.generalResponsePiecesLength[deliveryType][dataFormat],
                overallLen;


            // Iterate over all trains.
            overallLen = requestedTrains.reduce(function (acc, train_id) {

                var metadata      = that.bufferedMonitoredVehicleJourneys.byTrainsIndex[dataFormat][train_id],
                    journeyLength = metadata[1],

                    monitoredCallLen,
                    onwardCallsLen,

                    callMetadata,
                    monitoredCallNumber,
                    onwardCalls,
                    stopCallNumberForTrain,
                    firstOnwardCall,
                    lastOnwardCall,
                    lastOnwardCallIndex;

                if (dataFormat === 'json') { journeyLength -= 2; }

                // Does this train have calls?
                if (that.bufferedCalls.byTrainsIndex[dataFormat][train_id] && 
                    that.bufferedCalls.byTrainsIndex[dataFormat][train_id].length ) {
                    

                    if (deliveryType === 'stopMonitoring') {
                        monitoredCallNumber = that.bufferedCalls.stopIDToCallNumberForTrain[stop_id][train_id];
                    } else {
                        monitoredCallNumber = 0;
                    }

                    //FIXME: defense
                    callMetadata = that.bufferedCalls.byTrainsIndex[dataFormat][train_id][monitoredCallNumber] || {};
 
                    if (callMetadata.length) {
                        monitoredCallLen = msgChunks.perJourney[dataFormat].startNonemptyMonitoredCall.length + 
                                           callMetadata.length;
                    } else {
                        monitoredCallLen = msgChunks.perJourney[dataFormat].emptyMonitoredCall.length;
                    }
                    

                    if (dataFormat === 'json') { --monitoredCallLen; }

                     // Get the offsets and lengths for the trains calls.
                    onwardCalls = that.bufferedCalls.byTrainsIndex[dataFormat][train_id] || [];

                    // Do we include calls? 
                    // All StopMonitoring get calls, VehicleMonitoring only if detailLevel equals calls.
                    if ( onwardCalls.length && 
                            maxOnwardCalls && 
                            ((deliveryType === 'stopMonitoring') || (detailLevel === 'calls'))) {

                        // apply the maxOnwardCalls limit 
                        lastOnwardCallIndex = (maxOnwardCalls < onwardCalls.length) ?  
                            (maxOnwardCalls - 1) : (onwardCalls.length - 1);

                        // In this case, we must include the calls the train will make up to, 
                        // and including, the selected stop.
                        if ((deliveryType === 'stopMonitoring') && (detailLevel !== 'calls')) {
                            stopCallNumberForTrain = that.bufferedCalls.stopIDToCallNumberForTrain[stop_id][train_id];

                            if (lastOnwardCallIndex < stopCallNumberForTrain) { 
                                lastOnwardCallIndex = stopCallNumberForTrain; 
                            }
                        } 

                        firstOnwardCall = onwardCalls[0];
                        lastOnwardCall  = onwardCalls[lastOnwardCallIndex];

                        onwardCallsLen = msgChunks.perJourney[dataFormat].startNonemptyOnwardCalls.length                   +
                                         (((lastOnwardCall.offset + lastOnwardCall.length) - firstOnwardCall.offset)) +
                                         msgChunks.perJourney[dataFormat].endNonemptyOnwardCalls.length;

                        if (dataFormat === 'json') { --onwardCallsLen; }

                    } else {
                        onwardCallsLen = msgChunks.perJourney[dataFormat].emptyOnwardCalls.length;
                    }
                 } else {
                    monitoredCallLen = msgChunks.perJourney[dataFormat].emptyMonitoredCall.length;
                    onwardCallsLen = msgChunks.perJourney[dataFormat].emptyOnwardCalls.length;
                 }

                acc += journeyLength + monitoredCallLen + onwardCallsLen;

                return acc;

            }, minLength);

            // In pipeSituationExchange
            if (requestedTrains.length && (dataFormat === 'json')) {
                --overallLen; //last comma
            }

            if (includeSituationExchangeDelivery) {
                overallLen += that.bufferedSituationExchange.situationExchangeDelivery[dataFormat].length;
            }

            callback(null, overallLen);

        } catch (e) {
            console.error(e.stack || e);
            callback(e);
        }
    }

    function initTheResponseBuffer (overallLen, callback) {
        try {
            var offset = 0;

            respBuffer = new Buffer(overallLen);
            respBuffer.fill(); // This is simply so bugs don't leak out old data that's in the memory.

            offset += responseChunks.beginResponse.copy(respBuffer);
            offset += msgChunks.responseTimestampLength; //This is copied in later so that buffer may be reused.
            offset += responseChunks.afterFirstResponseTimestamp.copy(respBuffer, offset);
            offset += responseChunks.startDelivery.copy(respBuffer, offset);
            offset += msgChunks.responseTimestampLength; //This is copied in later so that buffer may be reused.
            offset += responseChunks.afterSecondResponseTimestamp.copy(respBuffer, offset);
            offset += that.validUntil.copy(respBuffer, offset);
            offset += responseChunks.afterValidUntil.copy(respBuffer, offset);
            offset += responseChunks.startTrainsData.copy(respBuffer, offset);

            callback(null, respBuffer, offset);

        } catch (e) {
            console.error(e.stack || e);
            callback(e);
        }
    }


    function pipeTrain (train_id, respBuffer, offset, callback) {
        /* jshint validthis: true */

        try {
            var metadata   = this.bufferedMonitoredVehicleJourneys.byTrainsIndex[dataFormat][train_id],
                dataOffset = metadata[0],
                len        = metadata[1],

                callMetadata,
                onwardCalls,
                monitoredCallNumber,
                stopCallNumberForTrain,
                firstOnwardCall,
                lastOnwardCall,
                lastOnwardCallIndex,
                callOffset,
                callLen; 

            // Copy the beginning chunk of the train's journey data.
            offset += this.bufferedMonitoredVehicleJourneys
                          .bufferedJourneys[dataFormat].copy(respBuffer, offset, dataOffset, dataOffset + len);

            if (dataFormat === 'json') {
                //TODO If this is legit, need to -2 in getLengthOfResponse.
                offset -=2; //2 parens that end the MonitoredVehicleJourney 
            }

            // Does this train have calls?
            if (this.bufferedCalls.byTrainsIndex[dataFormat][train_id] && 
                this.bufferedCalls.byTrainsIndex[dataFormat][train_id].length ) {
                    
                // Copy the beginning of the Monitored call
                offset += msgChunks.perJourney[dataFormat].startNonemptyMonitoredCall.copy(respBuffer, offset);

                if (deliveryType === 'stopMonitoring') {
                    monitoredCallNumber = that.bufferedCalls.stopIDToCallNumberForTrain[stop_id][train_id];
                } else {
                    monitoredCallNumber = 0;
                }

                //FIXME: defense
                callMetadata = that.bufferedCalls.byTrainsIndex[dataFormat][train_id][monitoredCallNumber]; 

                // The bufferedCalls data for the MonitoredCall
                callOffset   = callMetadata.offset;
                callLen      = callMetadata.length;

                // Copy the MonitoredCall into the buffer.
                offset += this.bufferedCalls.calls[dataFormat]
                                            .copy(respBuffer, offset, callOffset, callOffset + callLen);

                if (dataFormat === 'json') {
                    --offset; //Comma.
                }

                // Get the offsets and lengths for the trains calls.
                onwardCalls = that.bufferedCalls.byTrainsIndex[dataFormat][train_id] || [];

                // Do we include calls? 
                // Is maxOnwardCalls > 0? 
                // If so, all StopMonitoring get calls, VehicleMonitoring only if detailLevel equals calls.
                if ( onwardCalls.length && 
                     maxOnwardCalls     && 
                     ((deliveryType === 'stopMonitoring') || (detailLevel === 'calls'))
                   ) {

                    offset += msgChunks.perJourney[dataFormat].startNonemptyOnwardCalls.copy(respBuffer, offset);
                    
                    // apply the maxOnwardCalls limit 
                    lastOnwardCallIndex = (maxOnwardCalls < onwardCalls.length) ? 
                        (maxOnwardCalls - 1) : (onwardCalls.length - 1);

                    // In this case, we must include the calls the train will make up to, 
                    // and including, the selected stop.
                    if ((deliveryType === 'stopMonitoring') && (detailLevel !== 'calls')) {
                        stopCallNumberForTrain = that.bufferedCalls.stopIDToCallNumberForTrain[stop_id][train_id];

                        if (lastOnwardCall < stopCallNumberForTrain) {
                            lastOnwardCall = stopCallNumberForTrain;
                        }
                    }

                    firstOnwardCall = onwardCalls[0];
                    lastOnwardCall  = onwardCalls[lastOnwardCallIndex];

                    totalCalls += lastOnwardCallIndex + 1;

                    offset += this.bufferedCalls.calls[dataFormat]
                                                .copy(respBuffer,  offset, 
                                                      firstOnwardCall.offset, 
                                                      lastOnwardCall.offset + lastOnwardCall.length);

                    if (dataFormat === 'json') { --offset; }

                    offset += msgChunks.perJourney[dataFormat].endNonemptyOnwardCalls.copy(respBuffer, offset);

                } else {
                    offset += msgChunks.perJourney[dataFormat].emptyOnwardCalls.copy(respBuffer, offset);
                }

             } else {
                offset += msgChunks.perJourney[dataFormat].emptyMonitoredCall.copy(respBuffer, offset);
                offset += msgChunks.perJourney[dataFormat].emptyOnwardCalls.copy(respBuffer, offset);
             }
           
            callback(null, respBuffer, offset);

        } catch (e) {
            console.error(e.stack || e);
            callback(e);
        }
    }


    function pipeSituationExchange (respBuffer, offset, callback) {
        try {
            if (requestedTrains.length && (dataFormat === 'json')) {
                --offset; //last comma
            }
            offset += responseChunks.endTrainsData.copy(respBuffer, offset); 
            offset += responseChunks.beginSituationExchange.copy(respBuffer, offset);

            if (includeSituationExchangeDelivery) {
                offset += that.bufferedSituationExchange
                              .situationExchangeDelivery[dataFormat].copy(respBuffer, offset);
            }

            callback(null, respBuffer, offset);

        } catch (e) {
            console.error(e.stack || e);
            callback(e);
        }
    }


    function finito (err, respBuffer, offset) {

        var queue = that.responseCache[memoizationKey], 
            toMemoize,
            i;

        if (err) {
            toMemoize = [err, null];
        } else {
            try {
                offset += responseChunks.endResponse.copy(respBuffer, offset); 
                toMemoize = [null, respBuffer];

                if (offset !== respBuffer.length) { console.log("####### Buffer length != offset\n"); }

            } catch (e) {
                console.error(e.stack || e);
                toMemoize = [e, null];
            } 
        } 

        that.responseCache[memoizationKey] = toMemoize;

        respCallback.apply(null, toMemoize);

        // Clear the queue.
        if (Array.isArray(queue) && queue.length && (typeof queue[0] === 'function')) {
            for ( i = 0; i < queue.length; ++i) {
                queue[i].apply(null, toMemoize);
            }
        }
    }


    var tasks = requestedTrains.reduce(function (acc, train_id) { 
                    acc.push(pipeTrain.bind(that, train_id)); 
                    return acc; 
                }, [getLengthOfResponse, initTheResponseBuffer]);
    
    tasks.push(pipeSituationExchange);

    async.waterfall(tasks, finito);
}




function getRequestedTrainsForVehicleMonitoringResponse (getParams) {
    /*jshint validthis:true */

        /* Extract the filters from the params. */
    var that = this,
        
        operatorRef          = (getParams.operatorref) && getParams.operatorref.trim() ,
        train_id             = (getParams.vehicleref) && getParams.vehicleref.trim()   ,
        route_id             = (getParams.lineref) && getParams.lineref.trim()         ,
        directionRef         = parseInt(getParams.directionref)                        ,
        maxStopVisits        = parseInt(getParams.maximumstopvisits)                   ,
        minStopVisitsPerLine = parseInt(getParams.minimumstopvisitsperline)            ,

        reqTrainsByRoute,
        totalStopVisits,
        routesWithMoreThanMin,
        countOfRequiredTrains,
        minTrainsForRoutes,
        fillIndices,
        requestedTrains,
        next_fill_train,
        routes,

        i;


    if (maxStopVisits === 0) {
        return []; 
    }

    if (operatorRef && (!this.bufferedMonitoredVehicleJourneys.agency_ids[operatorRef]) ) { 
        return []; 
    }


    /* If a train is specified, return only that train. */
    if (train_id) { 
        //Make sure train exists in the byTrainsIndex.
        return (this.bufferedMonitoredVehicleJourneys.byTrainsIndex.json[train_id]) ? [train_id] : [];
    }

    if ( route_id && !isNaN(directionRef) ) { // Both route and directionRef are specified.
        reqTrainsByRoute = [ this.bufferedMonitoredVehicleJourneys //FIXME: Defensive code agains undefined.
                                       .partitionedByRouteByDirection[route_id][directionRef] || []];
    } else if ( route_id ) { // We have a route, but no direction.
        reqTrainsByRoute = [ this.bufferedMonitoredVehicleJourneys.partitionedByRoute[route_id] || []];
    } else if ( ! isNaN(directionRef) ) {  // Only direction specified.
        routes = Object.keys(this.bufferedMonitoredVehicleJourneys.partitionedByRoute);

        reqTrainsByRoute = routes.map(function (_route_id) { 
            return this.bufferedMonitoredVehicleJourneys.partitionedByRouteByDirection[_route_id][directionRef] || [];
        });
    } else { // Neither route nor direction specified.
        routes = Object.keys(this.bufferedMonitoredVehicleJourneys.partitionedByRoute);

        reqTrainsByRoute = routes.map(function (_route_id) { 
             return that.bufferedMonitoredVehicleJourneys.partitionedByRoute[_route_id] || [];
        });
    }

    
    // How many trains total?
    totalStopVisits = reqTrainsByRoute.reduce(function (acc, arr) { 
        return acc + arr.length; 
    }, 0);
    
    // Does the total number of trains exceed the max specified?
    if  ((!isNaN(maxStopVisits))  && (maxStopVisits !== null) && (totalStopVisits > maxStopVisits)) {

        // Was minStopVisitsPerLine specified? If so, it could override max.
        if ((!isNaN(minStopVisitsPerLine)) && (minStopVisitsPerLine !== null)) {
            
            // The following datastructure is used 
            //      IF the number of train required by minStopVisitsPerLine is less than maxStopVisits.
            //      In that case, we merge into reqTrainIndices those trains with the nearest ETA for the
            //      stop that aren't already included in the minStopVisitsPerLine arrays.
            //
            // [ arrIndex : <index of route in reqTrainIndicesByRoute>, 
            //   offset   : <current offset into the route's list of trains>, ]
            routesWithMoreThanMin = []; 

            // Tally of the trains known to be added to reqTrainIndicesByRoute
            countOfRequiredTrains = 0;

            // An array of arrays. The nested arrays are the trains required by the minStopVisitsPerLine.
            minTrainsForRoutes = reqTrainsByRoute.reduce(function (acc, trainsForRoute, i) {

                var len = trainsForRoute.length;
                
                if (len > minStopVisitsPerLine) {
                    countOfRequiredTrains += minStopVisitsPerLine;
                    routesWithMoreThanMin.push({ arrIndex : i, offset : minStopVisitsPerLine });
                } else {
                    countOfRequiredTrains += len;
                }

                if (len) {
                    acc.push(trainsForRoute.slice(0, minStopVisitsPerLine));
                }

                return acc;

            }, []);

        } else {
            // No minStopVisitsPerLine, therefore the required trains is an empty list.
            countOfRequiredTrains = 0;
            minTrainsForRoutes = [[]];            

            // All non-empty lists have more than the required per route amount of zero.
            // We initialize all of them to their first element.
            routesWithMoreThanMin   = [];            
            for ( i = 0; i < reqTrainsByRoute.length; ++i ) {
                if (reqTrainsByRoute[i].length) {
                    routesWithMoreThanMin.push({ arrIndex : i, offset : 0 });
                }
            }
        }

        // If there are non-empty minTrainIndicesForRoutes arrays, fillIndices becomes
        // a list of the lowest indices. That list, together with the minTrainIndicesForRoutes,
        // brings the total number of trains returned to maxStopVisits.
        // 
        // If minTrainIndices contains only an empty list, the following will populate fillIndices
        // with the maxStopVisits lowest train indices that fit the route and direction constraints.
        fillIndices = [];
        i = 0;

        while ((routesWithMoreThanMin.length) && (countOfRequiredTrains < maxStopVisits)) {
            // Seeking the lowest remaining train index number within routesWithMoreThanMin.
            if (i >= routesWithMoreThanMin.length) {
                i = 0;
            }

            next_fill_train = reqTrainsByRoute[routesWithMoreThanMin[i].arrIndex][routesWithMoreThanMin[i].offset];

            // If we have exhausted a list, remove it from consideration.
            if (++(routesWithMoreThanMin[i].offset) === reqTrainsByRoute[routesWithMoreThanMin[i].arrIndex].length) {
                routesWithMoreThanMin.splice(i, 1);
            }

            // Don't count the mysterious nulls and undefineds.
            if ((typeof next_fill_train) === 'string') {
                fillIndices.push(next_fill_train);
                ++countOfRequiredTrains;

                ++i;
            }
        }
        minTrainsForRoutes.push(fillIndices);

        // Put all the train indices into a single array.
        requestedTrains = minTrainsForRoutes.reduce(function (acc, arr) { return acc.concat(arr); }, []);

    } else { //Under the max limit, just concat the arrays.
        requestedTrains = reqTrainsByRoute.reduce(function (acc, arr) { return acc.concat(arr); }, []);
    }

    // From trainIndices to train_ids.
    return requestedTrains;
}




function getRequestedTrainsForStopMonitoringResponse (stop_id, getParams) {
    /* jshint validthis:true */

    var that = this,

        operatorRef          = getParams.operatorref || 'MTA'               ,
        route_id             = getParams.lineref                            ,
        directionRef         = parseInt(getParams.directionref)             ,
        maxStopVisits        = parseInt(getParams.maximumstopvisits)        ,
        minStopVisitsPerLine = parseInt(getParams.minimumstopvisitsperline) ,

        indexNodeForStop,

        routes,

        totalStopVisits,
        routesWithMoreThanMin,
        countOfRequiredTrains,
        minTrainIndicesForRoutes,

        fillIndices,
        minIndex,
        minRoute,
        train_index,
        routeMin,
        reqTrainIndices,

        reqTrainIndicesByRoute,

        i;

    indexNodeForStop = this.bufferedCalls.stopIDToCallNumberForTrain[stop_id];

    // Get the OperatorRef
    // Check route_id to see if it begins with OperatorRef
    // If not, append OperatorRef to the route_id.
    // Will need to index/filter on OperatorRef as well.

    // Cases where there's nothing to do.
    if ((!indexNodeForStop) || (maxStopVisits === 0) || (operatorRef !== 'MTA')) { return []; }

    if ( route_id && !isNaN(directionRef) ) { // Both route and directionRef are specified.
        reqTrainIndicesByRoute = [ this.bufferedCalls
                                       .indicesOfTrainsSortedByETAForStopByRoute[stop_id]
                                                                                [route_id]
                                                                                [directionRef] || []];
    } else if ( route_id ) { // We have a route, but no direction.
        reqTrainIndicesByRoute = [ this.bufferedCalls.indicesOfTrainsSortedByETAForStopByRoute[stop_id]
                                                                                              [route_id] || []];
    } else if ( ! isNaN(directionRef) ) {  // Only direction specified.
        routes = Object.keys(this.bufferedCalls.indicesOfTrainsSortedByETAForStopByRoute[stop_id]) || [];

        reqTrainIndicesByRoute = routes.map(function (_route_id) { 
             return this.bufferedCalls.indicesOfTrainsSortedByETAForStopByRouteByDirection[stop_id]
                                                                                          [_route_id]
                                                                                          [directionRef] || [];
        });
    } else { // Neither route nor direction specified.
        routes = Object.keys(this.bufferedCalls.indicesOfTrainsSortedByETAForStopByRoute[stop_id]);

        reqTrainIndicesByRoute = routes.map(function (_route_id) { 
             return that.bufferedCalls.indicesOfTrainsSortedByETAForStopByRoute[stop_id][_route_id] || [];
        });
    }

    // How many trains total?
    totalStopVisits = reqTrainIndicesByRoute.reduce(function (acc, arr) { return acc + arr.length; }, 0);
    
    // Does the total number of trains exceed the max specified?
    if  ((!isNaN(maxStopVisits))  && (maxStopVisits !== null) && (totalStopVisits > maxStopVisits)) {

        // Was minStopVisitsPerLine specified? If so, it could override max.
        if ((!isNaN(minStopVisitsPerLine)) && (minStopVisitsPerLine !== null)) {
            
            // The following datastructure is used 
            //      IF the number of train required by minStopVisitsPerLine is less than maxStopVisits.
            //      In that case, we merge into reqTrainIndices those trains with the nearest ETA for the
            //      stop that aren't already included in the minStopVisitsPerLine arrays.
            //
            // [ arrIndex : <index of route in reqTrainIndicesByRoute>, 
            //   offset   : <current offset into the route's list of trains>, ]
            routesWithMoreThanMin = []; 

            // Tally of the trains known to be added to reqTrainIndicesByRoute
            countOfRequiredTrains = 0;

            // An array of arrays. The nested arrays are the trains required by the minStopVisitsPerLine.
            minTrainIndicesForRoutes = reqTrainIndicesByRoute.reduce(function (acc, indicesForRoute, i) {

                var len = indicesForRoute.length;
                
                if (len > minStopVisitsPerLine) {
                    countOfRequiredTrains += minStopVisitsPerLine;
                    routesWithMoreThanMin.push({ arrIndex : i, offset : minStopVisitsPerLine });
                } else {
                    countOfRequiredTrains += len;
                }

                if (len) {
                    acc.push(indicesForRoute.slice(0, minStopVisitsPerLine));
                }

                return acc;

            }, []);

        } else {
            // No minStopVisitsPerLine, therefore the required trains is an empty list.
            countOfRequiredTrains = 0;
            minTrainIndicesForRoutes = [[]];            

            // All non-empty lists have more than the required per route amount of zero.
            // We initialize all of them to their first element.
            routesWithMoreThanMin   = [];            
            for ( i = 0; i < reqTrainIndicesByRoute.length; ++i ) {
                if (reqTrainIndicesByRoute[i].length) {
                    routesWithMoreThanMin.push({ arrIndex : i, offset : 0 });
                }
            }
        }

        // If there are non-empty minTrainIndicesForRoutes arrays, fillIndices becomes
        // a list of the lowest indices. That list, together with the minTrainIndicesForRoutes,
        // brings the total number of trains returned to maxStopVisits.
        // 
        // If minTrainIndices contains only an empty list, the following will populate fillIndices
        // with the maxStopVisits lowest train indices that fit the route and direction constraints.
        fillIndices = [];
        while ((routesWithMoreThanMin.length) && (countOfRequiredTrains < maxStopVisits)) {
            // Initialize min and minRoute..
            minIndex = reqTrainIndicesByRoute[routesWithMoreThanMin[0].arrIndex][routesWithMoreThanMin[0].offset];
            minRoute = 0;

            // Seeking the lowest remaining train index number within routesWithMoreThanMin.
            for ( i = 1; i < routesWithMoreThanMin.length; ++i ) {
                train_index = reqTrainIndicesByRoute[routesWithMoreThanMin[i].arrIndex]
                                                    [routesWithMoreThanMin[i].offset];
                if (train_index < minIndex) {
                    minIndex = train_index;
                    routeMin = i;  
                }
            }

            fillIndices.push(minIndex);
            ++countOfRequiredTrains;

            // If we have exhausted a list, remove it from consideration.
            if (++routesWithMoreThanMin[minRoute].offset === 
                    reqTrainIndicesByRoute[routesWithMoreThanMin[minRoute].arrIndex].length) {
                routesWithMoreThanMin.splice(minRoute, 1);
            }
        }
        minTrainIndicesForRoutes.push(fillIndices);

        // Put all the train indices into a single array.
        reqTrainIndices = minTrainIndicesForRoutes.reduce(function (acc, arr) { return acc.concat(arr); }, []);

    } else { //Under the max limit, just concat the arrays.
        reqTrainIndices = reqTrainIndicesByRoute.reduce(function (acc, arr) { return acc.concat(arr); }, []);
    }

    // From trainIndices to train_ids.
    return reqTrainIndices.map(function (train_index) {
        return  that.bufferedCalls.trainsSortedByETAForStop[stop_id][train_index];
    });
}



module.exports = ConverterCache;


