#!/usr/bin/env node

'use strict';

var fs              = require('fs'),
    streamFactory   = require('MTA_Subway_GTFS-Realtime_Toolkit').GTFS_Realtime_ObjectStreamFactory,
    _               = require('lodash'),

    toSIRIConverter = require('../lib/converter'),
    apiKey          = require('./mtaAPIKey');


function test (msgObj) {
    var converter   = toSIRIConverter.newGTFSRealtimeToSIRIConverter(msgObj),
        sampleTrain = _.sample(_.keys(msgObj.trainsIndex)),
        sampleStop  = _.sample(_.keys(msgObj.stopsIndex)),

        vehicleMonitoringRequestParams = { 
            "VehicleRef" : sampleTrain,
            "VehicleMonitoringDetailLevel" : "calls"
        },
            
        stopMonitoringRequestParams = { "MonitoringRef" : sampleStop },

        siriVehicleMonitoringResponse = converter.getVehicleMonitoringResponse(vehicleMonitoringRequestParams),
        siriStopMonitoringResponse = converter.getStopMonitoringResponse(stopMonitoringRequestParams);


    
    fs.writeFile('SampleVehicleMonitoringResponse.json', JSON.stringify(siriVehicleMonitoringResponse, null, '    '));
    fs.writeFile('SampleStopMonitoringResponse.json', JSON.stringify(siriStopMonitoringResponse, null, '    '));

    stream.stop();
}

var stream = streamFactory.newGTFSRealtimeObjectStream(apiKey, test);

console.log(apiKey);

stream.start();
