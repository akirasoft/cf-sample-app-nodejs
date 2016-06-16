/*jslint node: true*/
"use strict";

var log = global._rx_log;
var cfg = global._rx_cfg;
var cfs = require('./agent-common');
//var err = require('./agent-error');
var finder = require('./find-package-json');

var md = require('module');
var path = require('path');

var agentLibCall = path.normalize('/instrumented_modules/agent-');


var specialModules = {
    // "name-of-the-file-with-special-instrumentation": {
    //                                     request : "what-is-requested", // simple string or regex, i.e. request:/(http|json|string)_client/
    //                                     parent  : "from-where-it's-requested", // part of parent.id (from the end)
    //                                     flag    : "cfg.flag-to-force-disabling-instrumentation" // i.e. flag:"debugSupportMongoDBNodeJS"
    // },
    // MongoDB database
    "agent-special-mongodb-database": {
                                        request : "./db",
                                        parent  : "/mongodb/lib/mongo_client.js",
                                        flag    : "debugSupportMongoDBNodeJS" },
    // MongoDB cursor
    "agent-special-mongodb-cursor": {
                                        request : "./cursor",
                                        parent  : "/mongodb/lib/server.js",
                                        flag    : "debugSupportMongoDBNodeJS" },
    // MongoDB collection
    "agent-special-mongodb-collection": {
                                        request : "./collection",
                                        parent  : "/mongodb/lib/db.js",
                                        flag    : "debugSupportMongoDBNodeJS" },
    // restify server
    "agent-special-restify-server": {
                                        request : "./server",
                                        parent  : "/restify/lib/index.js" },
    // restify response
    "agent-special-restify-response": {
                                        request : "./response",
                                        parent  : "/restify/lib/server.js" },
    // express universal error handler
    "agent-special-express": {
                                        request : "./layer",
                                        parent  : "/express/lib/router/route.js" },
    // sqllite3
    "agent-special-sqlite3": {
                                        request : "/node_sqlite3.node",
                                        parent  : "/sqlite3/lib/sqlite3.js" },
};

// transform all 'parent' values into proper paths (depending on OS)
for (var modName in specialModules) {
    specialModules[modName].parent = path.normalize(specialModules[modName].parent);
}

/**
 * Stores information about a module
 * @param moduleFilePath {string} the absolute path of the module file
 * @param parent {Object} parent object passed to Module._load
 */
function LoadedModuleInfo(moduleFilePath, parent) {
    this.moduleFilePath = moduleFilePath;
    this.requestorFilePath = (parent.id ? parent.id : "<none>");
}

/**
 * list of LoadedModuleInfo objects.
 * for each loaded module, an LoadedModuleInfo object will be appended to this list.
 */
var loadedModuleList = [];

/**
 * flag to throttle logging in getSpecialModuleName
 * this is related to APM-64729 to supply additional diagnostics
 */
var getSpecialModuleNameThrew = false;

/**
 * Checks whether the request is a "special" instrumentation request - a particular
 * request from a particular parent.
 * @param request
 * @param parentId
 * @returns {string|null}
 */
function getSpecialModuleName(request, parentId) {
    var moduleName;
    try {
        for (moduleName in specialModules) {
            var moduleData = specialModules[moduleName];

            // check if requested module path end matches with request string, same for parent (requesting) module, and if the module feature flag is enabled
            var found = ((typeof moduleData.request === 'string') ? cfs.str_endsWith(request, moduleData.request) : moduleData.request.test(request)) &&
                (!moduleData.parent || ((typeof(parentId) === 'string') && cfs.str_endsWith(parentId, moduleData.parent))) &&
                (('flag' in moduleData) ? cfg[moduleData.flag] : true);

            if (found) {
                return moduleName;
            }
        }
    } catch (e) {
        if (!getSpecialModuleNameThrew) {
            // only issue the warning once - log state information
            var util = require("util");
            log.warn("getSpecialModuleName failed: '" + moduleName +
                "\nrequest=" + request +
                "'\nspecialModules='" + util.inspect(specialModules) + "'\n" +
                (e.stack ? e.stack : "<no stack>") +
                "\nloadedModuleList: " + util.inspect(loadedModuleList));
            getSpecialModuleNameThrew = true;
        }
    }
    return null;
}

/**
 * List of the modules that won't be loaded at all when the agent is present.
 */
var disabledModules = {
    'newrelic': undefined,
    'appdynamics': { profile: function empty() {} }
};

/**
 * Checks whether the module is on the disabled modules list.
 * @param request
 * @returns {boolean}
 */
function shouldBeDisabled(request) {
    return disabledModules.hasOwnProperty(request);
}

/**
 * This function disables loading of some conflicting modules entirely,
 * replacing them with empty mockups.
 * @param request
 * @returns {Module}
 */
function disabledModuleLoad(request) {
    return disabledModules[request];
}

/**
 * Instruments a module that's
 * @param {bool} isNew - signifies whether the modules is being instrumented for the first time
 * @param request
 * @param parent
 * @param isMain
 * @returns {*}
 */
function specialModuleLoad(isNew, request, parent, isMain) {
    // special approach
    var modName = getSpecialModuleName(request, parent.id);
    if (modName) {
        if (cfg.debugLogPatchingNodeJS && isNew) { log.info('  >> Patching [' + request + '] module'); }
        return require('../instrumented_modules/' + modName)([request, parent, isMain]);
    }
    return null;
}

/**
 * Checks whether the module shouldn't be instrumented.
 * @param request
 * @returns {boolean}
 */
function shouldNotBeInstrumented(request) {
    var listOfLibsContainsRequest = (cfg.listOfLibs.indexOf(request) >= 0);
    return !listOfLibsContainsRequest;
}

/**
 * Loads the original module without any changes.
 * @param {bool} isNew - signifies whether the modules is being instrumented for the first time
 * @param {string} request
 * @param parent
 * @param isMain
 * @returns {Module}
 */
function bypassLoad(isNew, request, parent, isMain) {
    /*jshint validthis:true */
    // a module that won't be instrumented
    if (isNew) {
        log.debug('  >> Loading [' + request + '] module');
    }
    return global._rx_moduleLoad.call(this, request, parent, isMain);
}

/**
 * Checks whether the required module should be instrumented.
 * @param {string} request
 * @param parent
 * @returns {boolean}
 */
function isRegularInstrumentedRequire(request, parent) {
    var hasNotBeenCalledFromAgent = (typeof(parent.id) !== 'string') || (parent.id.indexOf(agentLibCall) < 0);

    // This is a special case. The https module is largely based on the http, so our instrumentation
    // reuses most of the code in both cases. Thus we do want to load the instrumented http module if it
    // comes from the agent if-and-only-if it's made from https instrumented module.
    var hasBeenCalledFromHttps = (request === 'http' && cfs.str_endsWith(parent.id, 'agent-https.js'));

    return hasNotBeenCalledFromAgent || hasBeenCalledFromHttps;
}

/**
 * This loader picks up our own version of the module that contains the instrumentation
 * from the instrumented_modules folder.
 * @param {bool} isNew - signifies whether the modules is being instrumented for the first time
 * @param {string} request
 * @returns {Module}
 */
function regularInstrumentedLoad(isNew, request) {
    /*jshint validthis:true */
    if (cfg.debugLogPatchingNodeJS && isNew) {
        log.info('  >> Loading [agent-' + request + '] module instead of [' + request + ']');
    }

    // The _extensions array contains functions that load a particular file type.
    // By saving them at the agent loading point we ensure that the original nodejs
    // logic is used. An example of a library that modifies them is dynamic Babel compiler,
    // which replaces them with functions that transpile ES6 first.
    var extensions = this._extensions[".js"];
    this._extensions[".js"] = global._rx_extensions_js;
    var m = require('../instrumented_modules/agent-' + request);
    this._extensions[".js"] = extensions;

    return m;
}

/**
 * This function represents a request made from inside of the instrumented module
 * that's replacing the requested one.
 * @param {bool} isNew - signifies whether the modules is being instrumented for the first time
 * @param {string} request
 * @param parent
 * @returns {Module}
 */
function requestFromInstrumentedModuleLoad(isNew, request, parent) {
    /*jshint validthis:true */
    // a module that will be instrumented (second call - from the instrumented_modules/agent-<module>)
    if (cfg.debugLogPatchingNodeJS && isNew) { log.info('  >> Loading [' + request + '] original module'); }

    // TODO: hotfix for redis to load as if it was required from the app
    if (request === 'redis') {
        parent = global._rx_redisParent;
    }

    return global._rx_moduleLoad.call(this, request, parent);
}

// remember original method
if (!global._rx_moduleLoad) {
    global._rx_moduleLoad = module._load;
}
/**
 * This function is put in instead of the original module.load
 * @param request
 * @param parent
 * @param isMain
 * @returns {Module}
 * @private
 */
var _instrumentedModuleLoad = function _instrumentedModuleLoad(request, parent, isMain) {
    // This function will be called on the returned module to allow modifying it
    var afterLoad = function(m) { return m; };

    // TODO: hotfix for redis to load as if it was required from the app
    if (request === 'redis' && !global._rx_redisParent) {
        global._rx_redisParent = parent;
    }

    //if (!parent) { parent = { "id": "" }; }

    // The graceful-fs in some older versions used unsupported code instrumentation method.
    // Since it's API-compatible with fs, it was easiest to simply change the request to 'fs'.
    // TODO: it should probably be properly supported at some point
    if (request === 'graceful-fs') {
        log.warn('  >> graceful-fs requested! Changing to regular fs');
        request = 'fs';

        // Newer versions of graceful-fs introduced gracefulify function that allows
        // wrapping an already loaded fs module. Since we don't load the library at all,
        // we have to provide a dummy replacement.
        afterLoad = function(m) {
            m.gracefulify = function(){};
            return m;
        };
    }

    var isNew = global._rx_modules.indexOf(request) < 0;
    if (isNew) {
        var f = finder(md._resolveFilename(request, parent)).next().value;
        if (f && f.name && !global._rx_modulesInfo[f.name]) {
            global._rx_modulesInfo[f.name] = f.version || '0.0.0';
        }
        global._rx_modules.push(request);
    }

    var requireLoader;
    if (shouldBeDisabled(request)) {
        requireLoader = disabledModuleLoad;
    }
    else if (getSpecialModuleName(request, parent.id)) {
        requireLoader = specialModuleLoad;
    }
    else if (shouldNotBeInstrumented(request)) {
        requireLoader = bypassLoad;
    }
    else if (isRegularInstrumentedRequire(request, parent)) {
        requireLoader = regularInstrumentedLoad;
    }
    else {
        requireLoader = requestFromInstrumentedModuleLoad;
    }
    
    return afterLoad(requireLoader.call(this, isNew, request, parent, isMain));
};


module.exports._instrumentedModuleLoad = _instrumentedModuleLoad;
