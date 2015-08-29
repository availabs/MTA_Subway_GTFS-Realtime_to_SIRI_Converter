/**
 * @module MTA_Subway_GTFS-Realtime_to_SIRI_Converter.SituationExchangeDeliveryBuilder
 * @summary Helprt module that builds the SituationExchangeDelivery section of StopMonitoring and VehicleMonitoring Responses.
 *
 * @see [The MTA documentation.]{@link https://bustime.mta.info/wiki/Developers/SIRISituationExchangeDelivery}
 * @see [The page 72 of SIRI Handbook.]{@link http://user47094.vs.easily.co.uk/siri/schema/1.3/doc/Handbook/Handbookv15.pdf}
 *
 * From the SIRI Handbook:
 * "The SituationExchangeDelivery is returned by the SIRI-SX service and normally contains
 * one or more SituationElement instances; these will either be a BaseSituationElement or an
 * UpdateSituationElement. A Series of one ore more SituationElements describes a Situation. Each
 * SituationElement has a body (either of type PtSItuationBody or RoadSituationBody not shown)
 * which is itself made up of a number of groups of attributes and child elements (eg SituationSource, Consequence)."
 *
 * Unless otherwise noted, the quotations in the function comments are from the MTA documentation.
 * 
 */

'use strict';


var _ = require('lodash');


//TODO: Remove next line
/* jshint unused: false */


/**
 * "The SIRI SituationExchangeDelivery element only appears when there is a service alert active for a route or stop being called on. 
 *  It is used by the responses to both the VehicleMonitoring and StopMonitoring calls."
 */
function getSituationExchangeDeliveryForStop (_GTFSrt_, stop_id) {
    var serviceAlerts = null;  //get all service alerts for the stop.

    return {
        Situations : getSituations(serviceAlerts) ,  
    };
}




/**
 * "The SIRI SituationExchangeDelivery element only appears when there is a service alert active for a route or stop being called on. 
 *  It is used by the responses to both the VehicleMonitoring and StopMonitoring calls."
 */
function getSituationExchangeDeliveryForRoute (_GTFSrt_, route_id) {
    var serviceAlerts = null;  //get all service alerts for the route.

    return {
        Situations : getSituations(serviceAlerts) ,  
    };
}



/**
 * @private
 */
function getSituations (alerts) {
    return _.map(alerts, getPtSituationElement);
}



/**
 * "One each per Service Alert."
 * @private
 */
function getPtSituationElement(alert) {
    return {
        SituationNumber   : getSituationNumber(alert)   ,
        PublicationWindow : getPublicationWindow(alert) ,
        Severity          : getSeverity(alert)          ,
        Summary           : getSummary(alert)           ,
        Description       : getDescription(alert)       ,
        Affects           : getAffects(alert)           ,
    };
}


/**
 * "Unique ID."
 * @private
 */
function getSituationNumber (alert) { return null; }


/**
 * "Information on temporal applicability of the service alert."
 * @private
 */
function getPublicationWindow (alert) {
    return {
        StartTime : getStartTime(alert),
        EndTime   : getEndTime(alert),
    };
}


/**
 * "Severity of the event."
 * @private
 */
function getSeverity (alert) { return null; }


/**
 * "Summary text."
 * @private
 */
function getSummary (alert) { return null; }


/**
 * "Long description Text."
 * @private
 */
function getDescription (alert) { return null; }


/**
 * "Scope of effects." --From SIRI handbook.
 * @private
 */
function getAffects (alert) {
    return {
        VehicleJourneys : getVehicleJourneys(alert) ,
    };
}


/**
 * "Start time of Service Alert."
 * @private
 */
function getStartTime (alert) { return null; }


/**
 * "End time of Service Alert."
 * @private
 */
function getEndTime (alert) { return null; }


/**
 * "Element containing VehicleJourney lines and directions."
 * @private
 */
function getVehicleJourneys (alert) {
    var directions = getDirectionsForAlert(alert);

    return directions.map(function (direction) {
        return getAffectedVehicleJourney(alert, direction);
    });
}


/**
 * "One for each Line/Direction."
 * @private
 */
function getAffectedVehicleJourney (alert, direction) {
    return {
        LineRef : getLineRef(alert, direction),
        DirectionRef : direction,
    }; 
}


/**
 * Helper function for @link{getVehicleJourneys}
 * @private
 */
function getDirectionsForAlert (alert) { return null; }


/**
 * "GTFS Route_ID, prefixed by agency_id."
 * @private
 */
function getLineRef (alert, direction) { return null; }



module.exports = {
    getSituationExchangeDeliveryForStop  : getSituationExchangeDeliveryForStop  ,
    getSituationExchangeDeliveryForRoute : getSituationExchangeDeliveryForRoute ,
};



/*
Sample from the MTA SIRISituationExchangeDelivery documentation.
<SituationExchangeDelivery>
    <Situations>
        <! One each per Service Alert->
        <PtSituationElement>
            <! Unique ID->

          <SituationNumber>MTA NYCT_8d065d76-2813-46ee-b024-20f956232831</SituationNumber>
            <! Information on temporal applicability of the service alert->

          <PublicationWindow>
                <! Start time of Service Alert->
              <StartTime>2011-12-12T08:45:00-05:00</StartTime>
                <! End time of Service Alert>
              <EndTime>2011-12-13T08:45:00-05:00</StartTime>
          </PublicationWindow>

          <! Severity of the event>
          <Severity>undefined</Severity>


          <! Summary text>
          <Summary xml:lang="EN">The B63 is having a party!</Summary>

          <! Long description Text>
          <Description xml:lang="EN">The B63 is having a party! (SMS)</Description>


          <Affects>
              <! Element containing VehicleJourney lines and directions>
              <VehicleJourneys>
                  <! One for each Line/Direction>
                    <AffectedVehicleJourney>
                      <! GTFS Route_ID, prefixed by agency_id>
                        <LineRef>MTA NYCT_B63</LineRef>
                      <! GTFS Route direction_id >
                        <DirectionRef>1</DirectionRef>
                    </AffectedVehicleJourney>

                    <AffectedVehicleJourney>
                        <LineRef>MTA NYCT_B63</LineRef>
                      <! GTFS Opposite Route direction_id >
                        <DirectionRef>0</DirectionRef>
                    </AffectedVehicleJourney>
              </VehicleJourneys>
          </Affects>

          <Consequences>
              <Consequence>
                  <! Service alert consequence: CANCELLED, NO_SERVICE, DISRUPTED, INTERMITTENT_SERVICE, DELAYED, DIVERTED etc>
                    <Condition>altered</Condition>
              </Consequence>
          </Consequences>

        </PtSituationElement>

    </Situations>
</SituationExchangeDelivery>
*/

/*
getSituationExchangeDeliveryForStop
getSituationExchangeDeliveryForRoute
getSituations
getPtSituationElement
getSituationNumber
getPublicationWindow
getSeverity
getSummary
getDescription
getAffects
getStartTime
getEndTime
getVehicleJourneys
getAffectedVehicleJourney
getDirectionsForAlert
getLineRef
*/
