'use strict';


var Wrapper   = require('MTA_Subway_GTFS-Realtime_Toolkit').Wrapper,
    Converter = require('./Converter');


function ConverterStream (feedReader, gtfsDataDir, callback) {

    this.start = function () {
        feedReader.registerListener(convertAndSend);
    };

    this.stop = function () {
        feedReader.removeListener(convertAndSend);
    };

    function convertAndSend (msg) { 
        var converter = new Converter(msg, gtfsDataDir);

        callback(converter);
    } 
}

module.exports = ConverterStream ;

