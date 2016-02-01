"use strict";


var _ = require('lodash') ,
    
    trainTrackerUtils   = require('./TrainTrackerUtils') ,
    logger = require('./TrainTrackerLogging') ;



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
        if      (!GTFS.tripIsAScheduledTrip(gtfsTripKey)) { unscheduledTrips.push(gtfsTripKey)          ; }
        else if (!GTFS.tripsHasSpatialData(gtfsTripKey) ) { noSpatialDataTrips.push(trip_id)            ; }
        else                                              { acc[gtfsTripKey] = locationInferer(trip_id) ; }

        return acc;
    }, {});

    if (this.config.logTrainTrackingStats) {
        logger.logTrainTrackingStats(GTFSrt, result, unscheduledTrips, noSpatialDataTrips, this.config);
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
//
// TODO ??? There is a bizarre case where the ratioCovered is negative
//          because eta is not being updated even though the train is moving.
//          Sometimes (rarely) an eta will be negative, even though the train 
//          is approaching the stop. This can happen for hundreds of seconds.
//          Not sure how to handle it. Currently throwing an error and logging it.
function inferTrainLocation (GTFS, GTFSrt, trip_id) {
    /*jshint validthis:true*/

    var gtfsTripKey       = GTFSrt.getGTFSTripKeyForRealtimeTripID(trip_id) ,
        previous          = _.get(this.previousSnapshot, ['trainLocations', gtfsTripKey], null) ,
        positionTimestamp = GTFSrt.getVehiclePositionTimestamp(trip_id) ,
        stopTimeUpdates   = trainTrackerUtils.getSimpleStopTimeUpdatesForTrip(GTFSrt, trip_id) ,

        state             = getStateOfTrain(GTFSrt, trip_id, stopTimeUpdates, previous) ,

        _GTFS             = (state.KNEW_LOCATION) ? previous.locationGeoJSON.properties._GTFS : GTFS ,

        immediateNextStop ,
        subsequentStop    ,

        ratioCovered      ,
        locationGeoJSON   ;

    try {

        if (state.NO_STOP_TIME_UPDATES) { 
            throw new Error('No stopTimeUpdates for trip in the GTFS-Realtime message.');
        } 

        immediateNextStop = stopTimeUpdates[0];
        subsequentStop    = stopTimeUpdates[1];


        if ( state.AT_STOP && 
             (previous && previous.AT_STOP && previous.locationGeoJSON) && 
             state.SAME_IMMEDIATE_NEXT_STOP ) {

                locationGeoJSON = previous.locationGeoJSON;

        } else if ( state.AT_ORIGIN || state.AT_IN_BETWEEN_STOP ) {
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
                // Cloning the locationGeoJSON. Probably not required. Just to be safe.
                locationGeoJSON = {
                        type : previous.locationGeoJSON.type,
                        geometry : _.clone(previous.locationGeoJSON.geometry, true),
                        properties : _.clone(_.omit(previous.locationGeoJSON.properties, '_GTFS'), true),
                };
                locationGeoJSON.properties._GTFS = previous.locationGeoJSON.properties._GTFS;

                //ratioCovered = (this.gtfsrtTimestamp  - previousSnapshot.gtfsrtTimestamp) / 
                               //(immediateNextStop.eta - previousSnapshot.gtfsrtTimestamp);

                ratioCovered = (positionTimestamp  - previous.positionTimestamp) / 
                               (immediateNextStop.eta - previous.positionTimestamp);

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
        locationGeoJSON = previous ? previous.locationGeoJSON : null;

        var context = Object.create(this);

        context.error = e;

        // for making this function's scope variables accessible to the logger.
        context.gtfsTripKey       =  gtfsTripKey ;
        context.previous          =  previous ;
        context.positionTimestamp =  positionTimestamp ;
        context.stopTimeUpdates   =  stopTimeUpdates ;
        context.state             =  state ;           
        context._GTFS             =  _GTFS ;
        context.immediateNextStop =  immediateNextStop ;
        context.subsequentStop    =  subsequentStop ;
        context.ratioCovered      =  ratioCovered ;
        context.locationGeoJSON   =  locationGeoJSON ;

        logger.logTrainTrackingErrors(context);

        // TODO we must handle the case of an erroneous AT_DESTINATION state.
        //      The train will never leave that stop because the advancePositon function
        //      will continuously throw errors. The GeoJSON Point will need to be
        //      converted to a GeoJSON LineString.
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
        BAD_ETA                  : false ,
        BAD_PREVIOUS_ETA         : false ,
        AT_IN_BETWEEN_STOP       : false ,
        HAS_MOVED                : false ,
        SAME_IMMEDIATE_NEXT_STOP : false ,
        NO_STOP_TIME_UPDATES     : false ,
    };

    var positionTimestamp   = GTFSrt.getVehiclePositionTimestamp(trip_id)                  ,
        vehicleStopStatus   = GTFSrt.getVehiclePositionCurrentStatusForTrip(trip_id)       ,
        currentStopSequence = GTFSrt.getVehiclePositionCurrentStopSequenceForTrip(trip_id) ,

        immediateNextStop;
    

    // Is this the first time we've seen this train?
    state.FIRST_OCCURRANCE = ! previous;

    state.WAS_ASSIGNED_TRAIN = GTFSrt.tripWasAssignedATrain(trip_id);

    // Did we infer the location of this train the last time around?
    state.KNEW_LOCATION = !!(previous && previous.locationGeoJSON);

    if ( ! stopTimeUpdates ) {
        state.NO_STOP_TIME_UPDATES = true;
        return state;
    }

    immediateNextStop = stopTimeUpdates[0];
   
    state.AT_ORIGIN = (!state.WAS_ASSIGNED_TRAIN) || (stopTimeUpdates[0].eta === null) || (stopTimeUpdates[0].eta === undefined);

   
    state.AT_STOP = ( state.AT_ORIGIN  ) || 
                    ((!isNaN(currentStopSequence)) && vehicleStopStatus === 'STOPPED_AT') ;
    
    state.AT_DESTINATION = state.AT_STOP && (stopTimeUpdates.length === 1) ;

    state.AT_IN_BETWEEN_STOP = state.AT_STOP && !(state.AT_ORIGIN || state.AT_DESTINATION) ;
    
    if ( (!state.AT_STOP) && (stopTimeUpdates[0].eta < positionTimestamp) ) {
       state.BAD_ETA = true; 
    }
        
    // Same stop_0 as in the previous GTFS-Realtime message?
    state.SAME_IMMEDIATE_NEXT_STOP = ( !!(previous && previous.immediateNextStop) ) && 
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
    inferLocations : inferLocations ,
};

