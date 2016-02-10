'use strict';

// NOTE: Currently, the csv files do not have header rows.


var fs = require('fs'),
    _  = require('lodash'),

    timeUtils = require('MTA_Subway_GTFS-Realtime_Toolkit').TimeUtils ;

var constants = require("./Constants");



var verifiedTrainLocationsCSVHasHeaderRow     = false,
    verifiedTrainTrackingStatsCSVHasHeaderRow = false;



function logLocationInferringStats (GTFSrt, result, unscheduledTrips, noSpatialDataTrips, config) {
    var timestamp = GTFSrt.getTimestamp();

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
            verifyTrainTrackingStatsCSVHasHeaderRowBeforeLogging(result, unscheduledTrips, noSpatialDataTrips, config, timestamp);
        }

    } 

    if (config.logUnscheduledTrips) {
        logUnscheduledTrips(unscheduledTrips, config) ;
    }

    if (config.logNoSpatialDataTrips) {
        logNoSpatialDataTrips(noSpatialDataTrips, config);
    }
}


function logTrainLocations (result, config, timestamp) {
     var output = Object.keys(result).reduce(function (acc, gtfsTripKey) {
                    var row             = '\n' + timestamp + ',' + gtfsTripKey + ',',

                        locationGeoJSON = _.get( result, [gtfsTripKey, 'locationGeoJSON'], null ),

                        coords;

                    if (locationGeoJSON) {
                        if (locationGeoJSON.geometry.type === 'LineString') {
                            coords = locationGeoJSON.geometry.coordinates[0];
                        } else if (locationGeoJSON.geometry.type === 'Point') {
                            coords = locationGeoJSON.geometry.coordinates;
                        }
                    }
                   
                    if (Array.isArray(coords)) {
                        coords = coords.map(function (n) { 
                                    return n.toPrecision(constants.SIGNIFICANT_DIGITS); 
                                 });
                    }

                    return acc += (row += (coords) ? coords.join(',') : ',');
                }, '');

    fs.appendFile(config.trainLocationsLogPath, output, function (err) {
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


function logUnscheduledTrips (unscheduledTrips, config) {
    var output = '\n' +  unscheduledTrips.join('\n');

    fs.appendFile(config.unscheduledTripsLogPath, output, function (err) {
        if (err) { console.error(err); }
    });
}


function logNoSpatialDataTrips (noSpatialDataTrips, config) {
    var output = '\n' +  noSpatialDataTrips.join('\n');

    fs.appendFile(config.noSpatialDataTripsLogPath, output, function (err) {
        if (err) { console.error(err); }
    });
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
    var headersRow = 'timestamp, num_trains_with_complete_data,num_unscheduled_trains,num_scheduled_but_without_spatial_data';

    verifiedTrainTrackingStatsCSVHasHeaderRow = true;

    fs.stat(config.trainTrackingStatsLogPath, function (err) {
        if (err) {
            if (err.code === 'ENOENT') {
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

    var train_id = ctx.GTFSrt.getTrainIDForTrip(ctx.trip_id) ,

        message = 'ERROR: for tripKey ' + ctx.gtfsTripKey + ' with train_id ' + train_id + '\n' + 
                 (ctx.error ? (ctx.error.message + '\n') : ''),

        debugging_info;
    
    try {


        // TODO: DELETE THIS. Just here for development.
        if ( ctx.state.BAD_ETA ) {
            debugging_info = {
                gtfsrtTimestamp : (+ctx.gtfsrtTimestamp) ? timeUtils.getTimestamp(+ctx.gtfsrtTimestamp) : null ,

                prevGtfsrtTimestamp : (ctx.previousSnapshot && ctx.previousSnapshot.gtfsrtTimestamp) ?
                                        timeUtils.getTimestamp(ctx.previousSnapshot.gtfsrtTimestamp) : null ,

                positionTimestamp : (+ctx.positionTimestamp) ? 
                                        timeUtils.getTimestamp(+ctx.positionTimestamp) : null ,

                prevPositionTimestamp : (ctx.previous && +ctx.previous.positionTimestamp) ? 
                                            timeUtils.getTimestamp(+ctx.previous.positionTimestamp) : null ,

                immediateStopETA : (ctx.immediateStop && +ctx.immediateStop.eta) ? 
                                           timeUtils.getTimestamp(+ctx.immediateStop.eta) : null ,

                trip_in_alerts : ctx.GTFSrt.tripDoesHaveAlert(ctx.trip_id) ,
            };

            message += JSON.stringify(debugging_info, null, 4);

            console.log(message);
        }


        if (ctx.state.NO_STOP_TIME_UPDATES) { ctx.immediateStop = 'DOES_NOT_EXIST'; }

            
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

            immediateStop         : ctx.immediateStop ,
            prevImmediateNextStop : (ctx.previous) ? (ctx.previous.immediateStop) : null ,
            gtfsrtTimestamp       : (+ctx.gtfsrtTimestamp) ? 
                                        timeUtils.getTimestamp(+ctx.gtfsrtTimestamp) : 
                                        null ,
            prevGtfsrtTimestamp   : (ctx.previousSnapshot && +ctx.previousSnapshot.gtfsrtTimestamp) ? 
                                        timeUtils.getTimestamp(+ctx.previousSnapshot.gtfsrtTimestamp) : 
                                        null ,
            positionTimestamp     : (+ctx.positionTimestamp) ? 
                                        timeUtils.getTimestamp(+ctx.positionTimestamp) :
                                        null ,
            prevPositionTimestamp : (ctx.previous && +ctx.previous.positionTimestamp) ? 
                                        timeUtils.getTimestamp(+ctx.previous.positionTimestamp) : 
                                        null ,
            immediateStopETA      : (ctx.immediateStop && ctx.immediateStop.eta) ? 
                                        timeUtils.getTimestamp(+ctx.immediateStop.eta) : 
                                        null ,
            subsequentStop        : ctx.subsequentStop ,
            ratioCovered          : ctx.ratioCovered ,
            vehicleStopStatus     : ctx.GTFSrt.getVehiclePositionCurrentStatusForTrip(ctx.trip_id) ,
            currentStopSequence   : ctx.GTFSrt.getVehiclePositionCurrentStopSequenceForTrip(ctx.trip_id) ,

            badETA                : !!ctx.state.BAD_ETA,
            badPreviousETA        : !!ctx.state.BAD_PREVIOUS_ETA,

            trip_in_alerts        : ctx.GTFSrt.tripDoesHaveAlert(ctx.trip_id) ,
        };

    } catch (e) {
        console.log(e.stack || e);
    } finally {
        var output;

        if (ctx.config.logTrainTrackingErrors) {
            output = '\n::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::' +
                     JSON.stringify(debugging_info, null, '    ') + '\n'                        +
                     ctx.error.stack;

            fs.appendFile(ctx.config.trainTrackingErrorsLogPath, output, function (err) {
                if (err) { console.error(err); }
            });
        }
    }
}


module.exports = {
    logLocationInferringStats : logLocationInferringStats ,
    logTrainLocations         : logTrainLocations         ,
    logUnscheduledTrips       : logUnscheduledTrips       ,
    logNoSpatialDataTrips     : logNoSpatialDataTrips     ,
    logTrainTrackingErrors    : logTrainTrackingErrors    ,
};
