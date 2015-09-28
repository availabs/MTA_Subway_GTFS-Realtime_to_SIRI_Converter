'use strict';


// Currently supports only a single listener.

var GTFSWrapper   = require('MTA_Subway_GTFS_Toolkit').Wrapper,
    GTFSrtWrapper = require('MTA_Subway_GTFS-Realtime_Toolkit').Wrapper,
    Converter     = require('./Converter');


function ConverterStream (GTFS_Feed, GTFSRealtime_Feed, config, callback) {

    var latestGTFSWrapper,

        latestConfig = config;

    this.start = function () {
        GTFS_Feed.registerListener(updateGTFS); // Immediately calls updateGTFS
        GTFSRealtime_Feed.registerListener(convertAndSend);
    };

    this.stop = function () {
        GTFSRealtime_Feed.removeListener(convertAndSend);
    };

    this.updateConfig = function (newConfig) {
        latestConfig = newConfig;
    };

    function updateGTFS (indices) {
        latestGTFSWrapper = new GTFSWrapper(indices.indexedScheduleData, indices.indexedSpatialData);
    }

    function convertAndSend (GTFSrt_JSON) { 
        var gtfsrtWrapper = new GTFSrtWrapper(GTFSrt_JSON);

        callback(new Converter(latestGTFSWrapper, gtfsrtWrapper, latestConfig));
    } 
}

module.exports = ConverterStream ;

