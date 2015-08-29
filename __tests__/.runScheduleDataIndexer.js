#!/usr/bin/env node



'use strict';


var indexer = require('MTA_Subway_GTFS_Toolkit').scheduleDataIndexer;

var config = require('./.config.js');

indexer.run(config);
