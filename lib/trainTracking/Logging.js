'use strict';

// NOTE: Currently, the csv files do not have header rows.


var fs = require('fs'),
    _  = require('lodash'),

    timeUtils = require('MTA_Subway_GTFS-Realtime_Toolkit').TimeUtils ;

var constants = require("./Constants");



var verifiedTrainLocationsCSVHasHeaderRow     = false,
    verifiedTrainTrackingStatsCSVHasHeaderRow = false;



function logLocationInferringStats (GTFSrt, result, unscheduledTrips, noSpatialDataTrips, config) {
    var timestamp = GTFSrt.getTimestampForFeedMessage();

    if (config.logTrainLocations) {
        if (verifiedTrainLocationsCSVHasHeaderRow) {
            logTrainLocations (result, config, timestamp);
        } else {
            verifyTrainLocationsCSVHasHeaderRowBeforeLogging(result, config, timestamp);
        }
    }

    if (config.logTrainTrackingStats) {
        if (verifiedTrainTrackingStatsCSVHasHeaderRow) {
            logInfoCompletenessStats(result, unscheduledTrips, noSpatialDataTrips, config, timestamp);
        } else {
            verifyTrainTrackingStatsCSVHasHeaderRowBeforeLogging(result, 
                                                                 unscheduledTrips, 
                                                                 noSpatialDataTrips, 
                                                                 config, 
                                                                 timestamp);
        }
    } 

    if (config.logUnscheduledTrips) {
        logUnscheduledTrips(timestamp, unscheduledTrips, config) ;
    }

    if (config.logNoSpatialDataTrips) {
        logNoSpatialDataTrips(timestamp, noSpatialDataTrips, config);
    }
}


function logTrainLocations (result, config, timestamp) {

    var row = { 
        timestamp: timestamp ,
    };

    Object.keys(result).reduce(function (acc, gtfsTripKey) {
        var locationGeoJSON = _.get( result, [gtfsTripKey, 'locationGeoJSON'], null ),
            atStop,
            coordinates,
            distanceAlongRoute ;

         //['trainLocations', gtfsTripKey, 'locationGeoJSON', 'properties', 'start_dist_along_route_in_km'], 

        if (locationGeoJSON) {
            atStop = locationGeoJSON.properties.atStop;
            
            if (locationGeoJSON.geometry.type === 'LineString') {
                coordinates = locationGeoJSON.geometry.coordinates[0];
            } else if (locationGeoJSON.geometry.type === 'Point') {
                coordinates = locationGeoJSON.geometry.coordinates;
            }

            distanceAlongRoute = locationGeoJSON.properties.start_dist_along_route_in_km;
        }
       
        if (Array.isArray(coordinates)) {
            coordinates = coordinates.map(function (n) { 
                        return n.toPrecision(constants.SIGNIFICANT_DIGITS); 
                     });

            acc[gtfsTripKey] = {
                atStop             : atStop ,
                coodinates         : coordinates ,
                distanceAlongRoute : distanceAlongRoute ,
            };
        }

        return acc;
    }, row.locations = {});

    fs.appendFile(config.trainLocationsLogPath, JSON.stringify(row) + '\n', function (err) {
        if (err) { console.log(err); }
    });
}


function logInfoCompletenessStats (result, unscheduledTrips, noSpatialDataTrips, config, timeStamp) {
    var completeDataCount  = Object.keys(result).length ,
        unscheduledCount   = unscheduledTrips.length    ,
        noSpatialDataCount = noSpatialDataTrips.length  ,

        statsRow = '\n' + [timeStamp, completeDataCount, unscheduledCount, noSpatialDataCount].join(',');

    fs.appendFile(config.trainTrackingStatsLogPath, statsRow, function (err) {
        if (err) { console.error(err); }
    });
}


function logUnscheduledTrips (timestamp, unscheduledTrips, config) {

    if (unscheduledTrips && unscheduledTrips.length) {
        var data = {
            timestamp : timestamp ,
            unscheduledTrips : unscheduledTrips ,
        };

        fs.appendFile(config.unscheduledTripsLogPath, JSON.stringify(data) + '\n', function (err) {
            if (err) { console.error(err); }
        });
    }
}


function logNoSpatialDataTrips (timestamp, noSpatialDataTrips, config) {

    if (noSpatialDataTrips && noSpatialDataTrips.length) {
        var data = {
            timestamp          : timestamp ,
            noSpatialDataTrips : noSpatialDataTrips ,
        };

        fs.appendFile(config.noSpatialDataTripsLogPath, JSON.stringify(data) + '\n', function (err) {
            if (err) { console.error(err); }
        });
    }
}


function verifyTrainLocationsCSVHasHeaderRowBeforeLogging (result, config, timestamp) {
    var headersRow = 'timestamp,gtfs_trip_key,longitude,latitude';

    verifiedTrainLocationsCSVHasHeaderRow = true;

    fs.stat(config.trainLocationsLogPath, function (err) {
        if (err) {
            if (err.code === 'ENOENT') {
                fs.writeFile(config.trainLocationsLogPath, headersRow, function (err) {
                    if (err) {
                        console.error('Unable to initialize train locations log file.');
                        console.error(err);
                    } else {
                        logTrainLocations(result, config, timestamp);
                    }
                });
            } else {
                console.error('Unable to initialize train locations log file.');
                console.error(err);
            }
        } else {
            logTrainLocations(result, config, timestamp);
        }
    });  
}


function verifyTrainTrackingStatsCSVHasHeaderRowBeforeLogging (result, unscheduledTrips, noSpatialDataTrips, config, timestamp) {
    var headersRow = 'timestamp,num_trains_with_complete_data,' +
                     'num_unscheduled_trains,num_scheduled_but_without_spatial_data';

    verifiedTrainTrackingStatsCSVHasHeaderRow = true;

    fs.stat(config.trainTrackingStatsLogPath, function (err) {
        if (err) {
            if (err.code === 'ENOENT') { //If the file doesn't exist, we add the header row.
                fs.writeFile(config.trainTrackingStatsLogPath, headersRow, function (err) {
                    if (err) {
                        console.error('Unable to initialize train tracking statistics file.');
                        console.error(err);
                    } else {
                        logInfoCompletenessStats(result, unscheduledTrips, noSpatialDataTrips, config, timestamp);
                    }
                });    
            } else {
                console.error('Unable to initialize train tracking statistics file.');
                console.error(err);
            }
        } else {
            logInfoCompletenessStats(result, unscheduledTrips, noSpatialDataTrips, config, timestamp);
        }
    });  
}


function logTrainTrackingErrors (ctx) {

    if (! (ctx && ctx.config && ctx.config.logTrainTrackingErrors) ) { return; }

    try {
        var debugging_info ,
            output ;

        if (ctx.state.NO_STOP_TIME_UPDATE) { ctx.immediateStopInfo = 'DOES_NOT_EXIST'; }

        debugging_info = {
            state                : ctx.state ,
            
            gtfsTripKey          : ctx.gtfsTripKey ,
            
            previousState        : (ctx.previous) ? ctx.previous.state : null ,
            
            previousGeoJSON : {
                geometry   : _.get(ctx.previous, ['locationGeoJSON', 'geometry'], null) ,
                properties : _.omit(_.get(ctx.previous, ['locationGeoJSON', 'properties'], null), '_GTFS') ,
            },

            currentGeoJSON : {
                geometry   : (ctx.locationGeoJSON) ? ctx.locationGeoJSON.geometry : null ,
                properties : _.omit((ctx.locationGeoJSON && ctx.locationGeoJSON.properties), '_GTFS') ,
            },

            immediateStopInfo     : ctx.immediateStopInfo ,
            prevImmediateNextStop : (ctx.previous) ? (ctx.previous.immediateStopInfo) : null ,
            gtfsrtTimestamp       : (+ctx.gtfsrtTimestamp) ? 
                                        timeUtils.getTimestamp(+ctx.gtfsrtTimestamp) : null ,
            prevGtfsrtTimestamp   : (+ctx.previousSnapshot.gtfsrtTimestamp) ? 
                                        timeUtils.getTimestamp(+ctx.previousSnapshot.gtfsrtTimestamp) : null ,
            positionTimestamp     : (+ctx.immediateStopInfo.timestamp) ? 
                                        timeUtils.getTimestamp(+ctx.immediateStopInfo.timestamp) : null ,
            prevPositionTimestamp : (timeUtils.getTimestamp(+ctx.previous.immediateStopInfo.timestamp)) || null ,
            immediateStopETA      : timeUtils.getTimestamp(+ctx.immediateStopInfo.eta) || null ,
            subsequentStop        : ctx.subsequentStop ,
            ratioCovered          : ctx.ratioCovered ,
            vehicleStopStatus     : ctx.GTFSrt.getVehiclePositionCurrentStatusForTrip(ctx.trip_id) ,

            currentStopSequence   : 
                    ctx.GTFSrt.getVehiclePositionCurrentStopSequenceForTrip(ctx.immediateStopInfo.trip_id),

            trip_in_alerts        : ctx.GTFSrt.tripDoesHaveAlert(ctx.trip_id) ,

            error                 : ctx.error.stack ,
        };

        console.log(ctx.immediateStopInfo.timestamp);

        output = JSON.stringify(debugging_info) + '\n';

        fs.appendFile(ctx.config.trainTrackingErrorsLogPath, output, function (err) {
            if (err) { console.error(err); }
        });

    } catch (e) {
        console.error(e.stack || e);
    } 
}


module.exports = {
    logLocationInferringStats : logLocationInferringStats ,
    logTrainLocations         : logTrainLocations         ,
    logUnscheduledTrips       : logUnscheduledTrips       ,
    logNoSpatialDataTrips     : logNoSpatialDataTrips     ,
    logTrainTrackingErrors    : logTrainTrackingErrors    ,
};
