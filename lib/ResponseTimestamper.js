/**
 * @module MTA_Subway_GTFS-Realtime_to_SIRI_Converter.Timestamper
 * @summary Maintains a list of all objects and provides a `stamp` method which adds a ResponseTimestamp field to each of them, all with the exact same value.
 */

'use strict';


var timeUtils = require('./utils/timeUtils');



/**
 * Creates new ResponseTimestamper.
 * @constructor
 */
function ResponseTimestamper () {
    this.toStamp = [];
}

/**
 * Add an object to the list of objects requiring a ReponseTimestamp field.
 * @param {object} obj
 */
ResponseTimestamper.prototype.push = function (obj) {
    this.toStamp.push(obj);
};


/**
 *  Stamp all the objects that have been sent to the ResponseTimestamper via the push method.
 *  All objects will be given the exact same timestamp. 
 */
ResponseTimestamper.prototype.stamp = function () {
    var timestamp = timeUtils.getTimestamp(),
        i;

    for (i=0; i < this.toStamp.length; ++i) {
        this.toStamp[i].ResponseTimestamp = timestamp;
    }
};


module.exports = ResponseTimestamper;

