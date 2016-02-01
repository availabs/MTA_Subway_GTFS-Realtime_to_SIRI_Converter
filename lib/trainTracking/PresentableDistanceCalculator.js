"use strict";

var _ = require('lodash'),

    constants = require('./Constants');



/**
* "The distance displayed in the UI."
* @see {@link https://bustime.mta.info/wiki/Developers/SIRIMonitoredVehicleJourney#HThePresentableDistancefield}
*
*    === The PresentableDistance field ===
*
*    The logic that determines whether stops or miles are shown in the PresentableDistance field is below:
*
*    Show distance in miles if and only if:
*          (distance in miles to _immediate next stop_ is > D) 
*          OR (distance in stops to current stop is > N AND distance in miles to current stop > E)
*
*    Show "approaching" if and only if:
*          distance_in_miles to immediate next stop < P
*     
*    Show "at stop" if and only if:
*          distance_in_miles to immediate next stop < T
*
*    Current Parameter Values:
*
*        Parameter | Value | Units  
*        ----------+-------+--------
*            D     |   0.5 | miles
*            N     |   3   | stops
*            E     |   0.5 | miles
*            P     | 500   | feet
*            T     | 100   | feet
*
*/
function getPresentableDistance (gtfsTripKey, curStopDistanceAlongRoute_km, stopsFromCurStop) {
    /* jshint validthis: true */

    // Constant Parameters
    var D = 0.5,
        N = 3,
        E = 0.5,
        P = 500,
        T = 100;

    var showMiles;

    var vehicleStatus          ,  
        distToImmedNextStop_km ,
        distToImmedNextStop_mi ,

        trainDistAlongRoute_km ,

        distToCurrentStop_km   ,
        distToCurrentStop_mi   ,
        distToCurrentStop_ft   ;


    // If the vehicle has no status, we aren't tracking it. (unscheduled or no spatial data)
    vehicleStatus = _.get(this, ['trainLocations', gtfsTripKey, 'state'], null);

    if (vehicleStatus === null) { return null; }


    // If trainDistAlongRoute_km not available, then we were not able to infer the train's location.
    trainDistAlongRoute_km = this.getVehicleDistanceAlongRouteInKilometers(gtfsTripKey);

    if (trainDistAlongRoute_km === null) { return null; }


    // Get the distance to the immediate next stop. 
    // If we are currently at a stop, this distance is zero,
    //      otherwise it is the length of the LineString (see INVARIANTS).
    if (vehicleStatus.AT_STOP) {
        distToImmedNextStop_km =  0;
    } else {
        distToImmedNextStop_km = _.get(this, 
                                       [ 'trainLocations', 
                                         gtfsTripKey, 
                                         'locationGeoJSON', 
                                         'properties', 
                                         'line_distance_km' 
                                       ], 
                                       NaN); 
    }

    distToImmedNextStop_mi = distToImmedNextStop_km * constants.MILES_PER_KILOMETER;

    distToCurrentStop_km   = curStopDistanceAlongRoute_km - trainDistAlongRoute_km;
    distToCurrentStop_mi   =
        (distToCurrentStop_km * constants.MILES_PER_KILOMETER).toPrecision(constants.SIGNIFICANT_DIGITS);

    // Determine whether to show miles based on the logic explained in comments preceeding this function.
    showMiles = (distToImmedNextStop_mi > D) || ((stopsFromCurStop > N) && (distToCurrentStop_mi > E));
        
    if (showMiles) {

        return  distToCurrentStop_mi + ' mile' + ((distToCurrentStop_mi === 1) ? '' : 's');

    } else {
        
        // The special rules for when the bus is near the immediate next stop.
        if (stopsFromCurStop === 0) {
            distToCurrentStop_ft = distToCurrentStop_mi * constants.FEET_PER_MILE;

            if      (distToCurrentStop_ft < T) { return 'at stop'     ; }
            else if (distToCurrentStop_ft < P) { return 'approaching' ; }
        }

        return (stopsFromCurStop + ' stop' + ((stopsFromCurStop === 1) ? '' : 's'));
    }
}


module.exports = {
    getPresentableDistance : getPresentableDistance ,
};
