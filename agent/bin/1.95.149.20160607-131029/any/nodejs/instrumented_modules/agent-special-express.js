/*jslint node: true*/
"use strict";

var path = require('path');

var err  = require('../lib/agent-error');
var core = require('../lib/core.js');


module.exports = function(args) {
    var Layer = require(path.join(path.dirname(args[1].id), args[0]));

    function handleErrorBefore(ctx) {
        err.errorHandler(ctx.metadata, 'EXPRESS', ctx._arguments[0]);
    }
    core.wrap(Layer.prototype, 'handle_error', { type: core.CallbackType.callbackLast, enter: handleErrorBefore });

    return Layer;
};
