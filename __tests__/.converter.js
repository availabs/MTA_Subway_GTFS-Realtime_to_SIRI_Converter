#!/usr/bin/env node


var fs = require('fs'),

    config        = require('./.config.js'),
    sampleMessage = JSON.parse(fs.readFileSync(__dirname + '/GTFS-Realtime_Sample.json')),

    Converter = require('../lib/Converter.js'),

    /**
     * Example URL from the MTA [documentation]@link{https://bustime.mta.info/wiki/Developers/SIRIStopMonitoring} 
     * http://bustime.mta.info/api/siri/stop-monitoring.xml?key=##KEY##&OperatorRef=MTA&MonitoringRef=308209&LineRef=MTA NYCT_B63
     */
    stopMonitoringRequestParams1 = {
        OperatorRef   : 'MTA'          ,
        MonitoringRef : '104S'         ,
        //LineRef       : 'MTA NYCT_B63' ,
    },

     stopMonitoringRequestParams2 = {
        OperatorRef   : 'MTA'          ,
        MonitoringRef : '207N'         ,
        //LineRef       : 'MTA NYCT_B63' ,
    },

     stopMonitoringRequestParams3 = {
        OperatorRef   : 'MTA'          ,
        MonitoringRef : '409S'         ,
        //LineRef       : 'MTA NYCT_B63' ,
    },

     stopMonitoringRequestParams4 = {
        OperatorRef   : 'MTA'          ,
        MonitoringRef : '611N'         ,
        //LineRef       : 'MTA NYCT_B63' ,
    } ;


console.time('Build Converter');

var converter = new Converter(sampleMessage, config.gtfsDataDir);

console.timeEnd('Build Converter');

console.log(process.memoryUsage());

console.time('Answer stopMonitoringRequest 1');
var stopMonitoringResponse = converter.getStopMonitoringResponse(stopMonitoringRequestParams1);
console.timeEnd('Answer stopMonitoringRequest 1');

console.log(process.memoryUsage());

console.time('Answer stopMonitoringRequest 2');
var stopMonitoringResponse = converter.getStopMonitoringResponse(stopMonitoringRequestParams2);
console.timeEnd('Answer stopMonitoringRequest 2');

console.log(process.memoryUsage());

console.time('Answer stopMonitoringRequest 3');
var stopMonitoringResponse = converter.getStopMonitoringResponse(stopMonitoringRequestParams3);
console.timeEnd('Answer stopMonitoringRequest 3');

console.log(process.memoryUsage());

console.time('Answer stopMonitoringRequest 4');
var stopMonitoringResponse = converter.getStopMonitoringResponse(stopMonitoringRequestParams4);
console.timeEnd('Answer stopMonitoringRequest 4');

console.log(process.memoryUsage());

fs.writeFile('SIRI_Sample.json', JSON.stringify(stopMonitoringResponse, null, '    '));

