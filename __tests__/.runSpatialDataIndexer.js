#!/usr/bin/env node



'use strict';


var indexer = require('MTA_Subway_GTFS_Toolkit').spatialDataIndexer;

var config = require('./.config.js');

indexer.run(config);
