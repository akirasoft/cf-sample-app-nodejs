/*jslint node: true*/
"use strict";

var core = require('../lib/core.js');

// require the original module
var http  = require('http');  // https can't work without http
var https = require('https');

var log = global._rx_log;
var cfg = global._rx_cfg;
//var cfs = require('../lib/agent-common');


https._rx_PROTO_DEFAULT = {PROTOCOL: 'https:',  PORT: 443,  MODULE: 'https'};


https.Server.prototype._rx_req_res_handler = require('../lib/req-res-handler')._rx_req_res_handler;


if (cfg.debugLogPatchingNodeJS) { log.info('     > patching [https.Server.prototype.addListener]'); }
https.Server.prototype._rx_addListener = https.Server.prototype.addListener;
https.Server.prototype.addListener = http.Server.prototype.addListener;
https.Server.prototype.on = https.Server.prototype.addListener;


https._rx_prepareOutgoingRequestParams = http.__rx_prepareOutgoingRequestParams.bind(https, https._rx_PROTO_DEFAULT);

core.wrap(https, 'request', {
    type: core.CallbackType.callbackLastFill,
    before: http.requestCallbackBefore,
    after: http.requestCallbackAfter,
    instead: http.generateRequestInstead(https, 'https')
});

// return original module with provided changes
module.exports = https;
