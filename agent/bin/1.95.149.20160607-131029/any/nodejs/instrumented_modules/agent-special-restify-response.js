/*jslint node: true*/
"use strict";

//var log = global._rx_log;
//var cfg = global._rx_cfg;
//var cfs = require('../lib/agent-common');
var err  = require('../lib/agent-error');
var core = require('../lib/core.js');

var path = require('path');
var http = require('http');


module.exports = function(args) {

    var Response = http.ServerResponse;
    require(path.join(path.dirname(args[1].id), args[0]));

    var Errors = require(path.join(path.dirname(args[1].id), './errors'));


    function sendEnter(ctx) {
        // arguments: code, body, headers

        var code = ctx._arguments[0];
        var body = ctx._arguments[1];
        var error;

        if      (code instanceof Error) { error = code; }
        else if (body instanceof Error) { error = body; }

        // filter out regular 404 error
        if (error instanceof Errors.ResourceNotFoundError) {
            error = undefined;
        }

        if ((error || code >= 400) && !ctx._this._rx_errorSent) {
            ctx._this._rx_errorSent = true;
            err.errorHandler(ctx.metadata, 'RESTIFY_SERVER', error);
        }
    }

    core.wrap(Response.prototype, 'send', { type: core.CallbackType.noCallback, enter: sendEnter });
};
