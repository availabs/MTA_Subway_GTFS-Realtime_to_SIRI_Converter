'use strict';


// Currently supports only a single listener.
//
// NOTE: Currently, converterStream instances do not a require a destuctor.
//          Should this change, make sure users of this class clean up memory references.

var GTFSWrapper     = require('MTA_Subway_GTFS_Toolkit').Wrapper,
    GTFSrtWrapper   = require('MTA_Subway_GTFS-Realtime_Toolkit').Wrapper,

    Converter       = require('./converter/Converter'),
    ConverterCache  = require('./caching/ConverterCache'),

    GTFSrtTimeUtils = require('MTA_Subway_GTFS-Realtime_Toolkit').TimeUtils, 

    converterEventEmitter = require('./events/ConverterEventEmitter') ;



var MESSAGE_COUNTER = 0;


function ConverterStream (GTFS_Feed, 
                          GTFSRealtime_Feed, 
                          config, 
                          trainTrackerInitialState, // for testing/debugging.
                          converterUpdateListener) {


    var latestGTFSWrapper,

        timestampOfLastSuccessfulRead ,

        latestConfig = config ;


    this.converterEventEmitter = converterEventEmitter ;


    this.start = function () {
        GTFS_Feed.registerListener(updateGTFS); // Immediately calls updateGTFS

        GTFSRealtime_Feed.registerListener(convertAndSend);
    };

    this.stop = function () {
        GTFS_Feed.removeListener(updateGTFS);

        GTFSRealtime_Feed.removeListener(convertAndSend);
    };

    this.updateConfig = function (newConfig, callback) {
        latestConfig = newConfig;

        if (callback) { return callback(null); }
    };

    this.getCurrentGTFSRealtimeTimestamp = function () {
        return timestampOfLastSuccessfulRead;
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
            var gtfsrtWrapper = new GTFSrtWrapper(GTFSrt_JSON, latestGTFSWrapper),
                
                latestConverter = new Converter(latestGTFSWrapper, 
                                                gtfsrtWrapper, 
                                                latestConfig, 
                                                trainTrackerInitialState),

                converterCache = new ConverterCache(latestConverter);

            trainTrackerInitialState = null; // Should only be used once, then set to null.

            timestampOfLastSuccessfulRead = gtfsrtWrapper.getTimestampForFeedMessage() ;

            console.info(++MESSAGE_COUNTER + ' : ' + timestampOfLastSuccessfulRead);

            converterUpdateListener(converterCache);

        } catch (e) {
            console.error(e.stack || e);
            converterUpdateListener(null);
        }
    } 
    
}

module.exports = ConverterStream ;
