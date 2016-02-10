/**
 * @module MTA_Subway_GTFS-Realtime_to_SIRI_Converter.CallBuilder
 * @summary Helper module that builds the MonitoredCall and OnwardCall sections of StopMonitoring and VehicleMonitoring Responses.
 *
 * @see [The MTA documentation.]{@link https://bustime.mta.info/wiki/Developers/SIRISituationExchangeDeliver://bustime.mta.info/wiki/Developers/SIRIMonitoredVehicleJourney}
 * @see [The page 72 of SIRI Handbook.]{@link http://user47094.vs.easily.co.uk/siri/schema/1.3/doc/Handbook/Handbookv15.pdf}
 *
 * Unless otherwise noted, the quotations in the function comments are from the MTA documentation.
 */


'use strict';


var timeUtils = require('MTA_Subway_GTFS-Realtime_Toolkit').TimeUtils;
    



/**
 *  "Call data about a particular stop."
 */
function buildCall (trip_id, stop_id) { 
    /* jshint validthis: true */

    return {
        "Extensions": { 
            "Distances" : getDistances.call(this, trip_id, stop_id) , 
        },

        "ExpectedArrivalTime"   : getExpectedArrivalTime.call(this, trip_id, stop_id) ,
        "ExpectedDepartureTime" : getExpectedDepartureTime.call(this, trip_id, stop_id) ,

        "StopPointRef"          : getStopPointRef.call(this, stop_id) ,
        "StopPointName"         : getStopPointName.call(this, stop_id) ,

        "VisitNumber"           : getVisitNumber() ,
    };
}



/**
 *  "The MTA Bus Time extensions to show distance of the vehicle from the stop."
 */
function getDistances (trip_id, stop_id) {
    /* jshint validthis: true */
    var tripKey                   = this.GTFSrt.getGTFSTripKeyForRealtimeTripID(trip_id) ,
        stopsFromCall             = getStopsFromCall.call(this, trip_id, stop_id) ,
        callDistanceAlongRoute_m  = getCallDistanceAlongRoute.call(this, tripKey, stop_id) ,
        callDistanceAlongRoute_km = callDistanceAlongRoute_m / 1000 ;

    return {
        PresentableDistance    : this.trainTrackerSnapshot && 
                                 this.trainTrackerSnapshot.getPresentableDistance(tripKey,
                                                                                  callDistanceAlongRoute_km, 
                                                                                  stopsFromCall),

        DistanceFromCall       : this.trainTrackerSnapshot && 
                                 this.getDistanceFromCall(tripKey, stop_id),

        StopsFromCall          : stopsFromCall ,
        CallDistanceAlongRoute : callDistanceAlongRoute_m ,
    };
}

/**
 *  The number of stops on the vehicle's current trip 
 *  until the stop in question, starting from 0.
 *
 *  NOTE: This would equal the index of the stop in the StopTimeUpdates.
 */
function getStopsFromCall (trip_id, stop_id) {
    /* jshint validthis: true */
    return this.GTFSrt.getIndexOfStopInStopTimeUpdatesForTrip(trip_id, stop_id) ;
}

/**
 *  "Predicted arrival times in ISO8601 format."
 */
function getExpectedArrivalTime (trip_id, stop_id) { // Note: in docs, but not in actual SIRI.
    /* jshint validthis: true */
    var arrivalTime = +this.GTFSrt.getExpectedArrivalTimeAtStopForTrip(trip_id, stop_id);

    return (arrivalTime) ? timeUtils.getTimestamp(arrivalTime) : null;
}


/**
 *  "Predicted departure times in ISO8601 format."
 */
function getExpectedDepartureTime (trip_id, stop_id) { // Note: in docs, but not in actual SIRI.
    /* jshint validthis: true */
    var departureTime = +this.GTFSrt.getExpectedDepartureTimeAtStopForTrip(trip_id, stop_id);

    return (departureTime) ? timeUtils.getTimestamp(departureTime) : null;
}


/**
 *  "The GTFS stop ID of the stop prefixed by agency_id."
 */
function getStopPointRef (stop_id) {
    /* jshint validthis: true */
    var mutator = this.config.fieldMutators && this.config.fieldMutators.StopPointRef;

    if (stop_id && Array.isArray(mutator)) {
        return stop_id.replace(mutator[0], mutator[1]);
    } else {
        return (stop_id !== undefined) ? stop_id : null;
    }
}


/**
 *  "The GTFS stop name of the stop."
 */
function getStopPointName (stop_id) {
    /* jshint validthis: true */
    return this.GTFS.getStopName(stop_id) || null;
}


/**
 *  "The ordinal value of the visit of this vehicle to this stop, always 1 in this implementation."
 */
function getVisitNumber () {
    return 1;
}


/**
 *  "The distance of the stop from the beginning of the trip/route."
 *  NOTE: Not explicitly stated in the MTA docs, but looks like the units is meters.
 *  From 'DistanceFromCall' : 
 *      'The distance from the vehicle to the stop along the route, in meters.'
 */
function getCallDistanceAlongRoute (tripKey, stop_id) {
    /* jshint validthis: true */
    return this.GTFS.getStopDistanceAlongRouteForTripInMeters(tripKey, stop_id);
}



module.exports = {
    buildCall : buildCall ,
};

