'use strict';

// NOTE: Currently, the csv files do not have header rows.


var fs = require('fs'),
    _  = require('lodash');


var SIGNIFICANT_DIGITS = 6;

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
            logTrainTrackingStats(result, unscheduledTrips, noSpatialDataTrips, config, timestamp);
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
                                    return n.toPrecision(SIGNIFICANT_DIGITS); 
                                 });
                    }

                    return acc += (row += (coords) ? coords.join(',') : ',');
                }, '');

    fs.appendFile(config.locationsLogPath, output, function (err) {
        if (err) { console.log(err); }
    });
}


function logTrainTrackingStats (result, unscheduledTrips, noSpatialDataTrips, config, timeStamp) {
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


function logTrainTrackingErrors (debugging_info, config, e) {
    var output;

    console.log('*****************');

    if (config.logTrainTrackingErrors) {
        output = '\n::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::' +
                 JSON.stringify(debugging_info, null, '    ') + '\n'                      +
                 e.stack;

        fs.appendFile(config.trainTrackingErrorsLogPath, output, function (err) {
            if (err) { console.error(err); }
        });
    }
}


function verifyTrainLocationsCSVHasHeaderRowBeforeLogging (result, config, timestamp) {
    var headersRow = 'timestamp,gtfs_trip_key,longitude,latitude';

    verifiedTrainLocationsCSVHasHeaderRow = true;

    fs.stat(config.locationsLogPath, function (err) {
        if (err) {
            if (err.code === 'ENOENT') {
                fs.writeFile(config.locationsLogPath, headersRow, function (err) {
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
    var headersRow = 'num_trains_with_complete_data,num_unscheduled_trains,num_scheduled_but_without_spatial_data';

    verifiedTrainTrackingStatsCSVHasHeaderRow = true;

    fs.stat(config.trainTrackingStatsLogPath, function (err) {
        if (err) {
            if (err.code === 'ENOENT') {
                fs.writeFile(config.trainTrackingStatsLogPath, headersRow, function (err) {
                    if (err) {
                        console.error('Unable to initialize train tracking statistics file.');
                        console.error(err);
                    } else {
                        logTrainTrackingStats(result, unscheduledTrips, noSpatialDataTrips, config, timestamp);
                    }
                });    
            } else {
                console.error('Unable to initialize train tracking statistics file.');
                console.error(err);
            }
        } else {
            logTrainTrackingStats(result, unscheduledTrips, noSpatialDataTrips, config, timestamp);
        }
    });  
}



module.exports = {
    logLocationInferringStats : logLocationInferringStats ,
    logTrainLocations         : logTrainLocations         ,
    logTrainTrackingStats     : logTrainTrackingStats     ,
    logUnscheduledTrips       : logUnscheduledTrips       ,
    logNoSpatialDataTrips     : logNoSpatialDataTrips     ,
    logTrainTrackingErrors    : logTrainTrackingErrors    ,
};

