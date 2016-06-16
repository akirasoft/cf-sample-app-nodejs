/*jslint node: true*/
"use strict";

var core = require('../lib/core.js');

var net = require('net');

// a polyfill in our polyfill etc so forth -- taken from node master on 2013/10/30
if (!net._normalizeConnectArgs) {
    net._normalizeConnectArgs = function (args) {
        var options = {};

        function toNumber(x) { return (x = Number(x)) >= 0 ? x : false; }

        if (typeof args[0] === 'object' && args[0] !== null) {
            // connect(options, [cb])
            options = args[0];
        }
        else if (typeof args[0] === 'string' && toNumber(args[0]) === false) {
            // connect(path, [cb]);
            options.path = args[0];
        }
        else {
            // connect(port, [host], [cb])
            options.port = args[0];
            if (typeof args[1] === 'string') {
                options.host = args[1];
            }
        }

        var cb = args[args.length - 1];
        return typeof cb === 'function' ? [options, cb] : [options];
    };
}

core.wrap(net.Server.prototype, '_listen2', {
    type: core.CallbackType.noCallback,
    instead: function (ctx) {
        ctx._this.on('connection', function (socket) {
            if (socket._handle) {
                socket._handle.onread = core.directAsyncWrap(socket._handle.onread, {}, "socket._handle.onread");
            }
        });

        try {
            return ctx.callOriginal();
        } finally {
            // the handle will only not be set in cases where there has been an error
            if (ctx._this._handle && ctx._this._handle.onconnection) {
                ctx._this._handle.onconnection = core.directAsyncWrap(ctx._this._handle.onconnection, {}, "handle.onconnection");
            }
        }
    },
});

core.wrap(net.Socket.prototype, 'connect', {
    type: core.CallbackType.noCallback,
    instead: function (ctx) {
        var args = net._normalizeConnectArgs(ctx._arguments);
        if (args[1]) {
            args[1] = core.directAsyncWrap(args[1], {}, "socket.Prototype.connnect");
        }

        try {
            return ctx.callOriginal(args);
        } finally {
            if (ctx._this._handle && ctx._this._handle.onread) {
                ctx._this._handle.onread = core.directAsyncWrap(ctx._this._handle.onread, {}, "socket.Prototype._handle.onread");
            }
        }
    }
});

module.exports = net;
