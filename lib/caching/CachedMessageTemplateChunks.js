"use strict";

var timeUtils = require('MTA_Subway_GTFS-Realtime_Toolkit').TimeUtils;


var perJourney = {

    json : {
        startNonemptyMonitoredCall : new Buffer(',"MonitoredCall":'), 
        emptyMonitoredCall         : new Buffer(',"MonitoredCall":{}'),

        startNonemptyOnwardCalls : new Buffer(',"OnwardCalls":{"OnwardCall":['),
        endNonemptyOnwardCalls   : new Buffer(']}}},'), //Ends MonitoredVehicleJourney Too

        emptyOnwardCalls : new Buffer(',"OnwardCalls":{}}},'),
    },

    xml : {
        startNonemptyMonitoredCall : new Buffer('<MonitoredCall>'),
        emptyMonitoredCall         : new Buffer('<MonitoredCall>'),

        startNonemptyOnwardCalls : new Buffer('</MonitoredCall><OnwardCalls><OnwardCall>'),
        endNonemptyOnwardCalls   : new Buffer('</OnwardCall></OnwardCalls>'),

        emptyOnwardCalls : new Buffer('</MonitoredCall><OnwardCalls></OnwardCalls>'),
    }
};


var responseLevel = (function () {
    var shared_json = {
            beginResponse                  : new Buffer('{"Siri":{"ServiceDelivery":{"ResponseTimestamp":"'),

            afterFirstResponseTimestamp    : new Buffer('",'),

            //startDelivery

            afterSecondResponseTimestamp   : new Buffer('","ValidUntil":"'),
            afterValidUntil                : new Buffer('",'),

            //startTripsData

            //startNonemptyMonitoredCall

            //startNonemptyOnwardCalls 
            //endNonemptyOnwardCalls
            
            //emptyOnwardCalls

            endTripsData                   : new Buffer('],'),

            beginSituationExchangeDelivery : new Buffer('"SituationExchangeDelivery":['),
            endResponse                    : new Buffer(']}]}}}'),
        }, 

        shared_xml = {
            beginResponse : new Buffer('<Siri xmlns:ns2="http://www.ifopt.org.uk/acsb" '    + 
                                             'xmlns:ns4="http://datex2.eu/schema/1_0/1_0" ' + 
                                             'xmlns:ns3="http://www.ifopt.org.uk/ifopt" '   +
                                             'xmlns="http://www.siri.org.uk/siri">'         + 
                                             '<ServiceDelivery><ResponseTimestamp>'),

            afterFirstResponseTimestamp : new Buffer('</ResponseTimestamp>'),

            //startDelivery
            
            afterSecondResponseTimestamp : new Buffer('</ResponseTimestamp><ValidUntil>'),

            afterValidUntil : new Buffer('</ValidUntil>'),
            
            //startTripsData
            //startNonemptyMonitoredCall
            //startNonemptyOnwardCalls 
            //endNonemptyOnwardCalls
            //emptyOnwardCalls

            beginSituationExchangeDelivery : new Buffer('<SituationExchangeDelivery>'),

            endResponse                    : new Buffer('</SituationExchangeDelivery></ServiceDelivery></Siri>'),
        },

        
        stopMonitoring = {
            json : {
                beginResponse                : shared_json.beginResponse,

                afterFirstResponseTimestamp  : shared_json.afterFirstResponseTimestamp,

                startDelivery                : new Buffer('"StopMonitoringDelivery":[{"ResponseTimestamp":"'),

                afterSecondResponseTimestamp : shared_json.afterSecondResponseTimestamp,
                afterValidUntil              : shared_json.afterValidUntil,

                startTripsData               : new Buffer('"MonitoredStopVisit":['),

                //startNonemptyMonitoredCall
                //startNonemptyOnwardCalls 
                //endNonemptyOnwardCalls
                //emptyMonitoredCall
                //emptyOnwardCalls

                endTripsData                 : shared_json.endTripsData,

                beginSituationExchange       : shared_json.beginSituationExchangeDelivery,

                endResponse                  : shared_json.endResponse,
            },

            xml : {
                beginResponse                : shared_xml.beginResponse,

                afterFirstResponseTimestamp  : shared_xml.afterFirstResponseTimestamp,

                startDelivery                : new Buffer('<StopMonitoringDelivery><ResponseTimestamp>'),

                afterSecondResponseTimestamp : shared_xml.afterSecondResponseTimestamp,
                afterValidUntil              : shared_xml.afterValidUntil,

                startTripsData               : new Buffer('<MonitoredStopVisit>'),
                
                //startNonemptyMonitoredCall
                //startNonemptyOnwardCalls 
                //endNonemptyOnwardCalls
                //emptyMonitoredCall
                //emptyOnwardCalls

                endTripsData                 : new Buffer('</MonitoredStopVisit></StopMonitoringDelivery>'),

                beginSituationExchange       : shared_xml.beginSituationExchangeDelivery,

                endResponse                  : shared_xml.endResponse,
            },
        },

        
        vehicleMonitoring = {
            json : {
                beginResponse                : shared_json.beginResponse,
                afterFirstResponseTimestamp  : shared_json.afterFirstResponseTimestamp,

                startDelivery                : new Buffer('"VehicleMonitoringDelivery":[{"ResponseTimestamp":"'),

                afterSecondResponseTimestamp : shared_json.afterSecondResponseTimestamp,
                afterValidUntil              : shared_json.afterValidUntil,

                startTripsData               : new Buffer('"VehicleActivity":['),
                
                //startNonemptyMonitoredCall
                //startNonemptyOnwardCalls 
                //endNonemptyOnwardCalls
                //emptyMonitoredCall
                //emptyOnwardCalls

                endTripsData                 : shared_json.endTripsData,

                beginSituationExchange       : shared_json.beginSituationExchangeDelivery,

                endResponse                  : shared_json.endResponse,
            },

            xml : {
                beginResponse                : shared_xml.beginResponse,

                afterFirstResponseTimestamp  : shared_xml.afterFirstResponseTimestamp,

                startDelivery                : new Buffer('<VehicleMonitoringDelivery><ResponseTimestamp>'),

                afterSecondResponseTimestamp : shared_xml.afterSecondResponseTimestamp,
                afterValidUntil              : shared_xml.afterValidUntil,

                startTripsData               : new Buffer('<VehicleActivity>'),
                
                //startNonemptyMonitoredCall
                //startNonemptyOnwardCalls 
                //endNonemptyOnwardCalls
                //emptyMonitoredCall
                //emptyOnwardCalls

                endTripsData                 : new Buffer('</VehicleActivity></VehicleMonitoringDelivery>'),

                beginSituationExchange       : shared_xml.beginSituationExchangeDelivery,

                endResponse                  : shared_xml.endResponse,
            },

        };

    return {
        stopMonitoring    : stopMonitoring,
        vehicleMonitoring : vehicleMonitoring,
    };
}());


var responseTimestampLength = timeUtils.getTimestamp().length;


var generalResponsePiecesLength = (function () {

    function getSumLengthOfPieces (deliveryType, dataFormat) {
        return Object.keys(responseLevel[deliveryType][dataFormat])
                     .reduce(function(sum, key) { 
                                 return sum + responseLevel[deliveryType][dataFormat][key].length; 
                             }, (3 * responseTimestampLength));
    }

    return {
        stopMonitoring : {
            json : getSumLengthOfPieces('stopMonitoring', 'json'),
            xml  : getSumLengthOfPieces('stopMonitoring', 'xml'),
        },

        vehicleMonitoring : {
            json : getSumLengthOfPieces('vehicleMonitoring', 'json'),
            xml : getSumLengthOfPieces('vehicleMonitoring', 'xml'),
        }
    };
}());


var firstTimestampOffset = {
    stopMonitoring : {
        json : responseLevel.stopMonitoring.json.beginResponse.length,
        xml : responseLevel.stopMonitoring.xml.beginResponse.length,
    },

    vehicleMonitoring : {
        json : responseLevel.stopMonitoring.json.beginResponse.length,
        xml : responseLevel.stopMonitoring.xml.beginResponse.length,
    },
};



var secondTimestampOffset = (function () {
    function getOffset (deliveryType, dataFormat) {
        return responseLevel[deliveryType][dataFormat].beginResponse.length +
               responseTimestampLength +
               responseLevel[deliveryType][dataFormat].afterFirstResponseTimestamp.length +
               responseLevel[deliveryType][dataFormat].startDelivery.length;
    }

    return {
        stopMonitoring : {
            json : getOffset('stopMonitoring', 'json'),
            xml : getOffset('stopMonitoring', 'xml'),
        },
        vehicleMonitoring : {
            json : getOffset('vehicleMonitoring', 'json'),
            xml : getOffset('vehicleMonitoring', 'xml'),
        },
    };
}());




module.exports = {
    perJourney                  : perJourney,
    responseLevel               : responseLevel,

    responseTimestampLength     : responseTimestampLength,
    generalResponsePiecesLength : generalResponsePiecesLength,

    firstTimestampOffset        : firstTimestampOffset,
    secondTimestampOffset       : secondTimestampOffset,
};
