/*jslint node: true*/
"use strict";

var log = global._rx_log;
var cfg = global._rx_cfg;
var cfs = require('../lib/agent-common');
//var err = require('../lib/agent-error');

var path = require('path');
//var util = require('util');


var _rx_req_res_handler = require('../lib/req-res-handler')._rx_req_res_handler.bind(global, function _rx_original() {});


var _rx_newHandler = cfs.decorateWithLogger(function restify_server_request_handler(req, res, next) {
    log.debug('RESTIFY_SERVER> ' + req.method + ' ' + req.url);
    _rx_req_res_handler.apply(this, arguments);

    // no side effects -> no exception handling required
    return next();
});

/*
var _rx_restifyErrorHandler = cfs.decorateWithLogger(function restifyErrorHandler(type, req, res, route, error) {
    log.debug('RESTIFY_SERVER on(' + type + ')');
    if (!res) { res = {}; }
    if (res._rx_errorSent || !error) { return; }
    res._rx_errorSent = true;
    log.warn(util.inspect(error.stack));
    err.errorHandler('RESTIFY_SERVER', error);
});
*/

module.exports = function(args) {
    /*
    var Server = require(path.join(path.dirname(args[1].id), args[0]));

    // patching constructor (actually creating subclass)
    var _rx_Server = function Server() {
        _rx_Server.super_.apply(this, arguments);

        this.on('uncaughtException', _rx_restifyErrorHandler.bind(this, 'uncaughtException'));
        this.on('error',             _rx_restifyErrorHandler.bind(this, 'error'));
    };
    _rx_Server.prototype = Object.create(Server.prototype);
    _rx_Server.prototype.constructor = _rx_Server;
    util.inherits(_rx_Server, Server);
    */

    /**/var _rx_Server = require(path.join(path.dirname(args[1].id), args[0]));/**/

    // patching methods
    [
        {'name': 'del',   'desc': 'DELETE'},
        {'name': 'get',   'desc': 'GET'},
        {'name': 'head',  'desc': 'HEAD'},
        {'name': 'opts',  'desc': 'OPTIONS'},
        {'name': 'post',  'desc': 'POST'},
        {'name': 'put',   'desc': 'PUT'},
        {'name': 'patch', 'desc': 'PATCH'}
    ].forEach(function (method) {
        var mn = method.name;

        if (!_rx_Server.prototype[mn]._rx_original) {
            if (cfg.debugLogPatchingNodeJS) { log.info('     > patching [restify.Server.prototype.' + mn + ']'); }

            var md = method.desc;
            var fn = _rx_Server.prototype[mn];
            _rx_Server.prototype[mn] = function(route) {
                // make extended argument list ([arg1, arg2, arg3, ...] -> [arg1, argX, arg2, arg3, ...])
                var argsNew = Array.prototype.slice.call(arguments);
                argsNew.unshift(argsNew.shift(), _rx_newHandler);

                // no side effects -> no exception handling required
                var ret = cfs.callOriginal(this, this[mn]._rx_original, 'restify.Server.' + mn, argsNew);
                log.debug('RESTIFY_SERVER> added route=[' + md + ' ' + route + ']');

                return ret;
            };
            _rx_Server.prototype[mn]._rx_original = fn;
        }
    });

    return _rx_Server;
};
