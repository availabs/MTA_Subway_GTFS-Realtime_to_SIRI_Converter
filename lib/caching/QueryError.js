'use strict';


function errorConditionBuilder (message) {
    return {
         "ErrorCondition": {
             "Description": message ,
             "OtherError": {
                 "ErrorText": message ,
             }
         },
    };
}

// Note: use e.name to distinguish between Error and this 'subclass.'
function QueryError (message) {
    this.name = 'QueryError';
    this.message = errorConditionBuilder(message);
}

QueryError.prototype = new Error();

module.exports = QueryError ;
