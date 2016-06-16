/*jslint node: true*/
"use strict";

var verID = '6.3.0201';

module.exports = exports.nodejsagent = function nodejsagent(options) {


var semver = require('semver');
var nodejsVer = semver.clean(process.version);
// we're supporting only v0.10.xx, v0.12.xx and v4.x.x of nodejs
if (!semver.satisfies(nodejsVer, '0.10') && !semver.satisfies(nodejsVer, '0.12') && !semver.satisfies(nodejsVer, '4.x.x') && !semver.satisfies(nodejsVer, '5.x.x')) {
    console.error('Node.js version ' + process.version + ' is not supported. Agent disabled.');
    return;
}


if (global._rx_amIinjectedYet) { return; }
global._rx_amIinjectedYet = true;


global._rx_modules     = [];
global._rx_modulesInfo = {};

// standard nodeJS library
var module      = require('module');
var util        = require('util');
var path        = require('path');
var timers      = require('timers');

Error.stackTraceLimit = 20;

// agent libraries
var jsalogger = require('./lib/agent-logger');
var jsaconfig = require('./lib/agent-config');
var cfs = require('./lib/agent-common');
var err = require('./lib/agent-error');

var cfg = new jsaconfig.JSAconfig(options);
global._rx_cfg = cfg;


var memwatch;
var blacklisted = false;

cfg.allowConsoleLog = cfg.forceConsoleLog || (('loglevelcon' in options) ? (options.loglevelcon !== 'none') : cfg.allowConsoleLog);

// checking blacklisted apps
var scriptFilename = path.basename(process.argv[1]);
if (cfg.isBlackListed(scriptFilename)) {
    if (cfg.allowConsoleLog) { console.log('>>> nodejsAgent: "' + scriptFilename + '" (' + cfg.applicationName + ') is blacklisted. Skipping instrumentation.'); }
    blacklisted = true;
}


var log = new jsalogger.JSAlogger(cfg.logLevel, cfg.logLibrary, null, cfg.allowConsoleLog);
cfg.log = log;
global._rx_log = log;

log.info('=== Agent [start] ===');
log.info('  * Platform   : ' + global.process.platform);
log.info('  * Arch       : ' + global.process.arch);
log.info('  * Node ver.  : ' + global.process.version);
log.info('  * Agent ver. : ' + verID);
log.info('  * Script     : ' + scriptFilename);
log.info('  * AppName    : ' + cfg.applicationName);
log.info('  * Blacklisted: ' + blacklisted);
log.info('  * LogLevel   : ' + log.level);

cfg.EMPTY_ID = new Array(process.pid.toString().length + 1).join('x') + '-' + cfg.EMPTY_ID;


if (cfg.debugNativeActiveNodeJS) {
    if (semver.major(nodejsVer) === 0) {
        // v0.10.xx and v0.12.xx
        cfg.nativelib += semver.minor(nodejsVer).toString();
    }
    else {
        // v4.x, v5.x and all next versions (which use semantic versioning - semver)
        cfg.nativelib += '_v' + semver.major(nodejsVer);
    }

    var lib_path = cfg.libpathMod;
    switch (global.process.platform) {
        case 'win32':
            lib_path += 'windows-x86-';
            break;
        case 'linux':
            lib_path += 'linux-x86-';
            break;
        default:
            log.error('Agent injection aborted as platform is not supported: ' + global.process.platform);
            break;
    }
    switch (global.process.arch) {
        case 'x64':
            lib_path += '64';
            break;
        default:
            lib_path += '32';
            break;
    }
    lib_path += '/' + cfg.nativelib;
    try {
        log.info('*** Loading native extension [' + lib_path + '] ***');
        cfg.native = require(lib_path);
    } catch (error) {
        log.info('*** failed to load native extension [' + lib_path + '] ***');
    }

    // in case of failure try fallback location
    if (!cfg.native) {
        lib_path = cfg.libpathMod + 'lib';
        if (global.process.arch === 'x64') { lib_path += '64'; }
        lib_path += '/' + cfg.nativelib;
            
        log.info('*** Loading native extension [' + lib_path + '] ***');
        cfg.native = require(lib_path);
    }

    try {
        // convert options object to to comma seperated string (e.a. tenant=abcd,tenanttoken=1234,debugLoaderNodeJs=true)
        var optString = Object.keys(options).map(function (key) {
            return key + '=' + options[key];
        }).join();

        // backward compat to older native API: extend options with debugFlagsFromJS and pass it as first argument
        // to CommHandler. Old native APIs use only first argument, newer ones only the remaining 
        if (cfg.allowDebugFlagsFromJS) {
            options.debugFlagsFromJS = true;
        }
        cfg.cfgAgent = new cfg.native.CommHandler(options, optString, cfg.nativelib, cfg.allowDebugFlagsFromJS);

        if (!cfg.cfgAgent) { throw new Error('Can\'t create CommHandler'); }

        // prepare native logging facility
        log.native   = cfg.cfgAgent.log;
        log.reconfigure();

        // application name
        cfg.applicationName = cfg.cfgAgent.getApplicationName().AppName;

        // repeat basic info log
        log.info('  * Platform   : ' + global.process.platform);
        log.info('  * Arch       : ' + global.process.arch);
        log.info('  * Node ver.  : ' + global.process.version);
        log.info('  * Agent ver. : ' + verID);
        log.info('  * Script     : ' + scriptFilename);
        log.info('  * AppName    : ' + cfg.applicationName);
        log.info('  * Blacklisted: ' + blacklisted);
        log.info('  * LogLevel   : ' + log.level);

        // how to check any debug flag value in the beginning: cfs.callNative(cfg.cfgAgent, 'getDebugFlags', []).DebugFlags.debugMongoDBNodeJS === true;
        if (cfg.allowDebugFlagsFromJS) {
            log.info('*** Updating debug flags from JSON config ***');
            cfs.callNative(cfg.cfgAgent, 'setDebugFlags', [cfg.debugFlagsJSON]);
        }
        else {
            log.info('*** Updating debug flags from debugUI config ***');
            cfs.updateConfig(cfs.callNative(cfg.cfgAgent, 'getDebugFlags', []).DebugFlags);
        }
    }
    catch (error) {
        log.error('ERROR! Agent injection aborted: ' + error.toString());
        return;
    }
}

process.on('exit', function exitHandler() {
    log.info('=== Application [ ' + cfg.applicationName + ' ] end ===');
    if (memwatch) { timers.clearInterval(memwatch); }
    log.info('SHUTTING DOWN THE NODEJS AGENT');
    if (cfg.debugNativeActiveNodeJS) {
        cfg.cfgAgent.shutdown();
    }
});

process.on('SIGINT', function sigintHandler() {
    // if there's only one (this one) callback for SIGING defined, then we have to exit;
    // otherwise - we depend on the listeners defined in monitored application
    if (process.EventEmitter.listenerCount(process, 'SIGINT') === 1) {
        process.exit();
    }
});

if (!blacklisted) {
    process.on('uncaughtException', function uncaughtExceptionHandler(error) {
        try {
            log.info('UncaughtException!');
            if (error && error instanceof Error) { //currently we can only handle REAL error objects
                var fs = require('fs');
                var errorInfo = err.getStacktraceInfoDict(error);
                //if callstack to uncaught exception has agent frames -> support alert
                if (cfg.debugNativeActiveNodeJS) {
                    log.info(errorInfo.getOriginalStackErrMsg() || error.toString() || 'Unknown uncaughtException');
                    if (errorInfo.hasAgentFrame()) {
                        cfs.callNative(cfg.cfgAgent, 'supportAlert', [errorInfo.getOriginalStackErrMsg(), process.execPath]);
                    }
                }
                    
                //any other uncaughtException handlers registered -> return right away
                if (process.listeners('uncaughtException').length > 1) { return; }
                    
                //else we mimic the original node js uncaught exception log:
                try {                    
                    var lastFrame = errorInfo.getOriginalFrames()[0];
                    console.error(lastFrame.getFileName() + ':' + lastFrame.getLineNumber());
                    var sourceFileLines = fs.readFileSync(lastFrame.getFileName(), 'utf8').split(/\r?\n/);
                    console.error(sourceFileLines[lastFrame.getLineNumber() - 1]);
                    console.error(Array(lastFrame.getColumnNumber()).join(' ') + '^');
                } catch (e) {
                    console.error('');
                }
                console.error(errorInfo.getFilteredStackErrMsg() || error.toString() || 'Unknown uncaughtException');
                
            } else {
                //basically anything can be thrown in javascript. Everything else but a real error object is handled here
                log.info('Unknown uncaughtException: error object is ' + error);
                console.error('Unknown uncaughtException: error object is ' + error);
            }
        } finally {
            process.exit(1);
        }
    });

    if (cfg.debugNativeActiveNodeJS) {
        memwatch = timers.setInterval(function() {
            if (!cfg.cfgAgent) {
                log.error('There\'s no CommHandler! Disabling the agent...');
                if (cfg) { cfg.debugAgentActiveNodeJS = false; }
                if (memwatch) { timers.clearInterval(memwatch); }
                return;
            }
            var mtr = process.memoryUsage();
            cfg.cfgAgent.memoryUsage(mtr.heapTotal, mtr.heapUsed, mtr.rss);
        }, 10*1000);
        memwatch.unref();
    }

    global._rx_extensions_js = module._extensions[".js"];

    log.info('*** Hooking to module load procedure ***');
    if (!global._rx_moduleLoad) {
        global._rx_moduleLoad = module._load;
    }
    module._load = require('./lib/agent-instrumentation')._instrumentedModuleLoad;

    // list of required modules that need to be instrumented at the very beginning
    require('events');
    require('net');
}

if (global.v8debug === undefined) {
    // util.inspect has a known issue running in debug mode
    log.info('Agent options: ' + util.inspect(options));
}
log.info('=== Agent [ end ] ===');
log.info('');
log.info('=== Application [ ' + cfg.applicationName + ' ] start ===');

};
