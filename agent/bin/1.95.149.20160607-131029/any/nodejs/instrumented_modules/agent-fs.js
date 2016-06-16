/*jslint node: true*/
"use strict";

// require the original module
var fs  = require('fs');
var core = require('../lib/core.js');

var log = global._rx_log;
var cfg = global._rx_cfg;
var cfs = require('../lib/agent-common');

var asyncMethods = [
    'rename',
    'ftruncate',
    'truncate',
    'chown',
    'fchown',
    'chmod',
    'fchmod',
    'stat',
    'lstat',
    'fstat',
    'link',
    'symlink',
    'readlink',
    'realpath',
    'unlink',
    'rmdir',
    'mkdir',
    'readdir',
    'close',
    'open',
    'utimes',
    'futimes',
    'fsync',
    'write',
    'read',
    'readFile',
    'writeFile',
    'appendFile',
    'exists',
];

var optionalAsyncMethods = [
    'access',
    'lchmod',
    'lchown'
];

function genAsyncFsInstead(name) {
    return function (ctx) {
        ctx.syncData.started = cfs.timer();
        // no side effects -> no exception handling required
        return cfs.callOriginal(ctx._this, ctx.original, "fs." + name, ctx._arguments);
    };
}

function genAsyncFsCallbackInstead(name) {
    return function (ctx) {
        // no side effects -> no exception handling required
        var ret = cfs.callOriginal(ctx._this, ctx.original, "fs." + name + '.cb', ctx._arguments);

        if (cfg.debugLogFSNodeJS) {
            log.info(ctx.metadata.logHdrM + "fs." + name + '() : ' + cfs.timer(ctx.syncData.started, 'micro').toString() + ' us');
        }
        return ret;
    };
}

asyncMethods.forEach(function (methodName) {
    core.wrap(fs, methodName, {
        type: core.CallbackType.callbackLast,
        instead: genAsyncFsInstead(methodName),
        insteadCallback: genAsyncFsCallbackInstead(methodName)
    });
});

optionalAsyncMethods.forEach(function (methodName) {
    core.wrap(fs, methodName, {
        type: core.CallbackType.callbackLast,
        instead: genAsyncFsInstead(methodName),
        insteadCallback: genAsyncFsCallbackInstead(methodName),
        allowMissing: true
    });
});

var syncMethods = [
    'renameSync',
    'ftruncateSync',
    'truncateSync',
    'chownSync',
    'fchownSync',
    'chmodSync',
    'fchmodSync',
    'statSync',
    'lstatSync',
    'fstatSync',
    'linkSync',
    'symlinkSync',
    'readlinkSync',
    'realpathSync',
    'unlinkSync',
    'rmdirSync',
    'mkdirSync',
    'readdirSync',
    'closeSync',
    'openSync',
    'utimesSync',
    'futimesSync',
    'fsyncSync',
    'writeSync',
    'readSync',
    'readFileSync',
    'writeFileSync',
    'appendFileSync',
    'existsSync'
];

var optionalSyncMethods = [
    'accessSync',
    'lchmodSync',
    'lchownSync'
];

function genSyncFsInstead(name) {
    return function (ctx) {
        var started = cfs.timer();

        // no side effects -> no exception handling required
        var ret = cfs.callOriginal(ctx._this, ctx.original, "fs." + name + '.cb', ctx._arguments);

        if (cfg.debugLogFSNodeJS) {
            log.info(ctx.metadata.logHdrM + "fs." + name + '() : ' + cfs.timer(started, 'micro').toString() + ' us');
        }

        return ret;
    };
}

syncMethods.forEach(function (methodName) {
    core.wrap(fs, methodName, {
        type: core.CallbackType.noCallback,
        instead: genSyncFsInstead(methodName)
    });
});

optionalSyncMethods.forEach(function (methodName) {
    core.wrap(fs, methodName, {
        type: core.CallbackType.callbackLast,
        instead: genAsyncFsInstead(methodName),
        insteadCallback: genAsyncFsCallbackInstead(methodName),
        allowMissing: true
    });
});

// return original module with provided changes
module.exports = fs;
