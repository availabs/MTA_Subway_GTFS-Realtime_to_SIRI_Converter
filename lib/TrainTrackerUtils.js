'use strict';
    
var turf = require('turf') ,
    _    = require('lodash');

  


function getGeoJSONPointForStopForTrip (_GTFS, gtfsTripKey, stop_id) {
    var coords                       = _GTFS.getSnappedCoordinatesOfStopForTrip(gtfsTripKey, stop_id),
        start_dist_along_route_in_km = _GTFS.getStopDistanceAlongRouteForTripInKilometers(gtfsTripKey, stop_id),
        properties;

    if ( ! Array.isArray(coords) ) {
        throw new Error('For trip ' + gtfsTripKey + ', no snapped_coords for ' + stop_id + '.\n');
    }

    properties = { 
        _GTFS                        : _GTFS                        ,
        gtfsTripKey                  : gtfsTripKey                  ,
        end_stop_id                  : stop_id                      ,
        distance_from_call           : 0                            ,
        bearing                      : undefined                    ,
        start_dist_along_route_in_km : start_dist_along_route_in_km ,
    };
 
    return turf.point(coords, properties);
}

function getLineStringBetweenStopsForTrip (_GTFS, gtfsTripKey, immediateNextStopID, subsequentStopID) {

    var immediateNextStop_shapeSegNum ,
        subsequentStop_shapeSegNum    ,
        waypoints                     ,
        pathCoords                    ,
        immediateNextStop_coords      ,
        subsequentStop_coords         ,
        pt_0                          ,
        pt_00                         ,
        start_dist_along_route_in_km  ,
        distance_from_call            ,
        properties                    ,
        linestring = null             ;

    immediateNextStop_coords = _GTFS.getSnappedCoordinatesOfStopForTrip(gtfsTripKey, immediateNextStopID);
    subsequentStop_coords    = _GTFS.getSnappedCoordinatesOfStopForTrip(gtfsTripKey, subsequentStopID);

    if ( ! Array.isArray(immediateNextStop_coords) ) {
        throw new Error('No snapped_coords for immediateNextStop ' + immediateNextStopID + '.\n');
    } else if ( ! Array.isArray(subsequentStop_coords) ) {
        throw new Error('No snapped_coords for subsequentStop_coords ' + subsequentStopID + '.\n');
    } 

    immediateNextStop_shapeSegNum = _GTFS.getShapeSegmentNumberOfStopForTrip(gtfsTripKey, immediateNextStopID);
    subsequentStop_shapeSegNum    = _GTFS.getShapeSegmentNumberOfStopForTrip(gtfsTripKey, subsequentStopID);

    if ( isNaN(immediateNextStop_shapeSegNum) ) {
        throw new Error('No trip shape segment number for immediateNextStop ' + immediateNextStopID + '.\n');
    } else if ( isNaN(subsequentStop_shapeSegNum) ) {
        throw new Error('No trip shape segment number for subsequentStop ' + subsequentStopID + '.\n');
    } else if ( immediateNextStop_shapeSegNum > subsequentStop_shapeSegNum ) {
        throw new Error('immediateNextStop follows subsequentStop in the indexed data.\n');
    }

    // a shapeSegmentNum of X begins at the Xth point and ends at the (X+1)th point. 
    // so shape[X] is the start point, shape[X+1] is the end point of shape segment X.
    waypoints = _GTFS.getSliceShapeForTrip(gtfsTripKey, 
                                          immediateNextStop_shapeSegNum + 1, 
                                          subsequentStop_shapeSegNum);

    if ( waypoints === null ) { 
        throw new Error('Unable to get waypoints for ' + gtfsTripKey + ' between ' + 
                        immediateNextStopID  + ' and ' + subsequentStopID +'.\n'); 
    }

    // The linestring needs to start at immediateNextStop and end at subsequentStop.
    pathCoords = waypoints.reduce(function (acc, waypoint) { 
        acc.push([waypoint.longitude, waypoint.latitude]);
        return acc;
    }, [ immediateNextStop_coords ]);

    pathCoords.push(subsequentStop_coords);
    

    // How far along the route is immediateNextStop?
    start_dist_along_route_in_km = _GTFS.getStopDistanceAlongRouteForTripInKilometers(gtfsTripKey, 
                                                                                      immediateNextStopID);
    
    // Convert the start and endpoint coords into geojson points so we can use them in the turf bearing function.
    pt_0 = turf.point(immediateNextStop_coords);
    
    // For the bearing of the train, we want the bearing between immediateNextStop and the first waypoint.
    pt_00 = turf.point(pathCoords[1]);

    // The properties for the geojson LineString.
    properties = { 
        _GTFS                        : _GTFS                        ,
        gtfsTripKey                  : gtfsTripKey                  ,
        end_stop_id                  : subsequentStopID             ,
        distance_from_call           : distance_from_call           ,
        bearing                      : turf.bearing(pt_0, pt_00)    ,
        start_dist_along_route_in_km : start_dist_along_route_in_km ,
    };
    
    // Create the linestring from immediateNextStop to subsequentStop.
    linestring = turf.linestring(pathCoords, properties);

    // Add the line_distance_km property.
    linestring.properties.line_distance_km = turf.lineDistance(linestring, 'kilometers');

    return linestring;
}


function advancePositionAlongLineString (linestring, ratioCovered) {
    var kilometersCovered ,
        newStartPoint     ,
        firstWaypoint     ,
        endPoint          ,
        slice             ;


    // These throw errors if the parameters are invalid.
    verifyLineStringParameterForAdvancePositionAlongLineString(linestring);
    verifyRatioCoveredParameterForAdvancePositionAlongLineString(linestring, ratioCovered);

    kilometersCovered = getKilometersCoveredForAdvancePositionAlongLineString(linestring, ratioCovered);

    newStartPoint = turf.along(linestring, kilometersCovered, 'kilometers') ;
    endPoint      = turf.point(linestring.geometry.coordinates[linestring.geometry.coordinates.length - 1]) ;

    // Slice the LineString so that it represents the new span between the 
    // current infered location and the next stop along the route.
    slice = turf.lineSlice(newStartPoint, endPoint, linestring) ;

    //Update the bearing
    if (slice.geometry.coordinates.length > 1) {
        // Get a geojson representing the first waypoint after the LineString's starting point.
        firstWaypoint = turf.point(slice.geometry.coordinates[1]);

        // Get the bearing between the starting point and the first waypoint.
        linestring.properties.bearing = turf.bearing(newStartPoint, firstWaypoint);
    } else {
        // The LineString is now a point. Bearing makes no sense.
        linestring.properties.bearing = undefined;
    }

    // Replace the parameter LineString's coordinates with the slice's.
    linestring.geometry.coordinates = slice.geometry.coordinates;

    // Update the train's distance along the route.
    linestring.properties.start_dist_along_route_in_km  += kilometersCovered;

    // Store the LineString's distance in the properties.
    linestring.properties.line_distance_km = linestring.properties.line_distance_km - kilometersCovered;
}


function extendLinestringToFurtherStopForTrip (linestring, newSubsequentStop_id) {
    var oldSubsequentStop_id     ,
        oldSubsequentStop_segNum ,
        newSubsequentStop_segNum ,
        newSubsequentStop_coords ,
        waypoints                ;

    var errorString = '';


    if (!(linestring.geometry && linestring.geometry.coordinates && linestring.geometry.coordinates.length)) { 
        throw new Error('linestring parameter passed to extendLinestringToFurtherStopForTrip has no coordinates.\n');
    } else if ( ! (linestring.properties && linestring.properties.end_stop_id) ) {
        throw new Error ('The linestring argument to extendLinestringToFurtherStopForTrip ' + 
                       'must have a nonempty properties.end_stop_id.');
    }

    // The old endpoint stop_id of the LineString.
    oldSubsequentStop_id = linestring.properties.end_stop_id;

    newSubsequentStop_coords = linestring.properties._GTFS.getSnappedCoordinatesOfStopForTrip(linestring.properties.gtfsTripKey, newSubsequentStop_id);

    oldSubsequentStop_segNum = linestring.properties._GTFS.getShapeSegmentNumberOfStopForTrip(oldSubsequentStop_id);
    newSubsequentStop_segNum = linestring.properties._GTFS.getShapeSegmentNumberOfStopForTrip(newSubsequentStop_id);

    if ( ! Array.isArray(newSubsequentStop_coords) ) {
        errorString += ('No snapped_coords for immediateNextStop ' + newSubsequentStop_id + '.\n');
    }

    if ( isNaN(oldSubsequentStop_segNum) ) {
        errorString += ('No trip shape segment number for the oldSubsequentStop_id ' + oldSubsequentStop_id + '.\n');
    } else if ( isNaN(newSubsequentStop_segNum) ) {
        errorString += ('No trip shape segment number for the newSubsequentStop_id ' + newSubsequentStop_id + '.\n');
    } else if ( newSubsequentStop_segNum < oldSubsequentStop_segNum ) {
        errorString += ('The new subsequentStop precedes the old subsequentStop in the trip\'s shape.\n');
    }

    if (errorString) {
        throw new Error(errorString);
    }

    // We want to gather the sequence of waypoints including and in-between:
    //      * the waypoint immediately after the previous endpoint stop.
    //      * the waypoint immediately before the new endpoint stop.
    waypoints = linestring.properties._GTFS.getSliceShapeForTrip(linestring.properties.gtfsTripKey, 
                                                                 oldSubsequentStop_segNum + 1, 
                                                                 newSubsequentStop_segNum);



    // Append to the current LineString coordinates the above waypoints.
    waypoints.reduce(function (acc, waypoint) { 
        acc.push([waypoint.longitude, waypoint.latitude]);
        return acc;
    }, linestring.geometry.coordinates);

    // Append the new endpoint/stop coordinates to the LineString.
    linestring.geometry.coordinates.push(newSubsequentStop_coords);

    // Update the end_stop_id property of the LineString.
    linestring.properties.end_stop_id = newSubsequentStop_id;

    // Update the line_distance_km property.
    linestring.properties.line_distance_km = turf.lineDistance(linestring, 'kilometers');

    // The following newly added property is used to handle the following case:
    //      We extend the line beyond a stop, but then the computed ratioCovered places the train
    //      before this stop. We know that we must advance the train at least past 
    //      the previous endpoint stop (or else, there was no reason to extend the LineString).
    linestring.properties.penultimate_stop_id = 
            linestring.properties._GTFS.getPreviousStopIDOfStopForTrip(linestring.properties.gtfsTripKey, 
                                                                       newSubsequentStop_id);
}



function getSimpleStopTimeUpdatesForTrip (GTFSrt, trip_id) {
    var rawStopTimeUpdates = GTFSrt.getStopTimeUpdatesForTrip(trip_id);

    if ( ! Array.isArray(rawStopTimeUpdates) ) { return null; }

    return rawStopTimeUpdates.map(function (update) {
        return {
            stop_id : update.stop_id ,
            eta     : _.get(update, ['arrival',   'time', 'low']) ,
            etd     : _.get(update, ['departure', 'time', 'low']) ,
        };
    });
}


function verifyLineStringParameterForAdvancePositionAlongLineString (linestring) {
    // Make sure that we've got the minimum LineString properties to proceed.
    if ( ! linestring ) {
        throw new Error('Bad linestring parameter passed to advancePositionAlongLineString.\n');
    } else if ( !(linestring.geometry && (linestring.geometry.type === 'LineString')) ) {
        throw new Error('linestring parameter passed to advancePositionAlongLineString must be a GeoJSON LineString.\n');
    } else if ( !(Array.isArray(linestring.geometry.coordinates) && linestring.geometry.coordinates.length) ) {
        throw new Error('linestring parameter passed to advancePositionAlongLineString must have coordinates.\n');
    } else if ( !linestring.properties ) {
        throw new Error('linestring parameter have properties.\n');
    } else if ((linestring.properties.gtfsTripKey === null) || (linestring.properties.gtfsTripKey === undefined)) {
        throw new Error('linestring parameter have properties.gtfsTripKey.\n');
    } else if ( isNaN(linestring.properties.start_dist_along_route_in_km) ) {
        throw new Error('linestring parameter have properties.start_dist_along_route_in_km.\n');
    } else if ( isNaN(linestring.properties.line_distance_km) ) {
        throw new Error('linestring parameter must have properties.line_distance_km.\n');
    }
}

function verifyRatioCoveredParameterForAdvancePositionAlongLineString(linestring, ratioCovered) {
    // Make sure that we've got a valid ratioCovered.
    if ( (ratioCovered === null) || isNaN(ratioCovered) ) { 
        throw new Error('Bad ratioCovered parameter passed to advanceTrainAlongLineStringBetweenStops\n');
    } else if (ratioCovered < 0) {
        throw new Error('Negative ratioCovered parameter passed to advanceTrainAlongLineStringBetweenStops\n');
    } else if ((ratioCovered !== 0) && (linestring.geometry.coordinates.length < 2)) {
        // We've moved away from a point. We don't know where the train is.  
        // We don't want to stay on a point that we know does not represent the train's location.
        throw new Error('The train moved away from a point. We have no clue where it is.');
    }
}

// Assumes parameters aleady verified.
function getKilometersCoveredForAdvancePositionAlongLineString (linestring, ratioCovered) {
    // How far along the LineString the train has traveled.
    var kilometersCovered = ratioCovered * linestring.properties.line_distance_km ,

        distAlongRoute,
        minDistAlongRoute,
        minDistCovered;

    // Make sure we are always beyond the stops that we know that we have passed.
    // If the GTFS-R feed goes down for a while, and we are forced to extend the path beyond
    // a couple of stops, it may happen that the ratioCovered does not get us beyond stops
    // we know that the train has passed.
    // (We would know that we are beyond those stops if they no longer appear in the stop times updates).
    //
    // NOTE: The properties.penultimate_stop_id property is set in the extendLinestringToFurtherStopForTrip function. 
    //       It is the stop_id of the stop immediately before the LineString's endpoint stop.
    if (linestring.properties.penultimate_stop_id) {

        // What's the minimum distance along the LineString that we must advance?
        minDistAlongRoute = 
            linestring.properties._GTFS.getStopDistanceAlongRouteForTripInKilometers(linestring.properties.gtfsTripKey,
                                                                          linestring.properties.penultimate_stop_id);
        
        // If there is a minimum distance, 
        if (!isNaN(minDistAlongRoute)) {
            
            // How far along does the current kilometersCovered place us?
            distAlongRoute = linestring.properties.start_dist_along_route_in_km + kilometersCovered;

            // If distAlongRoute is insufficient, move us just a bit past the penultimate_stop.
            if (distAlongRoute < minDistAlongRoute) {
                // What's the min required distance covered?
                minDistCovered = minDistAlongRoute - linestring.properties.start_dist_along_route_in_km;
                // Fudge kilometersCovered to get us just a bit beyond the min.  FIXME: magic #.
                kilometersCovered = minDistCovered + 
                                    ((linestring.properties.line_distance_km - minDistCovered) / 100);
            }
        }
    }

    return kilometersCovered;
}


module.exports = {
    getLineStringBetweenStopsForTrip     : getLineStringBetweenStopsForTrip     ,
    advancePositionAlongLineString       : advancePositionAlongLineString       ,
    extendLinestringToFurtherStopForTrip : extendLinestringToFurtherStopForTrip ,
    getSimpleStopTimeUpdatesForTrip      : getSimpleStopTimeUpdatesForTrip      ,
    getGeoJSONPointForStopForTrip        : getGeoJSONPointForStopForTrip        ,
};
