/**
 * @module MTA_Subway_GTFS-Realtime_to_SIRI_Converter
 */

'use strict';

var util      = require('util')      ,
    async     = require('async')     ,
    jsontoxml = require('jsontoxml') ,

    timeUtils = require('./utils/timeUtils');



var generalResponsePieces = (function () {
    var shared_json = {
            beginning                      : new Buffer('{"SIRI":{"ServiceDelivery":{"ResponseTimestamp":"'),
            afterFirstResponseTimestamp    : new Buffer('",'),

            afterSecondResponseTimestamp   : new Buffer('","ValidUntil":"'),
            afterValidUntil                : new Buffer('",'),

            startMonitoredCall             : new Buffer(',"MonitoredCall":'),
            endMonitoredCall               : new Buffer(','),

            startOnwardCalls               : new Buffer(',"OnwardCalls":['),
            endOnwardCalls                 : new Buffer('],'),

            afterVehicleActivity           : new Buffer('],"SituationExchangeDelivery":['),

            ending                         : new Buffer(']}}}'),
        },

        
        stopMonitoringDelivery = {
            json : {
                beginning                      : shared_json.beginning,
                afterFirstResponseTimestamp    : shared_json.afterFirstResponseTimestamp,

                startDelivery                  : new Buffer('"StopMonitoringDelivery":[{"ResponseTimestamp":"'),

                afterSecondResponseTimestamp   : shared_json.afterSecondResponseTimestamp,
                afterValidUntil                : shared_json.afterValidUntil,

                startMonitoredStopVisit        : new Buffer('"MonitoredStopVisit:["'),

                startMonitoredCall             : shared_json.startMonitoredCall,
                endMonitoredCall               : shared_json.endMonitoredCall,

                startOnwardCalls               : shared_json.startOnwardCalls,
                endOnwardCalls                 : shared_json.endOnwardCalls,

                afterMonitoredStopVisit        : new Buffer('],"SituationExchangeDelivery":['),

                ending                         : shared_json.ending,
            },
        },

        
        vehicleMonitoringDelivery = {
            json : {
                beginning                      : shared_json.beginning,
                afterFirstResponseTimestamp    : shared_json.afterFirstResponseTimestamp,

                startDelivery                  : new Buffer('"VehicleMonitoringDelivery":[{"ResponseTimestamp":"'),

                afterSecondResponseTimestamp   : shared_json.afterSecondResponseTimestamp,
                afterValidUntil                : shared_json.afterValidUntil,

                startVehicleActivity           : new Buffer('"VehicleActivity":['),

                startMonitoredCall             : shared_json.startMonitoredCall,
                endMonitoredCall               : shared_json.endMonitoredCall,

                startOnwardCalls               : shared_json.startOnwardCalls,
                endOnwardCalls                 : shared_json.endOnwardCalls,

                afterVehicleActivity           : new Buffer('],"SituationExchangeDelivery":['),

                ending                         : shared_json.ending,
            },
        };

    return {
        stopMonitoringDelivery    : stopMonitoringDelivery,
        vehicleMonitoringDelivery : vehicleMonitoringDelivery,
    };
}());


var responseTimestampLength = timeUtils.getTimestamp().length;


var generalResponsePiecesLength = (function () {

    function getSumLengthOfPieces (deliveryType, dataFormat) {
        return Object.keys(generalResponsePieces[deliveryType][dataFormat])
                     .reduce(function(sum, key) { 
                                 return sum + generalResponsePieces[deliveryType][dataFormat][key].length; 
                             }, (2 * responseTimestampLength));
    }

    return {
        stopMonitoringDelivery : {
            json : getSumLengthOfPieces('stopMonitoringDelivery', 'json'),
            xml  : null, //TODO
        },

        vehicleMonitoringDelivery : {
            json : getSumLengthOfPieces('vehicleMonitoringDelivery', 'json'),
            xml  : null, //TODO
        }
    };
}());


var firstTimestampOffset = {
    stopMonitoringDelivery : {
        json : generalResponsePieces.stopMonitoringDelivery.beginning.length,
        xml  : null, //TODO
    },

    vehicleMonitoringDelivery : {
        json : generalResponsePieces.stopMonitoringDelivery.beginning.length,
        xml  : null, //TODO
    },
};

var secondTimestampOffset = (function () {
    function getOffset (deliveryType, dataFormat) {
        return generalResponsePieces[deliveryType][dataFormat].beginning.length +
               responseTimestampLength +
               generalResponsePieces[deliveryType][dataFormat].startDelivery.length;
    }

    return {
        stopMonitoringDelivery : {
            json : getOffset('stopMonitoringDelivery', 'json'),
            xml  : null, //TODO
        },
        vehicleMonitoringDelivery : {
            json : getOffset('vehicleMonitoringDelivery', 'json'),
            xml  : null, //TODO
        },
    };
}());

var ConverterCache = function (converter) {
    var vehicleMonitoringResponse = converter.getVehicleMonitoringResponse({}).response;
    var vehicleActivity = vehicleMonitoringResponse.Siri.ServiceDelivery.VehicleMonitoringDelivery.VehicleActivity;

    // The following order is important as bufferMonitoredVehicleJourneys mutates the objects.
    this.bufferedCalls = bufferCalls(vehicleActivity);
    this.bufferedMonitoredVehicleJourneys = bufferMonitoredVehicleJourneys(vehicleActivity);
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
| DirectionRef                |  A filter by GTFS direction ID (optional).  Either 0 or 1.            | //TODO
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
+ ----------------------------+-----------------------------------------------------------------------+
*/
ConverterCache.prototype.getVehicleMonitoringResponse = function (getParams, dataFormat, callback) {
    var getParams                 = getParams || {}  /* jshint ignore:line */       ,
        stopMonitoringDetailLevel = getParams.VehicleMonitoringDetailLevel          ,
        maxOnwardCalls            = parseInt(getParams.MaximumNumberOfCallsOnwards) ,

        //responseTimestamp,
        requestedTrains = getRequestedTrainsForVehicleMonitoringResponse.call(this, getParams);

    buildVehicleMonitoringReponse(requestedTrains, stopMonitoringDetailLevel, maxOnwardCalls, 'json', function (response) {
        applyTimestamp('vehicleMonitoringDelivery', dataFormat, response);
        callback(response);
    });
};

function applyTimestamp (deliveryType, dataFormat, res) {
    var responseTimestamp = new Buffer(timeUtils.getTimestamp());

    responseTimestamp.copy(res, firstTimestampOffset[deliveryType][dataFormat]);
    responseTimestamp.copy(res, secondTimestampOffset[deliveryType][dataFormat]);
}

function buildVehicleMonitoringReponse (requestedTrains, 
                                        stopMonitoringDetailLevel, 
                                        maxOnwardCalls, 
                                        dataFormat, 
                                        respCallback) {
    /* jshint validthis: true */

    var that = this;

    var respBuffer;

    function getLengthOfResponse (callback) {
        var overallLen = generalResponsePiecesLength.vehicleMonitoringDelivery[dataFormat];

        overallLen += requestedTrains.reduce(function (acc, train_id) {
            var metadata      = that.bufferedMonitoredVehicleJourneys.byTrainsIndex.json[train_id],
                journeyLength = metadata[1],
                indexNode,
                callLen,
                onwardCalls,
                firstOnwardCall,
                lastOnwardCall;
           
            // Need to handle VehicleMonitoringDetailLevel, MaximumNumberOfCallsOnwards 
            if (that.bufferedCalls.byTrainsIndex.json[train_id][0]) {
                indexNode = that.bufferedCalls.byTrainsIndex.json[train_id][0];
                callLen = indexNode.length;

                onwardCalls = that.bufferedCalls.byTrainsIndex.json[train_id];

                if ( ! isNaN(maxOnwardCalls) ) {
                   onwardCalls.splice(0, maxOnwardCalls) ;
                }
                firstOnwardCall = onwardCalls[0];
                lastOnwardCall  = onwardCalls[onwardCalls.length - 1];

                callLen = ((lastOnwardCall.offset + lastOnwardCall.length) - firstOnwardCall.offset) ;
             }
          
            return acc + journeyLength + callLen;

        }, overallLen);

        overallLen += (requestedTrains.length - 1); // commas

        callback(null, overallLen);
    }

    function initTheResponseBuffer (overallLen, callback) {
        var offset = 0;

        respBuffer = new Buffer(overallLen);

        offset = generalResponsePieces.vehicleMonitoringDelivery[dataFormat].beginning.copy(respBuffer);

        offset += responseTimestampLength;

        offset += generalResponsePieces.vehiclemonitoringdelivery[dataFormat]
                                       .afterfirstresponsetimestamp.copy(respBuffer, offset);

        callback(null, respBuffer, offset);
    }


    function pipeTrain (requestedTrain, respBuffer, offset, callback) {
        /* jshint validthis: true */
        var metadata   = this.bufferedMonitoredVehicleJourneys.byTrainsIndex.json[requestedTrain],
            dataOffset = metadata[0],
            len        = metadata[1];

        offset += this.bufferedMonitoredVehicleJourneys.bufferedJourneys.json.copy(respBuffer, 
                                                                                   offset, 
                                                                                   dataOffset, 
                                                                                   dataOffset + len);
        offset -=2; //2 parens that end the MonitoredVehicleJourney

        offset += generalResponsePieces.vehicleMonitoringDelivery[dataFormat]
                                       .startMonitoredCall.copy(respBuffer, offset);

        if (this.bufferedCalls.byTrainsIndex.json[requestedTrain]) {
            var indexNode = this.bufferedCalls.byTrainsIndex.json[requestedTrain][0];
            var callOffset = indexNode.offset;
            var callLen = indexNode.length;

            offset += this.bufferedCalls.calls.json.copy(respBuffer, 
                                                         offset, 
                                                         callOffset, 
                                                         callOffset + callLen);

            var onwardCallsStart = '"OnwardCalls":{"OnwardCall":[';
            offset += respBuffer.write(onwardCallsStart, offset, onwardCallsStart.length);

            if (((typeof stopMonitoringDetailLevel) === 'string') && (stopMonitoringDetailLevel.trim() === 'calls')) {
                var onwardCalls = this.bufferedCalls.byTrainsIndex.json[requestedTrain];
                var firstOnwardCall, lastOnwardCall;

                if ( ! isNaN(maxOnwardCalls) ) {
                   onwardCalls.splice(0, maxOnwardCalls) ;
                }
                firstOnwardCall = onwardCalls[0];
                lastOnwardCall = onwardCalls[onwardCalls.length - 1];

                this.bufferedCalls.calls.json.copy(respBuffer,  
                                                   offset, 
                                                   firstOnwardCall.offset, 
                                                   lastOnwardCall.offset + lastOnwardCall.length);

                offset += ((lastOnwardCall.offset + lastOnwardCall.length) - firstOnwardCall.offset) ;
            }

            --offset; //comma
            offset += respBuffer.write(']}}},', offset);
         } else {
            --offset; //comma
            offset += respBuffer.write('}}},', offset); //This is untested. Rare case.
         }
       
        callback(null, respBuffer, offset);
    }

    function finito (respBuffer, offset) {
        --offset; //last comma
        offset += generalResponsePieces.vehicleMonitoringDelivery[dataFormat]
                                       .afterVehicleActivity.copy(respBuffer, offset); 

        generalResponsePieces.vehicleMonitoringDelivery
                             .afterSituationExchangeDelivery.copy(respBuffer, offset);
        
        respCallback(respBuffer);
    } 

    var tasks = requestedTrains.reduce(function (acc, train_id) { 
                    acc.push(pipeTrain.bind(that, train_id)); return acc; 
                }, [getLengthOfResponse, initTheResponseBuffer]);
    
    async.series(tasks, finito);
}


function getRequestedTrainsForVehicleMonitoringResponse (getParams) {
    /*jshint validthis:true */

        /* Extract the filters from the params. */
    var operatorRef          = (getParams.OperatorRef) ? getParams.OperatorRef.trim() : 'MTA' ,
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
        return [train_id]; 
    }

    if ( route_id && !isNaN(directionRef) ) { // Both route and directionRef are specified.
        reqTrainsByRoute = [ this.bufferedMonitoredVehicleJourneys //FIXME: Defensive code agains undefined.
                                       .partitionedByRouteByDirection[route_id][directionRef] ];
    } else if ( route_id ) { // We have a route, but no direction.
        reqTrainsByRoute = [ this.bufferedMonitoredVehicleJourneys.partitionedByRoute[route_id] ];
    } else if ( ! isNaN(directionRef) ) {  // Only direction specified.
        routes = Object.keys(this.bufferedMonitoredVehicleJourneys.partitionedByRoute);

        reqTrainsByRoute = routes.map(function (_route_id) { 
             return this.bufferedMonitoredVehicleJourneys.partitionedByRouteByDirection[_route_id][directionRef];
        });
    } else { // Neither route nor direction specified.
        routes = Object.keys(this.bufferedMonitoredVehicleJourneys.partitionedByRoute);

        reqTrainsByRoute = routes.map(function (_route_id) { 
             return this.bufferedMonitoredVehicleJourneys.partitionedByRoute[_route_id];
        });
    }
    
    // How many trains total?
    totalStopVisits = reqTrainsByRoute.reduce(function (acc, arr) { return acc + arr.length; }, 0);
    
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

            next_fill_train = reqTrainsByRoute[routesWithMoreThanMin[i].arrIndex][routesWithMoreThanMin[i].offset];

            fillIndices.push(next_fill_train);
            ++countOfRequiredTrains;

            // If we have exhausted a list, remove it from consideration.
            if (++routesWithMoreThanMin[i].offset === reqTrainsByRoute[routesWithMoreThanMin[i].arrIndex].length) {
                routesWithMoreThanMin.slice(i, 1);
            }

            ++i;
        }


        // Put all the train indices into a single array.
        requestedTrains = minTrainsForRoutes.push(fillIndices)
                                          .reduce(function (acc, arr) { return acc.concat(arr); }, []);

    } else { //Under the max limit, just concat the arrays.
        requestedTrains = reqTrainsByRoute.reduce(function (acc, arr) { return acc.concat(arr); }, []);
    }

    // From trainIndices to train_ids.
    return requestedTrains;
}


//write into resp
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
+ ----------------------------+-----------------------------------------------------------------------+
*/
ConverterCache.prototype.getStopMonitoringResponse = function (getParams, resp, callback) {
    var getParams                 = getParams || {} /* jshint ignore:line */  ,
        //stopMonitoringDetailLevel = getParams.StopMonitoringDetailLevel       ,
        //maxNumberOfCallsOnwards   = getParams.MaximumNumberOfCallsOnwards     ,

        requestedTrains = getRequestedTrainsForStopMonitoringResponse.call(this, getParams);

    console.log(requestedTrains);

    callback();
};

function getRequestedTrainsForStopMonitoringResponse (getParams) {
    /* jshint validthis:true */

    var operatorRef          = getParams.OperatorRef || 'MTA'               ,
        stop_id              = getParams.MonitoringRef                      ,
        route_id             = getParams.LineRef                            ,
        directionRef         = parseInt(getParams.DirectionRef)             ,
        maxStopVisits        = parseInt(getParams.MaximumStopVisits)        ,
        minStopVisitsPerLine = parseInt(getParams.MinimumStopVisitsPerLine) ,

        indexForStop,

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

    indexForStop = this.bufferedCalls.stopIDToCallNumberForTrain[stop_id];

    // Cases where there's nothing to do.
    if ((!indexForStop) || (maxStopVisits === 0) || (operatorRef !== 'MTA')) { return []; }

    if ( route_id && !isNaN(directionRef) ) { // Both route and directionRef are specified.
        reqTrainIndicesByRoute = [ this.bufferedCalls
                                       .indicesOfTrainsSortedByETAForStopByRoute[stop_id][route_id][directionRef] ];
    } else if ( route_id ) { // We have a route, but no direction.
        reqTrainIndicesByRoute = [ this.bufferedCalls.indicesOfTrainsSortedByETAForStopByRoute[stop_id][route_id] ];
    } else if ( ! isNaN(directionRef) ) {  // Only direction specified.
        routes = Object.keys(this.bufferedCalls.indicesOfTrainsSortedByETAForStopByRoute[stop_id]);

        reqTrainIndicesByRoute = routes.map(function (_route_id) { 
             return this.bufferedCalls.indicesOfTrainsSortedByETAForStopByRouteByDirection[stop_id][_route_id][directionRef];
        });
    } else { // Neither route nor direction specified.
        routes = Object.keys(this.bufferedCalls.indicesOfTrainsSortedByETAForStopByRoute[stop_id]);

        reqTrainIndicesByRoute = routes.map(function (_route_id) { 
             return this.bufferedCalls.indicesOfTrainsSortedByETAForStopByRoute[stop_id][_route_id];
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
                routesWithMoreThanMin.slice(minRoute, 1);
            }
        }


        // Put all the train indices into a single array.
        reqTrainIndices = minTrainIndicesForRoutes.push(fillIndices)
                                          .reduce(function (acc, arr) { return acc.concat(arr); }, []);

    } else { //Under the max limit, just concat the arrays.
        reqTrainIndices = reqTrainIndicesByRoute.reduce(function (acc, arr) { return acc.concat(arr); }, []);
    }

    // From trainIndices to train_ids.
    return reqTrainIndices.map(function (train_index) {
        return  this.bufferedCalls.trainsSortedByETAForStop[stop_id][train_index];
    });
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

        /* train_id : [ {   offset : curOffset  ,
                            length : len        , } ]; */
        byTrainsIndex_json = {},       
        byTrainsIndex_xml  = {},       

        /* NOTE: trainsToCallsMetadataIndex and byTrainsIndex_* are parallel arrays. */

        /* { stop_id  : { train_id  : index_into_trainsMetadatIndex } }     */
        /* for each stop, allows lookup of how many calls away a train is. */
        stopIDToCallNumberForTrain = {},         

        /* { stop_id  : { route_id : train_id : 1 } } } */
        /* for each stop, allows lookup of whether a train serves a route that visits the stop. */
        routesBloomFilter = {},   

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
        byTrainsIndex_json[train_id]  = [];
        byTrainsIndex_xml[train_id]   = [];

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
            if ( ! routesBloomFilter[stop_id] ) {
                routesBloomFilter[stop_id] = {};
            }

            if ( ! routesBloomFilter[stop_id][route_id] ) {
                routesBloomFilter[stop_id][route_id] = {};
            }

            routesBloomFilter[stop_id][route_id][train_id] = 1;
            /*=====================================*/           


            /*========== Buffer the JSON ==========*/           
            call_json = JSON.stringify(call);
            allCalls_json.push(call_json);
            allCalls_json.push(',');
            len_json  = call_json.length + 1; // adding commas
            curOffset_json += (len_json);

            json_node = {
                offset   : curOffset_json ,
                length   : len_json       ,
            };

            byTrainsIndex_json[train_id].push(json_node);
            /*=====================================*/           


            /*========== Buffer the XML ===========*/           
            call_xml = jsontoxml(call);
            allCalls_xml.push(call_xml);
            len_xml  = call_xml.length;
            curOffset_xml  += (len_xml);

            xml_node = {
                offset   : curOffset_xml ,
                length   : len_xml       ,
            };
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

        routesBloomFilter          : routesBloomFilter          ,

        trainsSortedByETAForStop   : trainsSortedByETAForStop   ,

        indicesOfTrainsSortedByETAForStopByRoute : indicesOfTrainsSortedByETAForStopByRoute     ,

        indicesOfTrainsSortedByETAForStopByRouteByDirection : indicesOfTrainsSortedByETAForStopByRouteByDirection ,
    };
}


module.exports = ConverterCache;
