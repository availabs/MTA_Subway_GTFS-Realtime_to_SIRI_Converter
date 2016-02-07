/**
 * @module MTA_Subway_GTFS-Realtime_to_SIRI.TrainTracker
 * @summary Stateful module that infers the locations of trains in subway system.
 */

'use strict';

// INVARIANTS: 
//      (1) The LineString ALWAYS represents the span between 
//          a train's current location and the immediate next stop.
//      (2) The current snapshot extracts all needed info from the previous snapshot.
//          This means that we need to keep only one snapshot at time.
//      (3) We use the same GTFS data set for tracking a particular train.
//          If an update occurs, its data will apply to newly tracked trains. 
//          (The indexedSpatial data uses offsets. Not everything is keyed.)
//          Each trip's tracking data holds a reference to the GTFS version (_GTFS)
//          that will be used to infer its location.


// The logic for advancing the train is based on Zeno's paradox of Achilles and the tortoise.
// If we always approach the next stop by a ratio to the distance between, we can never go beyond it. 




var _  = require('lodash') ,

    presentableDistanceCalculator = require('./PresentableDistanceCalculator').getPresentableDistance ,

    inferLocations = require('./InferenceEngine').inferLocations ,

    constants = require('./Constants') ;



var previousSnapshot = null ;



/**
 * @throws error if GTFSrt is older than GTFSrt of previousSnapshot.
 */
function newSnapshot (GTFS, GTFSrt, config) {
    var gtfsrtTimestamp = GTFSrt.getTimestamp(),
        prevTimestamp   = _.get(previousSnapshot, 'gtfsrtTimestamp', Number.NEGATIVE_INFINITY) ,

        snapshot;


    if (gtfsrtTimestamp < prevTimestamp) { 
        throw new Error('GTFS-Realtime object sent to TrainTracker.newSnapshot is older than the previous one.');
    }

    if (gtfsrtTimestamp === prevTimestamp) { 
        return previousSnapshot; 
    }

    snapshot = new Snapshot(GTFS, GTFSrt, config);

    // Linked list of snapshots would be a huge memory leak.
    if (previousSnapshot !== null) {
        previousSnapshot.previousSnapshot = null;
    }

    newSnapshot.previousSnapshot = previousSnapshot;

    return snapshot;
}


//================================= Snapshot Constructor ================================= 

// Note: Snapshots do not keep a reference to the GTFS and GTFSrt so that they may 
//       be garbage collected as soon as they are no longer needed.
function Snapshot (GTFS, GTFSrt, config) {
    this.config          = config;
    this.gtfsrtTimestamp = GTFSrt.getTimestamp()        ;
    this.trainLocations  = inferLocations.call(this, GTFS, GTFSrt) ;
}


Snapshot.prototype = {

    /** "Vehicle bearing: 0 is East, increments counter-clockwise." 
     *  http://www.movable-type.co.uk/scripts/latlong.html#bearing
     */
    getBearing : function (gtfsTripKey) {
        var bearing = _.get(this, ['trainLocations', gtfsTripKey, 'locationGeoJSON', 'properties', 'bearing'], null);

        return (bearing !== null) ? bearing.toPrecision(constants.SIGNIFICANT_DIGITS) : null;
    },

    getLatitude : function (gtfsTripKey) {
        var latitude =  _.get(this, 
                              ['trainLocations', gtfsTripKey, 'locationGeoJSON', 'geometry', 'coordinates', 0, 1], 
                              null);

        return (latitude !== null) ? latitude.toPrecision(constants.SIGNIFICANT_DIGITS) : null;
    },

    getLongitude : function (gtfsTripKey) {
        var longitude = _.get(this, 
                              ['trainLocations', gtfsTripKey, 'locationGeoJSON', 'geometry', 'coordinates', 0, 0], 
                              null);

        return (longitude !== null) ? longitude.toPrecision(constants.SIGNIFICANT_DIGITS) : null;
    },

    getVehicleDistanceAlongRouteInKilometers : function (gtfsTripKey) {
        return _.get(this, 
                     ['trainLocations', gtfsTripKey, 'locationGeoJSON', 'properties', 'start_dist_along_route_in_km'], 
                     NaN);
    },

    /**
     *  "The distance from the vehicle to the stop along the route, in meters."
     */
    getDistanceFromCall : function (gtfsTripKey, stop_id) {
        var _GTFS                  = _.get(this, 
                                           ['trainLocations', gtfsTripKey, 'locationGeoJSON', 'properties', '_GTFS'], 
                                           null),

            trainDistAlongRoute_km = this.getVehicleDistanceAlongRouteInKilometers(gtfsTripKey),
            stopDistAlongRoute_km  = NaN, // Default
            distFromCall;
        
        if (_GTFS) {
            stopDistAlongRoute_km = _GTFS.getStopDistanceAlongRouteForTripInKilometers(gtfsTripKey, stop_id);
        }

        if (isNaN(trainDistAlongRoute_km) || isNaN(stopDistAlongRoute_km)) {
            return null;
        } else {
            distFromCall = 
                ((stopDistAlongRoute_km - trainDistAlongRoute_km) * 1000).toPrecision(constants.SIGNIFICANT_DIGITS);

            return parseFloat(distFromCall);
        }
    },

    getPresentableDistance : presentableDistanceCalculator,

};


module.exports = {
    newSnapshot : newSnapshot ,
};
