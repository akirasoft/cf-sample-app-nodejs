/*jslint node: true*/
"use strict";

// logging library

var cfs = require('./agent-common');

var fs = require('fs');


var timestamp = function() {
    var ct = new Date();
    var dt = {year: ct.getFullYear(), month: ct.getMonth(), day: ct.getDate(), hours: ct.getHours(), minutes: ct.getMinutes(), seconds: ct.getSeconds(), mili: ct.getMilliseconds()};
    var ret = dt.year + (dt.month < 10 ? '-0' : '-') + dt.month + (dt.day < 10 ? '-0' : '-') + dt.day;
    ret += ' ' + (dt.hours < 10 ? '0' : '') + dt.hours + (dt.minutes < 10 ? ':0' : ':') + dt.minutes + (dt.seconds < 10 ? ':0' : ':') + dt.seconds + (dt.mili < 100 ? (dt.mili < 10 ? '.00' : '.0') : '.') + dt.mili + ' ';
    return ret;
};

var decorate = function(func, endl) {
    return function() {
        var args = Array.prototype.slice.call(arguments);
        args[0] = timestamp() + args[0] + endl;
        func.apply(this, args);
    };
};

var JSAlogger = module.exports.JSAlogger = function JSAlogger(logLevel, logLibrary, logNative, allowConsoleLog, session) {
    this.levels = {
        // DEBUG : { level:  7, console: decorate(console.log)   },
        // INFO  : { level:  4, console: decorate(console.log)   },
        // WARN  : { level:  5, console: decorate(console.warn)  },
        // ERROR : { level:  6, console: decorate(console.error) },
        DEBUG : { level:  7, console: decorate(fs.writeSync.bind(fs, 1), '\n') },
        INFO  : { level:  4, console: decorate(fs.writeSync.bind(fs, 1), '\n') },
        WARN  : { level:  5, console: decorate(fs.writeSync.bind(fs, 1), '\n') },
        ERROR : { level:  6, console: decorate(fs.writeSync.bind(fs, 1), '\n') },
        NONE  : { }
    };
    this._native = logNative  || null;
    this.loglib  = logLibrary || 'nodejs';
    this.level   = this.levels.hasOwnProperty(logLevel) ? logLevel : 'INFO';
    this.session = session;
    this._allowConsoleLog = allowConsoleLog;
    this.reconfigure();
};

Object.defineProperty(JSAlogger.prototype, '_toNative', {
    get: function()  { return (this._native !== null && this._lib === 'native'); }
});

Object.defineProperty(JSAlogger.prototype, 'level', {
    get: function()  { return (this._level); },
    set: function(l) { if (this.levels.hasOwnProperty(l)) { this._level = l; this.reconfigure(); } }
});

Object.defineProperty(JSAlogger.prototype, 'loglib', {
    get: function()  { return (this._lib); },
    set: function(l) { if (l === 'native' || l === 'nodejs') { this._lib = l; this.reconfigure(); } }
});

Object.defineProperty(JSAlogger.prototype, 'native', {
    get: function()  { return (this._native); },
    set: function(l) { this._native = l || null; }
});

// JSAlogger.prototype.log = decorate(console.log);
JSAlogger.prototype.log = decorate(fs.writeSync.bind(fs, 1), '\n');

JSAlogger.prototype.res = function res(status, msg) { if (status < 400) { this.info(msg); } else { this.warn(msg); } };

JSAlogger.prototype.debug = JSAlogger.prototype.req = JSAlogger.prototype.info = JSAlogger.prototype.warn = JSAlogger.prototype.error = JSAlogger.prototype._empty = function() {};

JSAlogger.prototype.reconfigure = function reconfigure() {
    this.params = this.debug = this.req = this.info = this.warn = this.error = this._empty;
    /* jshint -W086 */
    if (this._toNative) {
        switch (this.level) {
            case 'DEBUG': this.debug  = this.native.bind(this, this.levels.DEBUG.level);
                          this.params = function(msg) { this.info(this._prepareParams(msg)); };
            case 'INFO' : this.info   = this.native.bind(this, this.levels.INFO.level);
            case 'WARN' : this.warn   = this.native.bind(this, this.levels.WARN.level);
            case 'ERROR': this.error  = this.native.bind(this, this.levels.ERROR.level);
        }
    }
    else if (this._allowConsoleLog) {
        switch (this.level) {
            case 'DEBUG': this.debug  = this.levels.DEBUG.console.bind(this);
                          this.params = function(msg) { this.info(this._prepareParams(msg)); };
            case 'INFO' : this.info   = this.levels.INFO.console.bind(this);
            case 'WARN' : this.warn   = this.levels.WARN.console.bind(this);
            case 'ERROR': this.error  = this.levels.ERROR.console.bind(this);
        }
    }
    /* jshint +W086 */
};

JSAlogger.prototype.stringify = function stringify(obj) {
    var cache = [];
    var ret = JSON.stringify(obj, function(key, value) {
        if (typeof value === 'object' && value !== null) {
            if (cache.indexOf(value) !== -1) { return; }
            cache.push(value);
        }
        return value;
    });
    cache = null;
    return ret;
};

JSAlogger.prototype._prepareParams = function _prepareParams(args) {
    var ret = '';
    var i;
    if (args.length > 0) {
        for (i = 0; i < args.length; i += 1) {
            ret += '     > ' + this.stringify(args[i]) + '\n';
        }
    }
    else {
        ret += '     > [None]\n';
    }
    return ret.slice(0, -1);
};

JSAlogger.prototype.msgHdr = function msgHdr(be, type, msg, addr, id) {
    var cfg = global._rx_cfg;
    var metadata = (this.session ? this.session.get('metadata') : null) || new cfs.Metadata();
    id           = id || (metadata ? metadata.id : cfg.EMPTY_ID);
    var logHdr   = addr || (metadata ? metadata.logHdrM : ('[' + id + '] '));
    type = type || '';
    this.info(logHdr + '>>' + type + '> ' + msg + '() ' + be);
};

JSAlogger.prototype.methodEnter   = function methodEnter  (msg, addr, id) { this.msgHdr('<begin>', 'i', msg, addr, id); };
JSAlogger.prototype.methodExit    = function methodExit   (msg, addr, id) { this.msgHdr('<end>',   'i', msg, addr, id); };
JSAlogger.prototype.nativeEnter   = function nativeEnter  (msg, addr, id) { this.msgHdr('<begin>', 'n', msg, addr, id); };
JSAlogger.prototype.nativeExit    = function nativeExit   (msg, addr, id) { this.msgHdr('<end>',   'n', msg, addr, id); };
JSAlogger.prototype.nativeCall    = function nativeCall   (msg, addr, id) { this.msgHdr('<call>',  'n', msg, addr, id); };
JSAlogger.prototype.paramsHdr     = function paramsHdr    (msg, addr, id) { this.msgHdr('PARAMS:', '-', msg, addr, id); };
JSAlogger.prototype.outputHdr     = function outputHdr    (msg, addr, id) { this.msgHdr('OUTPUT:', '-', msg, addr, id); };
JSAlogger.prototype.originalEnter = function originalEnter(msg, addr, id) { this.msgHdr('<begin>', 'o', msg, addr, id); };
JSAlogger.prototype.originalExit  = function originalExit (msg, addr, id) { this.msgHdr('<end>',   'o', msg, addr, id); };

JSAlogger.prototype.dumpData = function dumpData(hdr, type, data) {
    this.info(hdr + '---------- ' + type + ' <start> ----------');
    this.info(hdr + this.stringify(data));
    this.info(hdr + '---------- ' + type + '  <end>  ----------');
};
