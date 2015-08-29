/**
 * MTA_Subway_GTFS-Realtime_to_SIRI_Converter converts MTA GTFS-Realtime feed messages into SIRI format.
 *
 * @module MTA_Subway_GTFS-Realtime_to_SIRI_Converter
 * @summary Converts MTA Subway GTFS-R messages to SIRI.
 *
 */

module.exports = {
    Converter                        : require('./lib/Converter.js')               ,
    ConverterStream                  : require('./lib/ConverterStream.js')         ,
    MTA_Subway_GTFS_Toolkit          : require('MTA_Subway_GTFS_Toolkit')          ,
    MTA_Subway_GTFS_Realtime_Toolkit : require('MTA_Subway_GTFS-Realtime_Toolkit') ,
};
