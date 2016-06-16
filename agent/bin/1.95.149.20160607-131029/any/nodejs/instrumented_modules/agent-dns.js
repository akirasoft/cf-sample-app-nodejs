/*jslint node: true*/
"use strict";

// require the original module
var dns  = require('dns');


var log = global._rx_log;
var cfg = global._rx_cfg;
var cfs = require('../lib/agent-common');

var core = require('../lib/core.js');

var asyncMethods = [
    'lookup',
    'lookupService',
    'resolve',
    'resolve4',
    'resolve6',
    'resolveMx',
    'resolveTxt',
    'resolveSrv',
    'resolveSoa',
    'resolveNs',
    'resolveCname',
    'resolveNaptr',
    'reverse',
];

function genAsyncDnsInstead(name) {
    return function (ctx) {
        ctx.syncData.started = cfs.timer();
        // no side effects -> no exception handling required
        return cfs.callOriginal(ctx._this, ctx.original, "dns." + name, ctx._arguments);
    };
}

function genAsyncDnsCallbackInstead(name) {
    return function (ctx) {
        // no side effects -> no exception handling required
        var ret = cfs.callOriginal(ctx._this, ctx.original, "dns." + name + '.cb', ctx._arguments);

        if (cfg.debugLogFSNodeJS /*TODO: Change the logger option in cfg, probably copy paste*/) {
            log.info(ctx.metadata.logHdrM + "dns." + name + '() : ' + cfs.timer(ctx.syncData.started, 'micro').toString() + ' us');
        }
        return ret;
    };
}

asyncMethods.forEach(function (methodName) {
    core.wrap(dns, methodName, {
        type: core.CallbackType.callbackLast,
        instead: genAsyncDnsInstead(methodName),
        insteadCallback: genAsyncDnsCallbackInstead(methodName)
    });
});

var syncMethods = [
    'getServers',
    'setServers'
];

function genSyncDnsInstead(name) {
    return function (ctx) {
        var started = cfs.timer();

        // no side effects -> no exception handling required
        var ret = cfs.callOriginal(ctx._this, ctx.original, "dns." + name + ".cb", ctx._arguments);

        if(cfg.debugLogFSNodeJS) {
            log.info(ctx.metadata.logHdrM + "fs." + name + '() : ' + cfs.timer(started, 'micro').toString() + ' us');
        }

        return ret;
    };
}

syncMethods.forEach(function (methodName) {
    core.wrap(dns, methodName, {
        type: core.CallbackType.noCallback,
        instead: genSyncDnsInstead(methodName),
    });
});

// return original module with provided changes
module.exports = dns;
