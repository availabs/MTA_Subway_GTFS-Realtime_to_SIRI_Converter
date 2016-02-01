/**
 * @module MTA_Subway_GTFS-Realtime_to_SIRI_Converter.SituationExchangeDeliveryBuilder
 * @summary Helprt module that builds the SituationExchangeDelivery section of StopMonitoring and VehicleMonitoring Responses.
 *
 * @see [The MTA documentation.]{@link https://bustime.mta.info/wiki/Developers/SIRISituationExchangeDelivery}
 * @see [The page 72 of SIRI Handbook.]{@link http://user47094.vs.easily.co.uk/siri/schema/1.3/doc/Handbook/Handbookv15.pdf}
 *
 * From the SIRI Handbook:
 * "The SituationExchangeDelivery is returned by the SIRI-SX service and normally contains
 * one or more SituationElement instances; these will either be a BaseSituationElement or an
 * UpdateSituationElement. A Series of one ore more SituationElements describes a Situation. Each
 * SituationElement has a body (either of type PtSItuationBody or RoadSituationBody not shown)
 * which is itself made up of a number of groups of attributes and child elements (eg SituationSource, Consequence)."
 *
 * Unless otherwise noted, the quotations in the function comments are from the MTA documentation.
 * 
 * ??? http://web.mta.info/status/serviceStatus.txt ???
 * https://groups.google.com/d/msg/mtadeveloperresources/iKhpie5qmHU/XL5hbDa9HsUJ
 */

'use strict';


var _ = require('lodash');



/**
 * "The SIRI SituationExchangeDelivery element only appears when there is a service alert active for a route or stop being called on. 
 *  It is used by the responses to both the VehicleMonitoring and StopMonitoring calls."
 */
function getSituationExchangeDelivery (GTFSrt, affectedTrips, affectedTrains, affectedRoutes) {
    return {
        Situations : (GTFSrt && Array.isArray(affectedTrains) && affectedTrains.length) ? 
                        getSituations(GTFSrt, affectedTrips,  affectedTrains, affectedRoutes) : [],
    };
}



/**
 * @private
 */
function getSituations (GTFSrt, affectedTrips, affectedTrains, affectedRoutes) {
    return {
        PtSituationElement : getPtSituationElement(GTFSrt, affectedTrips, affectedTrains, affectedRoutes),
    };
}



/**
 * "One each per Service Alert."
 * @private
 */
function getPtSituationElement(GTFSrt, affectedTrips, affectedTrains, affectedRoutes) {
    return {
        SituationNumber   : getSituationNumber()                           ,
        PublicationWindow : getPublicationWindow()                         ,
        Severity          : getSeverity()                                  ,
        Summary           : getSummary()                                   ,
        Description       : getDescription(affectedTrains, affectedRoutes) ,
        Affects           : getAffects(GTFSrt, affectedTrips)              ,
        Consequences      : getConsequences()                              ,
    };
}


/**
 * "Unique ID."
 * Doesn't look like there is an equivalent in the GTFS-Realtime.
 * @private
 */
function getSituationNumber () { 
    return null; 
}


/**
 * "Information on temporal applicability of the service alert."
 * Doesn't look like this is provided in the GTFS-Realtime.
 * @private
 * @private
 */
function getPublicationWindow () {
    return {
        StartTime : null ,
        EndTime   : null ,
    };
}


/**
 * "Severity of the event."
 * From the docs and sample requests, looks like it's always the string "undefined".
 * @private
 */
function getSeverity () { 
    return 'undefined'; 
}


/**
 * "Summary text."
 * @private
 */
function getSummary () { 
    return "GTFS-Realtime train delay alert.";
}


/**
 * "Long description Text."
 * Makes sense to say which train is delayed, and where.
 *      e.g:  
 * @private
 */
function getDescription (affectedTrains, affectedRoutes) { 
    return 'The following trains are delayed: '  + affectedTrains.join(', ') + '.' +
           'The following routes are affected: ' + affectedRoutes.join(',') + '.';
}


/**
 * "Scope of effects." --From SIRI handbook.
 * @private
 */
function getAffects (GTFSrt, affectedTrips) {
    return {
        VehicleJourneys : getVehicleJourneys(GTFSrt, affectedTrips) ,
    };
}

function getConsequences () {
    return {
        Consequence : getConsequence() ,
    };
}


/**
 * "Element containing VehicleJourney lines and directions."
 * Note: Using GTFSrt to get the route_id and direction because
 *       GTFS only works for scheduled trips.
 * TODO: ??? Use North & South, or NyctTripDescriptor.direction
 * @private
 */
function getVehicleJourneys (GTFSrt, affectedTrips) {
    var routeDirections = affectedTrips.reduce(function (accumulator, trip_id) {
                                var route_id  = GTFSrt.getRouteIDForTrip(trip_id)     ,
                                    direction = GTFSrt.getRouteDirectionForTrip(trip_id) ;

                                accumulator[route_id] = (accumulator[route_id] || {});
                                
                                accumulator[route_id][direction] = true;
                                return accumulator;
                          }, {});

    // Direction sets to sequences.
    routeDirections = _.mapValues(routeDirections, function (dirObj) { return Object.keys(dirObj).sort(); });

    return _.map(routeDirections, getAffectedVehicleJourney);
}


/**
 * "One for each Line/Direction."
 * @private
 */
function getAffectedVehicleJourney (directions, route_id) {
    var lineRef = 'MTA ' + route_id;

    return directions.map(function (direction) {
        return {
            LineRef      : lineRef   ,
            DirectionRef : direction ,
        };
    }); 
}


function getConsequence (alert) {
    // Needs to return an array.
    return [ { Condition : getCondition(alert) } ];
}

function getCondition() {
    return 'DELAYED';
}




module.exports = {
    getSituationExchangeDelivery : getSituationExchangeDelivery ,
};

