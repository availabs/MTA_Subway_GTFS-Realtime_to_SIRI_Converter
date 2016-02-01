"use strict";


function getRequestedTrainsForVehicleMonitoringResponse (getParams) {
    /*jshint validthis:true */

        /* Extract the filters from the params. */
    var that = this,
        
        operatorRef          = (getParams.operatorref) && getParams.operatorref.trim() ,
        train_id             = (getParams.vehicleref) && getParams.vehicleref.trim()   ,
        route_id             = (getParams.lineref) && getParams.lineref.trim()         ,
        directionRef         = parseInt(getParams.directionref)                        ,
        maxStopVisits        = parseInt(getParams.maximumstopvisits)                   ,
        minStopVisitsPerLine = parseInt(getParams.minimumstopvisitsperline)            ,

        reqTrainsByRoute,
        totalStopVisits,
        routesWithMoreThanMin,
        countOfRequiredTrains,
        minTrainsForRoutes,
        fillIndices,
        requestedTrains,
        next_fill_train,
        routes,

        i;


    if (maxStopVisits === 0) {
        return []; 
    }

    if (operatorRef && (!this.bufferedMonitoredVehicleJourneys.agency_ids[operatorRef]) ) { 
        return []; 
    }


    /* If a train is specified, return only that train. */
    if (train_id) { 
        //Make sure train exists in the byTrainsIndex.
        return (this.bufferedMonitoredVehicleJourneys.byTrainsIndex.json[train_id]) ? [train_id] : [];
    }

    if ( route_id && !isNaN(directionRef) ) { // Both route and directionRef are specified.
        reqTrainsByRoute = [ this.bufferedMonitoredVehicleJourneys //FIXME: Defensive code agains undefined.
                                       .partitionedByRouteByDirection[route_id][directionRef] || []];
    } else if ( route_id ) { // We have a route, but no direction.
        reqTrainsByRoute = [ this.bufferedMonitoredVehicleJourneys.partitionedByRoute[route_id] || []];
    } else if ( ! isNaN(directionRef) ) {  // Only direction specified.
        routes = Object.keys(this.bufferedMonitoredVehicleJourneys.partitionedByRoute);

        reqTrainsByRoute = routes.map(function (_route_id) { 
            return this.bufferedMonitoredVehicleJourneys.partitionedByRouteByDirection[_route_id][directionRef] || [];
        });
    } else { // Neither route nor direction specified.
        routes = Object.keys(this.bufferedMonitoredVehicleJourneys.partitionedByRoute);

        reqTrainsByRoute = routes.map(function (_route_id) { 
             return that.bufferedMonitoredVehicleJourneys.partitionedByRoute[_route_id] || [];
        });
    }

    
    // How many trains total?
    totalStopVisits = reqTrainsByRoute.reduce(function (acc, arr) { 
        return acc + arr.length; 
    }, 0);
    
    // Does the total number of trains exceed the max specified?
    if  ((!isNaN(maxStopVisits))  && (maxStopVisits !== null) && (totalStopVisits > maxStopVisits)) {

        // Was minStopVisitsPerLine specified? If so, it could override max.
        if ((!isNaN(minStopVisitsPerLine)) && (minStopVisitsPerLine !== null)) {
            
            // The following datastructure is used 
            //      IF the number of train required by minStopVisitsPerLine is less than maxStopVisits.
            //      In that case, we merge into reqTrainIndices those trains with the nearest ETA for the
            //      stop that aren't already included in the minStopVisitsPerLine arrays.
            //
            // [ arrIndex : <index of route in reqTrainIndicesByRoute>, 
            //   offset   : <current offset into the route's list of trains>, ]
            routesWithMoreThanMin = []; 

            // Tally of the trains known to be added to reqTrainIndicesByRoute
            countOfRequiredTrains = 0;

            // An array of arrays. The nested arrays are the trains required by the minStopVisitsPerLine.
            minTrainsForRoutes = reqTrainsByRoute.reduce(function (acc, trainsForRoute, i) {

                var len = trainsForRoute.length;
                
                if (len > minStopVisitsPerLine) {
                    countOfRequiredTrains += minStopVisitsPerLine;
                    routesWithMoreThanMin.push({ arrIndex : i, offset : minStopVisitsPerLine });
                } else {
                    countOfRequiredTrains += len;
                }

                if (len) {
                    acc.push(trainsForRoute.slice(0, minStopVisitsPerLine));
                }

                return acc;

            }, []);

        } else {
            // No minStopVisitsPerLine, therefore the required trains is an empty list.
            countOfRequiredTrains = 0;
            minTrainsForRoutes = [[]];            

            // All non-empty lists have more than the required per route amount of zero.
            // We initialize all of them to their first element.
            routesWithMoreThanMin   = [];            
            for ( i = 0; i < reqTrainsByRoute.length; ++i ) {
                if (reqTrainsByRoute[i].length) {
                    routesWithMoreThanMin.push({ arrIndex : i, offset : 0 });
                }
            }
        }

        // If there are non-empty minTrainIndicesForRoutes arrays, fillIndices becomes
        // a list of the lowest indices. That list, together with the minTrainIndicesForRoutes,
        // brings the total number of trains returned to maxStopVisits.
        // 
        // If minTrainIndices contains only an empty list, the following will populate fillIndices
        // with the maxStopVisits lowest train indices that fit the route and direction constraints.
        fillIndices = [];
        i = 0;

        while ((routesWithMoreThanMin.length) && (countOfRequiredTrains < maxStopVisits)) {
            // Seeking the lowest remaining train index number within routesWithMoreThanMin.
            if (i >= routesWithMoreThanMin.length) {
                i = 0;
            }

            next_fill_train = reqTrainsByRoute[routesWithMoreThanMin[i].arrIndex][routesWithMoreThanMin[i].offset];

            // If we have exhausted a list, remove it from consideration.
            if (++(routesWithMoreThanMin[i].offset) === reqTrainsByRoute[routesWithMoreThanMin[i].arrIndex].length) {
                routesWithMoreThanMin.splice(i, 1);
            }

            // Don't count the mysterious nulls and undefineds.
            if ((typeof next_fill_train) === 'string') {
                fillIndices.push(next_fill_train);
                ++countOfRequiredTrains;

                ++i;
            }
        }
        minTrainsForRoutes.push(fillIndices);

        // Put all the train indices into a single array.
        requestedTrains = minTrainsForRoutes.reduce(function (acc, arr) { return acc.concat(arr); }, []);

    } else { //Under the max limit, just concat the arrays.
        requestedTrains = reqTrainsByRoute.reduce(function (acc, arr) { return acc.concat(arr); }, []);
    }

    // From trainIndices to train_ids.
    return requestedTrains;
}




function getRequestedTrainsForStopMonitoringResponse (stop_id, getParams) {
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
        countOfRequiredTrains,
        minTrainIndicesForRoutes,

        fillIndices,
        minIndex,
        minRoute,
        train_index,
        routeMin,
        reqTrainIndices,

        reqTrainIndicesByRoute,

        i;

    indexNodeForStop = this.bufferedCalls.stopIDToCallNumberForTrain[stop_id];

    // Get the OperatorRef
    // Check route_id to see if it begins with OperatorRef
    // If not, append OperatorRef to the route_id.
    // Will need to index/filter on OperatorRef as well.

    // Cases where there's nothing to do.
    if ((!indexNodeForStop) || (maxStopVisits === 0) || (operatorRef !== 'MTA')) { return []; }

    if ( route_id && !isNaN(directionRef) ) { // Both route and directionRef are specified.
        reqTrainIndicesByRoute = [ this.bufferedCalls
                                       .indicesOfTrainsSortedByETAForStopByRoute[stop_id]
                                                                                [route_id]
                                                                                [directionRef] || []];
    } else if ( route_id ) { // We have a route, but no direction.
        reqTrainIndicesByRoute = [ this.bufferedCalls.indicesOfTrainsSortedByETAForStopByRoute[stop_id]
                                                                                              [route_id] || []];
    } else if ( ! isNaN(directionRef) ) {  // Only direction specified.
        routes = Object.keys(this.bufferedCalls.indicesOfTrainsSortedByETAForStopByRoute[stop_id]) || [];

        reqTrainIndicesByRoute = routes.map(function (_route_id) { 
             return this.bufferedCalls.indicesOfTrainsSortedByETAForStopByRouteByDirection[stop_id]
                                                                                          [_route_id]
                                                                                          [directionRef] || [];
        });
    } else { // Neither route nor direction specified.
        routes = Object.keys(this.bufferedCalls.indicesOfTrainsSortedByETAForStopByRoute[stop_id]);

        reqTrainIndicesByRoute = routes.map(function (_route_id) { 
             return that.bufferedCalls.indicesOfTrainsSortedByETAForStopByRoute[stop_id][_route_id] || [];
        });
    }

    // How many trains total?
    totalStopVisits = reqTrainIndicesByRoute.reduce(function (acc, arr) { return acc + arr.length; }, 0);
    
    // Does the total number of trains exceed the max specified?
    if  ((!isNaN(maxStopVisits))  && (maxStopVisits !== null) && (totalStopVisits > maxStopVisits)) {

        // Was minStopVisitsPerLine specified? If so, it could override max.
        if ((!isNaN(minStopVisitsPerLine)) && (minStopVisitsPerLine !== null)) {
            
            // The following datastructure is used 
            //      IF the number of train required by minStopVisitsPerLine is less than maxStopVisits.
            //      In that case, we merge into reqTrainIndices those trains with the nearest ETA for the
            //      stop that aren't already included in the minStopVisitsPerLine arrays.
            //
            // [ arrIndex : <index of route in reqTrainIndicesByRoute>, 
            //   offset   : <current offset into the route's list of trains>, ]
            routesWithMoreThanMin = []; 

            // Tally of the trains known to be added to reqTrainIndicesByRoute
            countOfRequiredTrains = 0;

            // An array of arrays. The nested arrays are the trains required by the minStopVisitsPerLine.
            minTrainIndicesForRoutes = reqTrainIndicesByRoute.reduce(function (acc, indicesForRoute, i) {

                var len = indicesForRoute.length;
                
                if (len > minStopVisitsPerLine) {
                    countOfRequiredTrains += minStopVisitsPerLine;
                    routesWithMoreThanMin.push({ arrIndex : i, offset : minStopVisitsPerLine });
                } else {
                    countOfRequiredTrains += len;
                }

                if (len) {
                    acc.push(indicesForRoute.slice(0, minStopVisitsPerLine));
                }

                return acc;

            }, []);

        } else {
            // No minStopVisitsPerLine, therefore the required trains is an empty list.
            countOfRequiredTrains = 0;
            minTrainIndicesForRoutes = [[]];            

            // All non-empty lists have more than the required per route amount of zero.
            // We initialize all of them to their first element.
            routesWithMoreThanMin   = [];            
            for ( i = 0; i < reqTrainIndicesByRoute.length; ++i ) {
                if (reqTrainIndicesByRoute[i].length) {
                    routesWithMoreThanMin.push({ arrIndex : i, offset : 0 });
                }
            }
        }

        // If there are non-empty minTrainIndicesForRoutes arrays, fillIndices becomes
        // a list of the lowest indices. That list, together with the minTrainIndicesForRoutes,
        // brings the total number of trains returned to maxStopVisits.
        // 
        // If minTrainIndices contains only an empty list, the following will populate fillIndices
        // with the maxStopVisits lowest train indices that fit the route and direction constraints.
        fillIndices = [];
        while ((routesWithMoreThanMin.length) && (countOfRequiredTrains < maxStopVisits)) {
            // Initialize min and minRoute..
            minIndex = reqTrainIndicesByRoute[routesWithMoreThanMin[0].arrIndex][routesWithMoreThanMin[0].offset];
            minRoute = 0;

            // Seeking the lowest remaining train index number within routesWithMoreThanMin.
            for ( i = 1; i < routesWithMoreThanMin.length; ++i ) {
                train_index = reqTrainIndicesByRoute[routesWithMoreThanMin[i].arrIndex]
                                                    [routesWithMoreThanMin[i].offset];
                if (train_index < minIndex) {
                    minIndex = train_index;
                    routeMin = i;  
                }
            }

            fillIndices.push(minIndex);
            ++countOfRequiredTrains;

            // If we have exhausted a list, remove it from consideration.
            if (++routesWithMoreThanMin[minRoute].offset === 
                    reqTrainIndicesByRoute[routesWithMoreThanMin[minRoute].arrIndex].length) {
                routesWithMoreThanMin.splice(minRoute, 1);
            }
        }
        minTrainIndicesForRoutes.push(fillIndices);

        // Put all the train indices into a single array.
        reqTrainIndices = minTrainIndicesForRoutes.reduce(function (acc, arr) { return acc.concat(arr); }, []);

    } else { //Under the max limit, just concat the arrays.
        reqTrainIndices = reqTrainIndicesByRoute.reduce(function (acc, arr) { return acc.concat(arr); }, []);
    }

    // From trainIndices to train_ids.
    return reqTrainIndices.map(function (train_index) {
        return  that.bufferedCalls.trainsSortedByETAForStop[stop_id][train_index];
    });
}


module.exports = {
    getRequestedTrainsForVehicleMonitoringResponse : getRequestedTrainsForVehicleMonitoringResponse ,
    getRequestedTrainsForStopMonitoringResponse : getRequestedTrainsForStopMonitoringResponse ,
} ;

