/*jslint node: true*/
"use strict";

//var log = global._rx_log;
//var cfg = global._rx_cfg;
//var cfs = require('../lib/agent-common');
var core = require('../lib/core.js');

//var util = require('util');
var hooking = require('../lib/agent-hooking');


module.exports = function(args) {
    var sqlite3 = require(args[0]);
    var hookMethodsDatabase = [
        'close',
        'exec',
        'wait',
        'loadExtension',
        'serialize',
        'parallelize',
        'configure'
    ];

    hookMethodsDatabase.forEach(function (fname) {
        core.wrap(sqlite3.Database.prototype, fname, {
            type: core.CallbackType.callbackLast,
            before: hooking.genCallbackBefore(fname),
            after: hooking.genCallbackAfter(fname),
            enter: hooking.genEnter(fname),
            exit: hooking.genExit(fname)
        });
    });

    var hookMethodsStatement = [
        'bind',
        'get',
        'run',
        'all',
        'each',
        'reset',
        'finalize'
    ];

    hookMethodsStatement.forEach(function (fname) {
        core.wrap(sqlite3.Statement.prototype, fname, {
            type: core.CallbackType.callbackLast,
            before: hooking.genCallbackBefore(fname),
            after: hooking.genCallbackAfter(fname),
            enter: hooking.genEnter(fname),
            exit: hooking.genExit(fname)
        });
    });

    return sqlite3;
};