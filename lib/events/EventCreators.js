'use strict';


var eventEmitter = require('./ConverterEventEmitter') ;



module.exports = {

    emitTrainLocationsUpdate : function (locations) {
        eventEmitter.emit(eventEmitter.eventTypes.LOCATIONS_UPDATE, locations) ;
    } ,


    emitTrainTrackingStatsUpdate : function (stats) {
        eventEmitter.emit(eventEmitter.eventTypes.TRAIN_TRACKING_STATS_UPDATE, stats) ;
    } ,


    emitUnscheduledTripsUpdate : function (unscheduledTrips) {
        eventEmitter.emit(eventEmitter.eventTypes.UNSCHEDULED_TRIPS_UPDATE, unscheduledTrips) ;
    } ,


    emitNoSpatialDataTripsUpdate : function (noSpatialDataTrips) {
        eventEmitter.emit(eventEmitter.eventTypes.NO_SPATIAL_DATA_TRIPS_UPDATE, noSpatialDataTrips) ;
    } ,


    emitTrainTrackingError : function (debugging_info) {
        eventEmitter.emit(eventEmitter.eventTypes.ERROR, debugging_info) ;
    } ,

} ;

