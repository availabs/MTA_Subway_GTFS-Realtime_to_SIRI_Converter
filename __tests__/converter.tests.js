// __tests__/wrapper.js

jest.autoMockOff();

var fs       = require('fs')       ,
    path     = require('path')     ,
    jsonfile = require('jsonfile') ,

    gtfsConfig       = require('./.gtfsConfig')       ,

    sampleGTFSIndexedScheduleDataPath = path.join(gtfsConfig.dataDirPath, gtfsConfig.indexedScheduleDataFilePath) ,
    sampleGTFSIndexedSpatialDataPath  = path.join(gtfsConfig.dataDirPath, gtfsConfig.indexedSpatialDataFilePath)  ,
    sampleGTFSrtMessagePath           = path.join(__dirname, 'GTFS-Realtime_Sample.json')                         ,

    sampleGTFSIndexedScheduleData = jsonfile.readFileSync(sampleGTFSIndexedScheduleDataPath) ,
    sampleGTFSIndexedSpatialData  = jsonfile.readFileSync(sampleGTFSIndexedSpatialDataPath)  ,
    sampleGTFSrtMessage           = jsonfile.readFileSync(sampleGTFSrtMessagePath)           ,

    GTFS_Wrapper   = require('MTA_Subway_GTFS_Toolkit').Wrapper          ,
    GTFSrt_Wrapper = require('MTA_Subway_GTFS-Realtime_Toolkit').Wrapper ,
    Converter      = require('../lib/Converter.js')                      ,

    /**
     * Example URL from the MTA [documentation]@link{https://bustime.mta.info/wiki/Developers/SIRIStopMonitoring} 
     * http://bustime.mta.info/api/siri/stop-monitoring.xml?key=##KEY##&OperatorRef=MTA&MonitoringRef=308209&LineRef=MTA NYCT_B63
     */
    stopMonitoringRequestParams = {
        OperatorRef   : 'MTA'  ,
        MonitoringRef : '239S' ,
        LineRef       : '3'    ,
    },

    vehicleMonitoringRequestParams = {
        //VehicleRef   : '01 1759  SFY/242' ,
    };


describe('Simple GTFS-Realtime to SIRI Tests.', function() {
    var gtfsWrapper = new GTFS_Wrapper(sampleGTFSIndexedScheduleData, sampleGTFSIndexedSpatialData),
        gtfsrtWrapper = new GTFSrt_Wrapper(sampleGTFSrtMessage),
        converter = new Converter(gtfsWrapper, gtfsrtWrapper) ;

    it('Build a Converter.', function() {
        expect(converter).toBeTruthy();
    });

    it('Build a Stop Monitoring Response.', function() {
        //console.log(JSON.stringify(converter.getStopMonitoringResponse(stopMonitoringRequestParams).response, null, '    '));
        expect(converter.getStopMonitoringResponse(stopMonitoringRequestParams)).toBeTruthy();
    });

    it('Build a Vehicle Monitoring Response.', function() {
        expect(converter.getVehicleMonitoringResponse(vehicleMonitoringRequestParams).response).toBeTruthy();
    });
});

