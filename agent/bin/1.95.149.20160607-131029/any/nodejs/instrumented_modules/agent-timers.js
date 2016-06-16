/*jslint node: true*/
"use strict";

var timers = require('timers');
var core = require('../lib/core.js');

core.wrapMultiple(
    timers,
    ['setTimeout', 'setInterval', 'setImmediate'],
    { type: core.CallbackType.callbackFirst }
);

module.exports = timers;