/**
 * @module MTA_Subway_GTFS-Realtime_to_SIRI_Converter.MonitoredVehicleJourneyBuilder
 * @summary Creates the MonitoredVehicleJourney part of a SIRI StopMonitoring or VehicleMonitoring Response.
 * Based on the documentation found at the following:
 * @see {@link https://bustime.mta.info/wiki/Developers/SIRIIntro}
 * @see {@link http://datamine.mta.info/sites/all/files/pdfs/GTFS-Realtime-NYC-Subway%20version%201%20dated%207%20Sep.pdf}
 * NOTE: Comments in quotations are directly from the two above authorative sources.
 * Note:
 *      gtfs_trip_id is the GTFS trip_is as found in the static GTFS data.
 *      gtfsTripKey is the output of the optional tripKeyBuilder config function sent to the GTFS indexers.
 *      trip_id is the GTFS-Realtime trip_id. 
 *
 * The reason for these three keys is that the GTFS-Realtime trip_id will be a substring of the gtfs_trip_id.
 * To match the two, the service code is prepended to the GTFS-Realtime trip_id. This yields the tripKey.
 * See the message TripDescriptor section of MTA GTFS-Realtime doc for an explanation of the relation between the two.
 */


'use strict';

/* jshint unused: false */


var CallBuilder  = require('./CallBuilder'),
    timeUtils    = require('MTA_Subway_GTFS-Realtime_Toolkit').TimeUtils;


/**
 * @param {module:MTA_Subway_GTFS_Toolkit.Wrapper} GTFS
 * @param {module:MTA_Subway_GTFS-Realtime_Toolkit.Wrapper} GTFSrt
 * @param {string} train_id
 * @param {string} stop_id
 * @param {number} maxOnwardCalls
 * @param {string} detailLevel
 */
function getMonitoredVehicleJourney (GTFS                 ,
                                     GTFSrt               ,
                                     trainTrackerSnapshot ,
                                     train_id             ,
                                     stop_id              ,
                                     maxOnwardCalls       ,
                                     detailLevel          ) {

    var trip_id,
        gtfsTripKey,
        scheduleDate,
        agency_id,
        route_id,
        blockRef,
        mvj;


    if ( ! GTFSrt )      { return null; }

    trip_id      = GTFSrt.trainIDToTripIDMap[train_id]             ;

    gtfsTripKey  = GTFSrt.getGTFSTripKeyForRealtimeTripID(trip_id) ;

    scheduleDate = GTFSrt.getScheduleDateForTrip(trip_id)          ;

    agency_id    = GTFS.getAgencyIDForTrip(gtfsTripKey)            ;

    route_id     = GTFSrt.getRouteIDForTrip(trip_id)               ;

    blockRef     = getBlockRef(GTFS, gtfsTripKey)                  ;


    mvj = {
        "LineRef"                  : getLineRef(agency_id, route_id)                             ,
        "DirectionRef"             : getDirectionRef(GTFSrt, trip_id)                            ,
        "FramedVehicleJourneyRef"  : getFramedVehicleJourneyRef(GTFS, scheduleDate, gtfsTripKey) ,
        "JourneyPatternRef"        : getJourneyPatternRef(GTFS, gtfsTripKey, agency_id)          ,
        "PublishedLineName"        : getPublishedLineName(GTFS, route_id)                        ,
        "OperatorRef"              : getOperatorRef(agency_id)                                   ,
        "OriginRef"                : getOriginRef(GTFS, gtfsTripKey)                             ,
        "DestinationRef"           : getDestinationRef(GTFSrt, trip_id)                          ,
        "DestinationName"          : getDestinationName(GTFS, gtfsTripKey)                       ,
        "OriginAimedDepartureTime" : getOriginAimedDepartureTime(GTFSrt, trip_id)                ,
        "SituationRef"             : getSituationRef()                                           ,
        "Monitored"                : getMonitored()                                              ,
        "VehicleLocation"          : getVehicleLocation(trainTrackerSnapshot,gtfsTripKey)        ,
        "Bearing"                  : getBearing(trainTrackerSnapshot, gtfsTripKey)               ,
        "ProgressRate"             : getProgressRate(GTFSrt, trip_id)                            ,
        "ProgressStatus"           : getProgressStatus(trip_id)                                  ,
        "VehicleRef"               : getVehicleRef(agency_id, train_id)                          ,

        "MonitoredCall" : getMonitoredCall(GTFS, GTFSrt, trainTrackerSnapshot, trip_id, stop_id)                   ,
        "OnwardCalls"   : getOnwardCalls(GTFS, GTFSrt, trainTrackerSnapshot, trip_id, detailLevel, maxOnwardCalls) ,
    };

    if (blockRef) {
        mvj.BlockRef = blockRef;
    }

    return mvj;
}


/**
 *  "A compound element uniquely identifying the trip the vehicle is serving."
 */
function getFramedVehicleJourneyRef (GTFS, scheduleDate, gtfsTripKey) {
    return {
        "DataFrameRef"           : getDataFrameRef(scheduleDate)                ,
        "DatedVehicleJourneyRef" : getDatedVehicleJourneyRef(GTFS, gtfsTripKey) ,
    };
}


/** 
 *  "The 'fully qualified' route name (GTFS agency ID + route ID) for the trip the vehicle is serving. 
 *   Not intended to be customer-facing."
 */
function getLineRef (agency_id, route_id) {
    if (agency_id !== null) {
        return (route_id !== null) ? (agency_id + '_' + route_id) : null;
    } else {
        return route_id;
    }
}


/** 
 *  "The GTFS direction for the trip the vehicle is serving." --MTA SIRI Docs
 *  "The direction_id field contains a binary value that 
 *   indicates the direction of travel for a trip. Use 
 *   this field to distinguish between bi-directional 
 *   trips with the same route_id." --Google GTFS reference.
 *
 *   So it doesn't look like this relates to the 
 *   nyct_subway GTFS-Realtime NyctTripDescriptor direction field
 *   which describes "The direction the train is moving."
 */
function getDirectionRef (GTFSrt, trip_id) { //TODO: Is this right???
    return GTFSrt.getDirectionForTrip(trip_id);
}


/*
 *  "The GTFS Shape_ID, prefixed by GTFS Agency ID."
 */
function getJourneyPatternRef (GTFS, gtfsTripKey, agency_id) {
    var shape_id  = GTFS.getShapeIDForTrip(gtfsTripKey);

    if (agency_id !== null) {
        return (shape_id !== null) ? (agency_id + '_' + shape_id) : null;
    } else {
        return shape_id;
    }
}


/** 
 *  "The GTFS route_short_name."
 */
function getPublishedLineName (GTFS, route_id) {
    return GTFS.getRouteShortName(route_id) || null;
}


/** 
 *  "GTFS Agency_ID."
 *  Default is identity function. To allow eventual override.
 */
function getOperatorRef (agency_id) {
    return agency_id; 
}


/** 
 *  "The GTFS stop ID for the first stop on the trip 
 *   the vehicle is serving, prefixed by Agency ID."
 */
function getOriginRef (GTFS, gtfsTripKey) {
    var originID = GTFS.getIDOfFirstStopForTrip (gtfsTripKey);

    return (originID) ? 'MTA_' + originID : null;
}


/**
 *  "The GTFS stop ID for the last stop on the trip 
 *   the vehicle is serving, prefixed by Agency ID."
 */
function getDestinationRef (GTFSrt, trip_id, agency_id) {
    var destinationID = GTFSrt.getDestinationIDForTrip(trip_id);

    return (destinationID) ? 'MTA_' + destinationID : null;
}


/**
 *  "The GTFS trip_headsign for the trip the vehicle is serving."
 */
function getDestinationName (GTFS, gtfsTripKey) {
    return GTFS.getTripHeadsign(gtfsTripKey);
}

/**
 *  "If a bus has not yet departed, OriginAimedDepartureTime indicates 
 *   the scheduled departure time of that bus from that terminal in ISO8601 format."
 */
function getOriginAimedDepartureTime (GTFSrt, trip_id) {
    return GTFSrt.getOriginTimeForTrip(trip_id);
}


/**
 *  "SituationRef, present only if there is an active service alert covering this call."
 *  GTFS-Realtime alerts don't map. Therefore, leaving null. 
 *  TODO: Verify that this is the right approach.
 */
function getSituationRef () {
    //TODO: Implement
    return null;
}


/**
 *  "Always true."
 */
function getMonitored () {
    return true;
}


/**
 *  "The most recently recorded or inferred coordinates of this vehicle."
 */
function getVehicleLocation (trainTrackerSnapshot, gtfsTripKey) {
    return {
        "Latitude"  : trainTrackerSnapshot ? trainTrackerSnapshot.getLatitude(gtfsTripKey) : null,
        "Longitude" : trainTrackerSnapshot ? trainTrackerSnapshot.getLongitude(gtfsTripKey) : null,
    };
}

/** 
 *  "Vehicle bearing: 0 is East, increments counter-clockwise."
 */
function getBearing (trainTrackerSnapshot, gtfsTripKey) {
    return trainTrackerSnapshot ? trainTrackerSnapshot.getBearing(gtfsTripKey) : null;
}


/**
 *  "Indicator of whether the bus is 
 *      making progress (i.e. moving, generally), 
 *      not moving (with value noProgress), 
 *      laying over before beginning a trip (value layover), 
 *      or serving a trip prior to one which will arrive (prevTrip)."
 */
function getProgressRate () {//TODO
    //TODO: Implement
    return null;
}


/**
 *  "Optional indicator of vehicle progress status. 
 *   Set to "layover" when the bus is in a layover 
 *       waiting for its next trip to start at a terminal, 
 *   and/or "prevTrip" when the bus is currently serving the previous trip 
 *       and the information presented 'wraps around' to the following scheduled trip."
 */
function getProgressStatus () {//TODO
    //TODO: Implement
    return null;
}



/**
 *  "The GTFS service date for the trip the vehicle is serving."
 */
function getDataFrameRef (scheduleDate) {
    return (Object.prototype.toString.call(scheduleDate) === '[object Date]') ?
            timeUtils.getTimestamp(scheduleDate, null, 'YYYY-MM-DD') :
            null;
}



/**
 *  "The GTFS trip ID for trip the vehicle is serving, prefixed by the GTFS agency ID."
 */
function getDatedVehicleJourneyRef (GTFS, gtfsTripKey) {
    var fullTripID = GTFS.getFullTripIDForTrip(gtfsTripKey);

    return (fullTripID) ? ('MTA NYCT ' + fullTripID) : null;
}



/**
 *  "The vehicle ID, preceded by the GTFS agency ID."
 */
function getVehicleRef (agency_id, train_id) {
    if (agency_id !== null) {
        return (train_id !== null) ? (agency_id + '_' + train_id) : null;
    } else {
        return train_id;
    }
}



/**
 *  "Depending on the system's level of confidence, the GTFS block_id the bus is serving."
 *  "If the assignment is block-level, 
 *   the new BlockRef field of the MonitoredVehicleJourney is present, 
 *   and populated with the assigned block id."
 *  NOTE: Qualifications in the MTA documentations.
 *       @see [Transparency of Block vs. Trip-Level Assignment]@link{https://bustime.mta.info/wiki/Developers/SIRIMonitoredVehicleJourney#HTransparencyofBlockvs.Trip-LevelAssignment}
 */
function getBlockRef (GTFS, gtfsTripKey) {
    return GTFS.getBlockIDForTrip(gtfsTripKey);
}



/**
 * Get the MonitoredCall for the MonitoredVehicleJourney.
 * "Call data about a particular stop. 
 *      In StopMonitoring, it is the stop of interest; 
 *      in VehicleMonitoring it is the next stop the bus will make."
 * @param {module:MTA_Subway_GTFS-Realtime_Toolkit.Wrapper} GTFSrt
 * @param {string|number} trip_id
 * @param {string|number} stop_id
 * @returns {object}
 * @see getCall
 */
function getMonitoredCall (GTFS, GTFSrt, trainTrackerSnapshot, trip_id, stop_id) {//
    var monitoredStopID = stop_id || GTFSrt.getIDOfNextOnwardStopForTrip(trip_id);

    return CallBuilder.buildCall(GTFS, GTFSrt, trainTrackerSnapshot, trip_id, monitoredStopID);
}


/**
 * "The collection of calls that a vehicle is going to make."
 */
function getOnwardCalls (GTFS, GTFSrt, trainTrackerSnapshot, trip_id, maxOnwardCalls) { 
    var onwardStopIDs = (maxOnwardCalls) ?
                            GTFSrt.getNextNOnwardStopIDsForTrip(trip_id, maxOnwardCalls) :
                            GTFSrt.getOnwardStopIDsForTrip(trip_id)                      ;

    return onwardStopIDs.map(CallBuilder.buildCall.bind({}, GTFS, GTFSrt, trainTrackerSnapshot, trip_id));
}


/**
 *  "The GTFS stop ID of the stop prefixed by agency_id."
 */
function getStopPointRef (stop_id) {
    return 'MTA_' + stop_id;
}


/**
 *  "The GTFS stop name of the stop."
 */
function getStopPointName (GTFS, stop_id) {
    return GTFS.getStopName(stop_id);
}


/**
 *  "The ordinal value of the visit of this vehicle to this stop, always 1 in this implementation."
 */
function getVisitNumber () {
    return 1;
}



module.exports = {
    getMonitoredVehicleJourney : getMonitoredVehicleJourney ,
};

