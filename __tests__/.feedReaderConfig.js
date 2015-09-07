var path = require('path'),
    key           = require('./.apiKey'),

    url           = "http://datamine.mta.info/mta_esi.php?key=" + key,
    protofilePath = path.join(__dirname, '.proto_files/nyct-subway.proto');


module.exports = {
    feedURL       : url           ,
    protofilePath : protofilePath ,
    readInterval  : 30000,
    maxRetries    : 5,
    retryInterval : 2000,
};
