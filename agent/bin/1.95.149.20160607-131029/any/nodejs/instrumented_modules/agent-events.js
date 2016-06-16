/*jslint node: true*/
"use strict";

// require the original module
var events = require('events');
var core = require('../lib/core');

//-----------------------------------------------------------------------------
function addListenerEnter(ctx) {
    // Wrap only if the argument count matches expected
    if (ctx._arguments.length === 2) {
        var origListener = ctx._arguments[1];

        // create wrapped listener
        var cb = core.directAsyncWrap(origListener, {}, "addListener cb");

        // In case passed listener has already a listener property use it here as it comes from once().
        // This allows unregistration using removeListener() on the one hand and implicit via emit().
        ctx.syncData.origListener = origListener.listener ? origListener.listener : ctx._arguments[1];

        // store originial listener in listener property similar as Node EventEmitter does for
        // listeners registered via once. By doing this the wrapped listener can be removed by passing
        // the original listener to removeListener
        cb.listener = ctx.syncData.origListener;

        // pass our wrapped callback down to EventEmitter
        ctx._arguments[1] = cb;
    }
}

//-----------------------------------------------------------------------------
core.wrap(events.EventEmitter.prototype, "addListener", {
    type: core.CallbackType.noCallback,
    enter: addListenerEnter
});

//-----------------------------------------------------------------------------
core.wrap(events.EventEmitter.prototype, "on", {
    type: core.CallbackType.noCallback,
    enter: addListenerEnter
});

//-----------------------------------------------------------------------------
core.wrap(events.EventEmitter.prototype, "once", {
    type: core.CallbackType.noCallback,
    instead: function (ctx) {
        var type = ctx._arguments[0];
        var listener = ctx._arguments[1];

        // implementation here is "inspired" by node internal events.js
        if (typeof listener !== 'function') {
            throw new TypeError('"listener" argument must be a function');
        }

        var fired = false;

        function g() {
            // remove once wrapper via original listener as g() itself is not visible
            // inside EventEmitter. EventEmitter gets wrapped cb with .listener pointing to original
            ctx._this.removeListener(type, g.listener);

            if (!fired) {
                fired = true;
                listener.apply(ctx._this, arguments);
            }
        }

        // store reference to original listener in once wrapper and register listener via on()
        // in on the original listener can be extraced and forwarded to the core wrapped listener
        g.listener = listener;
        ctx._this.on(type, g);

        return ctx._this;
    }
});


//=============================================================================
// return original module with provided changes
module.exports = events;
