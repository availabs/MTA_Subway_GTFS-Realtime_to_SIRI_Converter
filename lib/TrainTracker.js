/**
 * @module MTA_Subway_GTFS-Realtime_to_SIRI.TrainTracker
 * @summary Stateful module that infers the locations of trains in subway system.
 */


'use strict';

/*jshint unused:false */

//TODO: Enforce rule that only 

//NOTE: may need to implement simple semaphore to make sure that race conditions don't bork this module.


var _ = require('lodash');

//GTFSWrapper   = require('MTA_Subway_GTFS_Toolkit').Wrapper,
//GTFSrtWrapper = require('MTA_Subway_GTFS-Realtime_Toolkit').Wrapper,

//_gtfs   = new GTFSWrapper(),
//_gtfsrt = new GTFSrtWrapper();


// In the snapshots, keep a reference to the GTFS_Toolkit.Wrapper used for the trip.
//      This will allow consistency when the GTFS version changes over.


var previousSnapshot = null;




/**
 * @throws error if GTFSrt is older than GTFSrt of previousSnapshot.
 */
function newSnapshot (GTFS, GTFSrt) {
    var gtfsrtTimestamp = GTFSrt.getTimestamp(),
        prevTimestamp   = _.get(previousSnapshot, 'timestamp', Number.NEGATIVE_INFINITY),

        thisSnapshot;
    
    if ( ! GTFS )   { throw 'Empty GTFS passed to TrainTracker.newSnapshot.'   ; }
    if ( ! GTFSrt ) { throw 'Empty GTFSrt passed to TrainTracker.newSnapshot.' ; }

    if (gtfsrtTimestamp < prevTimestamp)   { throw 'GTFS-Realtime Message older than previously submitted GTFS-Realtime message.'; }
    if (gtfsrtTimestamp === prevTimestamp) { return previousSnapshot; }
            

    thisSnapshot = new Snapshot(GTFS, GTFSrt);

    previousSnapshot = thisSnapshot;

    return thisSnapshot;
}


//================================= Snapshot Constructor ================================= 

function Snapshot (GTFS, GTFSrt) {

    this.timestamp = GTFSrt.getTimestamp();

    this.trainLocations = inferLocations(GTFS, GTFSrt);
}


Snapshot.prototype.getVehicleLocation = function (trip_id) {
    return _.get(this, ['trainLocations', trip_id, 'vehicleLocation'], null);
};


Snapshot.prototype.getDistancesForCall = function (trip_id, stop_id) {
    return _.get(this, ['trainLocations', trip_id, 'distancesForCall', stop_id], null);
};


Snapshot.prototype.getBearing = function (trip_id, stop_id) {
    return _.get(this, ['trainLocations', trip_id, 'bearing'], null);
};

//======================================================================================== 




function inferLocations (GTFS, GTFSrt) {
    var allTrips        = GTFSrt.getAllMonitoredTrips(),
        locationInferer = inferTrainLocation.bind(null, GTFS, GTFSrt);

    if ( ! allTrips ) { return null; }

    return allTrips.map(locationInferer);
}



/*
 *  Cases:
 *      at stop.
 *      in motion.
 *
 *      have previous
 *      no previous
 */


function inferTrainLocation (GTFS, GTFSrt, trip_id) {
    var nextStop    = GTFSrt.getIDOfNextOnwardStopForTrip(trip_id),
        etaNextStop = GTFSrt.getExpectedArrivalTimeAtStopForTrip(trip_id, nextStop);
}


module.exports = {
    newSnapshot : newSnapshot ,
};




//
//
///**
// *  "The distance from the vehicle to the stop along the route, in meters."
// */
//function getDistanceFromCall (GTFS, GTFSrt, previousHistory, trip_id, stop_id) {
//    //TODO: Implement
//    return null;
//}
//
//
//
//
////TODO: Implement this.
///**
// * "The distance displayed in the UI."
// * @see {@link https://bustime.mta.info/wiki/Developers/SIRIMonitoredVehicleJourney#HThePresentableDistancefield}
// */
//function getPresentableDistance (GTFS, GTFSrt, previousHistory, trip_id, stop_id) {
//    // Constant Parameters
//    var D = 0.5,
//        N = 3,
//        E = 0.5,
//        P = 500,
//        T = 100;
//
//
//    //var distInMilesToNextStop = GTFSrt.getDistanceInMilesToNextStop(GTFS, trip_id),
//        //distInStopsToNextStop = GTFSrt.getDistanceInStopsToNextStop(GTFS, trip_id),
//        //distInMilesToCurrStop = GTFSrt.getDistanceInMilesToCurrStop(GTFS, trip_id, stop_id),
//        //distInStopsToCurrStop = GTFSrt.getDistanceInStopsToCurrStop(GTFS, trip_id, stop_id);
//
//    return null;
//}
//
//
///**
// *  "The number of stops on the vehicle's current trip until the stop in question, starting from 0."
// *  @param {module:MTA_Subway_GTFS-Realtime_Toolkit.Wrapper} GTFSrt
// *  @param {string|number} trip_id
// *  @param {string|number} stop_id
// */
//function getStopsFromCall (GTFSrt, trip_id, stop_id) {
//    return GTFSrt.getIndexOfStopInStopTimeUpdatesForTrip(trip_id, stop_id);
//}
//
//
///**
// *  "The distance of the stop from the beginning of the trip/route."
// */
//function getCallDistanceAlongRoute (GTFS, GTFSrt, vehicleTracker, trip_id, stop_id) {
//    //TODO: Implement
//    return null;
//}
//
///**
// * "The most recently recorded or inferred longitude coodinate of this vehicle."
// */
//function getLongitude (GTFS, GTFSrt, trip_id) {
//    //TODO: Implement
//    return null;
//}
//
//
///**
// * "The most recently recorded or inferred latitude coodinate of this vehicle."
// */
//function getLatitude (GTFS, GTFSrt, trip_id) {
//    //TODO: Implement
//    return null;
//}
//
//
//
//
//
//module.exports = {
//    Histories : function (){} ,
//};
