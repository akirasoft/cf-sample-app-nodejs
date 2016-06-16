/*jslint node: true*/
"use strict";

// general req-res handler

var log = global._rx_log;
var cfg = global._rx_cfg;
var cfs = require('./agent-common');
var err = require('./agent-error');
var rrs = require('./req-res-special');

require('./core-process.js');

var uuid = require('node-uuid');
var url  = require('url');


var _rx_req_res_handler_internal = function _rx_req_res_handler_internal(_rx_original, int_args) {
    var req = int_args[0];
    var res = int_args[1];

    var id = process.pid + '-' + uuid.v4();
    if (cfg.debugLogOriginalCallsNodeJS) { log.originalEnter('===== requestHandler', '[' + id + '] '); }
    var nlret;
    var url_parts  = url.parse(req.url);

    // special config urls
    if (url_parts.pathname === '/nodejsagentconfig') {
        return rrs.generateConfigPage(res, url_parts, id);
    }
    else if (url_parts.pathname === '/nodejsagentmoduleversions') {
        res.writeHead(200, 'OK', {'Content-Type': 'text/plain'});
        return res.end(rrs.generateVersionsList());
    }
    else if (url_parts.pathname === '/nodejsagentappfiles') {
        res.writeHead(200, 'OK', {'Content-Type': 'text/plain'});
        return res.end(rrs.generateModuleList(['nodejsagent', 'agentnodejs', 'node_modules', '\.json']));
    }
    else if (url_parts.pathname === '/nodejsagentrequires') {
        res.writeHead(200, 'OK', {'Content-Type': 'text/plain'});
        return res.end(rrs.generateRequireList());
    }
    else if (url_parts.pathname === '/nodejsagentloadedfiles') {
        res.writeHead(200, 'OK', {'Content-Type': 'text/plain'});
        return res.end(rrs.generateModuleList(['nodejsagent', 'agentnodejs']));
    }
    else if (url_parts.pathname === '/nodejsagentloadedfilessall') {
        res.writeHead(200, 'OK', {'Content-Type': 'text/plain'});
        return res.end(rrs.generateModuleList());
    }

    // agent is not active - stop processing
    if (!cfg.debugAgentActiveNodeJS) {
        // return on original invocation -> no exception handling required
        return _rx_original.apply(this, int_args);
    }

    var metadata = new cfs.Metadata(id, req, url_parts);
    res._rx_metadata = metadata;
    res._rx_ppStarted = false;

    req.on('error', function requestError(error)  { err.errorHandler(metadata, 'REQUEST',  error); });
    res.on('error', function responseError(error) { err.errorHandler(metadata, 'RESPONSE', error); });

    if (cfg.debugLogRequestsNodeJS) { log.info(metadata.logHdrS); }
    if (cfg.debugLogHeadersNodeJS)  { log.info(metadata.logHdrM + 'Request headers:\n' + JSON.stringify(req.headers, null, 4)); }

    var reqTypeO     = {};

    if (cfg.debugNativeActiveNodeJS) {
        var addr;
        try { addr = req.connection.server.address(); }
        catch (error) {}

        if (!addr) { addr = {address: '0.0.0.0', port: 80, family: 'IPv4'}; }

        var hdrOrigin   = req.headers.origin || '';          // is this CORS?
        metadata.isCORS = (hdrOrigin !== '');

        var opt_protocol = (req.connection.pair && req.connection.pair.ssl) ? 'https' : 'http';
        var opt = {
            application: {
                name            : cfg.applicationName,
                ip              : addr.address,
                port            : addr.port
            },
            request: {
                scheme          : opt_protocol,
                method          : metadata.method,
                uri             : metadata.url,
                query           : metadata.query || '',
                cookies         : metadata.cookies,
                headers         : req.headers,
                headersLength   : metadata.headers.length,
                headersSpecial  : req.headers[cfg.specHeader],
                clientIP        : metadata.clientIP
            },
            cookies: {
                dtCookie        : metadata.cookieMgr.setCookie,
                dtPC            : metadata.dtPC,
                dtUseDebugAgent : cfs.parseCookie(req.headers.cookie).dtUseDebugAgent || ''
            },
            flags: {
                isCORS          : metadata.isCORS
            }
        };

        if (cfg.debugLogNativeCallsNodeJS) { log.nativeCall('new RequestProcessor'); }
        metadata.reqProc = new cfg.native.RequestProcessor();

        reqTypeO = cfs.callNative(metadata.reqProc, 'handleRequest', [opt]);
        log.debug('reqres>>> reqTypeO = ' + JSON.stringify(reqTypeO));

        metadata.reqType = (reqTypeO.RequestType === undefined ? cfg.REQUEST_TYPE.UNKNOWN : reqTypeO.RequestType);

        metadata.cookieMgr   = new cfs.cookieMgr(reqTypeO.Cookie);
        metadata.dtCookieSet = reqTypeO.dtCookieSet;

        if (!cfg.debugInjectionActiveNodeJS) {
            // injection disabled by config (nodejsagent.json)
            log.debug('reqres>>> INJECTION.DISABLED (reason: "debugInjectionActiveNodeJS" set to false)');
            metadata.injState = cfg.INJECTION.DISABLED;
        }
        if (reqTypeO.Config && !reqTypeO.Config.UemEnabled) {
            // injection disabled by config (native part)
            log.debug('reqres>>> INJECTION.DISABLED (reason: "Config.UemEnabled = false" got from handleRequest native method)');
            metadata.injState = cfg.INJECTION.DISABLED;
        }
        if ((!cfg.debugNodeEnableUemAfterWsNodeJS) && req.headers[cfg.specHeader]) {
            // injection disabled by special header x-dynatrace
            // x-dynatrace header should usually _not_ disabling UEM injection, see ONE-1017 for details
            log.debug('reqres>>> INJECTION.DISABLED (reason: "' + cfg.specHeader + ' in request headers")');
            metadata.injState = cfg.INJECTION.DISABLED;
        }

        if (reqTypeO.DebugFlags && !cfg.allowDebugFlagsFromJS) {
            Object.keys(reqTypeO.DebugFlags).forEach(function setDebugFlag(f) {
                if (cfg[f] !== reqTypeO.DebugFlags[f]) {
                    log.info('[' + cfg.EMPTY_ID + '] ' + f + ' : ' + cfg[f] + ' -> ' + reqTypeO.DebugFlags[f]);
                    cfg[f] = reqTypeO.DebugFlags[f];
                }
            });
        }
    }
    else {
        metadata.reqType = cfg.REQUEST_TYPE.REGULAR;
    }

    if (cfg.debugMetadumpActiveNodeJS) { log.dumpData(metadata.logHdrM, 'METADUMP', metadata); }

    if (metadata.reqType === cfg.REQUEST_TYPE.REGULAR) {
        res._rx_ppStarted = true;

        var that = this; //added this to function closure
        process.withListener(metadata, {}, function (listener) {
            metadata.listener = listener;

            // apply header changes from native code (basically RUM headers like dtCookie stuff)
            var hName = "";
            if (reqTypeO.changedRequestHeaders) {
                for (hName in reqTypeO.changedRequestHeaders) {
                    log.debug('reqres>>> adding REQUEST header: ' + hName + ' -> ' + reqTypeO.changedRequestHeaders[hName]);
                    req.headers[hName.toLowerCase()] = reqTypeO.changedRequestHeaders[hName];
                }
            }
            if (reqTypeO.changedResponseHeaders) {
                for (hName in reqTypeO.changedResponseHeaders) {
                    res.setHeader(hName, reqTypeO.changedResponseHeaders[hName]);
                }
            }

            // regular request (will be passed to application)
            // no side effects -> no exception handling required
            nlret = cfs.callOriginal(that, _rx_original, 'original requestHandler', int_args);
        });
    }
    else if (metadata.reqType === cfg.REQUEST_TYPE.AGENT) {
        // special request (request for JS agent)
        nlret = rrs.handleJSAgentRequest(res, req, metadata, reqTypeO.Body, reqTypeO.responseStatusCode, reqTypeO.changedResponseHeaders);
    }
    else if (metadata.reqType === cfg.REQUEST_TYPE.HEALTHCHECK) {
        // healthcheck page
        nlret = rrs.handleHealthCheckPage(res, req, metadata, reqTypeO.Body, reqTypeO.changedResponseHeaders);
    }
    else if (metadata.reqType === cfg.REQUEST_TYPE.BEACON || metadata.reqType === cfg.REQUEST_TYPE.BEACON_CORS) {
        // beacon and cors signal
        nlret = rrs.handleBeaconCors(res, req, metadata, metadata.isCORS);
    }
    else if (metadata.reqType === cfg.REQUEST_TYPE.BANDWIDTH) {
        nlret = rrs.handleGenericSpecialRequest(res, reqTypeO.Body, reqTypeO.responseStatusCode, reqTypeO.changedResponseHeaders);
    }
    else {
        // other - not known request type
        // log warning only if it's not NOT_ACTIVE (OS Agent is working)
        if (metadata.reqType !== cfg.REQUEST_TYPE.NOT_ACTIVE) {
            log.warn(metadata.logHdrM + 'Warning! Unsupported request type (' + metadata.reqType + ')');
        }
        metadata = new cfs.Metadata();
        res._rx_metadata = metadata;
        nlret = cfs.callOriginal(this, _rx_original, 'original requestHandler', int_args);
    }

    if (cfg.debugNativeActiveNodeJS && metadata.isValid()) { cfs.callNative(metadata.reqProc, 'methodSuspend', []); }

    if (cfg.debugLogOriginalCallsNodeJS) { log.originalExit('===== requestHandler', '[' + id + '] '); }

    return nlret;
};


module.exports._rx_req_res_handler = function _rx_req_res_handler(_rx_original) {
    // arguments: [original_handler, req, res, next]
    var int_args = Array.prototype.slice.call(arguments);
    int_args.shift();

    // var req = int_args[0];
    var res = int_args[1];

    // skip processing if it's already been done (in another listener)
    if (res._rx_metadata) {
        // do nothing if request was handled by the nodejs agent
        if (res._rx_metadata.reqType === cfg.REQUEST_TYPE.AGENT       ||
            res._rx_metadata.reqType === cfg.REQUEST_TYPE.BEACON      ||
            res._rx_metadata.reqType === cfg.REQUEST_TYPE.BEACON_CORS ||
            res._rx_metadata.reqType === cfg.REQUEST_TYPE.HEALTHCHECK) {
            return;
        }

        var result;
        process.withListener(res._rx_metadata, {}, function () {
            // do regular processing (without the agent)
            result = _rx_original.apply(this, int_args);
        });
        return result;
    }

    var rx_req_res_handler_internal = _rx_req_res_handler_internal.bind(this, _rx_original, int_args);

    return rx_req_res_handler_internal();

};
