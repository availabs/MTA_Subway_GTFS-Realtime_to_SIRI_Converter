'use strict';


var _            = require('lodash'),
    GTFS_Wrapper = require('MTA_Subway_GTFS_Toolkit').Wrapper;



function newHandler (GTFSrt, gtfsDataDir) {
    var handler = new Handler(GTFSrt, gtfsDataDir),
        dates   = _.uniq( _.filter(handler.tripsIDToGTFSDataIndex, 'schedule_date') );

    // Simple cache management. 
    getGTFSForScheduleDate.cache.__data__ = _.pick(getGTFSForScheduleDate.cache.__data__, dates);

    return handler;
}



function Handler (GTFSrt, gtfsDataDir) {
    this.tripsIDToGTFSDataIndex = indexTrips(GTFSrt, gtfsDataDir);
}

Handler.prototype.getScheduleDateForTrip = function (trip_id) {
    return _.get(this, ['tripsIDToGTFSDataIndex', trip_id, 'schedule_date'], null);
};

Handler.prototype.getGTFSForTrip = function (trip_id) {
    return _.get(this, ['tripsIDToGTFSDataIndex', trip_id, 'GTFS'], null);
};



function indexTrips(GTFSrt, gtfsDataDir) {
    var tripIDs = GTFSrt.getAllMonitoredTrips();

    return _.reduce(tripIDs, function (index, trip_id) {

        var scheduleDate = GTFSrt.getScheduleDateForTrip(trip_id);

        index[trip_id] = {
            schedule_date : scheduleDate,
            GTFS          : getGTFSForScheduleDate(scheduleDate, gtfsDataDir),
        };

        return index;
    }, {});
}


// NOTE: Possibly will have multiple GTFS_Toolkit.Wrapper objects in memory... >1G total...
// FIXME: Should cache on GTFS version, not date.
//        As is, frequency of multiple GTFS wrapper objects in memory is daily!
//        Need to add a getRequiredGTFSVersion to the GTFS_Toolkit.Wrapper,
//          probably as a static function on the constructor function itself.
var getGTFSForScheduleDate = _.memoize(function (scheduleDate, gtfsDataDir) {
    return new GTFS_Wrapper(scheduleDate, gtfsDataDir);
});



module.exports = {
    newHandler : newHandler ,
};
