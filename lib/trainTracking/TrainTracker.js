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
    var gtfsrtTimestamp = GTFSrt.getTimestampForFeedMessage(),
        prevTimestamp   = _.get(previousSnapshot, 'gtfsrtTimestamp', Number.NEGATIVE_INFINITY) ,

        snapshot;


    if (gtfsrtTimestamp < prevTimestamp) { 
        throw new Error('GTFS-Realtime object sent to TrainTracker.newSnapshot is older than the previous one.');
    }

    if (gtfsrtTimestamp === prevTimestamp) { 
        return previousSnapshot; 
    }

    snapshot = new Snapshot(GTFS, GTFSrt, config);

    previousSnapshot = snapshot;

    return snapshot;
}


//================================= Snapshot Constructor ================================= 

// Note: Snapshots do not keep a reference to the GTFS and GTFSrt so that they may 
//       be garbage collected as soon as they are no longer needed.
function Snapshot (GTFS, GTFSrt, config) {
    this.config          = config;
    this.gtfsrtTimestamp = GTFSrt.getTimestampForFeedMessage()        ;

    // Linked list of snapshots would be a huge memory leak.
    if (previousSnapshot !== null) {
        previousSnapshot.previousSnapshot = null;
    }

    this.previousSnapshot = previousSnapshot;
    this.trainLocations  = inferLocations.call(this, GTFS, GTFSrt) ;
}


function coordinateGetter (gtfsTripKey, coordType) {
    /* jslint validthis: true */
    var type   = _.get(this, ['trainLocations', gtfsTripKey, 'locationGeoJSON', 'geometry', 'type'], null),
        coords = _.get(this, ['trainLocations', gtfsTripKey, 'locationGeoJSON', 'geometry', 'coordinates'], null),
        coordIndex ,
        coord ;
    
    if (coordType === 'longitude') {
        coordIndex = 0; 
    } else if (coordType === 'latitude') {
        coordIndex = 1;
    } else {
        return null;
    }

    // Note: In turfjs, coords array is [lon,lat].
    if (type === 'Point') {
        coord = parseFloat(coords && coords[coordIndex]);
    } else if (type === 'LineString') {
        coord = parseFloat(coords && coords[0] && coords[0][coordIndex]);
    } else {
        return null;
    }


    return (!isNaN(coord)) ? coord.toPrecision(constants.SIGNIFICANT_DIGITS) : null;
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
        return coordinateGetter.call(this, gtfsTripKey, 'latitude');
    },

    getLongitude : function (gtfsTripKey) {
        return coordinateGetter.call(this, gtfsTripKey, 'longitude');
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
        var _GTFS = _.get(this, ['trainLocations', gtfsTripKey, 'locationGeoJSON', 'properties', '_GTFS'], null),

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
