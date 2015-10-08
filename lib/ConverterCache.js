/**
 * @module MTA_Subway_GTFS-Realtime_to_SIRI_Converter
 */

'use strict';

var once = true;

var async     = require('async')     ,
    jsontoxml = require('jsontoxml') ,

    timeUtils = require('./utils/timeUtils');

/* jshint unused: false */



var start = new Buffer('{"SIRI":{"ServiceDelivery":{"ResponseTimestamp":"'),
    afterResponseTimestamp = new Buffer('","VehicleMonitoringDelivery":[{"VehicleActivity":['),
    afterVehicleActivity = new Buffer('],"SituationExchangeDelivery":['),
    afterSituationExchangeDelivery = new Buffer(']}]}}}');


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
ConverterCache.prototype.getVehicleMonitoringResponse = function (getParams, resp, respCallback) {
    var getParams                 = getParams || {}  /* jshint ignore:line */       ,
        stopMonitoringDetailLevel = getParams.VehicleMonitoringDetailLevel          ,
        maxOnwardCalls            = parseInt(getParams.MaximumNumberOfCallsOnwards) ,

        requestedTrains = getRequestedTrainsForVehicleMonitoringResponse.call(this, getParams),
        metadata,
        offset,
        overallLen,
        len,
        i;
    
    var that = this;
    var respBuffer;
    var monitoredCallStart = new Buffer(',"MonitoredCall":');

    overallLen = 0;
    offset = 0;
    function init (callback) {
        var indexNode,
            callOffset,
            callLen = 0;

        overallLen += start.length                           +
                      afterResponseTimestamp.length          +
                      afterVehicleActivity.length            +
                      afterSituationExchangeDelivery.length;

        overallLen = requestedTrains.reduce(function (acc, train_id) {
            metadata = that.bufferedMonitoredVehicleJourneys.byTrainsIndex_json[train_id];
            var journeyLength = metadata[1];
            
            if (that.bufferedCalls.byTrainsIndex_json[train_id][0]) {
                indexNode = that.bufferedCalls.byTrainsIndex_json[train_id][0];
                callLen = indexNode.length;

                var onwardCalls = that.bufferedCalls.byTrainsIndex_json[train_id];
                var firstOnwardCall, lastOnwardCall, callsLen;
                if ( ! isNaN(maxOnwardCalls) ) {
                   onwardCalls.splice(0, maxOnwardCalls) ;
                }
                firstOnwardCall = onwardCalls[0];
                lastOnwardCall = onwardCalls[onwardCalls.length - 1];

                callLen = ((lastOnwardCall.offset + lastOnwardCall.length) - firstOnwardCall.offset) ;
             }
          
            return acc + journeyLength + callLen + monitoredCallStart.length + callLen;

        }, overallLen);


        overallLen += (requestedTrains.length - 1); // commas
        
        respBuffer = new Buffer(overallLen); //

        start.copy(respBuffer); //
        offset += start.length;

        var responseTimestamp = new Buffer(timeUtils.getTimestamp());//
        responseTimestamp.copy(respBuffer, offset);//
        offset += responseTimestamp.length;

        afterResponseTimestamp.copy(respBuffer, offset);//
        offset += afterResponseTimestamp.length;

        callback();
    }

    var trainCounter = 0;
    function pipeTrain (requestedTrain, callback) {
        /* jshint validthis: true */
        var metadata   = this.bufferedMonitoredVehicleJourneys.byTrainsIndex_json[requestedTrain],
            dataOffset = metadata[0];
            len        = metadata[1];

        this.bufferedMonitoredVehicleJourneys.bufferedJourneys_json.copy(respBuffer, 
                                                                         offset, 
                                                                         dataOffset, 
                                                                         dataOffset + len);
        offset += len;

        offset -=2; //2 parens that end the MonitoredVehicleJourney
        monitoredCallStart.copy(respBuffer, offset, 0, monitoredCallStart.length);
        offset += monitoredCallStart.length;

        if (this.bufferedCalls.byTrainsIndex_json[requestedTrain]) {
            var indexNode = this.bufferedCalls.byTrainsIndex_json[requestedTrain][0];
            var callOffset = indexNode.offset;
            var callLen = indexNode.length;

            this.bufferedCalls.bufferedCalls_json.copy(respBuffer, offset, callOffset, callOffset + callLen);
            offset += callLen;

            var onwardCallsStart = '"OnwardCalls":{"OnwardCall":[';
            respBuffer.write(onwardCallsStart, offset, onwardCallsStart.length);
            offset += onwardCallsStart.length;

            if (((typeof stopMonitoringDetailLevel) === 'string') && (stopMonitoringDetailLevel.trim() === 'calls')) {
                var onwardCalls = this.bufferedCalls.byTrainsIndex_json[requestedTrain];
                var firstOnwardCall, lastOnwardCall, callsLen;
                if ( ! isNaN(maxOnwardCalls) ) {
                   onwardCalls.splice(0, maxOnwardCalls) ;
                }
                firstOnwardCall = onwardCalls[0];
                lastOnwardCall = onwardCalls[onwardCalls.length - 1];

                this.bufferedCalls.bufferedCalls_json.copy(respBuffer,  
                                                           offset, 
                                                           firstOnwardCall.offset, 
                                                           lastOnwardCall.offset + lastOnwardCall.length);

                offset += ((lastOnwardCall.offset + lastOnwardCall.length) - firstOnwardCall.offset) ;
            }

            --offset; //comma
            respBuffer.write(']}}},', offset, 5);
            offset += 5;
         } else {
            --offset; //comma
            respBuffer.write('}}},', offset, 4); //This is untested. Rare case.
         }
       
        callback();
    }

    function finito (callback) {
        --offset; //last comma
        afterVehicleActivity.copy(respBuffer, offset, 0, afterVehicleActivity.length); //
        offset += (afterVehicleActivity.length);
        afterSituationExchangeDelivery.copy(respBuffer, offset, 0, afterSituationExchangeDelivery.length); //
        offset += afterSituationExchangeDelivery.length;
        
        resp.writeHead(200, {
            "Content-Type": "application/json",
            'Content-Length': offset,
        });

        resp.write(respBuffer.slice(0, offset));

        respCallback();
    } 

    var tasks = requestedTrains.reduce(function (acc, train_id) { acc.push(pipeTrain.bind(that, train_id)); return acc; }, [init]);
    
    async.series(tasks, finito);
};



function getRequestedTrainsForVehicleMonitoringResponse (getParams) {
    /*jshint validthis:true */

    var that                 = this,
        operatorRef          = (getParams.OperatorRef) ? getParams.OperatorRef.trim() : 'MTA' ,
        train_id             = (getParams.VehicleRef) && getParams.VehicleRef.trim()          ,
        route_id             = (getParams.LineRef) && getParams.LineRef.trim()                ,
        directionRef         = parseInt(getParams.DirectionRef)                               ,
        maxStopVisits        = parseInt(getParams.MaximumStopVisits)                          ,

        requestedTrains;


    if ((maxStopVisits === 0) || (operatorRef !== 'MTA')) { return []; }

    if (train_id) { return [train_id]; }

    if (route_id) { requestedTrains = this.bufferedMonitoredVehicleJourneys.partitionedByRoute[route_id]; }

    if ( ! isNaN(directionRef) ) { 
        if (requestedTrains) {
            requestedTrains.filter(function (train_id) { 
                return that.bufferedMonitoredVehicleJourneys.directionBloomFilters[directionRef][train_id]; });
        } else {
            requestedTrains = Object.keys(that.bufferedMonitoredVehicleJourneys.directionBloomFilters[directionRef]);
        }
    }


    return Object.keys(this.bufferedMonitoredVehicleJourneys.byTrainsIndex_json);
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
| DirectionRef                |  A filter by GTFS direction ID (optional).  Either 0 or 1.            | //TODO
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
        stopMonitoringDetailLevel = getParams.StopMonitoringDetailLevel       ,
        maxNumberOfCallsOnwards   = getParams.MaximumNumberOfCallsOnwards     ,

        requestedTrains = getRequestedTrainsForStopMonitoringResponse.call(this, getParams);

    console.log(requestedTrains);

    callback();
};

function getRequestedTrainsForStopMonitoringResponse (getParams) {
    /*jshint validthis:true */

    var that                 = this                                            ,
        operatorRef          = getParams.OperatorRef || 'MTA'                  ,
        stop_id              = getParams.MonitoringRef                         ,
        route_id             = getParams.LineRef                               ,
        directionRef         = parseInt(getParams.DirectionRef)                ,//TODO
        maxStopVisits        = parseInt(getParams.MaximumStopVisits)           ,
        minStopVisitsPerLine = parseInt(getParams.MinimumStopVisitsPerLine)    ,

        indexForStop,

        routes,
        trainIndicesForRoute,
        trainIndicesForRoutes,
        trainIndicesForRoutesFillMerged,
        trainsForResponse,

        requestedTrains,

        i, ii;

    indexForStop = this.bufferedCalls.byStopIndex[stop_id];

    if ( ! stop_id ) {
        console.log('No MonitoringRef.');
    }

    if ((!indexForStop) || (maxStopVisits === 0) || (operatorRef !== 'MTA')) { return []; }

    if ( route_id ) {
        var routesBloomFilter = that.bufferedCalls.routesBloomFilter[stop_id][route_id];
        requestedTrains = routesBloomFilter ? Object.keys(that.bufferedCalls.routesBloomFilter[stop_id][route_id]) : [];
    }

    if ( ! isNaN(directionRef) ) { 
        if (requestedTrains) {
            requestedTrains.filter(function (train_id) { 
                return that.bufferedMonitoredVehicleJourneys.directionBloomFilters[directionRef][train_id]; });
        } else {
            requestedTrains = Object.keys(that.bufferedMonitoredVehicleJourneys.directionBloomFilters[directionRef]);
        }
    }

    requestedTrains = requestedTrains || Object.keys(indexForStop);

    if ( (!isNaN(maxStopVisits))  && 
                (maxStopVisits !== null) && 
                (maxStopVisits < requestedTrains.length) ) {

            if ( (! route_id) && (!isNaN(minStopVisitsPerLine)) && (minStopVisitsPerLine === null) ) {
                routes = Object.keys(this.bufferedCalls.sortedTrainsPartedByRoute[stop_id]);

                trainIndicesForRoutes = [];

                for ( i = 0; i < routes.length; ++i ) {
                    trainIndicesForRoute = this.bufferedCalls.sortedTrainsPartedByRoute[stop_id][routes[i]];
                    trainIndicesForRoutes.push(trainIndicesForRoute.slice(0, minStopVisitsPerLine));
                }

                trainIndicesForRoutesFillMerged = mergeFillArrays(trainIndicesForRoutes, maxStopVisits);
                requestedTrains = trainIndicesForRoutesFillMerged.map(function (index) {
                                    return  this.bufferedCalls.trainsSortedByETA[index];
                                  });
            } else {
                requestedTrains = requestedTrains.slice(0, maxStopVisits);
            }
    } 

    return requestedTrains;
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

        bufferedJourneys_json,
        bufferedJourneys_xml,

        train_id,
        byTrainsIndex_json = {},   /* train_id : [offset, length] */
        byTrainsIndex_xml = {},   /* train_id : [offset, length] */

        route_id,
        partitionedByRoute = {},

        direction,
        directionBloomFilters = {},

        i;


    function omitCalls (acc, key) {
        if ( (key === 'MonitoredCall') || (key === 'OnwardCalls') ) { return acc; }

        acc[key] = journey.MonitoredVehicleJourney[key];
        return acc;
    }


    curOffset_json = 0;
    curOffset_xml  = 0;
    for ( i = 0; i < vehicleActivity.length; ++i ) {
        journey  = vehicleActivity[i];
        train_id = journey.MonitoredVehicleJourney.VehicleRef;
        route_id = journey.MonitoredVehicleJourney.LineRef;
        direction = journey.MonitoredVehicleJourney.DirectionRef;

        if ( ! partitionedByRoute[route_id] ) {
            partitionedByRoute[route_id] = [];
        }

        if ( ! directionBloomFilters[direction] ) {
            directionBloomFilters[direction] = {};
        }

        directionBloomFilters[direction][train_id] = true;

        partitionedByRoute[route_id].push(train_id);

        journey.MonitoredVehicleJourney = Object.keys(journey.MonitoredVehicleJourney).reduce(omitCalls, {});

        journey = { MonitoredVehicleJourney: journey.MonitoredVehicleJourney }; //remove the timestamp

        journey_json = JSON.stringify(journey);
        allJourneys_json.push(journey_json);
        len_json = journey_json.length;
        byTrainsIndex_json[train_id] = [curOffset_json, len_json];
        
        journey_xml = jsontoxml(journey);
        len_xml = journey_xml.length;
        byTrainsIndex_xml[train_id] = [curOffset_xml, len_xml];
        allJourneys_xml.push(journey_xml);

        curOffset_json += len_json;
        curOffset_xml  += len_xml;
    }

    bufferedJourneys_json = new Buffer (allJourneys_json.join(''));
    bufferedJourneys_xml  = new Buffer (allJourneys_xml.join(''));

    return {
        bufferedJourneys_json : bufferedJourneys_json ,
        byTrainsIndex_json    : byTrainsIndex_json    ,

        bufferedJourneys_xml  : bufferedJourneys_xml  ,
        byTrainsIndex_xml     : byTrainsIndex_xml     ,

        partitionedByRoute    : partitionedByRoute    ,

        directionBloomFilters : directionBloomFilters ,
    };
}


function bufferCalls (vehicleActivity) {
    var curOffset,
        i, ii;
    
    var bufferedCalls_json,
        bufferedCalls_xml,

        /* train_id : [ { eta      : eta      ,
                          route_id : route_id , } ];   */
        trainsMetadataIndex = {},

        /* train_id : [ {   offset : curOffset  ,
                            length : len        , } ]; */
        byTrainsIndex_json = {},       
        byTrainsIndex_xml  = {},       

        /* { stop_id  : { trip_id  : indexNumber } }   */
        byStopIndex = {},         

        /* { stop_id  : { route_id : trip_id : 1 } } } */
        routesBloomFilter = {},   

        trainsSortedByETA, 

        /* { stop_id : { route_id : [trains] } } } */
        sortedTrainsPartedByRoute, 

        metadata_node,

        json_node      , xml_node      ,
        curOffset_json , curOffset_xml ,
        call_json      , call_xml      ,
        len_json       , len_xml       ,

        allCalls_json = [], 
        allCalls_xml  = [],

        // Helpers for computation.
        onwardCalls,
        train_id,
        route_id,
        journey,
        stop_id,
        index,
        call,
        eta;



    curOffset_json = 0;
    curOffset_xml  = 0;

    for ( i = 0; i < vehicleActivity.length; ++i ) {
        journey = vehicleActivity[i].MonitoredVehicleJourney;
        onwardCalls = journey.OnwardCalls;
        train_id = journey.VehicleRef;
        route_id = journey.LineRef;

        trainsMetadataIndex[train_id] = [];
        byTrainsIndex_json[train_id]  = [];
        byTrainsIndex_xml[train_id]   = [];

        
        for ( ii = 0; ii < onwardCalls.length; ++ii ) {
            call = onwardCalls[ii];

            call_json = JSON.stringify(call);
            allCalls_json.push(call_json);
            allCalls_json.push(',');
            len_json  = call_json.length + 1; // adding commas

            call_xml = jsontoxml(call);
            allCalls_xml.push(call_xml);
            len_xml  = call_xml.length;

            stop_id = call.StopPointRef;

            eta = call.ExpectedArrivalTime;
            
            if ( ! byStopIndex[stop_id] ) {
                byStopIndex[stop_id] = {};
            }

            if ( ! routesBloomFilter[stop_id] ) {
                routesBloomFilter[stop_id] = {};
            }

            if ( ! routesBloomFilter[stop_id][route_id] ) {
                routesBloomFilter[stop_id][route_id] = {};
            }

            metadata_node = {
                eta      : eta       ,
                route_id : route_id  ,
            };

            json_node = {
                offset   : curOffset_json ,
                length   : len_json       ,
            };

            xml_node = {
                offset   : curOffset_xml ,
                length   : len_xml       ,
            };

            trainsMetadataIndex[train_id].push(metadata_node);
            byTrainsIndex_json[train_id].push(json_node);
            byTrainsIndex_xml[train_id].push(xml_node);

            byStopIndex[stop_id][train_id] = trainsMetadataIndex[train_id].length - 1;

            routesBloomFilter[stop_id][route_id][train_id] = 1;

            curOffset_json += (len_json);
            curOffset_xml  += (len_xml);
        }
    }

    function etaComparator (stop_id, train_A_id, train_B_id) {
      try { 
           var etaA = trainsMetadataIndex[train_A_id][byStopIndex[stop_id][train_A_id]].eta,
               etaB = trainsMetadataIndex[train_B_id][byStopIndex[stop_id][train_B_id]].eta;

           return etaA - etaB;
      } catch (e) {
          //debugger ;
      }
    }

    trainsSortedByETA = Object.keys(byStopIndex).reduce(function (acc, stop_id) {
        var etaComp = etaComparator.bind(null, stop_id);

        acc[stop_id] = Object.keys(byStopIndex[stop_id]).sort(etaComp);

        return acc;
    }, {});


    sortedTrainsPartedByRoute = Object.keys(trainsSortedByETA).reduce(function (acc, stop_id) {
        var trains = trainsSortedByETA[stop_id],
            route_id;

        acc[stop_id] = {};

        for ( i = 0; i < trains.length; ++i ) {
            route_id = trainsMetadataIndex[trains[i]][byStopIndex[stop_id][trains[i]]].route_id;

            if ( ! acc[stop_id][route_id] ) {
                acc[stop_id][route_id] = [];
            } 

            acc[stop_id][route_id].push(i);

            return acc;
        } 
    }, {});

    bufferedCalls_json = new Buffer(allCalls_json.join(''));
    bufferedCalls_xml  = new Buffer(allCalls_xml.join(''));

    return {
        bufferedCalls_json        : bufferedCalls_json        ,
        bufferedCalls_xml         : bufferedCalls_xml         ,
        byTrainsIndex_json        : byTrainsIndex_json        ,
        byTrainsIndex_xml         : byTrainsIndex_xml         ,
        byStopIndex               : byStopIndex               ,
        routesBloomFilter         : routesBloomFilter         ,
        trainsSortedByETA         : trainsSortedByETA         ,
        sortedTrainsPartedByRoute : sortedTrainsPartedByRoute ,
    };
}

function mergeFillArrays (arrArr, maxStopVisits) {
    var i = 0,
        merged = [],
        minArr,
        min,
        sumLengths = arrArr.reduce(function (acc, arr) { return acc + arr.length; }, 0),
        fillNum = maxStopVisits - sumLengths;

    while (arrArr.length) {
        minArr = 0;
        min = arrArr[0][0]; 

        if (isNaN(min)) { 
            arrArr.shift();
            continue;
        } 
        
        if ((arrArr.length === 1) && (fillNum === 0)) {
            merged.concat(arrArr[0]);
            break;
        }

        for ( i = 1; i < arrArr.length; ++i ) {
            if (arrArr[i][0] < min) {
                min = arrArr[i][0];
                minArr = i;
            }
        }

        while ((fillNum > 0) && (min < merged.length)) {
            --fillNum;
            merged.push(merged.length);
        }

        merged.push(arrArr[minArr].shift());
    }

    return merged;
}

function sendEmptyStopMonitoringResponse (resp) { /*TODO*/ }


module.exports = ConverterCache;
