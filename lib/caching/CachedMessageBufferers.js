"use strict";


var util      = require('util') ,
    jsontoxml = require('jsontoxml') ;


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

        agency_id,
        agency_ids = {}, /* agency_id : true */

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

        // TODO: Should the following try to convert toString if data are not strings?
        //       Assumes the upstream code outputs streams, but no type enforcement in JS.
        agency_id = (journey.MonitoredVehicleJourney.OperatorRef && 
                     journey.MonitoredVehicleJourney.OperatorRef.toLowerCase)     ?
                        journey.MonitoredVehicleJourney.OperatorRef.toLowerCase() :
                        journey.MonitoredVehicleJourney.OperatorRef;
        train_id  = (journey.MonitoredVehicleJourney.VehicleRef && 
                     journey.MonitoredVehicleJourney.VehicleRef.toLowerCase)     ?
                        journey.MonitoredVehicleJourney.VehicleRef.toLowerCase() :
                        journey.MonitoredVehicleJourney.VehicleRef;
        route_id  = (journey.MonitoredVehicleJourney.LineRef && 
                     journey.MonitoredVehicleJourney.LineRef.toLowerCase)     ?
                        journey.MonitoredVehicleJourney.LineRef.toLowerCase() :
                        journey.MonitoredVehicleJourney.LineRef;
        direction = (journey.MonitoredVehicleJourney.DirectionRef &&
                     journey.MonitoredVehicleJourney.DirectionRef.toLowerCase)     ?
                        journey.MonitoredVehicleJourney.DirectionRef.toLowerCase() :
                        journey.MonitoredVehicleJourney.DirectionRef;

        agency_ids[agency_id] = true;

        // NOTE: Do not handle the null train_id case... should we ???

        // Remove the agency_id prefix from the route_id
        if (route_id !== null) { // We do not index null route_ids

            route_id = (route_id.replace) ? route_id.replace(agency_id + '_', '') : route_id;

            if ( ! partitionedByRoute[route_id] ) {
                partitionedByRoute[route_id] = [];
                partitionedByRouteByDirection[route_id] = {};
            }
            partitionedByRoute[route_id].push(train_id);

            if (direction !== null) { // We do not index null directions.

                if ( ! partitionedByRouteByDirection[route_id][direction] ) {
                    partitionedByRouteByDirection[route_id][direction] = [];
                }

                partitionedByRouteByDirection[route_id][direction].push(train_id);

                if ( ! directionBloomFilters[direction] ) {
                    directionBloomFilters[direction] = {};
                }
                directionBloomFilters[direction][train_id] = true;
            }
        }

        /* NOTE: The following mutates the object. */
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
        agency_ids : agency_ids,

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
        train_id = (journey.VehicleRef && journey.VehicleRef.toLowerCase) ?
                        journey.VehicleRef.toLowerCase() : journey.VehicleRef;
        route_id = (journey.LineRef && journey.LineRef) ?
                        journey.LineRef.toLowerCase() : journey.LineRef;

        trainsToCallsMetadataIndex[train_id] = [];
        byTrainsIndex_json[train_id]         = [];
        byTrainsIndex_xml[train_id]          = [];

        // Loop over the onward calls for the train.
        for ( ii = 0; ii < onwardCalls.length; ++ii ) {

            call    = onwardCalls[ii];
            stop_id = (call.StopPointRef && call.StopPointRef.toLowerCase) ? 
                        call.StopPointRef.toLowerCase() : call.StopPointRef;
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
        console.error(e.stack || e);
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
                route_id  = metadata && metadata.route_id;
                direction = metadata && metadata.direction;

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

        description = (situationExchangeDelivery                               &&
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


module.exports = {
    bufferMonitoredVehicleJourneys : bufferMonitoredVehicleJourneys,
    bufferCalls                    : bufferCalls,
    bufferSituationExchange        : bufferSituationExchange,
};
