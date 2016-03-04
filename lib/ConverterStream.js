'use strict';


// Currently supports only a single listener.

var GTFSWrapper     = require('MTA_Subway_GTFS_Toolkit').Wrapper,
    GTFSrtWrapper   = require('MTA_Subway_GTFS-Realtime_Toolkit').Wrapper,

    Converter       = require('./converter/Converter'),
    ConverterCache  = require('./caching/ConverterCache'),

    GTFSrtTimeUtils = require('MTA_Subway_GTFS-Realtime_Toolkit').TimeUtils;


var MESSAGE_COUNTER = 0;


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

        feedConfluence();
    }

    function feedConfluence () {
        var agency_id = config && config.gtfsConfig && config.gtfsConfig.agency_id,
            agency_timezone;

        agency_timezone = latestGTFSWrapper.getAgencyTimezone(agency_id);
        GTFSrtTimeUtils.setAgencyTimezone(agency_timezone);
    }

    function convertAndSend (GTFSrt_JSON) { 

        try {
            var gtfsrtWrapper  = new GTFSrtWrapper(GTFSrt_JSON, latestGTFSWrapper),
                converter      = new Converter(latestGTFSWrapper, gtfsrtWrapper, latestConfig),
                converterCache = new ConverterCache(converter);

            console.info(++MESSAGE_COUNTER + ' : ' + gtfsrtWrapper.getTimestampForFeedMessage());

            callback(converterCache);
        } catch (e) {
            console.error(e.stack || e);
            callback(null);
        }
    }
}

module.exports = ConverterStream ;
