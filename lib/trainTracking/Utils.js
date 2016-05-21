'use strict';
    
var turf = require('turf') ;
  

function getImmediateStopInfo (GTFS, GTFSrt, gtfsTripKey, trip_id) {
    
    var stopInfo = {
            stopId                     : null ,
            timestamp                  : null ,
            eta                        : null ,
            atStop                     : null ,
            sequenceNumber             : null ,
            distance_along_route_in_km : null
        }, 
       
        seqNumbers;
 
    var originStopId ;

    stopInfo.stopId = GTFSrt.getIDOfNextOnwardStopForTrip(trip_id);

    if (stopInfo.stopId === null) { return stopInfo; }

   // Get the most specific timestamp available.
    stopInfo.timestamp = (GTFSrt.getVehiclePositionTimestamp && GTFSrt.getVehiclePositionTimestamp(trip_id)) || 
                          GTFSrt.getTimestampForTrip(trip_id) ||
                          GTFSrt.getTimestampForFeedMessage() ;

    stopInfo.eta = GTFSrt.getExpectedArrivalTimeAtStopForTrip(trip_id, stopInfo.stopId);

    stopInfo.atStop = (stopInfo.eta !== null) ? (stopInfo.eta <= stopInfo.timestamp) : null ;

    stopInfo.sequenceNumber = parseInt(GTFSrt.getCurrentStopSequenceForTrip(trip_id));

    if (isNaN(stopInfo.sequenceNumber)) {
        seqNumbers = GTFS.getSequenceNumbersForStopForTrip(trip_id, stopInfo.stopId);
        
        stopInfo.sequenceNumber = parseInt(Array.isArray(seqNumbers) && seqNumbers[0]);    
    }

    stopInfo.sequenceNumber = (!isNaN(stopInfo.sequenceNumber)) ? stopInfo.sequenceNumber : null;

    stopInfo.distance_along_route_in_km = 
        GTFS.getStopDistanceAlongRouteForTripInKilometers(gtfsTripKey, stopInfo.stopId);


    //if (!stopInfo.atStop) { // Seems like safe assumptions...
    if (stopInfo.atStop === null) { // Seems like safe assumptions...

        originStopId = GTFS.getOriginStopIdForTrip(gtfsTripKey);

        if (originStopId === stopInfo.stopId) {
            stopInfo.atStop = true;
            stopInfo.sequenceNumber = parseInt(stopInfo.sequenceNumber);
            if (isNaN(stopInfo.sequenceNumber)) {
                stopInfo.sequenceNumber = 1;
            }
        }
    }
                         
    return stopInfo;
}


function getGeoJSONPointForStopForTrip (_GTFS, gtfsTripKey, stop_id) {
    var coords                       = _GTFS.getSnappedCoordinatesOfStopForTrip(gtfsTripKey, stop_id),
        start_dist_along_route_in_km = _GTFS.getStopDistanceAlongRouteForTripInKilometers(gtfsTripKey, stop_id),
        properties;

    if ( ! Array.isArray(coords) ) {
        throw new Error('For trip ' + gtfsTripKey + ', no snapped_coords for ' + stop_id + '.\n');
    }

    properties = { 
        gtfsTripKey                  : gtfsTripKey                  ,
        end_stop_id                  : stop_id                      ,
        distance_from_call           : 0                            ,
        bearing                      : undefined                    ,
        start_dist_along_route_in_km : start_dist_along_route_in_km ,
    };
 
    return turf.point(coords, properties);
}

function getLineStringBetweenStopsForTrip (_GTFS, gtfsTripKey, immediateStopId, subsequentStopId) {

    var immediateStop_shapeSegNum ,
        subsequentStop_shapeSegNum ,
        waypoints ,
        pathCoords ,
        immediateStop_coords ,
        subsequentStop_coords ,
        mtaBearing ,
        start_dist_along_route_in_km ,
        distance_from_call ,
        properties ,
        linestring = null ;


    immediateStop_coords = _GTFS.getSnappedCoordinatesOfStopForTrip(gtfsTripKey, immediateStopId);
    subsequentStop_coords = _GTFS.getSnappedCoordinatesOfStopForTrip(gtfsTripKey, subsequentStopId);

    if ( ! Array.isArray(immediateStop_coords) ) {
        throw new Error('No snapped_coords for immediateStop ' + immediateStopId + '.\n');
    } else if ( ! Array.isArray(subsequentStop_coords) ) {
        throw new Error('No snapped_coords for subsequentStop_coords ' + subsequentStopId + '.\n');
    } 


    immediateStop_shapeSegNum = _GTFS.getShapeSegmentNumberOfStopForTrip(gtfsTripKey, immediateStopId);
    subsequentStop_shapeSegNum    = _GTFS.getShapeSegmentNumberOfStopForTrip(gtfsTripKey, subsequentStopId);


    if ( isNaN(immediateStop_shapeSegNum) ) {
        throw new Error('No trip shape segment number for immediateStop ' + immediateStopId + '.\n');
    } else if ( isNaN(subsequentStop_shapeSegNum) ) {
        throw new Error('No trip shape segment number for subsequentStop ' + subsequentStopId + '.\n');
    } else if ( immediateStop_shapeSegNum > subsequentStop_shapeSegNum ) {
        throw new Error('immediateStop follows subsequentStop in the indexed data.\n');
    }

    // a shapeSegmentNum of X begins at the Xth point and ends at the (X+1)th point. 
    // so shape[X] is the start point, shape[X+1] is the end point of shape segment X.
    waypoints = _GTFS.getSliceShapeForTrip(gtfsTripKey, 
                                          immediateStop_shapeSegNum + 1, 
                                          subsequentStop_shapeSegNum);

    if ( waypoints === null ) { 
        throw new Error('Unable to get waypoints for ' + gtfsTripKey + ' between ' + 
                        immediateStopId  + ' and ' + subsequentStopId +'.\n'); 
    }

    // The linestring needs to start at immediateStop and end at subsequentStop.
    pathCoords = waypoints.reduce(function (acc, waypoint) { 
        acc.push([waypoint.longitude, waypoint.latitude]);
        return acc;
    }, [ immediateStop_coords ]);

    pathCoords.push(subsequentStop_coords);
    

    // How far along the route is immediateStop?
    start_dist_along_route_in_km = _GTFS.getStopDistanceAlongRouteForTripInKilometers(gtfsTripKey, 
                                                                                      immediateStopId);
    mtaBearing = getMTABearing(immediateStop_coords, pathCoords[1]);
    
    // The properties for the geojson LineString.
    properties = { 
        gtfsTripKey                  : gtfsTripKey                  ,
        end_stop_id                  : subsequentStopId             ,
        distance_from_call           : distance_from_call           ,
        bearing                      : mtaBearing                   ,
        start_dist_along_route_in_km : start_dist_along_route_in_km ,
    };
    
    // Create the linestring between immediateStop and subsequentStop.
    linestring = turf.linestring(pathCoords, properties);

    // Add the line_distance_km property. 
    // Represents the distance between the linestring's start and end points.
    linestring.properties.line_distance_km = turf.lineDistance(linestring, 'kilometers');


    return linestring;
}


function advancePositionAlongLineString (_GTFS, linestring, ratioCovered) {
    var kilometersCovered ,
        newStartPoint ,
        endPoint ,
        slice ;


    // These throw errors if the parameters are invalid.
    verifyLineStringParameterForAdvancePositionAlongLineString(linestring);
    verifyRatioCoveredParameterForAdvancePositionAlongLineString(linestring, ratioCovered);

    // Distance covered along the current linestring.
    kilometersCovered = getKilometersCoveredForAdvancePositionAlongLineString(_GTFS, linestring, ratioCovered);

    // Where is the train now?
    newStartPoint = turf.along(linestring, kilometersCovered, 'kilometers') ;

    // Endpoint of the line string.
    endPoint = turf.point(linestring.geometry.coordinates[linestring.geometry.coordinates.length - 1]) ;

    // Slice the LineString so that it represents the new span between the 
    // current infered location and the next stop along the route.
    slice = turf.lineSlice(newStartPoint, endPoint, linestring) ;

    //Update the bearing
    if (slice.geometry.coordinates.length > 1) {
        // Get the bearing between the starting point and the first waypoint.
        linestring.properties.bearing = getMTABearing(slice.geometry.coordinates[0], slice.geometry.coordinates[1]);
    } else {
        // The LineString is now a point. Bearing makes no sense.
        linestring.properties.bearing = undefined;
    }

    // Replace the parameter LineString's coordinates with the slice's.
    linestring.geometry.coordinates = slice.geometry.coordinates;

    // Update the train's distance along the route.
    linestring.properties.start_dist_along_route_in_km  += kilometersCovered;

    // Store the LineString's distance in the properties.
    // We subtract the distance covered from the linestring's length.
    // Correctness obviously depends on the constraint that ratioCovered in range (0,1).
    linestring.properties.line_distance_km = linestring.properties.line_distance_km - kilometersCovered;

}


function extendLinestringToFurtherStopForTrip (_GTFS, linestring, newSubsequentStop_id) {
    var oldSubsequentStop_id ,
        oldSubsequentStop_segNum ,
        newSubsequentStop_segNum ,
        newSubsequentStop_coords ,
        waypoints ,

        endStopDistanceAlongRouteKm ;

    var errorString = '';


    if (!(linestring.geometry && linestring.geometry.coordinates && linestring.geometry.coordinates.length)) { 
        throw new Error('linestring parameter passed to extendLinestringToFurtherStopForTrip has no coordinates.\n');
    } else if ( ! (linestring.properties && linestring.properties.end_stop_id) ) {
        throw new Error ('The linestring argument to extendLinestringToFurtherStopForTrip ' + 
                       'must have a nonempty properties.end_stop_id.');
    }

    // The old endpoint stop_id of the LineString.
    oldSubsequentStop_id = linestring.properties.end_stop_id;

    newSubsequentStop_coords =
        _GTFS.getSnappedCoordinatesOfStopForTrip(linestring.properties.gtfsTripKey, newSubsequentStop_id);

    oldSubsequentStop_segNum = _GTFS.getShapeSegmentNumberOfStopForTrip(oldSubsequentStop_id);
    newSubsequentStop_segNum = _GTFS.getShapeSegmentNumberOfStopForTrip(newSubsequentStop_id);

    if ( ! Array.isArray(newSubsequentStop_coords) ) {
        errorString += ('No snapped_coords for immediateStop ' + newSubsequentStop_id + '.\n');
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
    waypoints = _GTFS.getSliceShapeForTrip(linestring.properties.gtfsTripKey, 
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
    //linestring.properties.line_distance_km = turf.lineDistance(linestring, 'kilometers');

    endStopDistanceAlongRouteKm = 
        _GTFS.getStopDistanceAlongRouteForTripInKilometers(linestring.properties.gtfsTripKey,
                                                           linestring.properties.end_stop_id);

    linestring.properties.line_distance_km = 
            endStopDistanceAlongRouteKm - linestring.properties.start_dist_along_route_in_km ;

        

    // The following newly added property is used to handle the following case:
    //      We extend the line beyond a stop, but then the computed ratioCovered places the train
    //      before this stop. We know that we must advance the train at least past 
    //      the previous endpoint stop (or else, there was no reason to extend the LineString).
    linestring.properties.penultimate_stop_id = 
            _GTFS.getPreviousStopIDOfStopForTrip(linestring.properties.gtfsTripKey, 
                                                                       newSubsequentStop_id);
}



function verifyLineStringParameterForAdvancePositionAlongLineString (linestring) {
    // Make sure that we've got the minimum LineString properties to proceed.
    if ( ! linestring ) {
        throw new Error('Bad linestring parameter passed to advancePositionAlongLineString.\n');
    } else if ( ! linestring.geometry ) {
        throw new Error('linestring parameter passed to advancePositionAlongLineString must be a GeoJSON object.\n');
    } else if ( linestring.geometry.type !== 'LineString' ) {
        if ( linestring.geometry.type === 'Point' ) {
            throw new Error('linestring parameter passed to advancePositionAlongLineString must be ' +
                            'a GeoJSON LineString.\nA GeoJSON point was passed instead. This may '   +
                            'have happened because the previous location was erroneously assumed '   +
                            'have been the destination.');
        }
        throw new Error('linestring parameter passed to advancePositionAlongLineString ' + 
                        'must be a GeoJSON LineString.\n');
    } else if ( !(Array.isArray(linestring.geometry.coordinates) && linestring.geometry.coordinates.length) ) {
        throw new Error('linestring parameter passed to advancePositionAlongLineString must have coordinates.\n');
    } else if ( !linestring.properties ) {
        throw new Error('linestring parameter have properties.\n');
    } else if ((linestring.properties.gtfsTripKey === null) || (linestring.properties.gtfsTripKey === undefined)) {
        throw new Error('linestring parameter must have properties.gtfsTripKey.\n');
    } else if ( isNaN(linestring.properties.start_dist_along_route_in_km) ) {
        throw new Error('linestring parameter must have properties.start_dist_along_route_in_km.\n');
    } else if ( linestring.properties.start_dist_along_route_in_km < 0 ) {
        throw new Error('linestring parameter\'s properties.start_dist_along_route_in_km is negative.\n');
    } else if ( isNaN(linestring.properties.line_distance_km) ) {
        throw new Error('linestring parameter must have properties.line_distance_km.\n');
    } else if ( linestring.properties.line_distance_km < 0 ) {
        throw new Error('linestring parameter\'s properties.line_distance_km is negative.\n');
    }
}

function verifyRatioCoveredParameterForAdvancePositionAlongLineString(linestring, ratioCovered) {
    // Make sure that we've got a valid ratioCovered.
    if ( (ratioCovered === null) || isNaN(ratioCovered) ) { 
        throw new Error('Bad ratioCovered parameter passed to advanceTrainAlongLineStringBetweenStops\n');
    } else if (ratioCovered > 1) {
        throw new Error('RatioCovered parameter passed to advanceTrainAlongLineStringBetweenStops is greater than 1.\n' +
                        'This breaks an invariant. If we are beyond the stop, we should have a new immediate next stop.\n');
    } else if (ratioCovered < 0) {
        throw new Error('Negative ratioCovered parameter passed to advanceTrainAlongLineStringBetweenStops\n');
    } else if ((ratioCovered !== 0) && (linestring.geometry.coordinates.length < 2)) {
        // We've moved away from a point. We don't know where the train is.  
        // We don't want to stay on a point that we know does not represent the train's location.
        throw new Error('The train moved, but the previous GeoJSON LineString had only one set of coordinates ' +
                        'in the geometry.coordinate. Since the train moved away from a point, we have no clue where it is.');
    }
}

// Assumes parameters aleady verified.
function getKilometersCoveredForAdvancePositionAlongLineString (_GTFS, linestring, ratioCovered) {
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
            _GTFS.getStopDistanceAlongRouteForTripInKilometers(linestring.properties.gtfsTripKey,
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


/** "Vehicle bearing: 0 is East, increments counter-clockwise." 
 *  http://www.movable-type.co.uk/scripts/latlong.html#bearing
 */
function getMTABearing (coords_1, coords_2) {
    // Convert the start and endpoint coords into geojson points so we can use them in the turf bearing function.
    var pt_0 = turf.point(coords_1),
        pt_1 = turf.point(coords_2),

        turfBearing = turf.bearing(pt_0, pt_1);

    return ((turfBearing + 360) % 360) - 90;
}

module.exports = {
    getImmediateStopInfo                 : getImmediateStopInfo ,
    getLineStringBetweenStopsForTrip     : getLineStringBetweenStopsForTrip ,
    advancePositionAlongLineString       : advancePositionAlongLineString ,
    extendLinestringToFurtherStopForTrip : extendLinestringToFurtherStopForTrip ,
    getGeoJSONPointForStopForTrip        : getGeoJSONPointForStopForTrip ,
};
