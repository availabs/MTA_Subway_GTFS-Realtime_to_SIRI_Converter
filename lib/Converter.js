/**
 * @module MTA_Subway_GTFS-Realtime_to_SIRI_Converter
 * @summary Exports the constructor for a GTFS-Realtime to SIRI Converter.
 * Based on the documentation found at the following:
 * @see [MTA SIRI Documentation]{@link https://bustime.mta.info/wiki/Developers/SIRIIntro}
 * @see [MTA GTFS-Realtime Documentation]{@link http://datamine.mta.info/sites/all/files/pdfs/GTFS%2DRealtime%2DNYC%2DSubway%20version%201%20dated%207%20Sep.pdf} //TODO: test link
 * NOTE: Comments in quotations are directly from the two above authorative sources.
 */

// See the bottom of the file for the TODO section.


'use strict';



var _                                = require('lodash')                                   ,

    TrainTracker                     = require('./TrainTracker')                           ,

    MonitoredVehicleJourneyBuilder   = require('./MonitoredVehicleJourneyBuilder')         ,

    SituationExchangeDeliveryBuilder = require('./SituationExchangeDeliveryBuilder')       ,

    ResponseTimestamper              = require('./ResponseTimestamper')                    ,

    timeUtils                        = require('./utils/timeUtils')                        ;


/**
 * New GTFS-Realtime to SIRI converter. 
 * @constructor 
 * @param {object} GTFSrt_JSON - output of [MTA Subway GTFS-Realtime Feed]@link{http://datamine.mta.info/mta_esi.php}, in JSON format.
 * @param {string} gtfsDataDir - path to the directory containing the GTFS static data. Passed along to the @link{GTFS_Toolkit.Wrapper}.
 * Note: The MTA_Subway_GTFS-Realtime_Toolkit.FeedReader handles the conversion from the above feed's protobuf output to JSON.
 */
function GTFSRealtimeToSIRIConverter (GTFS, GTFSrt) {

    if ( ! GTFS ) {
        throw "The 'gtfsDataDir parameter must specify the path to the static GTFS data.";
    }

    if ( ! GTFSrt ) {
        throw "A GTFS-Realtime message JSON object is required.";
    }

    this.GTFS = GTFS;
    this.GTFSrt = GTFSrt;

    this.trainTrackerSnapshot = new TrainTracker.newSnapshot(GTFS, GTFSrt);
}



/**
 * "The SIRI StopMonitoring ("SIRI SM") call allows the developer to request information about the vehicles serving a particular stop.  
 *  As much as possible, the values used both in the SM request and the SM response correspond to the values in the GTFS data for the B63."
 *  @see [The MTA SIRI StopMonitoring call documentation.]{@link https://bustime.mta.info/wiki/Developers/SIRIStopMonitoring}
 *  @param {object} getParams - one-to-one mapping with the MTA's GET parameters for MTA SIRI StopMonitoring Requests for buses.
 *  @see [GET parameter descriptions]{@link https://bustime.mta.info/wiki/Developers/SIRIStopMonitoring#HSIRIStopMonitoringRequests}
 *  @return {object} with the SIRI reponse and a timestamper. Caller should call timestamper.stamp() when ready to serve response.
 *  @see [The ResponseTimestamper]{@link ResponseTimestamper}
 *
 */
GTFSRealtimeToSIRIConverter.prototype.getStopMonitoringResponse = function (getParams) {
    var timestamper = new ResponseTimestamper(),

        response = {
            "Siri" : {
                "ServiceDelivery" : getStopMonitoringServiceDelivery.call(this, getParams, timestamper),
            },
        };

    return {
        response    : response    ,
        timestamper : timestamper ,
    };
};



/**
 * "The SIRI VehicleMonitoring ("SIRI VM") call allows the developer to request information 
 *  about one, some, or all vehicles monitored by the MTA Bus Time system.  
 *  As much as possible, the values used both in the VM request and the VM response correspond to the values in the GTFS data."
 *  @see [The MTA SIRI StopMonitoring call documentation.]{@link https://bustime.mta.info/wiki/Developers/SIRIStopMonitoring}
 *  @param {object} getParams - one-to-one mapping with the MTA's GET parameters for MTA SIRI StopMonitoring Requests for buses.
 *  @see [GET parameter descriptions]{@link https://bustime.mta.info/wiki/Developers/SIRIStopMonitoring#HSIRIStopMonitoringRequests}
 *  @return {object} with the SIRI reponse and a timestamper. Caller should call timestamper.stamp() when ready to serve response.
 *  @see [The ResponseTimestamper]{@link ResponseTimestamper}
 */
GTFSRealtimeToSIRIConverter.prototype.getVehicleMonitoringResponse = function (getParams) {
    var timestamper = new ResponseTimestamper(),

        response = {
            "Siri" : {
                "ServiceDelivery" : getVehicleMonitoringServiceDelivery.call(this, getParams, timestamper),
            },
        };

    return {
        response    : response    ,
        timestamper : timestamper ,
    };
};




/**
 *  Root of the response object. 
 *  @param {MTA_Subway_GTFS-Realtime_Toolkit.Wrapper} GTFSrt
 *  @param {object} getParams - forwarded along from @link{getStopMonitoringResponse}.
 *  @param {ResponseTimestamper} timestamper - the @link{ResponseTimestamper} member in the @link{getStopMonitoringResponse} response object.
 *  @returns {object} representing the SIRI StopMonitoringServiceDelivery. 
 */
function getStopMonitoringServiceDelivery (getParams, timestamper) { /*jshint validthis:true */

    var stop_id                      = getParams.MonitoringRef                ,
        route_id                     = getParams.LineRef                      ,
        maxOnwardCalls               = getParams.MaximumNumberOfCallsOnwards  ,
        vehicleMonitoringDetailLevel = getParams.VehicleMonitoringDetailLevel ,

        requestedTrains = (route_id) ? 
                            this.GTFSrt.getTrainsServicingStopForRoute(stop_id, route_id) : 
                            this.GTFSrt.getTrainsServicingStop(stop_id)                   ;

    var delivery = {
        //"ResponseTimestamp"       : handled by the timestamper.
        "StopMonitoringDelivery"    : getStopMonitoringDelivery.call(this, requestedTrains, stop_id, route_id, maxOnwardCalls, vehicleMonitoringDetailLevel) ,
        //FIXME: Stop or route ???
        "SituationExchangeDelivery" : SituationExchangeDeliveryBuilder.getSituationExchangeDelivery(this.GTFSrt, requestedTrains)                            ,
    };

    timestamper.push(delivery);
    timestamper.push(delivery.StopMonitoringDelivery);

    return delivery;
}


/**
 *  Root of the response object. 
 *  @param {MTA_Subway_GTFS-Realtime_Toolkit.Wrapper} GTFSrt
 *  @param {object} getParams - forwarded along from @link{getVehicleMonitoringResponse}.
 *  @param {ResponseTimestamper} timestamper - the @link{ResponseTimestamper} member in the @link{getVehicleMonitoringResponse} response object.
 *  @returns {object} representing the SIRI VehicleMonitoringServiceDelivery. 
 */
function getVehicleMonitoringServiceDelivery (getParams, timestamper) { /*jshint validthis:true */

    var train_id                     = (getParams.VehicleRef && getParams.VehicleRef.replace('MTA ', '')),
        route_id                     = getParams.LineRef,
        maxOnwardCalls               = getParams.MaximumNumberOfCallsOnwards,
        vehicleMonitoringDetailLevel = getParams.VehicleMonitoringDetailLevel,
        requestedTrains;
            
    if (train_id && route_id) {
       requestedTrains = _.includes(this.GTFSrt.getTrainsServicingRoute(route_id), train_id) ? train_id : [];
    } else if (train_id) {
        requestedTrains = [train_id];
    } else if (route_id) {
        requestedTrains = this.GTFSrt.getTrainsServicingRoute(route_id);
    } else {
        requestedTrains = this.GTFSrt.getAllMonitoredTrains();
    }


    var delivery = {
        //"ResponseTimestamp"       : handled by the timestamper.
        "VehicleMonitoringDelivery" : getVehicleMonitoringDelivery.call(this, requestedTrains, route_id, maxOnwardCalls, vehicleMonitoringDetailLevel) ,
        "SituationExchangeDelivery" : SituationExchangeDeliveryBuilder.getSituationExchangeDelivery(this.GTFSrt, 
                                                                                                    requestedTrains), 
    };

    timestamper.push(delivery);
    timestamper.push(delivery.VehicleMonitoringDelivery);

    return delivery;
}


/**
 *  "SIRI container for VehicleMonitoring response data." --possible MTA doc typo.
 *  @param {MTA_Subway_GTFS-Realtime_Toolkit.Wrapper} GTFSrt
 *  @param {object} getParams - forwarded along from @link{getStopMonitoringResponse}.
 *  @param {ResponseTimestamper} timestamper - the @link{ResponseTimestamper} member in the @link{getStopMonitoringResponse} response object.
 *  @returns {object} representing the SIRI StopMonitoringDelivery. 
 */
function getStopMonitoringDelivery (requestedTrains, stop_id, route_id, maxOnwardCalls, vehicleMonitoringDetailLevel) { /*jshint validthis:true */
    return {
        //"ResponseTimestamp" : handled by the timestamper.
        "MonitoredStopVisit"  : getMonitoredStopVisit.call(this, requestedTrains, stop_id, route_id, maxOnwardCalls, vehicleMonitoringDetailLevel) ,
        "ValidUntil"          : getValidUntil.call(this)                                                                                                        ,
    };
}

/**
 * "SIRI container for VehicleMonitoring response data."
 *  @param {MTA_Subway_GTFS-Realtime_Toolkit.Wrapper} GTFSrt
 *  @param {object} getParams - forwarded along from @link{getVehicleMonitoringResponse}.
 *  @param {ResponseTimestamper} timestamper - the @link{ResponseTimestamper} member in the @link{getVehicleMonitoringResponse} response object.
 *  @returns {object} representing the SIRI VehicleMonitoringDelivery. 
 */
function getVehicleMonitoringDelivery (requestedTrains, route_id, maxOnwardCalls, vehicleMonitoringDetailLevel) { /*jshint validthis:true */
    return {
        //"ResponseTimestamp" : handled by the timestamper.
        "VehicleActivity"     : getVehicleActivity.call(this, requestedTrains, route_id, maxOnwardCalls, vehicleMonitoringDetailLevel) ,
        "ValidUntil"          : getValidUntil.call(this)                       ,
    };
}


/**
 * "SIRI container for data about a particular vehicle service the selected stop."
 *  @param {MTA_Subway_GTFS-Realtime_Toolkit.Wrapper} GTFSrt
 *  @param {object} getParams - forwarded along from @link{getStopMonitoringResponse}.
 *  @returns {object} representing the SIRI MonitoredStopVisit. 
 */
function getMonitoredStopVisit (requestedTrains, stop_id, route_id, maxOnwardCalls, vehicleMonitoringDetailLevel)  { /*jshint validthis:true */
    var that = this;

    return requestedTrains.map(function (train_id) {
        return {
            "MonitoredVehicleJourney" : 
                getStopMonitoringMonitoredVehicleJourney.call(that, train_id, stop_id, maxOnwardCalls, vehicleMonitoringDetailLevel),
            "RecordedAtTime" : 
                getMonitoredStopVisitRecordedAtTime.call(that, train_id) , // TODO : Implement
        };
    });
}


/**
 *  "SIRI container for data about a particular vehicle."
 *  @param {MTA_Subway_GTFS-Realtime_Toolkit.Wrapper} GTFSrt
 *  @param {object} getParams - forwarded along from @link{getVehicleMonitoringResponse}.
 *  @returns {object} representing the SIRI VehicleActivity.
 */
function getVehicleActivity (requestedTrains, route_id, maxOnwardCalls, vehicleMonitoringDetailLevel) { /*jshint validthis:true */
    var that = this;
        
    return requestedTrains.map(function (train_id) {
        return {
            "MonitoredVehicleJourney" : 
                getVehicleMonitoringMonitoredVehicleJourney.call(that, train_id, maxOnwardCalls, vehicleMonitoringDetailLevel) ,
            "RecordedAtTime" : 
                getMonitoredStopVisitRecordedAtTime.call(that, train_id) , // TODO : Implement //FIXME Name of function.
        };
    });
}


/**
 * "The timestamp of the last real-time update from the particular vehicle."
 */
function getMonitoredStopVisitRecordedAtTime (/*train_id*/) {
    //TODO: Implement;
    return null;
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
    var posixTimestamp = this.GTFSrt.getTimestamp() + 30; //FIXME!!!

    return timeUtils.getTimestampFromPosix(posixTimestamp);
}



/**
 * "A MonitoredVehicleJourney element for a vehicle in revenue service. 
 *  Please See the [MonitoredVehicleJourney]@link{https://bustime.mta.info/wiki/Developers/SIRIMonitoredVehicleJourney} page for a thorough discription."
 *  Note: This function hands off the parameters to @link{MonitoredVehicleJourneyBuilder.getMonitoredVehicleJourney} and directly returns its return value..
 *  @param {MTA_Subway_GTFS-Realtime_Toolkit.Wrapper} GTFSrt
 *  @param {string|number} train_id
 *  @param {string|number} stop_id
 *  @param {string|number} maxOnwardCalls - plucked from the GET parameters
 *  @param {string|number} detailLevel - plucked from the GET parameters
 *  @returns {object} representing the a complete SIRI MonitoredVehicleJourney element.
 */
function getStopMonitoringMonitoredVehicleJourney (train_id, stop_id, maxOnwardCalls, detailLevel) {
    /*jshint validthis:true */
    return MonitoredVehicleJourneyBuilder.getMonitoredVehicleJourney(this.GTFS                 ,
                                                                     this.GTFSrt               ,
                                                                     this.trainTrackerSnapshot ,
                                                                     train_id                  ,
                                                                     stop_id                   ,
                                                                     maxOnwardCalls            ,
                                                                     detailLevel              );
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
function getVehicleMonitoringMonitoredVehicleJourney (train_id, maxOnwardCalls, detailLevel) {
    /*jshint validthis:true */
    return MonitoredVehicleJourneyBuilder.getMonitoredVehicleJourney(this.GTFS                 ,
                                                                     this.GTFSrt               ,
                                                                     this.trainTrackerSnapshot ,
                                                                     train_id                  ,
                                                                     null                      ,
                                                                     maxOnwardCalls            ,
                                                                     detailLevel              );
}



module.exports = GTFSRealtimeToSIRIConverter;


