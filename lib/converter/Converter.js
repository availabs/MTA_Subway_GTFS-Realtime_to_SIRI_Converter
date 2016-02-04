/**
 * @module MTA_Subway_GTFS-Realtime_to_SIRI_Converter
 * @summary Exports the constructor for a GTFS-Realtime to SIRI Converter.
 * Based on the documentation found at the following:
 * @see [MTA SIRI Documentation]{@link https://bustime.mta.info/wiki/Developers/SIRIIntro}
 * @see [MTA GTFS-Realtime Documentation]{@link http://datamine.mta.info/sites/all/files/pdfs/GTFS%2DRealtime%2DNYC%2DSubway%20version%201%20dated%207%20Sep.pdf} 
 * NOTE: Comments in quotations are directly from the two above authorative sources.
 */


'use strict';



var _                                = require('lodash') ,
    
    MonitoredVehicleJourneyBuilder   = require('./MonitoredVehicleJourneyBuilder') ,
    SituationExchangeDeliveryBuilder = require('./SituationExchangeDeliveryBuilder') ,

    TrainTracker                     = require('../trainTracking/TrainTracker') ,
    
    timeUtils                        = require('MTA_Subway_GTFS-Realtime_Toolkit').TimeUtils ;



/**
 * New GTFS-Realtime to SIRI converter. 
 * @constructor 
 * @param {object} GTFSrt_JSON - output of [MTA Subway GTFS-Realtime Feed]@link{http://datamine.mta.info/mta_esi.php}, in JSON format.
 * @param {string} gtfsDataDir - path to the directory containing the GTFS static data. Passed along to the @link{GTFS_Toolkit.Wrapper}.
 * Note: The MTA_Subway_GTFS-Realtime_Toolkit.FeedReader handles the conversion from the above feed's protobuf output to JSON.
 */
function GTFSRealtimeToSIRIConverter (GTFS, GTFSrt, config) {

    if ( ! GTFS ) {
        throw new Error("The 'gtfsDataDir parameter must specify the path to the static GTFS data.");
    }

    if ( ! GTFSrt ) {
        throw new Error ("A GTFS-Realtime message JSON object is required.");
    }

    this.GTFS   = GTFS;
    this.GTFSrt = GTFSrt;
    this.config = config;
    this.logger = (config.logConverter && config.winston) ?  config.winston.loggers.get('converter') : null;


    try {
        // NOTE: This call will throw an error if the GTFSrt is older than the previous one.
        this.trainTrackerSnapshot = new TrainTracker.newSnapshot(GTFS, GTFSrt, config);
    } catch (e) {
        this.trainTrackerSnapshot = null;
        this.logger && this.logger.error('ERROR: creating trainTrackerSnapshot.', { e:e }); /* jshint ignore: line */
    }

    this.allTripsWithAlert = GTFSrt.getAllTripsWithAlert();

    this.trainsWithAlertFilterObject = GTFSrt.getTrainsWithAlertFilterObject(this.allTripsWithAlert);
    this.stopsWithAlertsFilterObject = GTFSrt.getStopsWithAlertFilterObject(this.allTripsWithAlert);
    this.routesWithAlertFilterObject = GTFSrt.getRoutesWithAlertFilterObject(this.allTripsWithAlert);

    this.datedVehicleJourneyRef_to_gtfsTripKeyTable = {};
}


GTFSRealtimeToSIRIConverter.prototype.getTrainsWithAlertFilterObject = function () {
    return this.trainsWithAlertFilterObject;
};

GTFSRealtimeToSIRIConverter.prototype.getStopsWithAlertFilterObject = function () {
    return this.stopsWithAlertsFilterObject;
};

GTFSRealtimeToSIRIConverter.prototype.getRoutesWithAlertFilterObject = function () {
    return this.routesWithAlertFilterObject;
};



/**
 * "The SIRI VehicleMonitoring ("SIRI VM") call allows the developer to request information 
 *  about one, some, or all vehicles monitored by the MTA Bus Time system.  
 *  As much as possible, the values used both in the VM request and the VM response correspond 
 *  to the values in the GTFS data."
 *
 *  NOTE: StopMonitoring requests and query parameter filtering done in the ConverterCache.
 *
 *  @see [The MTA SIRI StopMonitoring call documentation.]{@link https://bustime.mta.info/wiki/Developers/SIRIStopMonitoring}
 *  @return {object} with the SIRI response
 */
GTFSRealtimeToSIRIConverter.prototype.getCompleteVehicleMonitoringResponse = function () {
    return {
        "Siri" : {
            "ServiceDelivery" : getVehicleMonitoringServiceDelivery.call(this),
        },
    };
};


/**
 *  Root of the response object. 
 *  @param {MTA_Subway_GTFS-Realtime_Toolkit.Wrapper} GTFSrt
 *  @param {ResponseTimestamper} timestamper - the @link{ResponseTimestamper} member in the @link{getCompleteVehicleMonitoringResponse} response object.
 *  @returns {object} representing the SIRI VehicleMonitoringServiceDelivery. 
 */
function getVehicleMonitoringServiceDelivery () { /*jshint validthis:true */

    var allTrips = Object.keys(this.GTFSrt.tripIDToTrainIDMap);

           
    return {
        //"ResponseTimestamp"       : handled in the Cacher
        "VehicleMonitoringDelivery" : getVehicleMonitoringDelivery.call(this, allTrips) ,

        "SituationExchangeDelivery" : SituationExchangeDeliveryBuilder.getSituationExchangeDelivery(
                                                                    this.GTFSrt, 
                                                                    this.allTripsWithAlert, 
                                                                    Object.keys(this.trainsWithAlertFilterObject),
                                                                    Object.keys(this.routesWithAlertFilterObject)),
    };
}


/**
 * "SIRI container for VehicleMonitoring response data."
 *  @param {MTA_Subway_GTFS-Realtime_Toolkit.Wrapper} GTFSrt
 *  @param {ResponseTimestamper} timestamper - the @link{ResponseTimestamper} member in the @link{getCompleteVehicleMonitoringResponse} response object.
 *  @returns {object} representing the SIRI VehicleMonitoringDelivery. 
 */
function getVehicleMonitoringDelivery (allTrips) { /*jshint validthis:true */
    return {
        //"ResponseTimestamp" : handled by the timestamper.
        "VehicleActivity"     : getVehicleActivity.call(this, allTrips) ,
        "ValidUntil"          : getValidUntil.call(this) ,
    };
}


/**
 *  "SIRI container for data about a particular vehicle."
 *  @param {MTA_Subway_GTFS-Realtime_Toolkit.Wrapper} GTFSrt
 *  @returns {object} representing the SIRI VehicleActivity.
 */
function getVehicleActivity (allTrips) { /*jshint validthis:true */
    var that = this;
        
    return allTrips.map(function (trip_id) {
        return {
            "MonitoredVehicleJourney" : 
                getVehicleMonitoringMonitoredVehicleJourney.call(that, trip_id) ,
            "RecordedAtTime" : 
                getRecordedAtTime.call(that, trip_id) ,
        };
    });
}


/**
 * "The timestamp of the last real-time update from the particular vehicle."
 */
function getRecordedAtTime (trip_id) {
    /*jshint validthis:true */
    return this.GTFSrt.getVehiclePositionTimestamp(trip_id) ;
}


// ??? Should we account for processing time of the GTFS-RT feed? ???
// Or, block requests after GTFS-RT update until the new data is processed ???
/**
 * "The time until which the response data is valid until."
 *  @param {MTA_Subway_GTFS-Realtime_Toolkit.Wrapper} GTFSrt
 *  @return {number}
 */
function getValidUntil () {
    /*jshint validthis:true */
    var gtfsrtTimestamp     = this.GTFSrt.getTimestamp(),
        readInterval        = +(_.get(this, ['config', 'gtfsrtConfig', 'readInterval'], null)),
        validUntilTimestamp = ((gtfsrtTimestamp !== null) && (readInterval !== null)) ?
                                    gtfsrtTimestamp + readInterval :
                                    NaN;

    if (validUntilTimestamp) {
        return timeUtils.getTimestamp(validUntilTimestamp);
    } else {
        return null;
    }
}



/**
 * "A MonitoredVehicleJourney element for a vehicle in revenue service. 
 *  Please See the [MonitoredVehicleJourney]@link{https://bustime.mta.info/wiki/Developers/SIRIMonitoredVehicleJourney} page for a thorough discription."
 *  Note: This function hands off the parameters to @link{MonitoredVehicleJourneyBuilder.getMonitoredVehicleJourney} and directly returns its return value..
 *  @param {MTA_Subway_GTFS-Realtime_Toolkit.Wrapper} GTFSrt
 *  @param {string|number} train_id
 *  @param {string|number} maxOnwardCalls - plucked from the GET parameters
 *  @param {string|number} detailLevel - plucked from the GET parameters
 *  @returns {object} representing the a complete SIRI MonitoredVehicleJourney element.
 */
function getVehicleMonitoringMonitoredVehicleJourney (trip_id) {
    /*jshint validthis:true */
    return MonitoredVehicleJourneyBuilder.getMonitoredVehicleJourney.call(this, trip_id);
}



module.exports = GTFSRealtimeToSIRIConverter;
