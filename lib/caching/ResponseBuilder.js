"use strict";


var async     = require('async')     ,

    msgChunks   = require('./CachedMessageTemplateChunks'),
    timeUtils   = require('MTA_Subway_GTFS-Realtime_Toolkit').TimeUtils;


function applyTimestamps (deliveryType, dataFormat, res) {
    var responseTimestamp = new Buffer(timeUtils.getTimestamp());

    responseTimestamp.copy(res, msgChunks.firstTimestampOffset[deliveryType][dataFormat]);
    responseTimestamp.copy(res, msgChunks.secondTimestampOffset[deliveryType][dataFormat]);
}


function buildResponse (requestedTrains, 
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
    var memoizationKey = requestedTrains.slice().sort().join('|') + '||' + 
                         Array.prototype.slice.call(arguments).slice(1,7).join('|');

    var memo;
    
    //var totalCalls = 0;

    var context = Object.create(this);


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

    context.requestedTrains          = requestedTrains ;
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

    /* getLengthOfResponse -> initTheResponseBuffer -> pipeTrains -> pipeSituationExchange -> finito */
    var tasks = requestedTrains.reduce(function (acc, train_id) { 
                    acc.push(pipeTrain.bind(context, train_id)); 
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


        // Iterate over all trains.
        overallLen = this.requestedTrains.reduce(function (acc, train_id) {

            var metadata      = _this.bufferedMonitoredVehicleJourneys.byTrainsIndex[dataFormat][train_id],
                journeyLength = metadata[1],

                monitoredCallLen,
                onwardCallsLen,

                callMetadata,
                monitoredCallNumber,
                onwardCalls,
                stopCallNumberForTrain,
                firstOnwardCall,
                lastOnwardCall,
                lastOnwardCallIndex;

            if (dataFormat === 'json') { journeyLength -= 2; }

            // Does this train have calls?
            if (_this.bufferedCalls.byTrainsIndex[dataFormat][train_id] && 
                _this.bufferedCalls.byTrainsIndex[dataFormat][train_id].length ) {
                

                if (_this.deliveryType === 'stopMonitoring') {
                    monitoredCallNumber = _this.bufferedCalls.stopIDToCallNumberForTrain[_this.stop_id][train_id];
                } else {
                    monitoredCallNumber = 0;
                }

                //FIXME: defense
                callMetadata = _this.bufferedCalls.byTrainsIndex[dataFormat][train_id][monitoredCallNumber] ||{};

                if (callMetadata.length) {
                    monitoredCallLen = msgChunks.perJourney[dataFormat].startNonemptyMonitoredCall.length + 
                                       callMetadata.length;
                } else {
                    monitoredCallLen = msgChunks.perJourney[dataFormat].emptyMonitoredCall.length;
                }
                

                if (dataFormat === 'json') { --monitoredCallLen; }

                 // Get the offsets and lengths for the trains calls.
                onwardCalls = _this.bufferedCalls.byTrainsIndex[dataFormat][train_id] || [];

                // Do we include calls? 
                // All StopMonitoring get calls, VehicleMonitoring only if detailLevel equals calls.
                if ( onwardCalls.length && 
                        _this.maxOnwardCalls && 
                        ((_this.deliveryType === 'stopMonitoring') || (_this.detailLevel === 'calls'))) {

                    // apply the maxOnwardCalls limit 
                    lastOnwardCallIndex = (_this.maxOnwardCalls < onwardCalls.length) ?  
                        (_this.maxOnwardCalls - 1) : (onwardCalls.length - 1);

                    // In this case, we must include the calls the train will make up to, 
                    // and including, the selected stop.
                    if ((_this.deliveryType === 'stopMonitoring') && (_this.detailLevel !== 'calls')) {

                        stopCallNumberForTrain = 
                            _this.bufferedCalls.stopIDToCallNumberForTrain[_this.stop_id][train_id];

                        if (lastOnwardCallIndex < stopCallNumberForTrain) { 
                            lastOnwardCallIndex = stopCallNumberForTrain; 
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
        if (this.requestedTrains.length && (dataFormat === 'json')) {
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
        offset += this.responseChunks.startTrainsData.copy(this.respBuffer, offset);

        callback(null, this.respBuffer, offset);

    } catch (e) {
        console.error(e.stack || e);
        callback(e);
    }
}




function pipeTrain (train_id, respBuffer, offset, callback) {
    /* jshint validthis: true */

    try {
        var dataFormat = this.dataFormat ,
            metadata   = this.bufferedMonitoredVehicleJourneys.byTrainsIndex[dataFormat][train_id],

            dataOffset = metadata[0],
            len        = metadata[1],

            callMetadata,
            onwardCalls,
            monitoredCallNumber,
            stopCallNumberForTrain,
            firstOnwardCall,
            lastOnwardCall,
            lastOnwardCallIndex,
            callOffset,
            callLen; 

        // Copy the beginning chunk of the train's journey data.
        offset += this.bufferedMonitoredVehicleJourneys
                      .bufferedJourneys[dataFormat].copy(respBuffer, offset, dataOffset, dataOffset + len);

        if (dataFormat === 'json') {
            //TODO If this is legit, need to -2 in getLengthOfResponse.
            offset -=2; //2 parens that end the MonitoredVehicleJourney 
        }

        // Does this train have calls?
        if (this.bufferedCalls.byTrainsIndex[dataFormat][train_id] && 
            this.bufferedCalls.byTrainsIndex[dataFormat][train_id].length ) {
                
            // Copy the beginning of the Monitored call
            offset += msgChunks.perJourney[dataFormat].startNonemptyMonitoredCall.copy(respBuffer, offset);

            if (this.deliveryType === 'stopMonitoring') {
                monitoredCallNumber = this.bufferedCalls.stopIDToCallNumberForTrain[this.stop_id][this.train_id];
            } else {
                monitoredCallNumber = 0;
            }

            //FIXME: defense
            callMetadata = this.bufferedCalls.byTrainsIndex[dataFormat][train_id][monitoredCallNumber]; 

            // The bufferedCalls data for the MonitoredCall
            callOffset   = callMetadata.offset;
            callLen      = callMetadata.length;

            // Copy the MonitoredCall into the buffer.
            offset += this.bufferedCalls.calls[dataFormat]
                                        .copy(respBuffer, offset, callOffset, callOffset + callLen);

            if (dataFormat === 'json') {
                --offset; //Comma.
            }

            // Get the offsets and lengths for the trains calls.
            onwardCalls = this.bufferedCalls.byTrainsIndex[dataFormat][train_id] || [];

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

                // In this case, we must include the calls the train will make up to, 
                // and including, the selected stop.
                if ((this.deliveryType === 'stopMonitoring') && (this.detailLevel !== 'calls')) {
                    stopCallNumberForTrain = 
                        this.bufferedCalls.stopIDToCallNumberForTrain[this.stop_id][this.train_id];

                    if (lastOnwardCall < stopCallNumberForTrain) {
                        lastOnwardCall = stopCallNumberForTrain;
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
        if (this.requestedTrains.length && (this.dataFormat === 'json')) {
            --offset; //last comma
        }
        offset += this.responseChunks.endTrainsData.copy(respBuffer, offset); 
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

            if (offset !== respBuffer.length) { console.log("####### Buffer length != offset\n"); }

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




module.exports = {
    buildResponse   : buildResponse ,
    applyTimestamps : applyTimestamps ,
};
