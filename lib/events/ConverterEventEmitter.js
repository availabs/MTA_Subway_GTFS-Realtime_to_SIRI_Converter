'use strict';


var EventEmitter = require('events') ,
    util = require('util') ;



function ConverterEventEmitter () {
    EventEmitter.call(this) ;
}

util.inherits(ConverterEventEmitter, EventEmitter) ;


ConverterEventEmitter.prototype.eventTypes = {
    LOCATIONS_UPDATE             : 'LOCATIONS_UPDATE' ,
    TRAIN_TRACKING_STATS_UPDATE  : 'TRAIN_TRACKING_STATS_UPDATE' ,
    UNSCHEDULED_TRIPS_UPDATE     : 'UNSCHEDULED_TRIPS_UPDATE' ,
    NO_SPATIAL_DATA_TRIPS_UPDATE : 'NO_SPATIAL_DATA_TRIPS_UPDATE' ,
    TRAIN_TRACKING_ERROR         : 'TRAIN_TRACKING_ERROR' ,
    DATA_ANOMALY                 : 'DATA_ANOMALY' ,
    ERROR                        : 'ERROR' ,
};


module.exports = new ConverterEventEmitter() ;

