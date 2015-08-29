// __tests__/wrapper.js

jest.autoMockOff();

var fs = require('fs'),

    config        = require('./.config.js'),
    sampleMessage = JSON.parse(fs.readFileSync(__dirname + '/GTFS-Realtime_Sample.json')),

    Converter = require('../lib/Converter.js'),

    /**
     * Example URL from the MTA [documentation]@link{https://bustime.mta.info/wiki/Developers/SIRIStopMonitoring} 
     * http://bustime.mta.info/api/siri/stop-monitoring.xml?key=##KEY##&OperatorRef=MTA&MonitoringRef=308209&LineRef=MTA NYCT_B63
     */
    stopMonitoringRequestParams = {
        OperatorRef   : 'MTA'            ,
        MonitoringRef : '107900_1..N02R' ,
        LineRef       : 'MTA NYCT_B63'   ,
    };


describe('Simple GTFS-Realtime to SIRI Tests.', function() {
    var converter = new Converter(sampleMessage, config.gtfsDataDir) ;

    console.log('##################### FOO #####################');

    it('Build a Converter.', function() {
        expect(converter).toBeTruthy();
    });

    it('Build a Stop.', function() {
        expect(converter.getStopMonitoringResponse(stopMonitoringRequestParams)).toBeTruthy();
    });
});
