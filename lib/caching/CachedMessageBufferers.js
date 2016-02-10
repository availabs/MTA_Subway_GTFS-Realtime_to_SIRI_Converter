"use strict";


var util      = require('util') ,
    jsontoxml = require('jsontoxml') ;


var xml_special_char_regex = /[<>&'"]/g;

function xml_char_escaper (c) {
    switch (c) {
        case '<'  : return '&lt;'   ;
        case '>'  : return '&gt;'   ;
        case '&'  : return '&amp;'  ;
        case '\'' : return '&apos;' ;
        case '"'  : return '&quot;' ;
    }
}


/* This function *MUST* be called before bufferMonitoredVehicleJourneys 
 * as that function removes the calls from the JSON objects. */ 
function bufferCalls (vehicleActivity) {
    /* jshint validthis: true */

    var i, ii;
    
        /* gtfsTripKey : [ { eta      : eta      ,
                          route_id : route_id , } ];   */
    var tripKeysToCallsMetadataIndex = {},

        /* NOTE: values in tripKeysToCallsMetadataIndex and byTripKeysIndex_* are parallel arrays. 
         *       byTripKeysIndex_* entries are keyed by gtfsTripKey. The values are objects 
         *       with the following structure:
         *
         *           gtfsTripKey : [ {   offset : curOffset  ,
         *                            length : len        , } ]; 
         */                           
        byTripKeysIndex_json = {},       
        byTripKeysIndex_xml  = {},       

        /* for each stop, allows lookup of how many calls away a tripKey is. 
         * { stop_id : { 
         *                gtfsTripKey : index_into_tripKeysMetadatIndex/byTripKeysIndex_* } 
         *             }                                                              
         */
        stopIDToCallNumberForTripKey = {},         

        /* { stop_id  : { route_id : gtfsTripKey : 1 } } } */
        /* for each stop, allows lookup of whether a tripKey serves a route that visits the stop. */
        routesFilter = {},   

        /* { stop_id : [tripKeys] } */
        tripKeysSortedByETAForStop, 

        /* { stop_id : { route_id : [tripKeys] } } } */
        /* partitions the tripKeysSortedByETAForStop by route. */
        indicesOfTripKeysSortedByETAForStopByRoute, 

        /* { stop_id : { direction : [tripKeys] } } } */
        /* partitions the tripKeysSortedByETAForStop by direction. */
        indicesOfTripKeysSortedByETAForStopByRouteByDirection, 

        metadata_node,

        json_node , 
        curOffset_json , 
        call_json , 
        len_json , 

        xml_node ,
        curOffset_xml ,
        call_xml ,
        len_xml ,

        allCalls_json = [], 
        allCalls_xml  = [],

        // Helpers for computation.
        onwardCalls,
        datedVehicleJourneyRef,
        gtfsTripKey,
        route_id,
        mvj,
        stop_id,
        call,
        eta;


    curOffset_json = 0;
    curOffset_xml  = 0;


    for ( i = 0; i < vehicleActivity.length; ++i ) {

        mvj = vehicleActivity[i].MonitoredVehicleJourney;

        onwardCalls = mvj.OnwardCalls;


        datedVehicleJourneyRef = mvj.FramedVehicleJourneyRef.DatedVehicleJourneyRef;

        // Note: We temporarily leave the unschedule trips' DatedVehicleJourneyRefs with the 
        //       unscheduled trip indicator so that they may be used in bufferMonitoredVehicleJourneys.
        gtfsTripKey = this.datedVehicleJourneyRef_to_gtfsTripKeyTable[datedVehicleJourneyRef];

        datedVehicleJourneyRef = (datedVehicleJourneyRef && datedVehicleJourneyRef.toLowerCase) ? 
                                        datedVehicleJourneyRef.toLowerCase() : datedVehicleJourneyRef;

        route_id = (mvj.LineRef && mvj.LineRef) ? mvj.LineRef.toLowerCase() : mvj.LineRef;

        tripKeysToCallsMetadataIndex[gtfsTripKey] = [];
        byTripKeysIndex_json[gtfsTripKey]         = [];
        byTripKeysIndex_xml[gtfsTripKey]          = [];

        // Loop over the onward calls for the tripKey.
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

            tripKeysToCallsMetadataIndex[gtfsTripKey].push(metadata_node);
            /*========================================*/           


            /*========== stopID to call num ==========*/
            if ( ! stopIDToCallNumberForTripKey[stop_id] ) {
                stopIDToCallNumberForTripKey[stop_id] = {};
            }
            stopIDToCallNumberForTripKey[stop_id][gtfsTripKey] = tripKeysToCallsMetadataIndex[gtfsTripKey].length - 1;
            /*=====================================*/           


            /*========== Routes BloomFilter ==========*/
            if ( ! routesFilter[stop_id] ) {
                routesFilter[stop_id] = {};
            }

            if ( ! routesFilter[stop_id][route_id] ) {
                routesFilter[stop_id][route_id] = {};
            }

            routesFilter[stop_id][route_id][gtfsTripKey] = 1;
            /*=====================================*/           


            /*========== Buffer the JSON ==========*/           
            call_json = JSON.stringify(call);
            allCalls_json.push(call_json);
            allCalls_json.push(',');
            len_json  = call_json.length + 1; // adding commas

            json_node = {
                offset : curOffset_json ,
                length : len_json       ,
            };
            curOffset_json += len_json;

            byTripKeysIndex_json[gtfsTripKey].push(json_node);
            /*=====================================*/           


            /*========== Buffer the XML ===========*/           
            call_xml = jsontoxml(call);
            allCalls_xml.push(call_xml);
            len_xml  = call_xml.length;

            xml_node = {
                offset : curOffset_xml ,
                length : len_xml       ,
            };
            curOffset_xml  += (len_xml);

            byTripKeysIndex_xml[gtfsTripKey].push(xml_node);
            /*=====================================*/           
        }
    }

    function etaComparator (stop_id, gtfsTripKeyA, gtfsTripKeyB) {
      try { 

           var etaA = tripKeysToCallsMetadataIndex[gtfsTripKeyA]
                                                  [stopIDToCallNumberForTripKey[stop_id][gtfsTripKeyA]].eta,
               etaB = tripKeysToCallsMetadataIndex[gtfsTripKeyB]
                                                  [stopIDToCallNumberForTripKey[stop_id][gtfsTripKeyB]].eta;

           return etaA - etaB;

      } catch (e) {
        console.error(e.stack || e);
        console.error('ERROR: ConverterCache.etaComparator.', util(e));
      }
    }

    tripKeysSortedByETAForStop = Object.keys(stopIDToCallNumberForTripKey).reduce(function (acc, stop_id) {
        var etaComp = etaComparator.bind(null, stop_id);

        acc[stop_id] = Object.keys(stopIDToCallNumberForTripKey[stop_id]).sort(etaComp);

        return acc;
    }, {});


    indicesOfTripKeysSortedByETAForStopByRoute = {};
    indicesOfTripKeysSortedByETAForStopByRouteByDirection = {};

    (function () { // For scoping variables.
        var all_stop_ids = Object.keys(tripKeysSortedByETAForStop),
            direction,
            route_id,
            metadata,
            stop_id,
            key,
            call_num,
            tripKeys,
            i, ii;

        for ( i = 0; i < all_stop_ids.length; ++i ) {
            stop_id = all_stop_ids[i];
            tripKeys  = tripKeysSortedByETAForStop[stop_id];

            indicesOfTripKeysSortedByETAForStopByRoute[stop_id] = {};
            indicesOfTripKeysSortedByETAForStopByRouteByDirection[stop_id] = {};
            for ( ii = 0; ii < tripKeys.length; ++ii ) {
                key       = tripKeys[ii];
                call_num  = stopIDToCallNumberForTripKey[stop_id][key];
                metadata  = tripKeysToCallsMetadataIndex[key][call_num];
                route_id  = metadata && metadata.route_id;
                direction = metadata && metadata.direction;

                // Partition by route.
                if ( ! indicesOfTripKeysSortedByETAForStopByRoute[stop_id][route_id] ) {
                    indicesOfTripKeysSortedByETAForStopByRoute[stop_id][route_id] = [];
                    indicesOfTripKeysSortedByETAForStopByRouteByDirection[stop_id][route_id] = {};
                } 
                indicesOfTripKeysSortedByETAForStopByRoute[stop_id][route_id].push(ii);

                // Parition by route and direction.
                if ( ! indicesOfTripKeysSortedByETAForStopByRouteByDirection[stop_id][route_id][direction] ) {
                    indicesOfTripKeysSortedByETAForStopByRouteByDirection[stop_id][route_id][direction] = [];
                } 
                indicesOfTripKeysSortedByETAForStopByRouteByDirection[stop_id][route_id][direction].push(ii);
            } 
        }
    }());


    return {
        calls : {
            json : new Buffer(allCalls_json.join('')) ,
            xml  : new Buffer(allCalls_xml.join(''))  ,
        },

        byTripKeysIndex : {
            json : byTripKeysIndex_json ,
            xml  : byTripKeysIndex_xml  ,
        },

        stopIDToCallNumberForTripKey : stopIDToCallNumberForTripKey ,

        routesFilter : routesFilter ,

        tripKeysSortedByETAForStop : tripKeysSortedByETAForStop ,

        indicesOfTripKeysSortedByETAForStopByRoute : indicesOfTripKeysSortedByETAForStopByRoute ,

        indicesOfTripKeysSortedByETAForStopByRouteByDirection : indicesOfTripKeysSortedByETAForStopByRouteByDirection ,
    };
}



function bufferMonitoredVehicleJourneys (vehicleActivity) {
    /* jshint validthis: true */

    var journey,
        mvj,     /* journey.MonitoredVehicleJourney */

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

        datedVehicleJourneyRef,
        gtfsTripKey,

        // used in this.vehicleRef_to_gtfsTripKey for filtering on query results on VehicleRef.
        vehicleRef,

        byTripKeysIndex_json = {},   /* gtfsTripKey : [offset, length] */
        byTripKeysIndex_xml  = {},   /* gtfsTripKey : [offset, length] */

        route_id,

        /* { route_id : [ gtfsTripKey ] } */
        partitionedByRoute = {},

        /* { route_id : { direction : [ gtfsTripKey ] } }*/
        partitionedByRouteByDirection = {},

        direction,
        directionBloomFilters = {},

        i;

    // Going to need a { route_id : [ tripKeys sorted by usefulness to apps ] }

    // Calls are buffered separately by the bufferCalls function.
    // This function is used in a reduce below to remove the calls from the journey object.
    function omitCalls (acc, key) {
        if ( (key === 'MonitoredCall') || (key === 'OnwardCalls') ) { return acc; }

        // Note: this function is called in the below for-loop. 
        //       The value of mvj is defined within the loop.
        //       The mvj variable is declared in the surrounding scope.
        acc[key] = mvj[key];

        return acc;
    }

    curOffset_json = 0;
    curOffset_xml  = 0;

    for ( i = 0; i < vehicleActivity.length; ++i ) {

        journey = vehicleActivity[i];
        mvj     = journey && journey.MonitoredVehicleJourney; 

        // TODO: Should the following try to convert toString if data are not strings?
        //       Assumes the upstream code outputs stings, but no type enforcement in JS.
        agency_id = (mvj.OperatorRef && mvj.OperatorRef.toLowerCase) ?  
                        mvj.OperatorRef.toLowerCase() : mvj.OperatorRef;

        datedVehicleJourneyRef = mvj.FramedVehicleJourneyRef.DatedVehicleJourneyRef;

        gtfsTripKey = this.datedVehicleJourneyRef_to_gtfsTripKeyTable[datedVehicleJourneyRef];

        datedVehicleJourneyRef = (datedVehicleJourneyRef && datedVehicleJourneyRef.toLowerCase) ?
                                    datedVehicleJourneyRef.toLowerCase() : datedVehicleJourneyRef;

        
        vehicleRef = (mvj.VehicleRef && mvj.VehicleRef.toLowerCase) ?
                       mvj.VehicleRef.toLowerCase() : mvj.VehicleRef;

        // The FramedVehicleJourneyRef.DatedVehicleJourneyRef is the GTFS trip ID for trip the vehicle is serving, 
        // prefixed by the GTFS agency ID. For unscheduled tripKeys, this value does not exist.
        // However, we need a way to map the MonitoredVehicleJourney back to the vehicle's 
        // GTFS-Realtime data. We therefore keep the gtfsTripKey in the SIRI feed message
        // to allow for this mapping, though prefixed by a character that indicates that the
        // vehicle is serving an unscheduled trip. This field now is overwritten with null for
        // unscheduled trips.
        if ( (datedVehicleJourneyRef && datedVehicleJourneyRef.charAt) && 
             (datedVehicleJourneyRef.charAt(0) === this.unscheduledTripIndicator)) {

                mvj.FramedVehicleJourneyRef.DatedVehicleJourneyRef = 
                    mvj.FramedVehicleJourneyRef.DatedVehicleJourneyRef.substring(1) || null;
        } 

        route_id  = (mvj.LineRef && mvj.LineRef.toLowerCase) ?
                        mvj.LineRef.toLowerCase() : mvj.LineRef;

        direction = (mvj.DirectionRef && mvj.DirectionRef.toLowerCase) ?
                        mvj.DirectionRef.toLowerCase() : mvj.DirectionRef;

        agency_ids[agency_id] = true;

        // NOTE: Do not handle the null gtfsTripKey case... should we ???

        // Remove the agency_id prefix from the route_id
        if (route_id !== null) { // We do not index null route_ids

            // Because the query parameter for LineRef does not include the agency_id,
            // we remove the agency_id prefix while creating index keys.
            route_id = (route_id.replace) ? route_id.replace(agency_id + '_', '') : route_id;

            if ( ! partitionedByRoute[route_id] ) {
                partitionedByRoute[route_id] = [];
                partitionedByRouteByDirection[route_id] = {};
            }
            partitionedByRoute[route_id].push(gtfsTripKey);

            if (direction !== null) { // We do not index null directions.

                if ( ! partitionedByRouteByDirection[route_id][direction] ) {
                    partitionedByRouteByDirection[route_id][direction] = [];
                }

                partitionedByRouteByDirection[route_id][direction].push(gtfsTripKey);

                if ( ! directionBloomFilters[direction] ) {
                    directionBloomFilters[direction] = {};
                }
                directionBloomFilters[direction][gtfsTripKey] = true;
            }
        }

        /* NOTE: THE FOLLOWING MUTATES THE OBJECT. */
        /*       Removes calls and the timestamp.  */
        journey = { 
            MonitoredVehicleJourney: Object.keys(journey.MonitoredVehicleJourney).reduce(omitCalls, {}) 
        };


        /*========== Buffer the JSON ==========*/           
        journey_json = JSON.stringify(journey);
        len_json = journey_json.length;
        byTripKeysIndex_json[gtfsTripKey] = [curOffset_json, len_json];
        
        allJourneys_json.push(journey_json);
        curOffset_json += len_json;
        /*=====================================*/           


        /*========== Buffer the XML ===========*/           

        // Some tripKey ids can break the xml encoding. We need to escape those.
        if ( xml_special_char_regex.test(mvj.VehicleRef) ) {
            mvj.VehicleRef = mvj.VehicleRef.replace(xml_special_char_regex, xml_char_escaper);
        } 
        journey_xml = jsontoxml(journey);
        len_xml = journey_xml.length;
        byTripKeysIndex_xml[gtfsTripKey] = [curOffset_xml, len_xml];

        allJourneys_xml.push(journey_xml);
        curOffset_xml  += len_xml;
        /*=====================================*/           

        vehicleRef = (mvj.VehicleRef && mvj.VehicleRef.toLowerCase) ?
                       mvj.VehicleRef.toLowerCase() : mvj.VehicleRef;

        this.vehicleRef_to_gtfsTripKey[vehicleRef] = gtfsTripKey; 
    }


    return {
        agency_ids : agency_ids,

        bufferedJourneys : {
            json : new Buffer (allJourneys_json.join('')) ,
            xml  : new Buffer (allJourneys_xml.join(''))  ,
        },

        byTripKeysIndex : {
            json : byTripKeysIndex_json ,
            xml  : byTripKeysIndex_xml  ,
        },

        partitionedByRoute            : partitionedByRoute ,
        partitionedByRouteByDirection : partitionedByRouteByDirection ,
        directionBloomFilters         : directionBloomFilters ,
    };
}




function bufferSituationExchange (situationExchangeDelivery) {
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
