/*jslint node: true*/
/** @module core */
"use strict";

var shimmer = require('shimmer');
var log = global._rx_log;
var cfg = global._rx_cfg;
var dtUtil = require("../lib/agent-util");

/**
One active listener can be there at a particular time.
 */
var activeListener = null;
var backupListener = null;

/**
 * There can be multiple listeners with the same properties, so disambiguate
 * them by assigning them an ID at creation time.
 * @type {int}
 */
var luid = 0;

var hasInitFinished = false;

/**
 * @param original
 * @param _this
 * @param _arguments
 * @param name
 * @param metadata
 * @param syncData
 * @constructor
 */
function Context(original, _this, _arguments, name, metadata, syncData) {
    this.original = original;
    this._this = _this;
    this._arguments = _arguments;
    this.name = name;
    this.metadata = metadata;
    this.syncData = syncData || {};
}

Context.prototype.callbackModified = false;

/**
 * This function is a shorthand for common:
 * original.apply(_this, _arguments);
 * @param args optional modified arguments
 */
Context.prototype.callOriginal = function (args) {
    // if the args aren't passed, use the original ones
    var a = (args) ? args : this._arguments;
    // the callback is already wrapped at this point
    return dtUtil.invoke(this._this, this.original, a);
};

/**
 * @typedef ListenerOptions
 */

/**
 * @typedef AsyncListener
 * @param listenerOptions
 * @param data
 * @constructor
 */
function AsyncListener(listenerOptions, data) {
    if (typeof listenerOptions !== 'object' || !listenerOptions) {
        throw new TypeError('callbacks argument must be an object');
    }

    this.luid = ++luid;
    this.data = data === undefined ? null : data;
}

AsyncListener.prototype.data   = undefined;
AsyncListener.prototype.uid    = 0;
AsyncListener.prototype.flags  = 0;

/**
 * @param {*} data
 * @param {ListenerOptions} listenerOptions
 * @param {function} fn
 */
function withListener(data, listenerOptions, fn) {
    if (activeListener) {
        log.warn("Context isn't empty when withListener was called");
        logStack();
    }

    // remember current listener
    var outerListener = activeListener;

    activeListener = new AsyncListener(listenerOptions, data);

    log.debug('WITH LISTENER : ' + activeListener.luid);

    // The listener is passed on so that the inner code can use it.
    try {
        fn(activeListener);
    } finally {
        // restore previous listener 
        activeListener = outerListener;
    }
}

/**
* Core wrapping routine that calls listeners
* @param {function} original - original function to wrap.
* @param {AsyncListener} listener - the listener that is supposed to be bound to this invocation
* @param {Object} cbs - the callbacks object containing per-function C/B/A/E/I callbacks
* (Create, Before, After, Error, Instead).
* @param {String} name - the name of the function.
* @param syncData
*/
var asyncWrap = function asyncWrap(original, listener, cbs /*=options*/, name, syncData) {
    return function () {
        if (!cfg.debugAgentActiveNodeJS) {
            // bail out early if agent not active
            return dtUtil.invoke(this, original, arguments);
        }

        // Backup parent listener
        var prevListener = activeListener;

        try {
            // Activate the new listener
            activeListener = listener;

            var ctx = new Context(original, this, arguments, name, activeListener.data, syncData);

            // "Before" handlers
            if (cbs.before) {
                cbs.before(ctx);
            }

            var result;
            if (cbs.insteadCallback) {
                // "Instead" handler
                result = cbs.insteadCallback(ctx);
            }
            else {
                // save the return value to pass to the after callbacks
                result = dtUtil.invoke(this, original, arguments);
            }

            // set return value in context and call after handler
            // "After" handlers (not run if original throws)
            ctx.returnValue = result;
            if (cbs.after) {
                cbs.after(ctx);
            }

            return result;

        } finally {
            // reset the previously active listener
            activeListener = prevListener;
        }
    };
};

/**
 * This function logs the current stacktrace to debug log.
 */
function logStack() {
    // call stack generation is expensive - do nothing in case
    // debug log level is not active
    if (log._level && log._level === "DEBUG") {
        try {
            var e = new Error().stack;
            log.debug(e);
        } catch (x) {
            // intentionally left blank
        }
    }
}

/**
 * Called each time an asynchronous function that's been wrapped is called.
 * If there is an asyncListener active, pass it to
 * asyncWrap for later use, otherwise just call the original.
 * This is mostly a convenience function.
 * @param {function} original - original function to wrap.
 * @param {Object} options - the containing per-function callbacks and options
 * @param {String} name - the name of the function.
 * @param syncData
 */
function asyncWrapWithListener(original, options, name, syncData) {
    if (!activeListener) {
        return original;
    }

    return asyncWrap(original, activeListener, options, name, syncData);
}

/**
 * @typedef {Object} CallbackType
 */
var CallbackType = Object.freeze({
    callbackLast: {},
    callbackLastFill: {},
    callbackFirst: {},
    auto: {},
    noCallback: {}
});

module.exports.CallbackType = CallbackType;

/**
 * @typedef {Object} Options
 * @property {CallbackType} type
 * @property {function} enter
 * @property {function} exit
 * @property {function} instead
 * @property {function} before
 * @property {function} after
 * @property {boolean} contextFromThis
 */

/**
 * Wraps callback into closures carrying context.
 * @param args {Arguments} - the original arguments to the function
 * @param options {Options} - option object for the instrumented function
 * @param parentName {string} - name of the function that will have its arguments wrapped
 * @param syncData
 * @return callBackWrapped {boolean} - returns true in case the callback has been wrapped, otherwise false
 */
var modifyCallbackArgs = function (args, options, parentName, syncData) {
    var name = "Callback from " + (parentName || "unknown");
    var index;
    var callbackModified = false;

    switch (options.type) {
        case CallbackType.callbackLastFill:
            index = args.length - 1;
            if (typeof args[index] !== "function") {
                // fill in an empty callback
                [].push.call(args, function () { });
                index = index + 1;
            }
            args[index] = asyncWrapWithListener(args[index], options, name, syncData);
            callbackModified = true;
            break;
        case CallbackType.callbackLast:
            index = args.length - 1;
            if (typeof args[index] === "function") {
                args[index] = asyncWrapWithListener(args[index], options, name, syncData);
                callbackModified = true;
            }
            break;
        case CallbackType.callbackFirst:
            // if the first parameter passed was indeed a function, wrap it.
            if (typeof args[0] === "function") {
                args[0] = asyncWrapWithListener(args[0], options, name, syncData);
                callbackModified = true;
            }
            break;
        case CallbackType.auto:
            for (var i = 0; i < args.length; i++) {
                if (typeof args[i] === "function") {
                    args[i] = asyncWrapWithListener(args[i], options, name, syncData);
                    callbackModified = true;
                }
            }
            break;
        case CallbackType.noCallback:
            break;
        default:
            throw new Error("Invalid callback wrapping type");
    }
    return callbackModified;
};

/**
 * @param {Options} options
 * @param {string} name
 * @returns {string} nameInfo
 */
function extractNameInfo(options, name) {
    if (options.instead && options.instead.name) {
        return options.instead.name + " wrapping " + name;
    } else {
        return name;
    }
}

/**
 * @param {Object} _this
 * @param {Options} options
 * @param {string} name
 * @returns {AsyncListener|null}
 */
function getContextMetadata(_this, options, name) {
    // if
    if (options.contextFromThis) {
        if (_this._rx_metadata) {
            return _this._rx_metadata;
        } else {
            if (!activeListener) {
                return null;
            }

            return activeListener.data;
        }
    } else {
        if (!activeListener) {
            return null;
        }

        var listenerId = activeListener.luid;
        var thisListenerId;

        // Check whether `this` contains a listener that differs from the current one
        if (_this && _this._rx_metadata && _this._rx_metadata.listener) {
            thisListenerId = _this._rx_metadata.listener.luid;

            if (thisListenerId && listenerId !== thisListenerId) {
                log.debug('CONTEXT MISMATCH - using listener from `this`');
                log.debug("(" + name + ") [" + listenerId + "] -->> [" + thisListenerId + "]");
                return _this._rx_metadata.listener.data;
                // uncomment to log stack at context mismatch
                // TODO: stack logging at arbitrary log
                //logStack();
            } else {
                return activeListener.data;
            }
        } else {
            return activeListener.data;
        }

        return null;
    }
}

/**
 * @param {function} original
 * @param {Object} _this
 * @param {Object} _arguments
 * @param {Options} options
 * @param {string} name
 * @returns {Context|null}
 */
function createLocalContext(original, _this, _arguments, options, name) {
    var data = getContextMetadata(_this, options, name);
    if (data) {
        return new Context(original, _this, _arguments, name, data);
    }
    else {
        return null;
    }
}

/**
 * @param {Options} options
 * @param {string} name
 * @returns {function}
 */
function syncWrap(options, name) {
    options = options || {};
    return function (original) { // this is called by shimmer when wrapping
        return function () {           // this is the function that will be put out to the clientcode

            // Gather name information
            var nameInfo = extractNameInfo(options, name);
            var ctx = createLocalContext(original, this, arguments, options, nameInfo);

            // In case we can't obtain the context, just bail out.
            if (!ctx) {
                log.debug("Function " + name + " called w/o context");
                return dtUtil.invoke(this, original, arguments);
            }

            hasInitFinished = true;

            // Call 'enter' handler
            if (options.enter) {
                options.enter(ctx);
            }

            // modify the arguments so that the callbacks are wrapped
            ctx.callbackModified = modifyCallbackArgs(arguments, options, nameInfo, ctx.syncData);
            // Actual call
            var result;
            if (options.instead) {
                // "Instead" handler
                result = options.instead(ctx);
            } else {
                // save the return value to pass to the after callbacks
                result = dtUtil.invoke(this, original, arguments);
            }
            ctx.returnValue = result;

            // Call 'exit' handler
            if (options.exit) {
                options.exit(ctx);
            }

            return result;
        };
    };
}

function directWrap(fn, options) {
    return syncWrap(options)(fn, fn.name);
}

function directAsyncWrap(fn, options, name, syncData) {
    return asyncWrapWithListener(fn, options, name, syncData);
}

var orig_prefix = '_rx_';

/**
 * This is the one-does-all function for instrumentation
 * @param nodule
 * @param {string} name
 * @param {Options} options
 */
function wrap(nodule, name, options) {
    if (cfg.debugLogPatchingNodeJS) { log.info('     > wrap-patching [' + name + ']'); }

    if (typeof name !== "string") {
        throw new TypeError("The second parameter must be the name of the function!");
    }

    if (!options.type) {
        throw new Error("You must provide a type of callback wrapper to be applied");
    }

    if (!nodule[name]) {
        if (!options.allowMissing) {
            log.warn("     > The function " + name + " doesn't exist! Skipping...");
        }
        return;
    }

    var wrapped = nodule[orig_prefix + name];

    // keep the original if not yet present
    if (!wrapped) {
        nodule[orig_prefix + name] = nodule[name];
    }

    if (!wrapped || options.allowDoubleWrap) { //prevents to wrap a function twice (only usage here...so should be removed)
        shimmer.wrap(nodule, name, syncWrap(options, name));
    }
}

function wrapMultiple(nodule, names, options) {
    names.forEach(function (n) {
        wrap(nodule, n, options);
    });
}

/**
 * simulation of losing ctx for testing scenarios 
 */
function removeContext() {
    //lost context simulation
    if(activeListener) {
        backupListener = activeListener;
        activeListener = null;
    }
}
function restoreContext() {
    //restoring context
    if(!activeListener) {
        activeListener = backupListener;
        backupListener = null;
    }
}

/**
 * replaces and return current activeListener with given context
 * @param context {AsyncListener} the context to be set
 * @returns current activeListener
 */
function exchangeContext(context) {
    var current = activeListener;
    activeListener = context;
    return current;
}

module.exports.wrap = wrap;
module.exports.directWrap = directWrap;
module.exports.directAsyncWrap = directAsyncWrap;
module.exports.wrapMultiple = wrapMultiple;

process.withListener = withListener;
//only for losing context test
process._rx_removeContext = removeContext;
process._rx_restoreContext = restoreContext;
process._rx_exchangeContext = exchangeContext;
