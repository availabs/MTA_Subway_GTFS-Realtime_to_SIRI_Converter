"use strict";


var async     = require('async'),

    msgChunks   = require('./CachedMessageTemplateChunks') ,
    timeUtils   = require('MTA_Subway_GTFS-Realtime_Toolkit').TimeUtils ,

    jsontoxml = require('jsontoxml') ;


function applyTimestamps (deliveryType, dataFormat, res) {
    var responseTimestamp = new Buffer(timeUtils.getTimestamp());

    responseTimestamp.copy(res, msgChunks.firstTimestampOffset[deliveryType][dataFormat]);
    responseTimestamp.copy(res, msgChunks.secondTimestampOffset[deliveryType][dataFormat]);
}



// Handling of the different deliveryTypes handled 
// when binding the context for this function's this.
function initTheResponseBuffer (overallLen, callback) {
    /* jshint validthis:true */

    try {
        var offset = 0;

        this.respBuffer = new Buffer(overallLen);
        this.respBuffer.fill(); // This is simply so bugs don't leak out old data that's in the memory.

        offset += this.responseChunks.beginResponse.copy(this.respBuffer);
        offset += msgChunks.responseTimestampLength; //This is copied in later so that buffer may be reused.
        offset += this.responseChunks.afterFirstResponseTimestamp.copy(this.respBuffer, offset);
        offset += this.responseChunks.startDelivery.copy(this.respBuffer, offset);
        offset += msgChunks.responseTimestampLength; //This is copied in later so that buffer may be reused.
        offset += this.responseChunks.afterSecondResponseTimestamp.copy(this.respBuffer, offset);
        offset += this.validUntil.copy(this.respBuffer, offset);
        offset += this.responseChunks.afterValidUntil.copy(this.respBuffer, offset);
        offset += this.responseChunks.startTripsData.copy(this.respBuffer, offset);

        callback(null, this.respBuffer, offset);

    } catch (e) {
        console.error(e.stack || e);
        callback(e);
    }
}


function buildResponse (requestedTripKeys, 
                        deliveryType,         /* stopMonitoring or vehicleMonitoring */
                        detailLevel,          /* normal/null/undefined or calls */ 
                        maxOnwardCalls, 
                        stop_id,              /* null for VehicleMonitoring */
                        includeSituationExchange,
                        dataFormat, 
                        respCallback) {

    /* jshint validthis: true */

    var responseChunks = msgChunks.responseLevel[deliveryType][dataFormat],
        respBuffer;

    // FIXME: need defense. Potential for server crash due to out-of-memory  
    var memoizationKey = requestedTripKeys.slice().sort().join('|') + '||' + 
                         Array.prototype.slice.call(arguments).slice(1,7).join('|');

    var memo;

    var context;
    
    //var totalCalls = 0;


    if ( this.responseCache[memoizationKey] ) {
        memo = this.responseCache[memoizationKey][0];
        if ((memo === undefined) || ((typeof memo) === 'function')) {
            this.responseCache[memoizationKey].push(respCallback);
        } else {
            respCallback.apply(null, this.responseCache[memoizationKey]);
        }
        return;
    } else {
        this.responseCache[memoizationKey] = [];
    }


    context = Object.create(this);

    context.requestedTripKeys        = requestedTripKeys ;
    context.deliveryType             = deliveryType ;
    context.detailLevel              = detailLevel ;
    context.maxOnwardCalls           = maxOnwardCalls ;
    context.stop_id                  = stop_id ;
    context.includeSituationExchange = includeSituationExchange ;
    context.dataFormat               = dataFormat ;
    context.respCallback             = respCallback ;
    context.memoizationKey           = memoizationKey ;
    context.responseChunks           = responseChunks ;
    context.respBuffer               = respBuffer ;

    /* getLengthOfResponse -> initTheResponseBuffer -> pipeTripKeys -> pipeSituationExchange -> finito */
    var tasks = requestedTripKeys.reduce(function (acc, gtfsTripKey) { 
                    acc.push(pipeTrip.bind(context, gtfsTripKey)); 
                    return acc; 
                }, [getLengthOfResponse.bind(context), initTheResponseBuffer.bind(context)]);
    
    tasks.push(pipeSituationExchange.bind(context));

    async.waterfall(tasks, finito.bind(context));
}


function getLengthOfResponse (callback) {
    /* jshint validthis:true */

    try {
        var _this      = this ,
            minLength  = msgChunks.generalResponsePiecesLength[this.deliveryType][this.dataFormat],
            dataFormat = this.dataFormat ,
            overallLen;


        // Iterate over all tripKeys.
        overallLen = this.requestedTripKeys.reduce(function (acc, gtfsTripKey) {

            var metadata      = _this.bufferedMonitoredVehicleJourneys.byTripKeysIndex[dataFormat][gtfsTripKey],
                journeyLength = metadata[1],

                monitoredCallLen,
                onwardCallsLen,

                callMetadata,
                monitoredCallNumber,
                onwardCalls,
                stopCallNumberForTrip,
                firstOnwardCall,
                lastOnwardCall,
                lastOnwardCallIndex;

            if (dataFormat === 'json') { journeyLength -= 2; }

            // Does this trip have calls?
            if (_this.bufferedCalls.byTripKeysIndex[dataFormat][gtfsTripKey] && 
                _this.bufferedCalls.byTripKeysIndex[dataFormat][gtfsTripKey].length ) {
                

                if (_this.deliveryType === 'stopMonitoring') {
                    monitoredCallNumber = _this.bufferedCalls.stopIDToCallNumberForTripKey[_this.stop_id][gtfsTripKey];
                } else {
                    monitoredCallNumber = 0;
                }

                //FIXME: defense
                callMetadata = _this.bufferedCalls.byTripKeysIndex[dataFormat][gtfsTripKey][monitoredCallNumber] ||{};

                if (callMetadata.length) {
                    monitoredCallLen = msgChunks.perJourney[dataFormat].startNonemptyMonitoredCall.length + 
                                       callMetadata.length;
                } else {
                    monitoredCallLen = msgChunks.perJourney[dataFormat].emptyMonitoredCall.length;
                }
                

                if (dataFormat === 'json') { --monitoredCallLen; }

                 // Get the offsets and lengths for the tripKeys calls.
                onwardCalls = _this.bufferedCalls.byTripKeysIndex[dataFormat][gtfsTripKey] || [];

                // Do we include calls? 
                // All StopMonitoring get calls, VehicleMonitoring only if detailLevel equals calls.
                if ( onwardCalls.length && 
                        _this.maxOnwardCalls && 
                        ((_this.deliveryType === 'stopMonitoring') || (_this.detailLevel === 'calls'))) {

                    // apply the maxOnwardCalls limit 
                    lastOnwardCallIndex = (_this.maxOnwardCalls < onwardCalls.length) ?  
                        (_this.maxOnwardCalls - 1) : (onwardCalls.length - 1);
                    // In this case, we must include the calls the trip will make up to, 
                    // and including, the selected stop.
                    if ((_this.deliveryType === 'stopMonitoring') && (_this.detailLevel !== 'calls')) {

                        stopCallNumberForTrip = 
                            _this.bufferedCalls.stopIDToCallNumberForTripKey[_this.stop_id][gtfsTripKey];

                        if (lastOnwardCallIndex < stopCallNumberForTrip) { 
                            lastOnwardCallIndex = stopCallNumberForTrip; 
                        }
                    } 

                    firstOnwardCall = onwardCalls[0];
                    lastOnwardCall  = onwardCalls[lastOnwardCallIndex];

                    onwardCallsLen = msgChunks.perJourney[dataFormat].startNonemptyOnwardCalls.length +
                                     (((lastOnwardCall.offset + lastOnwardCall.length) - firstOnwardCall.offset)) +
                                     msgChunks.perJourney[dataFormat].endNonemptyOnwardCalls.length;

                    if (dataFormat === 'json') { --onwardCallsLen; }

                } else {
                    onwardCallsLen = msgChunks.perJourney[dataFormat].emptyOnwardCalls.length;
                }
             } else {
                monitoredCallLen = msgChunks.perJourney[dataFormat].emptyMonitoredCall.length;
                onwardCallsLen = msgChunks.perJourney[dataFormat].emptyOnwardCalls.length;
             }

            acc += journeyLength + monitoredCallLen + onwardCallsLen;

            return acc;

        }, minLength);

        // In pipeSituationExchange
        if (this.requestedTripKeys.length && (dataFormat === 'json')) {
            --overallLen; //last comma
        }

        if (this.includeSituationExchange) {
            overallLen += this.bufferedSituationExchange.situationExchangeDelivery[dataFormat].length;
        }

        callback(null, overallLen);

    } catch (e) {
        console.error(e.stack || e);
        callback(e);
    }
}



// Handling of the different deliveryTypes handled 
// when binding the context for this function's this.
function initTheResponseBuffer (overallLen, callback) {
    /* jshint validthis:true */

    try {
        var offset = 0;

        this.respBuffer = new Buffer(overallLen);
        this.respBuffer.fill(); // This is simply so bugs don't leak out old data that's in the memory.

        offset += this.responseChunks.beginResponse.copy(this.respBuffer);
        offset += msgChunks.responseTimestampLength; //This is copied in later so that buffer may be reused.
        offset += this.responseChunks.afterFirstResponseTimestamp.copy(this.respBuffer, offset);
        offset += this.responseChunks.startDelivery.copy(this.respBuffer, offset);
        offset += msgChunks.responseTimestampLength; //This is copied in later so that buffer may be reused.
        offset += this.responseChunks.afterSecondResponseTimestamp.copy(this.respBuffer, offset);
        offset += this.validUntil.copy(this.respBuffer, offset);
        offset += this.responseChunks.afterValidUntil.copy(this.respBuffer, offset);
        offset += this.responseChunks.startTripsData.copy(this.respBuffer, offset);

        callback(null, this.respBuffer, offset);

    } catch (e) {
        console.error(e.stack || e);
        callback(e);
    }
}




function pipeTrip (gtfsTripKey, respBuffer, offset, callback) {
    /* jshint validthis: true */

    try {
        var dataFormat = this.dataFormat ,
            metadata   = this.bufferedMonitoredVehicleJourneys.byTripKeysIndex[dataFormat][gtfsTripKey],

            dataOffset = metadata[0],
            len        = metadata[1],

            callMetadata,
            onwardCalls,
            monitoredCallNumber,
            stopCallNumberForTrip,
            firstOnwardCall,
            lastOnwardCall,
            lastOnwardCallIndex,
            callOffset,
            callLen; 

        // Copy the beginning chunk of the trip's journey data.
        offset += this.bufferedMonitoredVehicleJourneys
                      .bufferedJourneys[dataFormat].copy(respBuffer, offset, dataOffset, dataOffset + len);

        if (dataFormat === 'json') {
            //TODO If this is legit, need to -2 in getLengthOfResponse.
            offset -=2; //2 parens that end the MonitoredVehicleJourney 
        }

        // Does this trip have calls?
        if (this.bufferedCalls.byTripKeysIndex[dataFormat][gtfsTripKey] && 
            this.bufferedCalls.byTripKeysIndex[dataFormat][gtfsTripKey].length ) {
                
            // Copy the beginning of the Monitored call
            offset += msgChunks.perJourney[dataFormat].startNonemptyMonitoredCall.copy(respBuffer, offset);


            if (this.deliveryType === 'stopMonitoring') {
                monitoredCallNumber = this.bufferedCalls.stopIDToCallNumberForTripKey[this.stop_id][gtfsTripKey];
            } else {
                monitoredCallNumber = 0;
            }

            //FIXME: defense
            callMetadata = this.bufferedCalls.byTripKeysIndex[dataFormat][gtfsTripKey][monitoredCallNumber]; 

            // The bufferedCalls data for the MonitoredCall
            callOffset   = callMetadata.offset;
            callLen      = callMetadata.length;

            // Copy the MonitoredCall into the buffer.
            offset += this.bufferedCalls.calls[dataFormat]
                                        .copy(respBuffer, offset, callOffset, callOffset + callLen);

            if (dataFormat === 'json') {
                --offset; //Comma.
            }

            // Get the offsets and lengths for the tripKeys calls.
            onwardCalls = this.bufferedCalls.byTripKeysIndex[dataFormat][gtfsTripKey] || [];

            // Do we include calls? 
            // Is maxOnwardCalls > 0? 
            // If so, all StopMonitoring get calls, VehicleMonitoring only if detailLevel equals calls.
            if ( onwardCalls.length  && 
                 this.maxOnwardCalls && 
                 ((this.deliveryType === 'stopMonitoring') || (this.detailLevel === 'calls'))
               ) {

                offset += msgChunks.perJourney[dataFormat].startNonemptyOnwardCalls.copy(respBuffer, offset);
                
                // apply the maxOnwardCalls limit 
                lastOnwardCallIndex = (this.maxOnwardCalls < onwardCalls.length) ? 
                    (this.maxOnwardCalls - 1) : (onwardCalls.length - 1);
                // In this case, we must include the calls the trip will make up to, 
                // and including, the selected stop.
                if ((this.deliveryType === 'stopMonitoring') && (this.detailLevel !== 'calls')) {
                    stopCallNumberForTrip = 
                        this.bufferedCalls.stopIDToCallNumberForTripKey[this.stop_id][gtfsTripKey];

                    if (lastOnwardCallIndex < stopCallNumberForTrip) {
                        lastOnwardCallIndex = stopCallNumberForTrip;
                    }
                }

                firstOnwardCall = onwardCalls[0];
                lastOnwardCall  = onwardCalls[lastOnwardCallIndex];

                //totalCalls += lastOnwardCallIndex + 1;
                offset += this.bufferedCalls.calls[dataFormat]
                                            .copy(respBuffer,  offset, 
                                                  firstOnwardCall.offset, 
                                                  lastOnwardCall.offset + lastOnwardCall.length);

                if (dataFormat === 'json') { --offset; }


                offset += msgChunks.perJourney[dataFormat].endNonemptyOnwardCalls.copy(respBuffer, offset);

            } else {
                offset += msgChunks.perJourney[dataFormat].emptyOnwardCalls.copy(respBuffer, offset);
            }

         } else {
            offset += msgChunks.perJourney[dataFormat].emptyMonitoredCall.copy(respBuffer, offset);
            offset += msgChunks.perJourney[dataFormat].emptyOnwardCalls.copy(respBuffer, offset);
         }
       
        callback(null, respBuffer, offset);

    } catch (e) {
        console.error(e.stack || e);
        callback(e);
    }
}


function pipeSituationExchange (respBuffer, offset, callback) {
    /* jshint validthis: true */

    try {
        if (this.requestedTripKeys.length && (this.dataFormat === 'json')) {
            --offset; //last comma
        }
        offset += this.responseChunks.endTripsData.copy(respBuffer, offset); 
        offset += this.responseChunks.beginSituationExchange.copy(respBuffer, offset);

        if (this.includeSituationExchange) {
            offset += this.bufferedSituationExchange
                          .situationExchangeDelivery[this.dataFormat].copy(respBuffer, offset);
        }

        callback(null, respBuffer, offset);

    } catch (e) {
        console.error(e.stack || e);
        callback(e);
    }
}



function finito (err, respBuffer, offset) {
    /* jshint validthis: true */

    var queue = this.responseCache[this.memoizationKey], 
        toMemoize,
        i;

    if (err) {
        toMemoize = [err, null];
    } else {
        try {
            offset += this.responseChunks.endResponse.copy(respBuffer, offset); 
            toMemoize = [null, respBuffer];

            if (offset !== respBuffer.length) { 
                console.log("####### Buffer length != offset ######", offset, ':', respBuffer.length, "\n"); 
            }

        } catch (e) {
            console.error(e.stack || e);
            toMemoize = [e, null];
        } 
    } 

    this.responseCache[this.memoizationKey] = toMemoize;

    this.respCallback.apply(null, toMemoize);

    // Clear the queue.
    if (Array.isArray(queue) && queue.length && (typeof queue[0] === 'function')) {
        for ( i = 0; i < queue.length; ++i) {
            queue[i].apply(null, toMemoize);
        }
    }
}


function buildErrorResponse (errorCondition, deliveryType, dataFormat, respCallback) {

    var responseChunks = msgChunks.errorResponse[deliveryType][dataFormat] ,
        baseLength = msgChunks.errorResponsePiecesLength[deliveryType][dataFormat] ,
        stringifiedErrorCondition ,

        errorConditionLength ,
        errorConditionBuffer ,

        overallLen,
        
        respBuffer ,

        offset ;


    if (dataFormat === 'json') {
        stringifiedErrorCondition = JSON.stringify(errorCondition) ;
        stringifiedErrorCondition = stringifiedErrorCondition.substring(1, stringifiedErrorCondition.length -1);
    } else {
        stringifiedErrorCondition = jsontoxml(errorCondition) ;
    }


    errorConditionLength = stringifiedErrorCondition.length ;

    errorConditionBuffer = new Buffer(stringifiedErrorCondition);

    overallLen = baseLength + errorConditionLength ;

    respBuffer = new Buffer(overallLen);
    respBuffer.fill(); // This is simply so bugs don't leak out old data that's in the memory.

    offset = 0;
    offset += responseChunks.beginResponse.copy(respBuffer, offset);
    offset += msgChunks.responseTimestampLength; //This is copied in later so that buffer may be reused.
    offset += responseChunks.afterFirstResponseTimestamp.copy(respBuffer, offset);
    offset += responseChunks.startDelivery.copy(respBuffer, offset);
    offset += msgChunks.responseTimestampLength; //This is copied in later so that buffer may be reused.
    offset += responseChunks.afterSecondResponseTimestamp.copy(respBuffer, offset);
    offset += errorConditionBuffer.copy(respBuffer, offset);
    offset += responseChunks.endResponse.copy(respBuffer, offset);


    if (offset !== respBuffer.length) { 
        console.log("####### Buffer length != offset ######", offset, ':', respBuffer.length, "\n"); 
    }

    respCallback(null, respBuffer) ;
}


module.exports = {
    buildResponse      : buildResponse ,
    buildErrorResponse : buildErrorResponse ,
    applyTimestamps    : applyTimestamps ,
};
