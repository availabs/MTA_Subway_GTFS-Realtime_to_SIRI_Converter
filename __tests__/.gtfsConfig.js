'use strict';

var path        = require('path'),
    dataDirPath = path.normalize(path.join(__dirname, '.data/'));

module.exports = {
    gtfsConfigFilePath          : __filename                                         ,

    latestDataURL               : 'http://transitfeeds.com/p/mta/79/latest/download' ,

    dataDirPath                 : dataDirPath                                        ,
    tmpDirPath                  : path.join(dataDirPath, 'tmp')                      ,

    indexedScheduleDataFileName : 'indexedScheduleData.json'                         ,
    indexedSpatialDataFileName  : 'indexedSpatialData.json'                          ,
    indexingStatisticsFileName  : 'indexingStatistics.json'                          ,
};
