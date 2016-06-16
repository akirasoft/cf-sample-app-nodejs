/*jslint node: true*/
"use strict";

var log = global._rx_log;
var cfg = global._rx_cfg;
var cfs = require('../lib/agent-common');

var uuid = require('node-uuid');


function genCallbackBefore(name) {
    return function (ctx) {
        if (cfg.debugMongoDBNodeJS) { log.info('NodeJsHook Enter : ' + name + 'Callback'); }

        ctx.metadata.pathId = ctx.syncData.pathId;

        if (!cfg.debugNativeActiveNodeJS) { return; }

        var args = [];

        var exitDbInteraction = {
            methodName: 'dbInteraction',
            path:   { command: 'use',  handle: ctx.syncData.pathId },
            method: { command: 'exit', handle: ctx.syncData.dbId },
            args: args,
            request_processor: ctx.metadata.reqProc,
            databaseName: String(ctx.metadata.databaseName),
            host: String(ctx.metadata.databaseHost),
            port: ctx.metadata.databasePort
        };
        var enterCallback = {
            methodName: name + "Callback",
            path:   { command: 'use', handle: ctx.syncData.pathId },
            method: { command: 'enter', handle: ctx.syncData.cbId },
            args: args,
            request_processor: ctx.metadata.reqProc,
            databaseName: String(ctx.metadata.databaseName),
            host: String(ctx.metadata.databaseHost),
            port: ctx.metadata.databasePort
        };

        cfs.callNative(cfg.cfgAgent, 'process', [exitDbInteraction]);
        cfs.callNative(cfg.cfgAgent, 'process', [enterCallback]);
    };
}


function genCallbackAfter(name) {
    return function (ctx) {
        if (cfg.debugMongoDBNodeJS) { log.info('NodeJsHook Exit : ' + name + 'Callback'); }

        if (!cfg.debugNativeActiveNodeJS) { return; }

        var args = Array.prototype.slice.call(ctx._arguments);
        args = decycle(args);

        var exitCallback = {
            methodName: name + "Callback",
            path:   { command: 'use', handle: ctx.syncData.pathId },
            method: { command: 'exit', handle: ctx.syncData.cbId },
            args: args,
            request_processor: ctx.metadata.reqProc,
            databaseName: String(ctx.metadata.databaseName),
            host: String(ctx.metadata.databaseHost),
            port: ctx.metadata.databasePort
        };
        var endPath = {
            path: { command: 'end', handle: ctx.syncData.pathId },
            args: args,
            databaseName: String(ctx.metadata.databaseName),
            host: String(ctx.metadata.databaseHost),
            port: ctx.metadata.databasePort
        };

        cfs.callNative(cfg.cfgAgent, 'process', [exitCallback]);
        cfs.callNative(cfg.cfgAgent, 'process', [endPath]);
    };
}


function genEnter(methodName) {

    return function (ctx) {
        ctx.metadata.__context__ = 1;
        ctx.syncData.inner = ctx.syncData.inner || 0;

        ctx.syncData.inner += 1;

        if (ctx.metadata.inner > 1) {
            return;
        }

        if (cfg.debugMongoDBNodeJS) { log.info('NodeJsHook Enter : ' + methodName); }

        //var useRequestProcessor = 0;
        //if (!session.get('parent')) { useRequestProcessor = 1; }
        var useRequestProcessor = 1;
        ctx.syncData.useRequestProcessor = useRequestProcessor;

        var reqProc = null;
        if (cfg.debugNativeActiveNodeJS) {
            reqProc = ctx.metadata ? ctx.metadata.reqProc : new cfg.native.RequestProcessor();
        }

        try {
            ctx.metadata.databaseName = ctx.metadata.databaseName || ctx._this.databaseName    || ctx._this.s.databaseName    || ctx._this.s.db.databaseName || undefined;
            ctx.metadata.databaseHost = ctx.metadata.databaseHost || ctx._this.s.topology.host || ctx._this.s.topology.s.host || undefined;
            ctx.metadata.databasePort = ctx.metadata.databasePort || ctx._this.s.topology.port || ctx._this.s.topology.s.port || undefined;
            ctx.metadata.collectionName = ctx._this.s.name || ctx._this.s.db.name || undefined;
        }
        catch (error) {
            if (cfg.debugMongoDBNodeJS) { log.info('NodeJsHook WARNING: Can\'t get db info: ' + error.toString() + '\nthis.s = ' + require('util').inspect(ctx._this.s)); }
        }

        log.debug('NodeJsHook INFO: dbName@dbHost:dbPort = ' + ctx.metadata.databaseName + '@' + ctx.metadata.databaseHost + ':' + ctx.metadata.databasePort);

        ctx.syncData.pathId   = uuid.v4(); //id for this subpath ( <=> path handle)
        ctx.syncData.cbId     = uuid.v4(); //id for callback method
        ctx.syncData.dbId     = uuid.v4(); //id for dbInteraction method
        ctx.syncData.methodId = uuid.v4(); //id for current method

        if (cfg.debugMongoDBNodeJS) { log.info('NodeJsHook Parent : ' + methodName +'(' + ctx.syncData.pathId +')' + " -> " + ctx.metadata.parent + '(' + ctx.metadata.pathId + ')'); }

        if (!cfg.debugNativeActiveNodeJS) { return; }

        var args = Array.prototype.slice.call(ctx._arguments);


        cfs.callNative(cfg.cfgAgent, 'process', [{
            path: { command: 'use', handle: ctx.metadata.pathId },
            method: { command: 'enter', handle: ctx.syncData.methodId },
            methodName: methodName,
            args: args,
            request_processor: reqProc,
            useRequestProcessor : useRequestProcessor,
            collectionName: ctx.metadata.collectionName,
            databaseName: String(ctx.metadata.databaseName),
            host: String(ctx.metadata.databaseHost),
            port: ctx.metadata.databasePort
        }]);


        cfs.callNative(cfg.cfgAgent, 'process', [{
            path: { command: 'start', handle: ctx.syncData.pathId, parent: ctx.metadata.pathId },
            args: args,
            request_processor: ctx.metadata.reqProc,
            useRequestProcessor: ctx.syncData.useRequestProcessor

        }]);

        cfs.callNative(cfg.cfgAgent, 'process', [{
            path: { command: 'use', handle: ctx.metadata.pathId },
            method: { command: 'exit', handle: ctx.syncData.methodId },
            methodName: methodName,
            args: args,
            request_processor: ctx.metadata.reqProc,
            useRequestProcessor: ctx.syncData.useRequestProcessor,
            collectionName: ctx.metadata.collectionName,
            databaseName: String(ctx.metadata.databaseName),
            host: String(ctx.metadata.databaseHost),
            port: ctx.metadata.databasePort
        }]);

        cfs.callNative(cfg.cfgAgent, 'process', [{
            path: { command: 'use', handle: ctx.syncData.pathId },
            method: { command: 'enter', handle: ctx.syncData.dbId },
            methodName: 'dbInteraction',
            asyncMethodName: methodName,
            args: args,
            request_processor: ctx.metadata.reqProc,
            collectionName: ctx.metadata.collectionName,
            databaseName: String(ctx.metadata.databaseName),
            host: String(ctx.metadata.databaseHost),
            port: ctx.metadata.databasePort
        }]);
    };
}

function genExit(methodName) {
    return function (ctx) {
        if (cfg.debugMongoDBNodeJS) { log.info('NodeJsHook Exit : ' + methodName); }
        if (!ctx.callbackModified) {
            var args = Array.prototype.slice.call(ctx._arguments);
            var exitDbInteraction = {
                methodName: 'dbInteraction',
                path: { command: 'use', handle: ctx.syncData.pathId },
                method: { command: 'exit', handle: ctx.syncData.dbId },
                args: args,
                request_processor: ctx.metadata.reqProc,
                databaseName: String(ctx.metadata.databaseName),
                host: String(ctx.metadata.databaseHost),
                port: ctx.metadata.databasePort
            };
            
            cfs.callNative(cfg.cfgAgent, 'process', [exitDbInteraction]);
            var endPath = {
                path: { command: 'end', handle: ctx.syncData.pathId },
                args: args,
                databaseName: String(ctx.metadata.databaseName),
                host: String(ctx.metadata.databaseHost),
                port: ctx.metadata.databasePort
            };
            cfs.callNative(cfg.cfgAgent, 'process', [endPath]);
        }
        
    };
}

module.exports.genCallbackAfter = genCallbackAfter;
module.exports.genCallbackBefore = genCallbackBefore;
module.exports.genEnter = genEnter;
module.exports.genExit = genExit;


function decycle(object) {
    var objects = [];   // Keep a reference to each unique object or array
    var paths = [];     // Keep the path to each unique object or array

    return (function derez(value, path) {
        // The derez recurses through the object, producing the deep copy.
        var i;          // The loop counter
        var name;       // Property name
        var nu;         // The new object or array

        // typeof null === 'object', so go on if this value is really an object but not
        // one of the weird builtin objects.
        if (typeof value === 'object' && value !== null &&
                !(value instanceof Boolean) &&
                !(value instanceof Date) &&
                !(value instanceof Number) &&
                !(value instanceof RegExp) &&
                !(value instanceof String)) {

            // If the value is an object or array, look to see if we have already
            // encountered it. If so, return a $ref/path object. This is a hard way,
            // linear search that will get slower as the number of unique objects grows.
            for (i = 0; i < objects.length; i += 1) {
                if (objects[i] === value) {
                    //console.log('cycle found for ' + paths[i]);
                    return { $ref: paths[i] };
                }
            }

            // Otherwise, accumulate the unique value and its path.
            objects.push(value);
            paths.push(path);

            // If it is an array, replicate the array.
            if (Object.prototype.toString.apply(value) === '[object Array]') {
                nu = [];
                for (i = 0; i < value.length; i += 1) {
                    nu[i] = derez(value[i], path + '[' + i + ']');
                }
            } else {
                // If it is an object, replicate the object.
                nu = {};
                for (name in value) {
                    if (Object.prototype.hasOwnProperty.call(value, name)) {
                        nu[name] = derez(value[name],
                                path + '[' + JSON.stringify(name) + ']');
                    }
                }
            }
            return nu;
        }
        return value;
    }(object, '$'));
}
