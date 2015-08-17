'use strict';



function padLeft(num, len) {
   return ('0000' + num).slice(-len);
}

function getTimestampFromPosix (posixTime) {
    return getTimestamp(new Date(posixTime * 1000));
}

function getTimestamp (jsDate) {
    var year,
        month,
        date,
        hours,
        minutes,
        seconds,
        millisecs;

    jsDate    = jsDate || new Date();

    year      = jsDate.getFullYear();
    month     = padLeft(jsDate.getMonth() + 1, 2);
    date      = padLeft(jsDate.getDate(), 2);
    hours     = padLeft(jsDate.getHours(), 2);
    minutes   = padLeft(jsDate.getMinutes(), 2);
    seconds   = padLeft(jsDate.getSeconds(), 2);
    millisecs = padLeft(jsDate.getMilliseconds(), 3);

    return [year, month, date].join('-') +
           'T'   +
           [hours, minutes, seconds].join('-') + '.' + millisecs +
           '-'   + '04:00';
}

function dateToString (date) {
    var offsetDate = getOffsetDate(date);

    return offsetDate.getFullYear()              + '-' +
           padLeft(offsetDate.getMonth() + 1, 2) + '-' +
           padLeft(offsetDate.getDate(), 2)            ;
}


function getOffsetDate (date) {
    var offsetDate = new Date(date);

    offsetDate.setTime(offsetDate.getTime() + (offsetDate.getTimezoneOffset() * 60 * 1000));

    return offsetDate;
}


//FIXME: Rename
function getDateFromDateString(dateString) {
    dateString = dateString.substring(0,4) + '/' + 
                 dateString.substring(4,6) + '/' + 
                 dateString.substring(6);
    
    return new Date(dateString);
}



module.exports = {
    padLeft               : padLeft,
    getDateFromDateString : getDateFromDateString,
    dateToString          : dateToString,
    getTimestamp          : getTimestamp,
    getTimestampFromPosix : getTimestampFromPosix,
};
