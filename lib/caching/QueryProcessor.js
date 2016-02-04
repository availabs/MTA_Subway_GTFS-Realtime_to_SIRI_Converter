"use strict";


function getRequestedTripKeysForVehicleMonitoringResponse (getParams) {
    /*jshint validthis:true */

        /* Extract the filters from the params. */
    var that = this,
        
        operatorRef          = (getParams.operatorref) && getParams.operatorref.trim() ,
        train_id             = (getParams.vehicleref)  && getParams.vehicleref.trim() ,
        route_id             = (getParams.lineref)     && getParams.lineref.trim() ,
        directionRef         = parseInt(getParams.directionref) ,
        maxStopVisits        = parseInt(getParams.maximumstopvisits) ,
        minStopVisitsPerLine = parseInt(getParams.minimumstopvisitsperline) ,

        gtfsTripKey,

        reqTripKeysByRoute,
        totalStopVisits,
        routesWithMoreThanMin,
        countOfRequiredTripKeys,
        minTripKeysForRoutes,
        fillIndices,
        requestedTripKeys,
        next_fill_tripKey,
        routes,

        i;


    gtfsTripKey = ((train_id !== undefined) && (train_id !== null)) ? 
                    (this.vehicleRef_to_gtfsTripKey[train_id]) : null;


    if (maxStopVisits === 0) {
        return []; 
    }

    if (operatorRef && (!this.bufferedMonitoredVehicleJourneys.agency_ids[operatorRef]) ) { 
        return []; 
    }

    

    /* If a tripKey is specified, return only that tripKey's trip trip. */
    if (gtfsTripKey) { 
        //Make sure tripKey exists in the byTripKeysIndex.
        return (this.bufferedMonitoredVehicleJourneys.byTripKeysIndex.json[gtfsTripKey]) ? [gtfsTripKey] : [];
    }

    if ( route_id && !isNaN(directionRef) ) { // Both route and directionRef are specified.
        reqTripKeysByRoute = [ this.bufferedMonitoredVehicleJourneys //FIXME: Defensive code agains undefined.
                                       .partitionedByRouteByDirection[route_id][directionRef] || []];
    } else if ( route_id ) { // We have a route, but no direction.
        reqTripKeysByRoute = [ this.bufferedMonitoredVehicleJourneys.partitionedByRoute[route_id] || []];
    } else if ( ! isNaN(directionRef) ) {  // Only direction specified.
        routes = Object.keys(this.bufferedMonitoredVehicleJourneys.partitionedByRoute);

        reqTripKeysByRoute = routes.map(function (_route_id) { 
            return this.bufferedMonitoredVehicleJourneys.partitionedByRouteByDirection[_route_id][directionRef] ||[];
        });

    } else { // Neither route nor direction specified.
        routes = Object.keys(this.bufferedMonitoredVehicleJourneys.partitionedByRoute);

        reqTripKeysByRoute = routes.map(function (_route_id) { 
             return that.bufferedMonitoredVehicleJourneys.partitionedByRoute[_route_id] || [];
        });
    }

    console.log(JSON.stringify(reqTripKeysByRoute, null, 4));
    
    // How many tripKeys total?
    totalStopVisits = reqTripKeysByRoute.reduce(function (acc, arr) { 
        return acc + arr.length; 
    }, 0);
    
    // Does the total number of tripKeys exceed the max specified?
    if  ((!isNaN(maxStopVisits))  && (maxStopVisits !== null) && (totalStopVisits > maxStopVisits)) {

        // Was minStopVisitsPerLine specified? If so, it could override max.
        if ((!isNaN(minStopVisitsPerLine)) && (minStopVisitsPerLine !== null)) {
            
            // The following datastructure is used 
            //      IF the number of tripKey required by minStopVisitsPerLine is less than maxStopVisits.
            //      In that case, we merge into reqTripKeyIndices those tripKeys with the nearest ETA for the
            //      stop that aren't already included in the minStopVisitsPerLine arrays.
            //
            // [ arrIndex : <index of route in reqTripKeyIndicesByRoute>, 
            //   offset   : <current offset into the route's list of tripKeys>, ]
            routesWithMoreThanMin = []; 

            // Tally of the tripKeys known to be added to reqTripKeyIndicesByRoute
            countOfRequiredTripKeys = 0;

            // An array of arrays. The nested arrays are the tripKeys required by the minStopVisitsPerLine.
            minTripKeysForRoutes = reqTripKeysByRoute.reduce(function (acc, tripKeysForRoute, i) {

                var len = tripKeysForRoute.length;
                
                if (len > minStopVisitsPerLine) {
                    countOfRequiredTripKeys += minStopVisitsPerLine;
                    routesWithMoreThanMin.push({ arrIndex : i, offset : minStopVisitsPerLine });
                } else {
                    countOfRequiredTripKeys += len;
                }

                if (len) {
                    acc.push(tripKeysForRoute.slice(0, minStopVisitsPerLine));
                }

                return acc;

            }, []);

        } else {
            // No minStopVisitsPerLine, therefore the required tripKeys is an empty list.
            countOfRequiredTripKeys = 0;
            minTripKeysForRoutes = [[]];            

            // All non-empty lists have more than the required per route amount of zero.
            // We initialize all of them to their first element.
            routesWithMoreThanMin   = [];            
            for ( i = 0; i < reqTripKeysByRoute.length; ++i ) {
                if (reqTripKeysByRoute[i].length) {
                    routesWithMoreThanMin.push({ arrIndex : i, offset : 0 });
                }
            }
        }

        // If there are non-empty minTripKeyIndicesForRoutes arrays, fillIndices becomes
        // a list of the lowest indices. That list, together with the minTripKeyIndicesForRoutes,
        // brings the total number of tripKeys returned to maxStopVisits.
        // 
        // If minTripKeyIndices contains only an empty list, the following will populate fillIndices
        // with the maxStopVisits lowest tripKey indices that fit the route and direction constripKeyts.
        fillIndices = [];
        i = 0;

        while ((routesWithMoreThanMin.length) && (countOfRequiredTripKeys < maxStopVisits)) {
            // Seeking the lowest remaining tripKey index number within routesWithMoreThanMin.
            if (i >= routesWithMoreThanMin.length) {
                i = 0;
            }

            next_fill_tripKey = reqTripKeysByRoute[routesWithMoreThanMin[i].arrIndex][routesWithMoreThanMin[i].offset];

            // If we have exhausted a list, remove it from consideration.
            if (++(routesWithMoreThanMin[i].offset) === reqTripKeysByRoute[routesWithMoreThanMin[i].arrIndex].length) {
                routesWithMoreThanMin.splice(i, 1);
            }

            // Don't count the mysterious nulls and undefineds.
            if ((typeof next_fill_tripKey) === 'string') {
                fillIndices.push(next_fill_tripKey);
                ++countOfRequiredTripKeys;

                ++i;
            }
        }
        minTripKeysForRoutes.push(fillIndices);

        // Put all the tripKey indices into a single array.
        requestedTripKeys = minTripKeysForRoutes.reduce(function (acc, arr) { return acc.concat(arr); }, []);

    } else { //Under the max limit, just concat the arrays.
        requestedTripKeys = reqTripKeysByRoute.reduce(function (acc, arr) { return acc.concat(arr); }, []);
    }

    // From tripKeyIndices to tripKey_ids.
    return requestedTripKeys;
}




function getRequestedTripKeysForStopMonitoringResponse (stop_id, getParams) {
    /* jshint validthis:true */

    var that = this,

        operatorRef          = getParams.operatorref || 'MTA'               ,
        route_id             = getParams.lineref                            ,
        directionRef         = parseInt(getParams.directionref)             ,
        maxStopVisits        = parseInt(getParams.maximumstopvisits)        ,
        minStopVisitsPerLine = parseInt(getParams.minimumstopvisitsperline) ,

        indexNodeForStop,

        routes,

        totalStopVisits,
        routesWithMoreThanMin,
        countOfRequiredTripKeys,
        minTripKeyIndicesForRoutes,

        fillIndices,
        minIndex,
        minRoute,
        tripKey_index,
        routeMin,
        reqTripKeyIndices,

        reqTripKeyIndicesByRoute,

        i;

    indexNodeForStop = this.bufferedCalls.stopIDToCallNumberForTripKey[stop_id];

    // Get the OperatorRef
    // Check route_id to see if it begins with OperatorRef
    // If not, append OperatorRef to the route_id.
    // Will need to index/filter on OperatorRef as well.

    // Cases where there's nothing to do.
    if ((!indexNodeForStop) || (maxStopVisits === 0) || (operatorRef !== 'MTA')) { return []; }

    if ( route_id && !isNaN(directionRef) ) { // Both route and directionRef are specified.
        reqTripKeyIndicesByRoute = [ this.bufferedCalls
                                       .indicesOfTripKeysSortedByETAForStopByRoute[stop_id]
                                                                                [route_id]
                                                                                [directionRef] || []];
    } else if ( route_id ) { // We have a route, but no direction.
        reqTripKeyIndicesByRoute = [ this.bufferedCalls.indicesOfTripKeysSortedByETAForStopByRoute[stop_id]
                                                                                              [route_id] || []];
    } else if ( ! isNaN(directionRef) ) {  // Only direction specified.
        routes = Object.keys(this.bufferedCalls.indicesOfTripKeysSortedByETAForStopByRoute[stop_id]) || [];

        reqTripKeyIndicesByRoute = routes.map(function (_route_id) { 
             return this.bufferedCalls.indicesOfTripKeysSortedByETAForStopByRouteByDirection[stop_id]
                                                                                          [_route_id]
                                                                                          [directionRef] || [];
        });
    } else { // Neither route nor direction specified.
        routes = Object.keys(this.bufferedCalls.indicesOfTripKeysSortedByETAForStopByRoute[stop_id]);

        reqTripKeyIndicesByRoute = routes.map(function (_route_id) { 
             return that.bufferedCalls.indicesOfTripKeysSortedByETAForStopByRoute[stop_id][_route_id] || [];
        });
    }

    // How many tripKeys total?
    totalStopVisits = reqTripKeyIndicesByRoute.reduce(function (acc, arr) { return acc + arr.length; }, 0);
    
    // Does the total number of tripKeys exceed the max specified?
    if  ((!isNaN(maxStopVisits))  && (maxStopVisits !== null) && (totalStopVisits > maxStopVisits)) {

        // Was minStopVisitsPerLine specified? If so, it could override max.
        if ((!isNaN(minStopVisitsPerLine)) && (minStopVisitsPerLine !== null)) {
            
            // The following datastructure is used 
            //      IF the number of tripKey required by minStopVisitsPerLine is less than maxStopVisits.
            //      In that case, we merge into reqTripKeyIndices those tripKeys with the nearest ETA for the
            //      stop that aren't already included in the minStopVisitsPerLine arrays.
            //
            // [ arrIndex : <index of route in reqTripKeyIndicesByRoute>, 
            //   offset   : <current offset into the route's list of tripKeys>, ]
            routesWithMoreThanMin = []; 

            // Tally of the tripKeys known to be added to reqTripKeyIndicesByRoute
            countOfRequiredTripKeys = 0;

            // An array of arrays. The nested arrays are the tripKeys required by the minStopVisitsPerLine.
            minTripKeyIndicesForRoutes = reqTripKeyIndicesByRoute.reduce(function (acc, indicesForRoute, i) {

                var len = indicesForRoute.length;
                
                if (len > minStopVisitsPerLine) {
                    countOfRequiredTripKeys += minStopVisitsPerLine;
                    routesWithMoreThanMin.push({ arrIndex : i, offset : minStopVisitsPerLine });
                } else {
                    countOfRequiredTripKeys += len;
                }

                if (len) {
                    acc.push(indicesForRoute.slice(0, minStopVisitsPerLine));
                }

                return acc;

            }, []);

        } else {
            // No minStopVisitsPerLine, therefore the required tripKeys is an empty list.
            countOfRequiredTripKeys = 0;
            minTripKeyIndicesForRoutes = [[]];            

            // All non-empty lists have more than the required per route amount of zero.
            // We initialize all of them to their first element.
            routesWithMoreThanMin   = [];            
            for ( i = 0; i < reqTripKeyIndicesByRoute.length; ++i ) {
                if (reqTripKeyIndicesByRoute[i].length) {
                    routesWithMoreThanMin.push({ arrIndex : i, offset : 0 });
                }
            }
        }

        // If there are non-empty minTripKeyIndicesForRoutes arrays, fillIndices becomes
        // a list of the lowest indices. That list, together with the minTripKeyIndicesForRoutes,
        // brings the total number of tripKeys returned to maxStopVisits.
        // 
        // If minTripKeyIndices contains only an empty list, the following will populate fillIndices
        // with the maxStopVisits lowest tripKey indices that fit the route and direction constripKeyts.
        fillIndices = [];
        while ((routesWithMoreThanMin.length) && (countOfRequiredTripKeys < maxStopVisits)) {
            // Initialize min and minRoute..
            minIndex = reqTripKeyIndicesByRoute[routesWithMoreThanMin[0].arrIndex][routesWithMoreThanMin[0].offset];
            minRoute = 0;

            // Seeking the lowest remaining tripKey index number within routesWithMoreThanMin.
            for ( i = 1; i < routesWithMoreThanMin.length; ++i ) {
                tripKey_index = reqTripKeyIndicesByRoute[routesWithMoreThanMin[i].arrIndex]
                                                        [routesWithMoreThanMin[i].offset];
                if (tripKey_index < minIndex) {
                    minIndex = tripKey_index;
                    routeMin = i;  
                }
            }

            fillIndices.push(minIndex);
            ++countOfRequiredTripKeys;

            // If we have exhausted a list, remove it from consideration.
            if (++routesWithMoreThanMin[minRoute].offset === 
                    reqTripKeyIndicesByRoute[routesWithMoreThanMin[minRoute].arrIndex].length) {
                routesWithMoreThanMin.splice(minRoute, 1);
            }
        }
        minTripKeyIndicesForRoutes.push(fillIndices);

        // Put all the tripKey indices into a single array.
        reqTripKeyIndices = minTripKeyIndicesForRoutes.reduce(function (acc, arr) { return acc.concat(arr); }, []);

    } else { //Under the max limit, just concat the arrays.
        reqTripKeyIndices = reqTripKeyIndicesByRoute.reduce(function (acc, arr) { return acc.concat(arr); }, []);
    }

    // From tripKeyIndices to tripKey_ids.
    return reqTripKeyIndices.map(function (tripKey_index) {
        return  that.bufferedCalls.tripKeysSortedByETAForStop[stop_id][tripKey_index];
    });
}


module.exports = {
    getRequestedTripKeysForVehicleMonitoringResponse : getRequestedTripKeysForVehicleMonitoringResponse ,
    getRequestedTripKeysForStopMonitoringResponse    : getRequestedTripKeysForStopMonitoringResponse ,
} ;

