/*jslint node: true*/
"use strict";

var core = require('./core.js');

// PROCESS - needs to be handled in a different way
// need unwrapped nextTick for use within < 0.9 async error handling
if (!process._fatalException) {
    process._originalNextTick = process.nextTick;
}

core.wrap(process, '_nextDomainTick', {
    type: core.CallbackType.callbackLast,
    allowMissing: true
});
core.wrap(process, 'nextTick', { type: core.CallbackType.callbackLast });

core.wrapMultiple(
    global,
    ['setTimeout', 'setInterval', 'setImmediate'],
    { type: core.CallbackType.callbackFirst }
);

