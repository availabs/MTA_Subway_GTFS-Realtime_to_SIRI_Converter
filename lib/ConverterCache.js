/**
 * @module MTA_Subway_GTFS-Realtime_to_SIRI_Converter
 */

'use strict';

var util      = require('util')      ,
    async     = require('async')     ,
    jsontoxml = require('jsontoxml') ,

    timeUtils = require('./utils/timeUtils');

// TODO
// The SIRI SituationExchangeDelivery element only appears when there is a service alert 
// active for a route or stop being called on. 
// It is used by the responses to both the VehicleMonitoring and StopMonitoring calls.
// May need to add a method on the converter to determine if a route or stop has an alert.


var ConverterCache = function (converter) {
    var vehicleMonitoringResponse = converter.getCompleteVehicleMonitoringResponse(),
        vehicleActivity = vehicleMonitoringResponse.Siri.ServiceDelivery.VehicleMonitoringDelivery.VehicleActivity,
        situationExchangeDelivery = vehicleMonitoringResponse.Siri.ServiceDelivery.SituationExchangeDelivery;

    this.validUntil = new Buffer(vehicleMonitoringResponse.Siri.ServiceDelivery.VehicleMonitoringDelivery.ValidUntil);

    // The following order is important as bufferMonitoredVehicleJourneys mutates the objects.
    this.bufferedCalls = bufferCalls(vehicleActivity);
    this.bufferedMonitoredVehicleJourneys = bufferMonitoredVehicleJourneys(vehicleActivity);

    this.bufferedSituationExchange = bufferSituationExchange(converter, situationExchangeDelivery);

    this.trainsWithAlertFilterObject = converter.getTrainsWithAlertFilterObject();
    this.routesWithAlertFilterObject = converter.getRoutesWithAlertFilterObject();
    this.stopsWithAlertsFilterObject = converter.getStopsWithAlertFilterObject();

    this.responseCache = {};
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
        stopMonitoringDetailLevel = getParams.StopMonitoringDetailLevel             ,
        maxOnwardCalls            = parseInt(getParams.MaximumNumberOfCallsOnwards) ,
        route_id                  = getParams.LineRef                               ,
        stop_id                   = ((typeof getParams.MonitoringRef) === 'string') ? 
                                        getParams.MonitoringRef.trim() : null ,
        requestedTrains,
        includeSituationExchangeDelivery;
    
    requestedTrains = getRequestedTrainsForStopMonitoringResponse.call(this, stop_id, getParams);

    stopMonitoringDetailLevel = ((typeof stopMonitoringDetailLevel) === 'string') ? 
                                    stopMonitoringDetailLevel.trim() : null;

    maxOnwardCalls            = (!isNaN(maxOnwardCalls)) ? maxOnwardCalls : Number.POSITIVE_INFINITY;
    maxOnwardCalls            = (maxOnwardCalls >= 0) ? maxOnwardCalls : 0;

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
        train_id                     = (getParams.VehicleRef) && getParams.VehicleRef.trim() ,
        vehicleMonitoringDetailLevel = getParams.VehicleMonitoringDetailLevel                ,
        route_id                     = getParams.LineRef                                     ,
        maxOnwardCalls               = parseInt(getParams.MaximumNumberOfCallsOnwards)       ,
        requestedTrains              = getRequestedTrainsForVehicleMonitoringResponse.call(this, getParams),

        includeSituationExchangeDelivery;

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
            console.log(e);
        }
        callback(null, response);
    }
}


var perTrainChunks = {

    json : {
        startNonemptyMonitoredCall : new Buffer(',"MonitoredCall":'), 
        emptyMonitoredCall         : new Buffer(',"MonitoredCall":{}'),

        startNonemptyOnwardCalls : new Buffer(',"OnwardCalls":{"OnwardCall":['),
        endNonemptyOnwardCalls   : new Buffer(']}}},'), //Ends MonitoredVehicleJourney Too

        emptyOnwardCalls : new Buffer(',"OnwardCalls":{}}},'),
    },

    xml : {
        startNonemptyMonitoredCall : new Buffer('<MonitoredCall>'),
        emptyMonitoredCall         : new Buffer('<MonitoredCall>'),

        startNonemptyOnwardCalls : new Buffer('</MonitoredCall><OnwardCalls><OnwardCall>'),
        endNonemptyOnwardCalls   : new Buffer('</OnwardCall></OnwardCalls>'),

        emptyOnwardCalls : new Buffer('</MonitoredCall><OnwardCalls></OnwardCalls>'),
    }
};


var generalResponseChunks = (function () {
    var shared_json = {
            beginResponse                  : new Buffer('{"Siri":{"ServiceDelivery":{"ResponseTimestamp":"'),

            afterFirstResponseTimestamp    : new Buffer('",'),

            //startDelivery

            afterSecondResponseTimestamp   : new Buffer('","ValidUntil":"'),
            afterValidUntil                : new Buffer('",'),

            //startTrainsData

            //startNonemptyMonitoredCall

            //startNonemptyOnwardCalls 
            //endNonemptyOnwardCalls
            
            //emptyOnwardCalls

            endTrainsData                  : new Buffer('],'),

            beginSituationExchangeDelivery : new Buffer('"SituationExchangeDelivery":['),
            endResponse                    : new Buffer(']}]}}}'),
        }, 

        shared_xml = {
            beginResponse : new Buffer('<Siri xmlns:ns2="http://www.ifopt.org.uk/acsb" '    + 
                                             'xmlns:ns4="http://datex2.eu/schema/1_0/1_0" ' + 
                                             'xmlns:ns3="http://www.ifopt.org.uk/ifopt" '   +
                                             'xmlns="http://www.siri.org.uk/siri">'         + 
                                             '<ServiceDelivery><ResponseTimestamp>'),

            afterFirstResponseTimestamp : new Buffer('</ResponseTimestamp>'),

            //startDelivery
            
            afterSecondResponseTimestamp : new Buffer('</ResponseTimestamp><ValidUntil>'),

            afterValidUntil : new Buffer('</ValidUntil>'),
            
            //startTrainsData
            //startNonemptyMonitoredCall
            //startNonemptyOnwardCalls 
            //endNonemptyOnwardCalls
            //emptyOnwardCalls

            beginSituationExchangeDelivery : new Buffer('<SituationExchangeDelivery>'),

            endResponse                    : new Buffer('</SituationExchangeDelivery></ServiceDelivery></Siri>'),
        },

        
        stopMonitoring = {
            json : {
                beginResponse                : shared_json.beginResponse,

                afterFirstResponseTimestamp  : shared_json.afterFirstResponseTimestamp,

                startDelivery                : new Buffer('"StopMonitoringDelivery":[{"ResponseTimestamp":"'),

                afterSecondResponseTimestamp : shared_json.afterSecondResponseTimestamp,
                afterValidUntil              : shared_json.afterValidUntil,

                startTrainsData              : new Buffer('"MonitoredStopVisit":['),

                //startNonemptyMonitoredCall
                //startNonemptyOnwardCalls 
                //endNonemptyOnwardCalls
                //emptyMonitoredCall
                //emptyOnwardCalls

                endTrainsData                : shared_json.endTrainsData,

                beginSituationExchange       : shared_json.beginSituationExchangeDelivery,

                endResponse                  : shared_json.endResponse,
            },

            xml : {
                beginResponse                : shared_xml.beginResponse,

                afterFirstResponseTimestamp  : shared_xml.afterFirstResponseTimestamp,

                startDelivery                : new Buffer('<StopMonitoringDelivery><ResponseTimestamp>'),

                afterSecondResponseTimestamp : shared_xml.afterSecondResponseTimestamp,
                afterValidUntil              : shared_xml.afterValidUntil,

                startTrainsData              : new Buffer('<MonitoredStopVisit>'),
                
                //startNonemptyMonitoredCall
                //startNonemptyOnwardCalls 
                //endNonemptyOnwardCalls
                //emptyMonitoredCall
                //emptyOnwardCalls

                endTrainsData                : new Buffer('</MonitoredStopVisit></StopMonitoringDelivery>'),

                beginSituationExchange       : shared_xml.beginSituationExchangeDelivery,

                endResponse                  : shared_xml.endResponse,
            },
        },

        
        vehicleMonitoring = {
            json : {
                beginResponse                : shared_json.beginResponse,
                afterFirstResponseTimestamp  : shared_json.afterFirstResponseTimestamp,

                startDelivery                : new Buffer('"VehicleMonitoringDelivery":[{"ResponseTimestamp":"'),

                afterSecondResponseTimestamp : shared_json.afterSecondResponseTimestamp,
                afterValidUntil              : shared_json.afterValidUntil,

                startTrainsData              : new Buffer('"VehicleActivity":['),
                
                //startNonemptyMonitoredCall
                //startNonemptyOnwardCalls 
                //endNonemptyOnwardCalls
                //emptyMonitoredCall
                //emptyOnwardCalls

                endTrainsData                : shared_json.endTrainsData,

                beginSituationExchange       : shared_json.beginSituationExchangeDelivery,

                endResponse                  : shared_json.endResponse,
            },

            xml : {
                beginResponse                : shared_xml.beginResponse,

                afterFirstResponseTimestamp  : shared_xml.afterFirstResponseTimestamp,

                startDelivery                : new Buffer('<VehicleMonitoringDelivery><ResponseTimestamp>'),

                afterSecondResponseTimestamp : shared_xml.afterSecondResponseTimestamp,
                afterValidUntil              : shared_xml.afterValidUntil,

                startTrainsData              : new Buffer('<VehicleActivity>'),
                
                //startNonemptyMonitoredCall
                //startNonemptyOnwardCalls 
                //endNonemptyOnwardCalls
                //emptyMonitoredCall
                //emptyOnwardCalls

                endTrainsData                : new Buffer('</VehicleActivity></VehicleMonitoringDelivery>'),

                beginSituationExchange       : shared_xml.beginSituationExchangeDelivery,

                endResponse                  : shared_xml.endResponse,
            },

        };

    return {
        stopMonitoring    : stopMonitoring,
        vehicleMonitoring : vehicleMonitoring,
    };
}());



var responseTimestampLength = timeUtils.getTimestamp().length;



var generalResponsePiecesLength = (function () {

    function getSumLengthOfPieces (deliveryType, dataFormat) {
        return Object.keys(generalResponseChunks[deliveryType][dataFormat])
                     .reduce(function(sum, key) { 
                                 return sum + generalResponseChunks[deliveryType][dataFormat][key].length; 
                             }, (3 * responseTimestampLength));
    }

    return {
        stopMonitoring : {
            json : getSumLengthOfPieces('stopMonitoring', 'json'),
            xml  : getSumLengthOfPieces('stopMonitoring', 'xml'),
        },

        vehicleMonitoring : {
            json : getSumLengthOfPieces('vehicleMonitoring', 'json'),
            xml : getSumLengthOfPieces('vehicleMonitoring', 'xml'),
        }
    };
}());


var firstTimestampOffset = {
    stopMonitoring : {
        json : generalResponseChunks.stopMonitoring.json.beginResponse.length,
        xml : generalResponseChunks.stopMonitoring.xml.beginResponse.length,
    },

    vehicleMonitoring : {
        json : generalResponseChunks.stopMonitoring.json.beginResponse.length,
        xml : generalResponseChunks.stopMonitoring.xml.beginResponse.length,
    },
};



var secondTimestampOffset = (function () {
    function getOffset (deliveryType, dataFormat) {
        return generalResponseChunks[deliveryType][dataFormat].beginResponse.length +
               responseTimestampLength +
               generalResponseChunks[deliveryType][dataFormat].afterFirstResponseTimestamp.length +
               generalResponseChunks[deliveryType][dataFormat].startDelivery.length;
    }

    return {
        stopMonitoring : {
            json : getOffset('stopMonitoring', 'json'),
            xml : getOffset('stopMonitoring', 'xml'),
        },
        vehicleMonitoring : {
            json : getOffset('vehicleMonitoring', 'json'),
            xml : getOffset('vehicleMonitoring', 'xml'),
        },
    };
}());



function applyTimestamps (deliveryType, dataFormat, res) {
    var responseTimestamp = new Buffer(timeUtils.getTimestamp());

    responseTimestamp.copy(res, firstTimestampOffset[deliveryType][dataFormat]);
    responseTimestamp.copy(res, secondTimestampOffset[deliveryType][dataFormat]);
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

    var responseChunks = generalResponseChunks[deliveryType][dataFormat],
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
            var minLength = generalResponsePiecesLength[deliveryType][dataFormat],
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
                        monitoredCallLen = perTrainChunks[dataFormat].startNonemptyMonitoredCall.length + 
                                           callMetadata.length;
                    } else {
                        monitoredCallLen = perTrainChunks[dataFormat].emptyMonitoredCall.length;
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

                        onwardCallsLen = perTrainChunks[dataFormat].startNonemptyOnwardCalls.length                   +
                                         (((lastOnwardCall.offset + lastOnwardCall.length) - firstOnwardCall.offset)) +
                                         perTrainChunks[dataFormat].endNonemptyOnwardCalls.length;

                        if (dataFormat === 'json') { --onwardCallsLen; }

                    } else {
                        onwardCallsLen = perTrainChunks[dataFormat].emptyOnwardCalls.length;
                    }
                 } else {
                    monitoredCallLen = perTrainChunks[dataFormat].emptyMonitoredCall.length;
                    onwardCallsLen = perTrainChunks[dataFormat].emptyOnwardCalls.length;
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
            console.error(e.stack);
            callback(e);
        }
    }

    function initTheResponseBuffer (overallLen, callback) {
        try {
            var offset = 0;

            respBuffer = new Buffer(overallLen);
            respBuffer.fill(); // This is simply so bugs don't leak out old data that's in the memory.

            offset += responseChunks.beginResponse.copy(respBuffer);
            offset += responseTimestampLength; //This is copied in later so that buffer may be reused.
            offset += responseChunks.afterFirstResponseTimestamp.copy(respBuffer, offset);
            offset += responseChunks.startDelivery.copy(respBuffer, offset);
            offset += responseTimestampLength; //This is copied in later so that buffer may be reused.
            offset += responseChunks.afterSecondResponseTimestamp.copy(respBuffer, offset);
            offset += that.validUntil.copy(respBuffer, offset);
            offset += responseChunks.afterValidUntil.copy(respBuffer, offset);
            offset += responseChunks.startTrainsData.copy(respBuffer, offset);

            callback(null, respBuffer, offset);

        } catch (e) {
            console.error(e.stack);
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
                offset += perTrainChunks[dataFormat].startNonemptyMonitoredCall.copy(respBuffer, offset);

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

                    offset += perTrainChunks[dataFormat].startNonemptyOnwardCalls.copy(respBuffer, offset);
                    
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

                    offset += perTrainChunks[dataFormat].endNonemptyOnwardCalls.copy(respBuffer, offset);

                } else {
                    offset += perTrainChunks[dataFormat].emptyOnwardCalls.copy(respBuffer, offset);
                }

             } else {
                offset += perTrainChunks[dataFormat].emptyMonitoredCall.copy(respBuffer, offset);
                offset += perTrainChunks[dataFormat].emptyOnwardCalls.copy(respBuffer, offset);
             }
           
            callback(null, respBuffer, offset);

        } catch (e) {
            console.error(e.stack);
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
            console.error(e.stack);
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
                console.error(e.stack);
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
        
        operatorRef          = (getParams.OperatorRef) ? getParams.OperatorRef.trim() : 'MTA' ,
        train_id             = (getParams.VehicleRef) && getParams.VehicleRef.trim()          ,
        route_id             = (getParams.LineRef) && getParams.LineRef.trim()                ,
        directionRef         = parseInt(getParams.DirectionRef)                               ,
        maxStopVisits        = parseInt(getParams.MaximumStopVisits)                          ,
        minStopVisitsPerLine = parseInt(getParams.MinimumStopVisitsPerLine)                   ,

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

    /* If either of these cases hold, the response would be empty. */
    if ((maxStopVisits === 0) || (operatorRef !== 'MTA')) { 
        return []; 
    }

    /* If a train is specified, return only that train. */
    if (train_id) { 
        //Make sure train exists.
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

        operatorRef          = getParams.OperatorRef || 'MTA'               ,
        route_id             = getParams.LineRef                            ,
        directionRef         = parseInt(getParams.DirectionRef)             ,
        maxStopVisits        = parseInt(getParams.MaximumStopVisits)        ,
        minStopVisitsPerLine = parseInt(getParams.MinimumStopVisitsPerLine) ,

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


var xml_special_char_regex = /[<>&'"]/g;

function xml_char_escaper (c) {
    switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
    }
}



function bufferMonitoredVehicleJourneys (vehicleActivity) {
    var journey,

        curOffset_json,
        curOffset_xml,

        allJourneys_json = [],
        allJourneys_xml  = [],

        journey_json,
        journey_xml,

        len_json,
        len_xml,

        train_id,
        byTrainsIndex_json = {},   /* train_id : [offset, length] */
        byTrainsIndex_xml  = {},   /* train_id : [offset, length] */

        route_id,

        /* { route_id : [ train_id ] } */
        partitionedByRoute = {},

        /* { route_id : { direction : [ train_id ] } }*/
        partitionedByRouteByDirection = {},

        direction,
        directionBloomFilters = {},

        i;

    // Going to need a { route_id : [ trains sorted by usefulness to apps ] }

    // Calls are buffered separately by the bufferCalls function.
    // This function is used in a reduce below to remove the calls 
    // from the journey object.
    function omitCalls (acc, key) {
        if ( (key === 'MonitoredCall') || (key === 'OnwardCalls') ) { return acc; }

        acc[key] = journey.MonitoredVehicleJourney[key];

        return acc;
    }

    curOffset_json = 0;
    curOffset_xml  = 0;

    for ( i = 0; i < vehicleActivity.length; ++i ) {

        journey   = vehicleActivity[i];
        train_id  = journey.MonitoredVehicleJourney.VehicleRef;
        route_id  = journey.MonitoredVehicleJourney.LineRef;
        direction = journey.MonitoredVehicleJourney.DirectionRef;

        if ( ! partitionedByRoute[route_id] ) {
            partitionedByRoute[route_id] = [];
            partitionedByRouteByDirection[route_id] = {};
        }

        if ( ! partitionedByRouteByDirection[route_id][direction] ) {
            partitionedByRouteByDirection[route_id][direction] = [];
        }

        partitionedByRoute[route_id].push(train_id);
        partitionedByRouteByDirection[route_id][direction].push(train_id);

        if ( ! directionBloomFilters[direction] ) {
            directionBloomFilters[direction] = {};
        }
        directionBloomFilters[direction][train_id] = true;

        /* NOTE: The following mutated the object. */
        /* Removes calls and the timestamp.        */
        journey = { 
            MonitoredVehicleJourney: Object.keys(journey.MonitoredVehicleJourney).reduce(omitCalls, {}) 
        };

        journey_json = JSON.stringify(journey);
        len_json = journey_json.length;
        byTrainsIndex_json[train_id] = [curOffset_json, len_json];

        if ( xml_special_char_regex.test(train_id) ) {
            journey.MonitoredVehicleJourney.VehicleRef = 
                train_id.replace(xml_special_char_regex, xml_char_escaper);
        } 
        journey_xml = jsontoxml(journey);
        len_xml = journey_xml.length;
        byTrainsIndex_xml[train_id] = [curOffset_xml, len_xml];

        allJourneys_json.push(journey_json);
        allJourneys_xml.push(journey_xml);

        curOffset_json += len_json;
        curOffset_xml  += len_xml;
    }

    return {
        bufferedJourneys : {
            json : new Buffer (allJourneys_json.join('')) ,
            xml  : new Buffer (allJourneys_xml.join(''))  ,
        },

        byTrainsIndex : {
            json : byTrainsIndex_json ,
            xml  : byTrainsIndex_xml  ,
        },

        partitionedByRoute            : partitionedByRoute ,
        partitionedByRouteByDirection : partitionedByRouteByDirection ,
        directionBloomFilters         : directionBloomFilters ,
    };
}




function bufferCalls (vehicleActivity) {
    var i, ii;
    
        /* train_id : [ { eta      : eta      ,
                          route_id : route_id , } ];   */
    var trainsToCallsMetadataIndex = {},

        /* NOTE: values in trainsToCallsMetadataIndex and byTrainsIndex_* are parallel arrays. */
        /*       with the following structure.
        /*           train_id : [ {   offset : curOffset  ,
                                      length : len        , } ]; */
        byTrainsIndex_json = {},       
        byTrainsIndex_xml  = {},       

        /* for each stop, allows lookup of how many calls away a train is. */
        /* { stop_id  : { train_id  : index_into_trainsMetadatIndex/byTrainsIndex_* } }     */
        stopIDToCallNumberForTrain = {},         

        /* { stop_id  : { route_id : train_id : 1 } } } */
        /* for each stop, allows lookup of whether a train serves a route that visits the stop. */
        routesFilter = {},   

        /* { stop_id : [trains] } */
        trainsSortedByETAForStop, 

        /* { stop_id : { route_id : [trains] } } } */
        /* partitions the trainsSortedByETAForStop by route. */
        indicesOfTrainsSortedByETAForStopByRoute, 

        /* { stop_id : { direction : [trains] } } } */
        /* partitions the trainsSortedByETAForStop by direction. */
        indicesOfTrainsSortedByETAForStopByRouteByDirection, 

        metadata_node,

        json_node      , 
        curOffset_json , 
        call_json      , 
        len_json       , 

        xml_node      ,
        curOffset_xml ,
        call_xml      ,
        len_xml       ,

        allCalls_json = [], 
        allCalls_xml  = [],

        // Helpers for computation.
        onwardCalls,
        train_id,
        route_id,
        journey,
        stop_id,
        call,
        eta;


    curOffset_json = 0;
    curOffset_xml  = 0;


    for ( i = 0; i < vehicleActivity.length; ++i ) {
        journey = vehicleActivity[i].MonitoredVehicleJourney;
        onwardCalls = journey.OnwardCalls;
        train_id = journey.VehicleRef;
        route_id = journey.LineRef;

        trainsToCallsMetadataIndex[train_id] = [];
        byTrainsIndex_json[train_id]         = [];
        byTrainsIndex_xml[train_id]          = [];

        // Loop over the onward calls for the train.
        for ( ii = 0; ii < onwardCalls.length; ++ii ) {

            call    = onwardCalls[ii];
            stop_id = call.StopPointRef;
            eta     = call.ExpectedArrivalTime;

            /*================ metadata ==============*/
            metadata_node = {
                eta      : eta       ,
                route_id : route_id  ,
            };

            trainsToCallsMetadataIndex[train_id].push(metadata_node);
            /*========================================*/           


            /*========== stopID to call num ==========*/
            if ( ! stopIDToCallNumberForTrain[stop_id] ) {
                stopIDToCallNumberForTrain[stop_id] = {};
            }
            stopIDToCallNumberForTrain[stop_id][train_id] = trainsToCallsMetadataIndex[train_id].length - 1;
            /*=====================================*/           


            /*========== Routes BloomFilter ==========*/
            if ( ! routesFilter[stop_id] ) {
                routesFilter[stop_id] = {};
            }

            if ( ! routesFilter[stop_id][route_id] ) {
                routesFilter[stop_id][route_id] = {};
            }

            routesFilter[stop_id][route_id][train_id] = 1;
            /*=====================================*/           


            /*========== Buffer the JSON ==========*/           
            call_json = JSON.stringify(call);
            allCalls_json.push(call_json);
            allCalls_json.push(',');
            len_json  = call_json.length + 1; // adding commas

            json_node = {
                offset   : curOffset_json ,
                length   : len_json       ,
            };
            curOffset_json += len_json;

            byTrainsIndex_json[train_id].push(json_node);
            /*=====================================*/           


            /*========== Buffer the XML ===========*/           
            call_xml = jsontoxml(call);
            allCalls_xml.push(call_xml);
            len_xml  = call_xml.length;

            xml_node = {
                offset   : curOffset_xml ,
                length   : len_xml       ,
            };
            curOffset_xml  += (len_xml);

            byTrainsIndex_xml[train_id].push(xml_node);
            /*=====================================*/           
        }
    }

    function etaComparator (stop_id, train_A_id, train_B_id) {
      try { 
           var etaA = trainsToCallsMetadataIndex[train_A_id][stopIDToCallNumberForTrain[stop_id][train_A_id]].eta,
               etaB = trainsToCallsMetadataIndex[train_B_id][stopIDToCallNumberForTrain[stop_id][train_B_id]].eta;

           return etaA - etaB;
      } catch (e) {
        console.error(e.stack);
        console.error('ERROR: ConverterCache.etaComparator.', util(e));
      }
    }

    trainsSortedByETAForStop = Object.keys(stopIDToCallNumberForTrain).reduce(function (acc, stop_id) {
        var etaComp = etaComparator.bind(null, stop_id);

        acc[stop_id] = Object.keys(stopIDToCallNumberForTrain[stop_id]).sort(etaComp);

        return acc;
    }, {});


    indicesOfTrainsSortedByETAForStopByRoute = {};
    indicesOfTrainsSortedByETAForStopByRouteByDirection = {};
    (function () { // For scoping variables.
        var all_stop_ids = Object.keys(trainsSortedByETAForStop),
            direction,
            route_id,
            metadata,
            stop_id,
            train_id,
            call_num,
            trains,
            i, ii;

        for ( i = 0; i < all_stop_ids.length; ++i ) {
            stop_id = all_stop_ids[i];
            trains  = trainsSortedByETAForStop[stop_id];

            indicesOfTrainsSortedByETAForStopByRoute[stop_id] = {};
            indicesOfTrainsSortedByETAForStopByRouteByDirection[stop_id] = {};
            for ( ii = 0; ii < trains.length; ++ii ) {
                train_id  = trains[ii];
                call_num  = stopIDToCallNumberForTrain[stop_id][train_id];
                metadata  = trainsToCallsMetadataIndex[train_id][call_num];
                route_id  = metadata.route_id;
                direction = metadata.direction;

                // Partition by route.
                if ( ! indicesOfTrainsSortedByETAForStopByRoute[stop_id][route_id] ) {
                    indicesOfTrainsSortedByETAForStopByRoute[stop_id][route_id] = [];
                    indicesOfTrainsSortedByETAForStopByRouteByDirection[stop_id][route_id] = {};
                } 
                indicesOfTrainsSortedByETAForStopByRoute[stop_id][route_id].push(ii);

                // Parition by route and direction.
                if ( ! indicesOfTrainsSortedByETAForStopByRouteByDirection[stop_id][route_id][direction] ) {
                    indicesOfTrainsSortedByETAForStopByRouteByDirection[stop_id][route_id][direction] = [];
                } 
                indicesOfTrainsSortedByETAForStopByRouteByDirection[stop_id][route_id][direction].push(ii);
            } 
        }
    }());

    return {
        calls : {
            json : new Buffer(allCalls_json.join('')) ,
            xml  : new Buffer(allCalls_xml.join(''))  ,
        },

        byTrainsIndex : {
            json : byTrainsIndex_json ,
            xml  : byTrainsIndex_xml  ,
        },

        stopIDToCallNumberForTrain : stopIDToCallNumberForTrain ,

        routesFilter : routesFilter ,

        trainsSortedByETAForStop : trainsSortedByETAForStop ,

        indicesOfTrainsSortedByETAForStopByRoute : indicesOfTrainsSortedByETAForStopByRoute ,

        indicesOfTrainsSortedByETAForStopByRouteByDirection : indicesOfTrainsSortedByETAForStopByRouteByDirection ,
    };
}


function bufferSituationExchange (converter, situationExchangeDelivery) {
    var stringified_json = JSON.stringify(situationExchangeDelivery),

        description      = (situationExchangeDelivery                               &&
                            situationExchangeDelivery.Situations                    &&
                            situationExchangeDelivery.Situations.PtSituationElement &&
                            situationExchangeDelivery.Situations.PtSituationElement.Description) || null;

    if (description) {
        situationExchangeDelivery.Situations.PtSituationElement.Description = 
            description.replace(xml_special_char_regex, xml_char_escaper);
    }

    return {
        situationExchangeDelivery : {
            json : new Buffer(stringified_json),
            xml  : new Buffer(jsontoxml(situationExchangeDelivery)),
        },
    };
}


module.exports = ConverterCache;


