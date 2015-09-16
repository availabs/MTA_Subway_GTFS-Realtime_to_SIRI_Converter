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

    trainTrackerUtils   = require('./TrainTrackerUtils'),
    trainTrackerLogging = require('./TrainTrackerLogging');


var MILES_PER_KILOMETER = 0.621371192,
    FEET_PER_MILE       = 5280;


var previousSnapshot = null;

var MESSAGE_COUNTER = 0;

/**
 * @throws error if GTFSrt is older than GTFSrt of previousSnapshot.
 */
function newSnapshot (GTFS, GTFSrt, config) {
    var gtfsrtTimestamp = GTFSrt.getTimestamp(),
        prevTimestamp   = _.get(previousSnapshot, 'gtfsrtTimestamp', Number.NEGATIVE_INFINITY);

    console.log(++MESSAGE_COUNTER);

    if (gtfsrtTimestamp < prevTimestamp) { 
        throw new Error('GTFS-Realtime object sent to TrainTracker.newSnapshot is older than the previous one.');
    }

    if (gtfsrtTimestamp === prevTimestamp) { 
        return previousSnapshot; 
    }

    return (previousSnapshot = new Snapshot(GTFS, GTFSrt, config));
}


//================================= Snapshot Constructor ================================= 

function Snapshot (GTFS, GTFSrt, config) {
    this.config          = config;
    this.gtfsrtTimestamp = GTFSrt.getTimestamp()        ;
    this.trainLocations  = inferLocations.call(this, GTFS, GTFSrt) ;
}

Snapshot.prototype = {

    getDistancesForCall : function (trip_id, stop_id) {
        return _.get(this, ['trainLocations', trip_id, 'distancesForCall', stop_id], null);
    },

    getBearing : function (trip_id) {
        return _.get(this, ['trainLocations', trip_id, 'locationGeoJSON', 'properties', 'bearing'], null);
    },

    getLatitude : function (trip_id) {
        return _.get(this, ['trainLocations', trip_id, 'locationGeoJSON', 'geometry', 'coordinates', 0, 1], null);
    },

    getLongitude : function (trip_id) {
        return _.get(this, ['trainLocations', trip_id, 'locationGeoJSON', 'geometry', 'coordinates', 0, 0], null);
    },

    getVehicleDistanceAlongRouteInKilometers : function (trip_id) {
        return _.get(this, 
                     ['trainLocations', trip_id, 'locationGeoJSON', 'properties', 'start_dist_along_route_in_km'], 
                     NaN);
    },

    /**
     *  "The distance from the vehicle to the stop along the route, in meters."
     */
    getDistanceFromCall : function (trip_id, stop_id) {
        var _GTFS                  = _.get(this, ['trainLocations', trip_id, '_GTFS'], null),
            gtfsTripKey            = _.get(this, ['trainLocations', trip_id, 'gtfsTripKey'], null),

            trainDistAlongRoute_km = this.getVehicleDistanceAlongRouteInKilometers(trip_id),
            stopDistAlongRoute_km  = NaN; // Default
        

        if (_GTFS) {
          stopDistAlongRoute_km = _GTFS.getStopDistanceAlongRouteForTripInKilometers(gtfsTripKey, stop_id);
        }

        if (isNaN(trainDistAlongRoute_km) || isNaN(stopDistAlongRoute_km)) {
            return null;
        } 

        return (stopDistAlongRoute_km - trainDistAlongRoute_km) * 1000;
    },


    /**
    * "The distance displayed in the UI."
    * @see {@link https://bustime.mta.info/wiki/Developers/SIRIMonitoredVehicleJourney#HThePresentableDistancefield}
    *
    *    === The PresentableDistance field ===
    *
    *    The logic that determines whether stops or miles are shown in the PresentableDistance field is below:
    *
    *    Show distance in miles if and only if:
    *          (distance in miles to _immediate next stop_ is > D) 
    *          OR (distance in stops to current stop is > N AND distance in miles to current stop > E)
    *
    *    Show "approaching" if and only if:
    *          distance_in_miles to immediate next stop < P
    *     
    *    Show "at stop" if and only if:
    *          distance_in_miles to immediate next stop < T
    *
    *    Current Parameter Values:
    *
    *        Parameter | Value | Units  
    *        ----------+-------+--------
    *            D     |   0.5 | miles
    *            N     |   3   | stops
    *            E     |   0.5 | miles
    *            P     | 500   | feet
    *            T     | 100   | feet
    *
    */
    getPresentableDistance : function (trip_id, curStopDistanceAlongRoute_km, stopsFromCurStop) {
        // Constant Parameters
        var D = 0.5,
            N = 3,
            E = 0.5,
            P = 500,
            T = 100;

        var showMiles;

        var vehicleStatus          ,  
            distToImmedNextStop_km ,
            distToImmedNextStop_mi ,

            trainDistAlongRoute_km ,

            distToCurrentStop_km   ,
            distToCurrentStop_mi   ,
            distToCurrentStop_ft   ;


        // If the vehicle has no status, we aren't tracking it. (unscheduled or no spatial data)
        vehicleStatus = _.get(this, ['trainLocations', trip_id, 'state'], null);

        if (vehicleStatus === null) { return null; }


        // If trainDistAlongRoute_km not available, then we were not able to infer the train's location.
        trainDistAlongRoute_km = this.getVehicleDistanceAlongRouteInKilometers(trip_id);

        if (trainDistAlongRoute_km === null) { return null; }


        // Get the distance to the immediate next stop. 
        // If we are currently at a stop, this distance is zero,
        //      otherwise it is the length of the LineString (see INVARIANTS).
        if (vehicleStatus.AT_STOP) {
            distToImmedNextStop_km =  0;
        } else {
            distToImmedNextStop_km = _.get(this, 
                                           [ 'trainLocations', 
                                             trip_id, 
                                             'locationGeoJSON', 
                                             'properties', 
                                             'line_distance_km' 
                                           ], 
                                           NaN); 
        }

        distToImmedNextStop_mi = distToImmedNextStop_km * MILES_PER_KILOMETER;

        distToCurrentStop_km   = curStopDistanceAlongRoute_km - trainDistAlongRoute_km;
        distToCurrentStop_mi   = distToCurrentStop_km * MILES_PER_KILOMETER;

        // Determine whether to show miles based on the logic explained in comments preceeding this function.
        showMiles = (distToImmedNextStop_mi > D) || ((stopsFromCurStop > N) && (distToCurrentStop_mi > E));
            
        if (showMiles) {

            return distToCurrentStop_mi + ' mile' + ((distToCurrentStop_mi === 1) ? '' : 's');

        } else {
            
            // The special rules for when the bus is near the immediate next stop.
            // Probably should incorporate VehicleStopStatus too.
            if (stopsFromCurStop === 0) {
                distToCurrentStop_ft = distToCurrentStop_mi * FEET_PER_MILE;

                if      (distToCurrentStop_ft < T) { return 'at stop'     ; }
                else if (distToCurrentStop_ft < P) { return 'approaching' ; }
            }

            return (stopsFromCurStop + ' stop' + ((stopsFromCurStop === 1) ? '' : 's'));
        }
    }
};



function inferLocations (GTFS, GTFSrt) {
    /*jshint validthis:true*/
    var allTrips        = GTFSrt.getAllMonitoredTrips(),
        locationInferer = inferTrainLocation.bind(this, GTFS, GTFSrt);

    var unscheduledTrips   = [],
        noSpatialDataTrips = [];


    if ( ! Array.isArray(allTrips) ) { return null; }


    var result = allTrips.reduce(function (acc, trip_id) {
        var gtfsTripKey = GTFSrt.getGTFSTripKeyForRealtimeTripID(trip_id) ;
        
        // We only track trains with the required GTFS data.
        if      (!GTFS.tripIsAScheduledTrip(gtfsTripKey)) { unscheduledTrips.push(gtfsTripKey)      ; }
        else if (!GTFS.tripsHasSpatialData(gtfsTripKey) ) { noSpatialDataTrips.push(trip_id)        ; }
        else                                              { acc[trip_id] = locationInferer(trip_id) ; }

        return acc;
    }, {});

    if (this.config) {
        trainTrackerLogging.logLocationInferringStats(GTFSrt, 
                                                      result, 
                                                      unscheduledTrips, 
                                                      noSpatialDataTrips, 
                                                      this.config);
    }

    return result;
}





// From MTA docs: "Note that the predicted times are not updated when the train is not moving."
//
// NOTE: Current train coords will be the first coords in the locationGeoJSON.
//
// NOTE: All tracking begins at stops. 
//      (We first encounter trains when they are at the origin terminal, 
//          except for the rare case when we first start the server.)
//
// ratioCovered = elapsedTime / estimatedTimeRequired
//
function inferTrainLocation (GTFS, GTFSrt, trip_id) {
    /*jshint validthis:true*/

    var gtfsTripKey       = GTFSrt.getGTFSTripKeyForRealtimeTripID(trip_id)                          ,
        previous          = _.get(previousSnapshot, ['trainLocations', trip_id], null)               ,
        positionTimestamp = GTFSrt.getVehiclePositionTimestamp(trip_id)                              ,
        stopTimeUpdates   = trainTrackerUtils.getSimpleStopTimeUpdatesForTrip(GTFSrt, trip_id)       ,

        state             = getStateOfTrain(GTFSrt, trip_id, stopTimeUpdates, previous)              ,

        _GTFS             = (state.KNEW_LOCATION) ? previous.locationGeoJSON.properties._GTFS : GTFS ,

        immediateNextStop ,
        subsequentStop    ,

        ratioCovered      ,
        locationGeoJSON   ;

    try {

        if (stopTimeUpdates === null) { 
            throw new Error('No stopTimeUpdates for trip in the GTFS-Realtime message.');
        }


        immediateNextStop = stopTimeUpdates[0];
        subsequentStop    = stopTimeUpdates[1];

        if ( state.AT_ORIGIN || state.AT_IN_BETWEEN_STOP ) {
            locationGeoJSON = trainTrackerUtils.getLineStringBetweenStopsForTrip(_GTFS,
                                                                                 gtfsTripKey, 
                                                                                 immediateNextStop.stop_id, 
                                                                                 subsequentStop.stop_id);
        } else if ( state.AT_DESTINATION ) {
             locationGeoJSON = trainTrackerUtils.getGeoJSONPointForStopForTrip(_GTFS,
                                                                               gtfsTripKey, 
                                                                               immediateNextStop.stop_id);

        } else if ( state.KNEW_LOCATION ) { // Not at a a stop, but we infered the location previously. 

            if ( !state.HAS_MOVED ) { 
                locationGeoJSON = previous.locationGeoJSON;

            } else {
                // Probably not required. Just to be safe.
                locationGeoJSON = {
                        type : previous.locationGeoJSON.type,
                        geometry : _.clone(previous.locationGeoJSON.geometry, true),
                        properties : _.clone(_.omit(previous.locationGeoJSON.properties, '_GTFS'), true),
                };
                locationGeoJSON.properties._GTFS = previous.locationGeoJSON.properties._GTFS;

                // TODO ??? There is a bizarre case where the ratioCovered is negative
                //          because eta is not being updated even though the train is moving.
                //          Sometimes (rarely) an eta will be negative, even though the train 
                //          is approaching the stop. This can happen for hundreds of seconds.
                //          Not sure how to handle it. Currently throwing an error and logging it.
                ratioCovered = (this.gtfsrtTimestamp  - previousSnapshot.gtfsrtTimestamp) / 
                               (immediateNextStop.eta - previousSnapshot.gtfsrtTimestamp);

                if ( state.SAME_IMMEDIATE_NEXT_STOP ) { // locationGeoJSON endpoint remains valid.

                    trainTrackerUtils.advancePositionAlongLineString(locationGeoJSON, ratioCovered);

                } else { // locationGeoJSON endpoint is invalid. We need to extend the line before advancing.

                    trainTrackerUtils.extendLinestringToFurtherStopForTrip(locationGeoJSON, 
                                                                           immediateNextStop.stop_id);
                    trainTrackerUtils.advancePositionAlongLineString(locationGeoJSON, ratioCovered);
                } 
            }
        } 

    } catch (e) { 
        var that = this;

        (function () {
            var debugging_info = {
                state               : state                                                        ,
                gtfsTripKey         : gtfsTripKey                                                 ,
                previousState       : previous.state                                              ,
                previousGeoJSON     : {
                    geometry   : previous.locationGeoJSON.geometry                    ,
                    properties : _.omit(previous.locationGeoJSON.properties, '_GTFS') ,
                },
                currentGeoJSON      : {
                    geometry   : locationGeoJSON.geometry                    ,
                    properties : _.omit(locationGeoJSON.properties, '_GTFS') ,
                },
                positionTimestamp   : positionTimestamp                                            ,
                immediateNextStop   : immediateNextStop                                            ,
                subsequentStop      : subsequentStop                                               ,
                ratioCovered        : ratioCovered                                                 ,
                vehicleStopStatus   : GTFSrt.getVehiclePositionCurrentStatusForTrip(trip_id)       ,
                currentStopSequence : GTFSrt.getVehiclePositionCurrentStopSequenceForTrip(trip_id) ,
            };

            trainTrackerLogging.logLostTrain(debugging_info, that.config, e);
        }());

        // TODO ??? Should we use previous.locationGeoJSON instead ???
        //          Makes sense to use this strict setting during testing.
        locationGeoJSON = null;
    }

    return {
        state             : state             ,
        gtfsTripKey       : gtfsTripKey       ,
        positionTimestamp : positionTimestamp ,
        immediateNextStop : immediateNextStop ,
        locationGeoJSON   : locationGeoJSON   ,
    };
}



// Initialize the state object. This object is used to decide the how we infer train locations.
//
// NOTE: When using `previous` for truthy/falsey, 
//       convert _ALL_ `previous` to boolean with !! to avoid memory leaks.
//
// NOTE: The logic determining the AT_ORIGIN, AT_DESTINATION, and AT_IN_BETWEEN_STOP state
//       is based on the following paragraph in the MTA docs:
//
//           For most stops along the trip path, NYC subway schedules define a transit time. 
//           Departure times are supplied for the Origin Terminal, arrival times for the Destination Terminal. 
//           Transit times are provided at all in-between stops except at those locations where there are 
//           “scheduled holds”. At those locations both arrival and departure times are given.
//
                  
// Is the train at a stop?
//
//      We've tried two methods to determing whether a train is at a stop.
//      Neither gives perfect results.
//
//      The method we are using uses VehiclePostion.current_status. This method does not seems to err towards
//      missing instances of trains at stops. The other method uses the eta of the immediate next stop.
//      If the eta is less than the GTFS-Realtime timestamp, we could assume the train is at the stop.
//      This method is prone to over optimistic ETAs. It seems better to use the GTFS-Realtime field specifically
//      meant to answer this question, so we use the current_status method.
//
// From MTA docs: "Note that the predicted times are not updated when the train is not moving."
 
function getStateOfTrain (GTFSrt, trip_id, stopTimeUpdates, previous) {

    var state = {
        FIRST_OCCURRANCE         : false ,
        WAS_ASSIGNED_TRAIN       : false ,
        KNEW_LOCATION            : false ,
        AT_STOP                  : false ,
        AT_ORIGIN                : false ,
        AT_DESTINATION           : false ,
        AT_IN_BETWEEN_STOP       : false ,
        HAS_MOVED                : false ,
        SAME_IMMEDIATE_NEXT_STOP : false ,
        BAD_PREVIOUS_ETA         : false ,
    };

    var positionTimestamp   = GTFSrt.getVehiclePositionTimestamp(trip_id)                  ,
        vehicleStopStatus   = GTFSrt.getVehiclePositionCurrentStatusForTrip(trip_id)       ,
        currentStopSequence = GTFSrt.getVehiclePositionCurrentStopSequenceForTrip(trip_id) ,

        immediateNextStop   = stopTimeUpdates[0];


    // Is this the first time we've seen this train?
    state.FIRST_OCCURRANCE = ! previous;

    state.WAS_ASSIGNED_TRAIN = GTFSrt.tripWasAssignedATrain(trip_id);

    // Did we infer the location of this train the last time around?
    state.KNEW_LOCATION = !!(previous && previous.locationGeoJSON);

   
    state.AT_ORIGIN = !state.WAS_ASSIGNED_TRAIN || 
                      !Number.isInteger(stopTimeUpdates[0].eta) ;

   
    state.AT_STOP = ( state.AT_ORIGIN  ) || 
                    (( ! isNaN(currentStopSequence )) && vehicleStopStatus === 'STOPPED_AT') ;
    
    state.AT_DESTINATION = state.AT_STOP && (stopTimeUpdates.length === 1) ;

    state.AT_IN_BETWEEN_STOP = state.AT_STOP && !(state.AT_ORIGIN || state.AT_DESTINATION) ;
    
    // Same stop_0 as in the previous GTFS-Realtime message?
    state.SAME_IMMEDIATE_NEXT_STOP = ( !!(previous && previous.immediateNextStop) )                    && 
                                     (immediateNextStop.stop_id === previous.immediateNextStop.stop_id) ;


    
    // Has the train moved since the previous GTFS-Realtime message?  
    if (!!previous && (positionTimestamp > previous.positionTimestamp)) {
        // This compensates for the fact that we are using estimates to infer location.
        // We may have assumed that we were at a stop based on 
        // a previous ETA that was overly optimistic.
        // Once we assume that we are at a stop, we stay there.
        if (previous.state.AT_STOP && state.SAME_IMMEDIATE_NEXT_STOP) {
            state.BAD_PREVIOUS_ETA = true; 
        } else {
            state.HAS_MOVED = true;
        }
    }

    return state;
}
 

module.exports = {
    newSnapshot : newSnapshot ,
};

