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


var _ = require('lodash'),

    timeUtils = require('./utils/timeUtils');
    



/**
 *  "Call data about a particular stop."
 */
function buildCall (GTFS, GTFSrt, trainTrackerSnapshot, trip_id, stop_id) { //TODO: Left-off here.
    return {
        "Extensions"            : { "Distances" : getDistances(GTFS, GTFSrt, trainTrackerSnapshot, trip_id, stop_id), } ,//TODO

        "ExpectedArrivalTime"   : getExpectedArrivalTime(GTFSrt, trip_id, stop_id)                                      ,//TODO
        "ExpectedDepartureTime" : getExpectedDepartureTime(GTFSrt, trip_id, stop_id)                                    ,//TODO

        "StopPointRef"          : getStopPointRef(stop_id)                                                              ,//\\
        "StopPointName"         : getStopPointName(GTFS, stop_id)                                                       ,//\\

        "VisitNumber"           : getVisitNumber()                                                                      ,//\\
    };
}



/**
 *  "The MTA Bus Time extensions to show distance of the vehicle from the stop."
 */
function getDistances (GTFS, GTFSrt, trainTrackerSnapshot, trip_id, stop_id) {
    var distances = trainTrackerSnapshot && trainTrackerSnapshot.getDistancesForCall(trip_id, stop_id);

    return {
        PresentableDistance    : _.get(distances , 'presentableDistance'    , null) , //TODO
        DistanceFromCall       : _.get(distances , 'distanceFromCall'       , null) , //TODO
        StopsFromCall          : _.get(distances , 'stopsFromCall'          , null) , //TODO
        CallDistanceAlongRoute : _.get(distances , 'callDistanceAlongRoute' , null) , //TODO
    };
}


/**
 *  "Predicted arrival times in ISO8601 format."
 */
function getExpectedArrivalTime (GTFSrt, trip_id, stop_id) { // Note: in docs, but not in actual SIRI.
    var arrivalTime = GTFSrt && GTFSrt.getExpectedArrivalTimeAtStopForTrip(trip_id, stop_id);

    return (arrivalTime) ? timeUtils.getTimestampFromPosix(arrivalTime) : null;
}


/**
 *  "Predicted departure times in ISO8601 format."
 */
function getExpectedDepartureTime (GTFSrt, trip_id, stop_id) { // Note: in docs, but not in actual SIRI.
    var departureTime = GTFSrt && GTFSrt.getExpectedDepartureTimeAtStopForTrip(trip_id, stop_id);

    return (departureTime) ? timeUtils.getTimestampFromPosix(departureTime) : null;
}


/**
 *  "The GTFS stop ID of the stop prefixed by agency_id."
 */
function getStopPointRef (stop_id) {
    return 'MTA ' + stop_id;
}


/**
 *  "The GTFS stop name of the stop."
 */
function getStopPointName (GTFS, stop_id) {
    return (GTFS && GTFS.getStopName(stop_id)) || null;
}


/**
 *  "The ordinal value of the visit of this vehicle to this stop, always 1 in this implementation."
 */
function getVisitNumber () {//\\
    return 1;
}


module.exports = {
    buildCall : buildCall ,
};

