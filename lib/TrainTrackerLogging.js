'use strict';



var fs = require('fs'),
    _  = require('lodash');



function logLocationInferringStats (GTFSrt, result, unscheduledTrips, noSpatialDataTrips, config) {
    var timestamp = GTFSrt.getTimestamp();

    if (config.logTrainLocations) {
        logTrainLocations(result, config, timestamp);
    }
 
    if (config.logTrainTrackingStats) {
        logTrainTrackingStats(result, unscheduledTrips, noSpatialDataTrips, config, timestamp);
    } 

    if (config.logUnscheduledTrips) {
        logUnscheduledTrips(unscheduledTrips, config) ;
    }

    if (config.logNoSpatialDataTrips) {
        logNoSpatialDataTrips(noSpatialDataTrips, config);
    }
}


function logTrainLocations (result, config, timestamp) {
    var output = Object.keys(result).reduce(function (acc, trip_id) {
                    var row             = '\n' + timestamp + ',' + trip_id + ',',

                        locationGeoJSON = _.get( result, [trip_id, 'locationGeoJSON'], null ),

                        coords;

                    if (locationGeoJSON) {
                        if (locationGeoJSON.geometry.type === 'LineString') {
                            coords = locationGeoJSON.geometry.coordinates[0];
                        } else if (locationGeoJSON.geometry.type === 'Point') {
                            coords = locationGeoJSON.geometry.coordinates;
                        }
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

    fs.appendFile(config.statsLogPathPath, statsRow, function (err) {
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



function logLostTrain (debugging_info, e, config) {
    var output;

    if (config.logLostTrains) {
        output = '::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::' +
                 JSON.stringify(debugging_info, null, '    ') + '\n'                      +
                 e.stack;

        fs.appendFile(config.lostTrainsLogPath, output, function (err) {
            if (err) { console.error(err); }
        });
    }
}


module.exports = {
    logLocationInferringStats : logLocationInferringStats ,
    logTrainLocations         : logTrainLocations         ,
    logTrainTrackingStats     : logTrainTrackingStats     ,
    logUnscheduledTrips       : logUnscheduledTrips       ,
    logNoSpatialDataTrips     : logNoSpatialDataTrips     ,
    logLostTrain              : logLostTrain              ,
};

