/**
 * @module MTA_Subway_GTFS-Realtime_to_SIRI_Converter
 */

'use strict';

var msgBufferer = require('./CachedMessageBufferers') ,

    responseBuilder = require('./ResponseBuilder') ,

    queryProcessor = require('./QueryProcessor') ;


// TODO
// The SIRI SituationExchangeDelivery element only appears when there is a service alert 
// active for a route or stop being called on. 
// It is used by the responses to both the VehicleMonitoring and StopMonitoring calls.
// May need to add a method on the converter to determine if a route or stop has an alert.


var ConverterCache = function (converter) {
    try {
        var vehicleMonitoringResponse = converter.getCompleteVehicleMonitoringResponse(),
            vehicleActivity = vehicleMonitoringResponse.Siri.ServiceDelivery.VehicleMonitoringDelivery.VehicleActivity,
            situationExchangeDelivery = vehicleMonitoringResponse.Siri.ServiceDelivery.SituationExchangeDelivery,

            validUntilTimestamp = vehicleMonitoringResponse.Siri.ServiceDelivery.VehicleMonitoringDelivery.ValidUntil;


        // Added for use by analysis plugins.
        this.converter = converter ;

        this.GTFS = converter.GTFS;
        this.GTFSrt = converter.GTFSrt;

        this.validUntil = new Buffer(validUntilTimestamp);

        this.datedVehicleJourneyRef_to_gtfsTripKeyTable = converter.datedVehicleJourneyRef_to_gtfsTripKeyTable;
        this.unscheduledTripIndicator  = converter.config.unscheduledTripIndicator;
        this.vehicleRef_to_gtfsTripKey = {};

        // The following order is important as msgBufferer.bufferMonitoredVehicleJourneys mutates the objects.
        this.bufferedCalls = msgBufferer.bufferCalls.call(this, vehicleActivity);

        this.bufferedMonitoredVehicleJourneys = msgBufferer.bufferMonitoredVehicleJourneys.call(this, vehicleActivity);

        this.bufferedSituationExchange = msgBufferer.bufferSituationExchange.call(this, situationExchangeDelivery);

        this.trainsWithAlertFilterObject = converter.getTrainsWithAlertFilterObject();
        this.routesWithAlertFilterObject = converter.getRoutesWithAlertFilterObject();
        this.stopsWithAlertsFilterObject = converter.getStopsWithAlertFilterObject();

        this.responseCache = {};

        this.getState = converter.getState ;

    } catch (e) {
        console.error(e.stack);
    }
};


/*
+-----------------------------+-----------------------------------------------------------------------+
| key                         |  your MTA Bus Time developer API key (required).  Go here to get one. |
+-----------------------------+-----------------------------------------------------------------------+
| OperatorRef                 |  the GTFS agency ID to be monitored (optional).  Currently,           |
|                             |  all stops have operator/agency ID of MTA. If left out,               |
|                             |  the system will make a best guess. Usage of the OperatorRef          |
|                             |  is suggested, as calls will return faster when populated.            |
+-----------------------------+-----------------------------------------------------------------------+
| MonitoringRef               |  the GTFS stop ID of the stop to be monitored (required).             |
|                             |  For example, 308214 for the stop at 5th Avenue                       |
|                             |  and Union St towards Bay Ridge.                                      |
+-----------------------------+-----------------------------------------------------------------------+
| LineRef                     |  A filter by 'fully qualified' route name,                            |
|                             |  GTFS agency ID + route ID (e.g. MTA NYCT_B63).                       |
+-----------------------------+-----------------------------------------------------------------------+
| DirectionRef                |  A filter by GTFS direction ID (optional).  Either 0 or 1.            |
+-----------------------------+-----------------------------------------------------------------------+
| StopMonitoringDetailLevel   |  Determines whether or not the response will include the stops        |
|                             |  ("calls" in SIRI-speak) each vehicle is going to make *after*        |
|                             |  it serves the selected stop (optional). To get calls data,           |
|                             |  use value calls, otherwise use value normal (default is normal).     |    
+-----------------------------+-----------------------------------------------------------------------+
| MaximumNumberOfCallsOnwards |  Limits the number of OnwardCall elements returned in the query.      |
| ----------------------------+-----------------------------------------------------------------------|
| MaximumStopVisits           |  an upper bound on the number of buses to return in the results.      |
+-----------------------------+-----------------------------------------------------------------------+
| MinimumStopVisitsPerLine    |  A lower bound on the number of buses to return in the results        |
|                             |  per line/route (assuming that many are available)                    |
+ ----------------------------+-----------------------------------------------------------------------+ */
ConverterCache.prototype.getStopMonitoringResponse = function (getParams, dataFormat, callback) {
    var getParams                 = getParams || {} /* jshint ignore:line */        ,
        stopMonitoringDetailLevel = getParams.stopmonitoringdetaillevel             ,
        maxOnwardCalls            = parseInt(getParams.maximumnumberofcallsonwards) ,
        route_id                  = getParams.lineref                               ,
        stop_id                   = ((typeof getParams.monitoringref) === 'string') ? 
                                        getParams.monitoringref.trim() : null ,
        requestedTripKeys,
        includeSituationExchangeDelivery;


    try {
        requestedTripKeys = 
            queryProcessor.getRequestedTripKeysForStopMonitoringResponse.call(this, stop_id, getParams);
    } catch (e) {
        if (e.name === 'QueryError') {
             responseBuilder.buildErrorResponse(e.message, 'stopMonitoring', dataFormat, 
                    responseHandler.bind(null, 'stopMonitoring', dataFormat, callback));
        } else {
            throw e;
        }

        return;
    }

   
    stopMonitoringDetailLevel = ((typeof stopMonitoringDetailLevel) === 'string') ? 
                                    stopMonitoringDetailLevel.trim() : null;

    maxOnwardCalls = (!isNaN(maxOnwardCalls)) ? maxOnwardCalls : Number.POSITIVE_INFINITY;
    maxOnwardCalls = (maxOnwardCalls >= 0) ? maxOnwardCalls : 0;

    includeSituationExchangeDelivery = !!this.stopsWithAlertsFilterObject[stop_id];

    if (route_id) {
        includeSituationExchangeDelivery = 
            !!(includeSituationExchangeDelivery && this.routesWithAlertFilterObject[route_id]);
    } 

    responseBuilder.buildResponse.call(this, requestedTripKeys, 'stopMonitoring', stopMonitoringDetailLevel, 
                                   maxOnwardCalls, stop_id, includeSituationExchangeDelivery, dataFormat, 
                                   responseHandler.bind(null, 'stopMonitoring', dataFormat, callback));
};

/*
+-----------------------------+-----------------------------------------------------------------------+
| key                         |  your MTA Bus Time developer API key (required).  Go here to get one. |
+-----------------------------+-----------------------------------------------------------------------+
| OperatorRef                 |  the GTFS agency ID to be monitored (optional).  Currently,           |
|                             |  all stops have operator/agency ID of MTA. If left out,               |
|                             |  the system will make a best guess. Usage of the OperatorRef          |
|                             |  is suggested, as calls will return faster when populated.            |
+-----------------------------+-----------------------------------------------------------------------+
| VehicleRef                  |  The ID of the vehicle to be monitored (optional).                    |
|                             |  This is the 4-digit number painted on the side of the bus,           |
|                             |  for example 7560. Response will include all buses if not included.   |
+-----------------------------+-----------------------------------------------------------------------+
| LineRef                     |  A filter by 'fully qualified' route name,                            |
|                             |  GTFS agency ID + route ID (e.g. MTA NYCT_B63).                       |
+-----------------------------+-----------------------------------------------------------------------+
| DirectionRef                |  A filter by GTFS direction ID (optional).  Either 0 or 1.            |
+-----------------------------+-----------------------------------------------------------------------+
| VehicleMonitoringDetailLevel|  Determines whether or not the response will include the stops        |
|                             |  ("calls" in SIRI-speak) each vehicle is going to make (optional).    |
|                             |  To get calls data, use value calls, otherwise use value normal       |
|                             |  (default is normal).                                                 |
+-----------------------------+-----------------------------------------------------------------------+
| MaximumNumberOfCallsOnwards |  Limits the number of OnwardCall elements returned in the query.      |
| ----------------------------+-----------------------------------------------------------------------|
| MaximumStopVisits           |  an upper bound on the number of buses to return in the results.      |
+-----------------------------+-----------------------------------------------------------------------+
| MinimumStopVisitsPerLine    |  A lower bound on the number of buses to return in the results        |
|                             |  per line/route (assuming that many are available)                    |
+ ----------------------------+-----------------------------------------------------------------------+ */
ConverterCache.prototype.getVehicleMonitoringResponse = function (getParams, dataFormat, callback) {
    var getParams                    = getParams || {}  /* jshint ignore:line */             ,
        train_id                     = (getParams.vehicleref) && getParams.vehicleref.trim() ,
        vehicleMonitoringDetailLevel = getParams.vehiclemonitoringdetaillevel                ,
        route_id                     = getParams.lineref                                     ,
        maxOnwardCalls               = parseInt(getParams.maximumnumberofcallsonwards)       ,

        requestedTripKeys ,

        includeSituationExchangeDelivery;

    try {
        requestedTripKeys = queryProcessor.getRequestedTripKeysForVehicleMonitoringResponse.call(this, getParams) ;
    } catch (e) {
        if (e.name === 'QueryError') {
             responseBuilder.buildErrorResponse(e.message, 'vehicleMonitoring', dataFormat, 
                    responseHandler.bind(null, 'vehicleMonitoring', dataFormat, callback));
        } else {
            throw e;
        }

        return;
    }

    vehicleMonitoringDetailLevel = ((typeof vehicleMonitoringDetailLevel) === 'string') ? 
                                        vehicleMonitoringDetailLevel.trim() : null;

    maxOnwardCalls = (!isNaN(maxOnwardCalls)) ? maxOnwardCalls : Number.POSITIVE_INFINITY;
    maxOnwardCalls = (maxOnwardCalls >= 0) ? maxOnwardCalls : 0;

    includeSituationExchangeDelivery = !train_id || this.trainsWithAlertFilterObject[train_id];

    if (includeSituationExchangeDelivery) {
        includeSituationExchangeDelivery = !route_id || this.routesWithAlertFilterObject[route_id];
    }

    responseBuilder.buildResponse.call(this, requestedTripKeys, 'vehicleMonitoring', vehicleMonitoringDetailLevel, 
                           maxOnwardCalls, null, includeSituationExchangeDelivery, dataFormat, 
                           responseHandler.bind(null, 'vehicleMonitoring', dataFormat, callback));
};


function responseHandler (callType, dataFormat, callback, err, response) {
    if (err) {
        console.log(err.stack);
        callback(err);
    } else {
        try {
            responseBuilder.applyTimestamps(callType, dataFormat, response);
            callback(null, response);
        } catch (e) {
            console.log(e.stack || e);
            callback(e);
        } 
    }
}


module.exports = ConverterCache;
