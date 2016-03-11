'use strict';

// NOTE: Currently, the csv files do not have header rows.


var _  = require('lodash'),

    timeUtils = require('MTA_Subway_GTFS-Realtime_Toolkit').TimeUtils ,

    eventsCreator = require('../events/EventCreators') ;


var constants = require("./Constants");



function logLocationInferringStats (GTFSrt, result, unscheduledTrips, noSpatialDataTrips) {
    var timestamp = GTFSrt.getTimestampForFeedMessage();

    logTrainLocations (result, timestamp);

    logTrainTrackingStats(result, unscheduledTrips, noSpatialDataTrips, timestamp);

    logUnscheduledTrips(timestamp, unscheduledTrips) ;

    logNoSpatialDataTrips(timestamp, noSpatialDataTrips);
}


function logTrainLocations (result, timestamp) {

    var data = { 
        timestamp : timestamp ,
    };

    Object.keys(result).reduce(function (acc, gtfsTripKey) {
        var locationGeoJSON = _.get( result, [gtfsTripKey, 'locationGeoJSON'], null ),
            atStop,
            coordinates,
            distAlongRouteKm ;

        if (locationGeoJSON) {
            atStop = locationGeoJSON.properties.atStop;
            
            if (locationGeoJSON.geometry.type === 'LineString') {
                coordinates = locationGeoJSON.geometry.coordinates[0];
            } else if (locationGeoJSON.geometry.type === 'Point') {
                coordinates = locationGeoJSON.geometry.coordinates;
            }
            
            distAlongRouteKm = locationGeoJSON.properties.start_dist_along_route_in_km;
        }
       
        if (Array.isArray(coordinates)) {
            coordinates = coordinates.map(function (n) { 
                              return n.toPrecision(constants.SIGNIFICANT_DIGITS); 
                          });

            acc.push({
                gtfsTripKey       : gtfsTripKey ,
                //state             : result[gtfsTripKey].state ,
                atStop            : atStop ,
                //stopInfo          : result[gtfsTripKey].immediateStopInfo ,
                coodinates        : coordinates ,
                distAlongRouteKm  : distAlongRouteKm ,
                //geoJSONProperties : _.omit((locationGeoJSON && locationGeoJSON.properties), '_GTFS') ,
            });
        }

        return acc;

    }, data.locations = []);

    eventsCreator.emitTrainLocationsUpdate(data);
}


function logTrainTrackingStats (result, unscheduledTrips, noSpatialDataTrips, timestamp) {
    var data = {
        timestamp          : timestamp ,
        completeDataCount  : Object.keys(result).length ,
        unscheduledCount   : unscheduledTrips.length ,
        noSpatialDataCount : noSpatialDataTrips.length ,
    } ;

    eventsCreator.emitTrainTrackingStatsUpdate(data);
}


function logUnscheduledTrips (timestamp, unscheduledTrips) {

    if (unscheduledTrips && unscheduledTrips.length) {
        var data = {
            timestamp : timestamp ,
            unscheduledTrips : unscheduledTrips ,
        };

        eventsCreator.emitUnscheduledTripsUpdate(data);
    }
}


function logNoSpatialDataTrips (timestamp, noSpatialDataTrips) {

    if (noSpatialDataTrips && noSpatialDataTrips.length) {
        var data = {
            timestamp          : timestamp ,
            noSpatialDataTrips : noSpatialDataTrips ,
        };

        eventsCreator.emitNoSpatialDataTripsUpdate(data);
    }
}


function logTrainTrackingErrors (ctx) {

    if (! (ctx && ctx.config && ctx.config.logTrainTrackingErrors) ) { return; }

    try {
        var debugging_info ;
        

        if (ctx.state.NO_STOP_TIME_UPDATE) { ctx.immediateStopInfo = 'DOES_NOT_EXIST'; }

        debugging_info = {
            errorTimestamp : ctx.errorTimestamp ,

            state     : ctx.state ,
            prevState : (ctx.previous) ? ctx.previous.state : null ,
            
            gtfsTripKey : ctx.gtfsTripKey ,
            
            geoJSONProperties     : _.omit((ctx.locationGeoJSON && ctx.locationGeoJSON.properties), '_GTFS') ,
            prevGeoJSONProperties : _.omit(_.get(ctx.previous, ['locationGeoJSON', 'properties'], null), '_GTFS') ,

            immediateStopInfo     : ctx.immediateStopInfo ,
            prevImmediateStopInfo : (ctx.previous) ? (ctx.previous.immediateStopInfo) : null ,

            gtfsrtTimestamp     : (+ctx.gtfsrtTimestamp) ? timeUtils.getTimestamp(+ctx.gtfsrtTimestamp) : null ,
            prevGtfsrtTimestamp : (ctx.previousSnapshot && +ctx.previousSnapshot.gtfsrtTimestamp) ? 
                                        timeUtils.getTimestamp(+ctx.previousSnapshot.gtfsrtTimestamp) : null ,

            positionTimestamp     : (ctx.immediateStopInfo && +ctx.immediateStopInfo.timestamp) ? 
                                        timeUtils.getTimestamp(+ctx.immediateStopInfo.timestamp) : null ,
            prevPositionTimestamp : (ctx.previous && 
                                     ctx.previous.immediateStopInfo && 
                                     timeUtils.getTimestamp(+ctx.previous.immediateStopInfo.timestamp)) || null ,

            etaTimestamp   : timeUtils.getTimestamp(ctx.immediateStopInfo && +ctx.immediateStopInfo.eta) || null ,
            subsequentStop : ctx.subsequentStop ,
            ratioCovered   : ctx.ratioCovered ,

            gtfsrtVehicleStopStatus : ctx.GTFSrt.getVehiclePositionCurrentStatusForTrip(ctx.trip_id) ,

            stopSequence : (ctx.immediateStopInfo) ?
                    ctx.GTFSrt.getVehiclePositionCurrentStopSequenceForTrip(ctx.immediateStopInfo.trip_id) : null ,

            trip_in_alerts : ctx.GTFSrt.tripDoesHaveAlert(ctx.trip_id) ,

            error : ctx.error.stack ,
        };

        eventsCreator.emitTrainTrackingError(debugging_info);

        //fs.appendFile(ctx.config.trainTrackingErrorsLogPath, JSON.stringify(debugging_info) + '\n', function (err) {
            //if (err) { console.error(err); }
        //});

    } catch (e) {
        console.error(e.stack || e);
    } 
}


module.exports = {
    logLocationInferringStats : logLocationInferringStats ,
    logTrainTrackingErrors    : logTrainTrackingErrors    ,
};
