'use strict';

//TODO: Remove next line
/* jshint unused: false */

// TODO: ? Should not return a response whose ResponseTimeStamp > ValidUntil ?

// TODO: Getting the appropriate GTFS data should be handled in the GTFS wrapper,
//       HOWEVER, this code should create a new GTFS wrapper object whenever a new schedule day is needed.
//       Should cache the GTFS objects and reuse them, creating a new one when needed, and deleting the old one
//       when no longer needed... A GTFS cache strategy.
//
//       Need the address the memory usage issue when two GTFS wrapper objects need to be in the memory at once.
//       A 'pluck' function may be required on the GTFS wrapper so that irrelevant info can be discarded.



var _ = require('lodash'),

    GTFS_Wrapper = require('MTA_Subway_GTFS_Toolkit').GTFS_Wrapper,
    timeUtils    = require('./utils/timeUtils');



function newGTFSRealtimeToSIRIConverter (GTFSrt) {
    return {
        getStopMonitoringResponse    : _.partial(getStopMonitoringResponse    , GTFSrt) ,
        getVehicleMonitoringResponse : _.partial(getVehicleMonitoringResponse , GTFSrt) ,
    };
}


function getStopMonitoringResponse (GTFSrt, getParams) {
    var timestamper = _newResponseTimestamper(),

        response = {
            "Siri" : {
                "ServiceDelivery" : getStopMonitoringServiceDelivery(GTFSrt, getParams, timestamper),
            },
        };

    timestamper.stamp(); 

    return response;
}


function getVehicleMonitoringResponse (GTFSrt, getParams) {
    var timestamper = _newResponseTimestamper(),

        response = {
            "Siri" : {
                "ServiceDelivery" : getVehicleMonitoringServiceDelivery(GTFSrt, getParams, timestamper),
            },
        };

    timestamper.stamp();

    return response;
}



function getStopMonitoringServiceDelivery (GTFSrt, getParams, timestamper) {
    var delivery = {
        //"ResponseTimestamp" handled by the timestamper.
        "StopMonitoringDelivery"    : getStopMonitoringDelivery(GTFSrt, getParams, timestamper)    ,
        "SituationExchangeDelivery" : getSituationExchangeDelivery(GTFSrt, getParams, timestamper) ,
    };

    timestamper.push(delivery);

    return delivery;
}

function getVehicleMonitoringServiceDelivery (GTFSrt, getParams, timestamper) {
    var delivery = {
        //"ResponseTimestamp" handled by the timestamper.
        "VehicleMonitoringDelivery" : getVehicleMonitoringDelivery(GTFSrt, getParams, timestamper) ,
        "SituationExchangeDelivery" : getSituationExchangeDelivery(GTFSrt, getParams) ,
    };

    timestamper.push(delivery);

    return delivery;
}


function getStopMonitoringDelivery (GTFSrt, getParams, timestamper) {
    var delivery = {
        //"ResponseTimestamp" handled by the timestamper.
        "MonitoredStopVisit" : getMonitoredStopVisit(GTFSrt, getParams, timestamper) ,
        "ValidUntil"         : getValidUntil(GTFSrt)                                 ,
    };

    timestamper.push(delivery);

    return delivery;
}


function getVehicleMonitoringDelivery (GTFSrt, getParams, timestamper) {
    var delivery = {
        //"ResponseTimestamp" handled by the timestamper.
        "VehicleActivity"   : getVehicleActivity(GTFSrt, getParams, timestamper) ,
        "ValidUntil"        : getValidUntil(GTFSrt)                              ,
    };

    timestamper.push(delivery);

    return delivery;
}


function getSituationExchangeDelivery (GTFSrt, getParams) {
    //TODO: Implement;
    return null;
}


function getMonitoredStopVisit (GTFSrt, getParams) {
    var stopID                       = getParams.MonitoringRef,
        routeID                      = getParams.LineRef,
        maxOnwardCalls               = getParams.MaximumNumberOfCallsOnwards,
        vehicleMonitoringDetailLevel = getParams.VehicleMonitoringDetailLevel,

        requestedTrains = (routeID) ? 
                            GTFSrt.getTrainsServicingStopForRoute(stopID, routeID) : 
                            GTFSrt.getTrainsServicingStop(stopID)                  ;

    return requestedTrains.map(function (trainID) {
        return {
            "MonitoredVehicleJourney" : 
                getStopMonitoringMonitoredVehicleJourney(GTFSrt,
                                                         trainID,
                                                         stopID,
                                                         maxOnwardCalls,
                                                         vehicleMonitoringDetailLevel),
            "RecordedAtTime" : 
                getMonitoredStopVisitRecordedAtTime(GTFSrt, getParams) ,
        };
    });
}


function getVehicleActivity (GTFSrt, getParams) {
    var trainID                      = (getParams.VehicleRef && getParams.VehicleRef.replace('MTA ', '')),
        routeID                      = getParams.LineRef,
        maxOnwardCalls               = getParams.MaximumNumberOfCallsOnwards,
        vehicleMonitoringDetailLevel = getParams.VehicleMonitoringDetailLevel,
        requestedTrains;
            
    if (trainID && routeID) {
       requestedTrains = _.intersection(GTFSrt.getTrainsServicingRoute(routeID), [trainID]);
    } else if (trainID) {
        requestedTrains = [trainID];
    } else if (routeID) {
        requestedTrains = GTFSrt.getTrainsServicingRoute(routeID);
    } else {
        requestedTrains = GTFSrt.getAllMonitoredTrains();
    }

    // FIXME: Handle alert only trains. 
    requestedTrains = requestedTrains.filter(function (trainID) { return !!GTFSrt.trainsIndex[trainID].tripUpdate; });

        
    return requestedTrains.map(function (trainID) {
        return {
            "MonitoredVehicleJourney" : 
                getVehicleMonitoringMonitoredVehicleJourney(GTFSrt,
                                                            trainID, 
                                                            maxOnwardCalls,
                                                            vehicleMonitoringDetailLevel),
            "RecordedAtTime" : 
                getMonitoredStopVisitRecordedAtTime(GTFSrt, getParams) ,
        };
    });
}


function getValidUntil (GTFSrt, getParams) {
    // ??? Should we account for processing the GTFS-RT feed? ???
    // Or, block requests after GTFS-RT update until the new data is processed ???
    var posixTimestamp = GTFSrt.getTimestamp() + 30; 

    return timeUtils.getTimestampFromPosix(posixTimestamp);
}


function getSituationExchangeDelivery (getParams) {
    //TODO: Implement;
    return null;
}


function getStopMonitoringMonitoredVehicleJourney (GTFSrt, trainID, stopID, maxOnwardCalls, detailLevel) {
    return getMonitoredVehicleJourney(GTFSrt, trainID, stopID,  maxOnwardCalls, detailLevel);
}


function getVehicleMonitoringMonitoredVehicleJourney (GTFSrt, trainID, maxOnwardCalls, detailLevel) {
    return getMonitoredVehicleJourney(GTFSrt, trainID, null, maxOnwardCalls, detailLevel);
}


// TODO: 
function getMonitoredVehicleJourney (GTFSrt, trainID, stopID, maxOnwardCalls, detailLevel) {
    var monitoredStopID = stopID || GTFSrt.getIDOfNextStopForTrain(trainID),

        scheduleDate    = GTFSrt.getTripScheduleDateForTrain(trainID),

        GTFS            = getGTFSForScheduleDate(scheduleDate),

        tripPartialName = GTFSrt.getPartialGTFSTripNameForTrain(trainID);



    return {
        "LineRef"                  : getLineRef(GTFSrt, trainID)                                                            ,
        "DirectionRef"             : getDirectionRef(trainID)                                                               ,
        "FramedVehicleJourneyRef"  : getFramedVehicleJourneyRef(GTFS, GTFSrt, trainID, tripPartialName)                     ,
        "JourneyPatternRef"        : getJourneyPatternRef(GTFS, tripPartialName)                                            ,
        "PublishedLineName"        : getPublishedLineName(GTFSrt, trainID)                                                  ,
        "OperatorRef"              : getOperatorRef()                                                                       ,
        "OriginRef"                : getOriginRef(trainID)                                                                  ,
        "DestinationRef"           : getDestinationRef(GTFSrt, trainID)                                                     ,
        "DestinationName"          : getDestinationName(GTFS, tripPartialName)                                              ,
        "OriginAimedDepartureTime" : getOriginAimedDepartureTime(trainID)                                                   ,
        "SituationRef"             : getSituationRef(trainID)                                                               ,
        "Monitored"                : getMonitored()                                                                         ,
        "VehicleLocation"          : getVehicleLocation(trainID)                                                            ,
        "Bearing"                  : getBearing(trainID)                                                                    ,
        "ProgressRate"             : getProgressRate(trainID)                                                               ,
        "ProgressStatus"           : getProgressStatus(trainID)                                                             ,
        "BlockRef"                 : getBlockRef(trainID)                                                                   ,
        "VehicleRef"               : getVehicleRef(trainID)                                                                 ,
        "MonitoredCall"            : getCall(GTFS, GTFSrt, trainID, monitoredStopID)                                        ,
        "OnwardCalls"              : (detailLevel === 'calls') ? getOnwardCalls(GTFS, GTFSrt, trainID, maxOnwardCalls) : {} ,
    };
}


function getMonitoredStopVisitRecordedAtTime (getParams) {
    //TODO: Implement;
    return null;
}


function getFramedVehicleJourneyRef (GTFS, GTFSrt, trainID, tripPartialName) {
    var scheduleDate = GTFSrt.getTripScheduleDateForTrain(trainID);

    return {
        "DataFrameRef"           : timeUtils.dateToString(scheduleDate)   ,
        "DatedVehicleJourneyRef" : getDatedVehicleJourneyRef(GTFS, tripPartialName) ,
    };
}


function getVehicleLocation (trainID) {
    return {
        "Longitude" : getLongitude(trainID) ,
        "Latitude"  : getLatitude(trainID)  ,
    };
}


function getCall (GTFS, GTFSrt, trainID, stopID) {
    return {
        "Extensions"            : { "Distances" : getDistances(GTFS, GTFSrt, trainID, stopID), },

        "ExpectedArrivalTime"   : getExpectedArrivalTime(GTFSrt, trainID, stopID)   ,
        "ExpectedDepartureTime" : getExpectedDepartureTime(GTFSrt, trainID, stopID) ,

        "StopPointRef"          : getStopPointRef(stopID)                   ,
        "StopPointName"         : getStopPointName(GTFS, stopID)                  ,

        "VisitNumber"           : getVisitNumber(GTFSrt, trainID, stopID)           ,
    };
}


function getLineRef (GTFSrt, trainID) {
    return 'MTA ' + GTFSrt.getRouteIDForTrain(trainID);
}

/* ???????????????????????????????????????????????????????????????????????????????????
   I think this means always 0. Not the N or S bound directions, 
   but a GTFS specific meaning. Always 0 for trains, it seems.
   https://developers.google.com/transit/gtfs/reference?hl=en#trips_direction_id_field */
// FIXME
function getDirectionRef () {
    return 0;
}


// ??? Use the shape id encoded in the route name ???
function getJourneyPatternRef (GTFS, tripPartialName) {
    var shapeID = GTFS.getGTFSShapeIDForTrain(tripPartialName);

    return (shapeID) ? ('MTA ' + shapeID) : null;
}


function getPublishedLineName (GTFSrt, trainID) {
    return GTFSrt.getGTFSRouteShortNameForTrain(trainID) || null;
}


function getOperatorRef () {
    return 'MTA';
}


function getOriginRef (getParams) {
    //TODO: Implement
    return null;
}


function getDestinationRef (GTFSrt, trainID) { //FIXME: Mess. At least make more defensively coded.
    var destinationID = GTFSrt.getDestinationIDForTrain(trainID);

    return (destinationID) ? 'MTA_' + destinationID : null;
}

function getDestinationName (GTFS, tripPartialName) {
    return GTFS.getGTFSTripHeadsignForTrain(tripPartialName);
}

// <!-- If a bus has not yet departed, OriginAimedDepartureTime indicates 
// the scheduled departure time of that bus from that terminal in ISO8601 format -->
function getOriginAimedDepartureTime (getParams) {
    //TODO: Implement
    return null;
}


function getSituationRef (getParams) {
    //TODO: Implement
    return null;
}


function getMonitored () {
    return true;
}


function getBearing (getParams) {
    //TODO: Implement
    return null;
}


function getProgressRate (getParams) {
    //TODO: Implement
    return null;
}


function getProgressStatus (getParams) {
    //TODO: Implement
    return null;
}


/*  PJT: I don't think this applies.... all in GTFS empty.
    
    From https://developers.google.com/transit/gtfs/reference#trips_block_id_field
    The block_id field identifies the block to which the trip belongs. 
    A block consists of two or more sequential trips made using the same vehicle, 
    where a passenger can transfer from one trip to the next just by staying in the vehicle. 
    The block_id must be referenced by two or more trips in trips.txt.
 */
function getBlockRef (getParams) {
    //TODO: Implement
    return null;
}


function getVehicleRef (trainID) { //TODO: Implement
    return 'MTA ' + trainID;
}


function getOnwardCalls (GTFS, GTFSrt, trainID, maxOnwardCalls) { //TODO: Implement
    var onwardStopIDs = (maxOnwardCalls) ?
                            GTFSrt.getFirstNOnwardStopIDsForTrain(trainID, maxOnwardCalls) :
                            GTFSrt.getOnwardStopIDsForTrain(trainID)                       ;

    return onwardStopIDs.map(getCall.bind({}, GTFS, GTFSrt, trainID));
}


function getDataFrameRefDate (start_date, origin_time) {
    var refDate = new Date(start_date);

    if      ( origin_time < 0)      { refDate.setDate(refDate.getDate() + 1); }
    else if ( origin_time > 144000) { refDate.setDate(refDate.getDate() - 1); }

    return refDate;
}

function getDatedVehicleJourneyRef (GTFS, tripPartialName) {
    var gtfsTripID      = GTFS.getGTFSTripIDForTrain(tripPartialName);

    return (gtfsTripID) ? ('MTA NYCT ' + gtfsTripID) : null;
}


function getLongitude (getParams) {
    //TODO: Implement
    return null;
}


function getLatitude (getParams) {
    //TODO: Implement
    return null;
}


// Left off here passing GTFS & GTFSrt into function.
function getDistances (GTFS, GTFSrt, trainID, stopID) {
    return {
        "PresentableDistance"    : getPresentableDistance(GTFS, GTFSrt, trainID, stopID) ,
        "DistanceFromCall"       : getDistanceFromCall(trainID, stopID)                  ,
        "StopsFromCall"          : getStopsFromCall(GTFS, GTFSrt, trainID, stopID)       ,
        "CallDistanceAlongRoute" : getCallDistanceAlongRoute(trainID, stopID)            ,
    };
}


function getExpectedArrivalTime (GTFSrt, trainID, stopID) { // Note: in docs, but not in actual SIRI.
    var arrivalTime = GTFSrt.getTrainArrivalTimeForStop(trainID, stopID);

    return (arrivalTime) ? timeUtils.getTimestampFromPosix(arrivalTime) : null;
}


function getExpectedDepartureTime (GTFSrt, trainID, stopID) { // Note: in docs, but not in actual SIRI.
    var departureTime = GTFSrt.getTrainDepartureTimeForStop(trainID, stopID);

    return (departureTime) ? timeUtils.getTimestampFromPosix(departureTime) : null;
}


function getStopPointRef (stopID) {
    return 'MTA ' + stopID;
}


function getStopPointName (GTFS, stopID) {
    return GTFS.getStopName(stopID);
}


function getVisitNumber (getParams) {
    return 1;
}


// FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME
// Will need to handle the cache. Huge memory leak as is !!!
var getGTFSForScheduleDate = _.memoize(function (scheduleDate) {
    return GTFS_Wrapper.newGTFSWrapperForScheduleDate(scheduleDate);
});
// FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME






//  The PresentableDistance field:
//  
//  The logic that determines whether stops or miles are shown 
//  in the PresentableDistance field is below:
//  
//      show distance in miles if and only if:
//          (distance in miles to _immediate next stop_ is > D) 
//          OR 
//          (distance in stops to current stop is > N AND distance in miles to current stop > E)
//
//          in other words, show distance in stops if and only if 
//              (distance in miles to _immediate next stop_ is <= D) 
//              AND 
//              (distance in stops to current stop <= N OR distance in miles to current stop <= E)
//
//      Show "approaching" if and only if:
//          distance_in_miles to immediate next stop < P
//
//      show "at stop" if and only if:
//          distance_in_miles to immediate next stop < T
//
//  Current Parameter Values:
//      Parameter	Value    
//          D	     0.5 miles
//          N	     3 stops
//          E	     0.5 miles
//          P	     500 feet
//          T	     100 feet
//
//TODO: Implement this.
function getPresentableDistance (GTFS, GTFSrt, trainID, stopID) {
    // Constant Parameters
    var D = 0.5,
        N = 3,
        E = 0.5,
        P = 500,
        T = 100;


    var distInMilesToNextStop = GTFSrt.getDistanceInMilesToNextStop(GTFS, trainID),
        distInStopsToNextStop = GTFSrt.getDistanceInStopsToNextStop(GTFS, trainID),
        distInMilesToCurrStop = GTFSrt.getDistanceInMilesToCurrStop(GTFS, trainID, stopID),
        distInStopsToCurrStop = GTFSrt.getDistanceInStopsToCurrStop(GTFS, trainID, stopID);

    return null;
}


function getDistanceFromCall (getParams) {
    //TODO: Implement
    return null;
}


function getStopsFromCall (GTFS, GTFSrt, trainID, stopID) {
    return GTFSrt.getStopsFromCallForTrain(trainID, stopID);
}


function getCallDistanceAlongRoute (getParams) {
    //TODO: Implement
    return null;
}


function padLeft (str, num) {        // For testing output.
    return _.padLeft(str, 2, '0');
}

function getTimestampForTestOutput () {
    var time  = new Date(),
        stamp = time.getFullYear() + 
                padLeft( time.getMonth()   ) + 
                padLeft( time.getDate()    ) +
                '_'                          +
                padLeft( time.getHours()   ) +
                ':'                          +
                padLeft( time.getMinutes() ) +
                ':'                          +
                padLeft( time.getSeconds() ) ;
 
    return stamp;
}


var _newResponseTimestamper = (function () {

    function _stamper (objList) {
        var timestamp = timeUtils.getTimestamp();

       _.forEach(objList, function(obj) { obj.ResponseTimestamp = timestamp; });
    }

    return function () {
        var toStamp = [];

        return {
            push  : function(obj) { toStamp.push(obj); },
            stamp : _stamper.bind(null, toStamp),
        };
    };
}());


function test (getParams) {
    //var fs    = require('fs'),
        //stamp = getTimestampForTestOutput();

    //var siriOutput = JSON.stringify(getVehicleMonitoringResponse(getParams), null, '  ');


    //fs.writeFileSync(__dirname + '/testsOutput/' + 'siri_test_' + stamp + '.json', siriOutput);

    //console.log(JSON.stringify(getStopMonitoringResponse(getParams), null, '\t'));
    //getVehicleMonitoringResponse(getParams);
    //
    //console.log(GTFSrt.stopsIndex);
    

    var siriOutput = JSON.stringify(getVehicleMonitoringResponse(getParams), null, '  ');
    console.log(siriOutput);
}


module.exports = {
    newGTFSRealtimeToSIRIConverter : newGTFSRealtimeToSIRIConverter ,
};
