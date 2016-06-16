/*jslint node: true*/
"use strict";

// config

var DEFAULT_LOGLEVEL        = 'INFO';
var DEFAULT_LOGLIBRARY      = 'nodejs';
var DEFAULT_ALLOWCON        = false;
var DEFAULT_FORCECON        = false;
var DEFAULT_ALLOWDFFROMJS   = false;

var DEFAULT_APPNAME         = 'nodejsApplication';

var DEFAULT_NATIVELIB       = 'ruxitagentnodejs';
var DEFAULT_SPECHEADER      = 'x-dynatrace';
var DEFAULT_INJECTIONHEADER = 'X-ruxit-JS-Agent';
var DEFAULT_METHODPREFIX    = '_JS_';

var DEFAULT_LIBPATH_MOD     = '../../';

// used to filter out some lines from stack trace while uncaughtException occurs (use only regular expressions!)
var DEFAULT_STACKFILTER     = [
    /Function\._instrumentedModuleLoad/
];

var path = require('path');
var fs   = require('fs');


module.exports.JSAconfig = function JSAconfig(options) {
    var self = {};

    // some enums
    self.REQUEST_TYPE = { REGULAR: 0, AGENT:     1, BEACON:             2, BEACON_CORS: 3, HEALTHCHECK: 4, INVALID_PATH: 5, NOT_ACTIVE: 6, BANDWIDTH: 7, UNKNOWN:  9 };
    self.INJECTION    = { UNKNOWN: 0, NEED_MORE: 1, NEED_MORE_CHUNKING: 2, INJECTED:    3, FLUSH:       4, DISABLED:     5 };

    self.ENCODING     = { '': 0, 'gzip': 1, 'deflate': 2};
    self.EMPTY_ID = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';

    var _cfg = require('../nodejsagent.json');

    self._logLevel                    = _cfg.logLevel                     || DEFAULT_LOGLEVEL;
    self.logLibrary                   = _cfg.logLibrary                   || DEFAULT_LOGLIBRARY;
    self.allowConsoleLog              = _cfg.allowConsoleLog              || DEFAULT_ALLOWCON;
    self.forceConsoleLog              = _cfg.forceConsoleLog              || DEFAULT_FORCECON;
    self.allowDebugFlagsFromJS        = _cfg.allowDebugFlagsFromJS        || DEFAULT_ALLOWDFFROMJS;

    self.defaultAppName               = _cfg.defaultAppName               || DEFAULT_APPNAME;

    self.nativelib                    = _cfg.nativeLib                    || DEFAULT_NATIVELIB;
    self.libpathMod = _cfg.libpathMod || options.libpathMod || DEFAULT_LIBPATH_MOD;
    self.injectionHeader              = _cfg.injectionHeader              || DEFAULT_INJECTIONHEADER;

    self.scriptsBlackList             = _cfg.scriptsBlackList             || [];
    self.appNameBlackList             = _cfg.appNameBlackList             || [];

    self.native       = null;
    self.cfgAgent     = null;
    self.log          = null;

    self.specHeader   = DEFAULT_SPECHEADER;
    self.JS_PREFIX    = DEFAULT_METHODPREFIX;

    self._stackFilter = DEFAULT_STACKFILTER;

    self._cookieNamesNew = {
        'dtCookie'    : 'rxsession',
        'dtLatC'      : 'rxlatency',
        'dtPC'        : 'rxpc',
        'x-dtPC'      : 'x-rxpc',
        'x-dtReferer' : 'x-rxreferer'
    };

    self.getCookieName = function getCookieName(cookie) {
        return (self.cfgAgent && self.cfgAgent.getUseNewCookies && self.cfgAgent.getUseNewCookies()) ? (self._cookieNamesNew[cookie] || cookie) : cookie;
    };

    self._flags = {};
    Object.keys(_cfg.debugFlags).forEach(function(f) {
        self._flags[f] = _cfg.debugFlags[f];
        // standard setter/getter
        Object.defineProperty(self, f, {
            configurable: true,
            get: function()  { return self.debugAgentActiveNodeJS && self._flags[f].value; },
            set: function(a) { self._flags[f].value = (a === 1 || a === '1' || a === 'true' || a === true); }
        });
    });

    Object.defineProperty(self, 'debugFlags', {
        get: function() { return Object.keys(self._flags); }
    });

    Object.defineProperty(self, 'debugFlagsJSON', {
        get: function() { return JSON.stringify(_cfg.debugFlags); }
    });

    self.getDesc = function(f) { return self._flags[f].desc; };

    // overwrite getter with special version
    Object.defineProperty(self, 'debugAgentActiveNodeJS', {
        get: function()  { return self._flags.debugAgentActiveNodeJS.value; }
    });
    Object.defineProperty(self, 'debugInjectionActiveNodeJS', {
        get: function()  { return self.debugAgentActiveNodeJS && self.debugNativeActiveNodeJS && self._flags.debugInjectionActiveNodeJS.value; }
    });
    Object.defineProperty(self, 'debugLogPatchingNodeJS', {
        get: function()  { return self.debugAgentActiveNodeJS && (self._flags.debugLogPatchingNodeJS.value || self.logLevel === 'DEBUG'); }
    });

    Object.defineProperty(self, 'logLevel', {
        get: function()  { if (self.log) { self._logLevel = self.log.level; } return self._logLevel; },
        set: function(a) { self._logLevel = a; if (self.log) { self.log.level = a; } }
    });
    self.logLevel = _cfg.logLevel;

    self._appName = '';
    Object.defineProperty(self, 'applicationName', {
        get: function()  { return self._appName; },
        set: function(n) { self._appName = n; }
    });

    self.isBlackListed = function isBlackListed(scriptFilename) {
        return (self.scriptsBlackList.indexOf(scriptFilename) >= 0 || self.appNameBlackList.indexOf(self.applicationName) >= 0);
    };


    // list of libs that will be instrumented (they are located in instrumented_modules/ directory)
    self._listOfLibs = fs.readdirSync(path.join(path.dirname(__filename), '../instrumented_modules')).map(function(el) { return el.replace('agent-', '').replace('.js', ''); });
    Object.defineProperty(self, 'listOfLibs', {
        get: function() { return self._listOfLibs; }
    });

    // if there is an "agentName" option or if app was started by "npm start"
    var appName = options.agentName || global.process.env.npm_package_name;
    if (appName) {
        self.applicationName = appName;
    }
    else {
        // try to find package.json file
        var currDir = path.dirname(global.process.mainModule.filename);
        var prevDir = currDir;
        while (true) {
            try {
                appName = require(path.join(currDir, 'package.json')).name;
                if (appName) { break; }
            }
            catch (error) {}
            currDir = path.dirname(currDir);
            if (currDir === prevDir) { break; }
            prevDir = currDir;
        }
        if (appName) {
            self.applicationName = appName;
        }
    }
    if (!self.applicationName) {
        self.applicationName = path.basename(process.argv[1]);   //APM-41280
    }

    return self;
};
