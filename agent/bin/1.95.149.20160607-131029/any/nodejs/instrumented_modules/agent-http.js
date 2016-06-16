/*jslint node: true*/
/** @module instrumented_modules/agent-http */
"use strict";

var core = require('../lib/core.js');

// require the original module
var http = require('http');

var log = global._rx_log;
var cfg = global._rx_cfg;
var cfs = require('../lib/agent-common');
var err = require('../lib/agent-error');

var url     = require('url');
var util    = require('util');
var events  = require('events');


http._rx_PROTO_DEFAULT = {PROTOCOL: 'http:',  PORT: 80,  MODULE: 'http'};

http.Server.prototype._rx_req_res_handler = require('../lib/req-res-handler')._rx_req_res_handler;


// this has to run always to overwrite the eventemitter prototype
if (!http.Server.prototype._rx_addListenerWrapped) {
    if (cfg.debugLogPatchingNodeJS) { log.info('     > patching [http.Server.prototype.addListener]'); }
    http.Server.prototype._rx_addListener = http.Server.prototype.addListener;
    http.Server.prototype._rx_addListenerWrapped = true;
    http.Server.prototype.addListener = function http_Server_addListener(type, listener) {
        log.debug('* "' + type + '" listener...');

        if (type === 'request') {
            log.debug("NEW SERVER REQUEST LISTENER REGISTERED - now are: " + (this.listeners('request').length + 1));
        }

        var argsNew = [type, listener];

        if (type === 'request') {
            log.debug('  * Registering...');
            var new_listener = this._rx_req_res_handler.bind(this, listener);
            argsNew[1] = new_listener;
        }

        return this._rx_addListener.apply(this, argsNew);
    };
}

if (cfg.debugLogPatchingNodeJS) { log.info('     > patching [http.Server.prototype.on]'); }
http.Server.prototype.on = http.Server.prototype.addListener;


if (!http.IncomingMessage.prototype._rx_addHeaderLine) {
    if (cfg.debugLogPatchingNodeJS) { log.info('     > patching [http.IncomingMessage.prototype._addHeaderLine]'); }
    var rx_addHeaderLine = function http_req_addHeaderLine(field, value) {
        log.debug('_addHeaderLine >>> [enter]: ' + field + ' -> ' + value);
        if (!cfg.debugAgentActiveNodeJS) { return this._rx_addHeaderLine.apply(this, arguments); }

        if (!this.allHeaders) { this.allHeaders = []; }
        this.allHeaders.push(field + ': ' + value);
        return this._rx_addHeaderLine.apply(this, arguments);
    };
    http.IncomingMessage.prototype._rx_addHeaderLine = http.IncomingMessage.prototype._addHeaderLine;
    http.IncomingMessage.prototype._addHeaderLine = rx_addHeaderLine;
}


function httpResponseSetHeaderEnter(ctx) {
    var name  = ctx._arguments[0];
    var value = ctx._arguments[1];
    log.debug('setHeader >>> [enter]: ' + name + ' -> ' + value);

    if (ctx._this._rx_headersBuffered) { ctx._this._header = ''; }

    // if there's something wrong with parameters let the nodejs handle this (most probably throw an exception)
    if (ctx._arguments.length >= 2 && !ctx._this._header && typeof name === 'string' && value !== undefined && ctx._this.statusCode) {
        if (ctx.metadata.isValid() && ctx.metadata.reqType === cfg.REQUEST_TYPE.REGULAR) {
            switch (name.toLowerCase()) {
                case 'content-type'     : ctx.metadata.content.type     = value; break;
                case 'content-encoding' : ctx.metadata.content.encoding = value; break;
                case 'content-length'   : {
                    ctx.metadata.content.length = value;
                    try { ctx.metadata.content.length = parseInt(ctx.metadata.content.length, 10); }
                    catch (error) { }
                    break;
                }
            }
        }

        log.debug(ctx.metadata.logHdrM + ' * Setting header: [' + name + '] -> [' + value + ']');
    }
}

function httpResponseSetHeaderExit(ctx) {
    log.debug('setHeader >>> [exit]');
    if (ctx._this._rx_headersBuffered) { ctx._this._header = 'dummy_toy'; }
}

core.wrap(http.OutgoingMessage.prototype, 'setHeader', {
    type: core.CallbackType.noCallback,
    enter: httpResponseSetHeaderEnter,
    exit: httpResponseSetHeaderExit,
    contextFromThis: true
});


function httpResponseRemoveHeaderEnter(ctx) {
    var name = ctx._arguments[0];
    log.debug('removeHeader >>> [enter]: ' + name);

    if (ctx._arguments.length >= 1 && !ctx._this._header && typeof name === 'string' && ctx._this.statusCode) {
        if (ctx.metadata.isValid() && ctx.metadata.reqType === cfg.REQUEST_TYPE.REGULAR) {
            switch (name.toLowerCase()) {
                case 'content-type'     : ctx.metadata.content.type     = cfs.DEFAULT.CONTENT_TYPE;     break;
                case 'content-encoding' : ctx.metadata.content.encoding = cfs.DEFAULT.CONTENT_ENCODING; break;
                case 'content-length'   : ctx.metadata.content.length   = cfs.DEFAULT.CONTENT_LENGTH;   break;
            }
        }

        log.debug(ctx.metadata.logHdrM + ' * Removing header: [' + name + ']');

        if (ctx._this._rx_headersBuffered) { ctx._this._header = ''; }
    }
}

function httpResponseRemoveHeaderExit(ctx) {
    log.debug('removeHeader >>> [exit]');
    if (ctx._this._rx_headersBuffered) { ctx._this._header = 'dummy_toy'; }
}
core.wrap(http.OutgoingMessage.prototype, 'removeHeader', {
    type: core.CallbackType.noCallback,
    enter: httpResponseRemoveHeaderEnter,
    exit: httpResponseRemoveHeaderExit,
    contextFromThis: true
});


function httpResponseStoreHeaderEnter(ctx) {
    //var firstLine = ctx._arguments[0];
    var headers   = ctx._arguments[1] || {};
    log.debug('_storeHeader >>> [enter]');

    // here modify Set-Cookie or Cookie header
    // if ctx._this.statusCode is set - we are in context of response, else - we are in context of outgoing request
    // this implies: if this is a response - we are setting Set-Cookie header, if this is outgoing request - we are setting Cookie header
    if (ctx.metadata.cookieMgr.cookie) {
        if (ctx._this.statusCode) {
            if (ctx.metadata.dtCookieSet) {

                var allSetCookie = headers['Set-Cookie'];
                if (!allSetCookie) { allSetCookie = []; }
                if (!Array.isArray(allSetCookie)) { allSetCookie = [allSetCookie]; }

                var dtCookieExists = false;
                allSetCookie.forEach(function(e) {
                    if (cfs.str_startsWith(e, cfg.getCookieName('dtCookie'))) {
                        dtCookieExists = true;
                    }
                });
                if (!dtCookieExists) {
                    log.debug(ctx.metadata.logHdrM + ' ... Modifying Set-Cookie header (adding: ' + ctx.metadata.cookieMgr.setCookie + ')');
                    allSetCookie.push(ctx.metadata.cookieMgr.setCookie);
                }
                else {
                    log.debug(ctx.metadata.logHdrM + ' ... dtCookie in Set-Cookie header already exists');
                }
                if (allSetCookie) { headers['Set-Cookie'] = allSetCookie; }
            }
            else {
                log.debug(ctx.metadata.logHdrM + ' ... dtCookie in Set-Cookie header won\'t be set: reqTypeO.dtCookieSet = false');
            }
        }
        else {
            if (!headers.Cookie) { headers.Cookie = ''; }
            if (headers.Cookie.indexOf(cfg.getCookieName('dtCookie')) < 0) {
                log.debug(ctx.metadata.logHdrM + ' ... Modifying Cookie header (adding: ' + ctx.metadata.cookieMgr.cookie + ')');
                headers.Cookie = [headers.Cookie, ctx.metadata.cookieMgr.cookie].filter(function(e) { return e; }).join('; ');
            }
            else {
                log.debug(ctx.metadata.logHdrM + ' ... dtCookie in Cookie header already exists');
            }
            if (!headers.Cookie) { delete(headers.Cookie); }
        }
    }


    if (ctx.metadata.isValid() && ctx.metadata.reqType === cfg.REQUEST_TYPE.REGULAR && ctx._this.statusCode) {
        if (headers['Content-Type'])        { headers['Content-Type']     = ctx.metadata.content.type     || headers['Content-Type']     || cfs.DEFAULT.CONTENT_TYPE; }
        if (headers['Content-Encoding'])    { headers['Content-Encoding'] = ctx.metadata.content.encoding || headers['Content-Encoding'] || cfs.DEFAULT.CONTENT_ENCODING; }
        if (headers['Content-Length'] >= 0) { headers['Content-Length']   = (ctx.metadata.content.length >= 0 ? ctx.metadata.content.length : (headers['Content-Length'] || 0)); }

        if (headers['Content-Type'])        { ctx.metadata.content.type     = headers['Content-Type'];     }
        if (headers['Content-Encoding'])    { ctx.metadata.content.encoding = headers['Content-Encoding']; }
        if (headers['Content-Length'] >= 0) { ctx.metadata.content.length   = headers['Content-Length'];   }

        Object.keys(headers).forEach(function(el) {
            log.debug(ctx.metadata.logHdrM + ' ... ' + el + ' -> ' + headers[el]);
        });

        if (ctx._this._rx_headersBuffered) { ctx._this._header = ''; }
    }
}

function httpResponseStoreHeaderExit(ctx) {
    log.debug('_storeHeader >>> [exit]');
    if (cfg.debugLogHeadersNodeJS && ctx.metadata.isValid()) {
        var type = ctx._this.statusCode ? 'Response' : 'Outgoing request';
        log.info(ctx.metadata.logHdrM + type + ' headers:\n' + ctx._this._header);
    }
}

core.wrap(http.OutgoingMessage.prototype, '_storeHeader', {
    type: core.CallbackType.noCallback,
    enter: httpResponseStoreHeaderEnter,
    exit: httpResponseStoreHeaderExit,
    contextFromThis: true
});


function httpResponseWriteHeadInstead(ctx) {
    log.debug('writeHead >>> [instead]');
    // ctx._arguments: [statusCode, reasonPhrase, headers];
    var args = []; for (var i = 0; i < ctx._arguments.length; i++) { args.push(ctx._arguments[i]); }

    if (ctx._this._rx_writeHeadForce || ctx.metadata.hdrArgs) {
        log.debug('writeHead >>> force writing headers');
        ctx._this._header = '';
        ctx._this._rx_headersBuffered = false;

        // if there's Content-Encoding and Content-Length headers - remove Content-Length and put Transfer-Encoding=chunked instead
        if (ctx._this.getHeader('Content-Encoding') && ctx.metadata.content.length >= 0) {
            log.debug('writeHead >>> switching to Transfer-Encoding: chunked and removing Content-Length');
            log.debug(ctx.metadata.logHdrM + 'Switching to "Transfer-Encoding: chunked" and removing Content-Length');
            ctx._this.removeHeader('Content-Length');
            ctx._this.setHeader('Transfer-Encoding', 'chunked');
        }

        log.debug('writeHead >>> metadata is ' + (ctx.metadata.isValid() ? '' : 'in') + 'valid');
        log.debug('writeHead >>> arguments = ' + JSON.stringify(ctx._arguments));
        log.debug('writeHead >>> metadata.hdrArgs = ' + JSON.stringify(ctx.metadata.hdrArgs));
        log.debug('writeHead >>> [this.statusCode] = ' + JSON.stringify([ctx._this.statusCode]));
        if (!ctx._this.statusCode || args.length === 0) { args = ctx.metadata.hdrArgs || [200]; }
        log.debug('writeHead >>> call original res.writeHead(' + util.inspect(args) + ')');
        log.debug('writeHead >>> exit(0)');

        // return on original invocation -> no exception handling required
        return ctx.callOriginal(args);
    }

    if (!ctx.metadata.isValid() || ctx.metadata.reqType !== cfg.REQUEST_TYPE.REGULAR || ctx.metadata.injState === cfg.INJECTION.DISABLED) {
        log.debug('writeHead >>> exit(2)');
        // return on original invocation -> no exception handling required
        return ctx.callOriginal();
    }

    log.debug('writeHead >>> buffering headers');
    ctx._this._header = 'dummy_toy';
    ctx._this._rx_headersBuffered = true;

    var headers = args.pop();
    if (typeof headers === 'object') {   // so there are actually headers that need to be set
        for (var header in headers) {    // we need to store all headers
            log.debug('writeHead >>> call setHeader(' + header + ', ' + headers[header] + ')');
            ctx._this.setHeader(header, headers[header]);
        }
    }
    else {                               // no headers here; push back the last argument to the list (it's statusCode or reasonPhrase)
        args.push(headers);
    }

    ctx.metadata.hdrArgs = args;          // store arguments (without already stored headers) for real writeHead call
    log.debug('writeHead >>> metadata.hdrArgs = ' + JSON.stringify(ctx.metadata.hdrArgs));

    ctx._this._rx_writeHeadForce = true;
    log.debug('writeHead >>> exit(X)');
}

core.wrap(http.ServerResponse.prototype, 'writeHead', {
    type: core.CallbackType.noCallback,
    instead: httpResponseWriteHeadInstead,
    contextFromThis: true
});


function genWriteEndInstead(method) {
    return function httpResponseWriteEndInstead(ctx) {
        var data     = ctx._arguments[0];
        var encoding = ctx._arguments[1];
        var callback = ctx._arguments[2];

        var hdr = method + ' >>> ';
        var isWrite = method === 'write';
        var args = [data, encoding, callback];
        log.debug(hdr + 'enter');

        // is the agent active and is this object a response object (has statusCode field)
        // the outgoing request object (which is also an OutgoingMessage object) doesn't have that
        if (!cfg.debugAgentActiveNodeJS || !ctx._this.statusCode) {
            log.debug(hdr + 'exit(1); not monitored; calling original res.' + method + '()');
            ctx._this._rx_writeHeadForce = true;
            if (!ctx._this.statusCode && typeof args[0] === 'function') { args[0] = ''; }
            if (cfg.debugDatadumpActiveNodeJS) { log.dumpData(ctx.metadata.logHdrM, 'OUTDUMP (enc: ' + (encoding || 'utf8') + ')', data); }

            // return on original invocation -> no exception handling required
            return ctx.callOriginal(args);
        }

        if (typeof data === 'function') {
            callback = data;
            data = null;
        }
        else if (typeof encoding === 'function') {
            callback = encoding;
            encoding = null;
        }

        // no data in res.write() - do the same as nodejs itself
        if (isWrite && (!data || data.length === 0)) { log.debug(hdr + 'exit(2); no data! just returning...'); return true; }

        args = [data, encoding, callback];

        if (!ctx.metadata.isValid() || ctx.metadata.reqType !== cfg.REQUEST_TYPE.REGULAR || ctx.metadata.injState === cfg.INJECTION.DISABLED) {
            log.debug(hdr + 'exit(4); no injection; calling original');
            if (isWrite) {
                ctx._this._rx_writeHeadForce = true;
                if (cfg.debugDatadumpActiveNodeJS) { log.dumpData(ctx.metadata.logHdrM, 'OUTDUMP (enc: ' + (encoding || 'utf8') + ')', data); }
                // return on original invocation -> no exception handling required
                return ctx.callOriginal(args);
            }
            else {
                log.debug(hdr + 'exit(4); no injection; calling res.end() -> closing...');
                return responseClose(ctx._this, ctx.metadata, args);
            }
        }

        if (!!data) {
            log.debug(hdr + 'there are some data');
            //log.debug(hdr + 'data = [' + require('util').inspect(data) + ']');

            if (!isWrite) {
                // if there's some data and it's res.end() method -> call res.write(data) and then res.end()
                log.debug(ctx.metadata.logHdrM + '>>> res.end(data, encoding, callback) -> res.write(data, encoding); res.end(callback)');
                log.debug(hdr + 'res.end(data, encoding, callback) -> res.write(data, encoding); res.end(callback)');
                log.debug(hdr + 'calling res.write()');
                try {
                    ret = ctx._this.write.call(ctx._this, data, encoding);
                    log.debug(hdr + 'back from res.write()');
                    data = null;
                    encoding = null;
                } catch (e) {
                    log.info("unhandled exception: " + e);
                    throw e;
                }
            }
            else if (typeof data !== 'string' && !Buffer.isBuffer(data)) {
                // if there's some data and it's res.write() -> check data type and pass all to original function (an exception will be thrown by nodejs)
                log.warn(ctx.metadata.logHdrM + 'Data passed to res.' + method + '() is not a string nor a buffer!');
                log.debug(hdr + 'data is not a string nor a buffer');
                log.debug(hdr + 'exit(3); invalid data type; calling original');
                ctx._this._rx_writeHeadForce = true;
                if (cfg.debugDatadumpActiveNodeJS) { log.dumpData(ctx.metadata.logHdrM, 'OUTDUMP (enc: ' + (encoding || 'utf8') + ')', data); }

                // return on original invocation -> no exception handling required
                return ctx.callOriginal(args);
            }
        }

        // if this is the first call, notify the native side about starting response handling
        if (!ctx.metadata.responseStarted) {
            ctx.metadata.responseStarted = true;
            log.debug(hdr + 'calling native responseStarted');
            var respStartedRetObj = cfs.callNative(ctx.metadata.reqProc, 'responseStarted', [ctx._this._headers]);
            if (respStartedRetObj && respStartedRetObj.changedHeaders && ctx._this._header && (ctx._this._header.length === 0 ||ctx._this._header === "dummy_toy")) {
                for (var hName in respStartedRetObj.changedHeaders) {
                    log.debug(hdr + 'after native call: updating header ' + hName + ' to value ' + respStartedRetObj.changedHeaders[hName]);
                    ctx._this.setHeader(hName, respStartedRetObj.changedHeaders[hName]);
                }
            }

            if (!respStartedRetObj || !respStartedRetObj.injectionActive) {
                ctx.metadata.injState = cfg.INJECTION.DISABLED;
                // carry on -- we might have some deferred headers that have to be written
            }
        }

        var ret = true;

        // remember type of data and encoding (if it was not set before)
        if (ctx.metadata.sendEnc === null && encoding) { log.debug(hdr + 'set encoding to ' + encoding); ctx.metadata.sendEnc = encoding; }

        var dataInLen  = !!data ? (typeof data === 'string' ? Buffer.byteLength(data, encoding) : data.length) : 0;
        var dataOutLen = dataInLen;
        log.debug(hdr + 'dataInLen  = ' + dataInLen);
        log.debug(hdr + 'dataOutLen = ' + dataOutLen);

        // how many data should be sent (initially)
        ctx.metadata.toSend += dataInLen;
        log.debug(hdr + 'ctx.metadata.toSend set to ' + ctx.metadata.toSend);

        // call the callback if it's present
        if (callback && typeof callback === 'function') {
            log.debug(hdr + 'SCHEDULING CALLBACK');
            process.nextTick(callback);
        }

        if (cfg.debugInjectionActiveNodeJS &&
            (ctx.metadata.injState === cfg.INJECTION.NEED_MORE ||
             ctx.metadata.injState === cfg.INJECTION.NEED_MORE_CHUNKING) &&
            (!ctx.metadata.content.type || cfs.str_startsWith(ctx.metadata.content.type, 'text/html'))) {

            log.debug(hdr + 'THERE WILL BE CALL TO INJECTION');
            var injectionState = { InjectedFrag:    data,
                                   Injected:        ctx.metadata.injState, //cfg.INJECTION.NEED_MORE,
                                   TagLen:          0,
                                   encoding:        encoding,
                                   dataOutLen:      0,
                                   alreadyBuffered: false
                                 };

            // UEMinjection is changing ctx and (IMPORTANT!) injectionState
            var isBuffered = UEMinjection(ctx, injectionState, hdr, isWrite);
            if (isBuffered) { return true; }   // not doing anything else, just return from write/end

            if (!injectionState.alreadyBuffered) {
                data       = injectionState.InjectedFrag;
                dataOutLen = injectionState.dataOutLen;
            }
        }
        else {
            log.debug(hdr + 'NO CALL TO INJECTION!');
        }

        // If we're here then we need to write all headers and buffered data
        ctx._this._rx_writeHeadForce = true;

        // check if there are delayed headers
        if (ctx.metadata.hdrArgs) {
            log.debug(hdr + 'NEED TO WRITE HEADERS, calling res.writeHeaders()');
            try {
                ctx._this.writeHead.call(ctx._this);
                log.debug(hdr + 'back from res.writeHeaders()');
                ctx.metadata.hdrArgs = null;
            } catch (e) {
                log.info("unhandled exception: " + e);
                throw e;
            }
        }

        // write buffered data
        if (!ctx._this._rx_buffer) { ctx._this._rx_buffer = []; }
        if (!!data) {
            ctx._this._rx_buffer.push([data, encoding]);
            log.debug(hdr + 'push current data into buffer');
        }
        log.debug(hdr + 'ctx._this._rx_buffer.length = ' + ctx._this._rx_buffer.length);
        while (ctx._this._rx_buffer.length > 0) {
            var buff = ctx._this._rx_buffer.shift();

            // log in/out data length
            ctx.metadata.sent += buff[0].length;
            log.debug(ctx.metadata.logHdrM + 'write() -> ' + buff[0].length.toString(10));

            log.debug(hdr + 'WRITING BUFFER (len = ' + buff[0].length + ')');
            log.debug(hdr + 'calling original res.write()');
            if (cfg.debugDatadumpActiveNodeJS) { log.dumpData(ctx.metadata.logHdrM, 'OUTDUMP (enc: ' + (encoding || 'utf8') + ')', buff); }
            ret = ctx._this._rx_write.apply(ctx._this, buff);
            log.debug(hdr + 'back from original res.write()');
        }

        log.debug(hdr + 'exit(X)');
        if (isWrite) { return ret; }
        return responseClose(ctx._this, ctx.metadata, []);
    };
}

core.wrap(http.OutgoingMessage.prototype, 'write', {
    type: core.CallbackType.callbackLast,
    instead: genWriteEndInstead('write'),
    contextFromThis: true
});

core.wrap(http.OutgoingMessage.prototype, 'end', {
    type: core.CallbackType.callbackLast,
    instead: genWriteEndInstead('end'),
    contextFromThis: true
});


function responseClose(_this, metadata, args) {
    log.debug('resClose >>> [enter]');
    _this._rx_writeHeadForce = true;

    log.debug('resClose >>> _this._rx_ppStarted = ' + _this._rx_ppStarted.toString());
    log.debug('resClose >>> CALLING ORIGINAL RES.END()');
    try {
        var ret = _this._rx_end.apply(_this, args);
        log.debug('resClose >>> BACK FROM ORIGINAL RES.END()');
        return ret;
    } finally {
        if (cfg.debugNativeActiveNodeJS && _this._rx_ppStarted) {
            if (!metadata.wasClosed) {
                log.debug('resClose >>> metadata was not closed yet (OK)');

                var headerLength = _this._header ? _this._header.length : 0;
                log.debug('resClose >>> CALLING NATIVE handleResponse()');
                cfs.callNative(metadata.reqProc, 'handleResponse', [_this.statusCode, cfs.parseHeaders(_this._header), headerLength]);
                log.debug('resClose >>> BACK FROM NATIVE handleResponse()');
                log.debug('resClose >>> set metadata.wasClosed to true');
                metadata.wasClosed = true;
            }
            else {
                log.debug('resClose >>> metadata WAS ALREADY CLOSED (VERY BAD!!!)');
                log.warn(metadata.logHdrM + 'handleResponse() was already invoked!');
                //log.warn(util.inspect(_this.socket));
            }
        }

        if (cfg.debugMetadumpActiveNodeJS) { log.dumpData(metadata.logHdrM, 'METADUMP', metadata); }
        if (cfg.debugLogRequestsNodeJS) {
            var bytes = metadata.sent || _this.getHeader('Content-Length') || 0;
            var bs = bytes <= 0 ? '' : ' - ' + bytes.toString(10) + ' B';
            log.res(_this.statusCode, metadata.logHdrE.replace('###', _this.statusCode.toString()) + cfs.timer(metadata.started, 'mili').toString() + ' ms' + bs);
        }
    }
}


// UEMinjection is changing ctx and (IMPORTANT!) injectionState
function UEMinjection(ctx, injectionState, hdr, isWrite) {

    var b = null;
    var data = injectionState.InjectedFrag;

    if (!!!data) { b = new Buffer(0); }                                                                   // data is empty (undefined, null or '')
    else if (typeof data === 'string')  { b = new Buffer(data, (injectionState.encoding || 'utf8')); }    // data is not empty string
    else if (Buffer.isBuffer(data))     { b = data; }                                                     // data is buffer
    else { b = new Buffer(0); }                                                                           // something bad has happened

    if (cfg.debugDatadumpActiveNodeJS) { log.dumpData(ctx.metadata.logHdrM, 'UEM-IN-DUMP (enc: ' + (injectionState.encoding || 'utf8') + ')', b); }
    var nativeInjectionState = cfs.callNative(ctx.metadata.reqProc, 'injectJsAgentTag', [b]);
    if (cfg.debugDatadumpActiveNodeJS) { log.dumpData(ctx.metadata.logHdrM, 'UEM-OUT-DUMP (enc: ' + (injectionState.encoding || 'utf8') + ')', nativeInjectionState.InjectedFrag); }

    if (nativeInjectionState) {
        Object.keys(nativeInjectionState).forEach(function(e/*, i, a*/) {
            injectionState[e] = nativeInjectionState[e];
        });
    }

    if (injectionState.Injected === cfg.INJECTION.INJECTED) {
        log.debug(ctx.metadata.logHdrM + '>>> injection (' + injectionState.TagLen.toString(10) + ' B)');
    }

    // injectionState contains status of injection, buffer and length of injected data

    injectionState.dataOutLen = injectionState.InjectedFrag.length;   // this is always buffer, so .length is enough
    ctx.metadata.injState = injectionState.Injected;

    log.debug(hdr + 'RETURN FROM NATIVE INJECTION:');
    log.debug(hdr + ' * INJECTED: ' + injectionState.Injected);
    log.debug(hdr + ' * TAGLEN  : ' + injectionState.TagLen);
    log.debug(hdr + ' * DATALEN : ' + injectionState.dataOutLen);

    // no decision was made during injection phase; need to buffer returned data; there won't be any real res.write()
    if (injectionState.Injected === cfg.INJECTION.NEED_MORE || injectionState.Injected === cfg.INJECTION.NEED_MORE_CHUNKING) {

        log.debug(hdr + 'WE STILL KNOW NOTHING ABOUT THE INJECTION');
        // if there are some data - buffer them
        data = injectionState.InjectedFrag;
        if (injectionState.dataOutLen > 0) {
            log.debug(hdr + 'INJECTION RETURNED SOME DATA. BUFFERING...');
            if (!ctx._this._rx_buffer) { ctx._this._rx_buffer = []; }
            if (!!data) {
                injectionState.alreadyBuffered = true;
                ctx._this._rx_buffer.push([data, injectionState.encoding]);
                log.debug(hdr + 'push current data into buffer');
            }
            log.debug(hdr + 'ctx._this._rx_buffer.length = ' + ctx._this._rx_buffer.length);
            ctx.metadata.sent += injectionState.dataOutLen;
        }
        else {
            log.debug(hdr + 'INJECTION RETURNED NO DATA');
        }

        if (isWrite) {
            log.debug(hdr + 'WE ARE NOT WRITING ANYTHING DURING THIS RES.WRITE()/RES.END()');
            log.debug(hdr + 'exit(5)');
            return true;   // not doing anything else, just return from write/end
        }
        else {
            log.debug(hdr + 'SOMETHING WRONG HAS HAPPENED. RES.END() AND STILL NO DECISION ABOUT INJECTION...');
            log.debug(hdr + 'WE WILL TRY TO WRITE WHAT WE HAVE.');
        }
    }

    // there was an injection; add header and modify headers etc.
    if (injectionState.Injected === cfg.INJECTION.INJECTED) {
        log.debug(hdr + 'THERE WAS INJECTION');
        ctx._this._header = '';

        if (ctx.metadata.content.length >= 0) {
            var oldContentLength = ctx.metadata.content.length;
            log.debug('>>> CONTENT-LENGTH manipulation:');
            log.debug('  > ctx.metadata.content.length = ' + ctx.metadata.content.length);
            log.debug('  > ctx.metadata.sent           = ' + ctx.metadata.sent);
            log.debug('  > ctx.metadata.toSend         = ' + ctx.metadata.toSend);
            log.debug('  > dataOutLen                  = ' + injectionState.dataOutLen);
            ctx.metadata.content.length += ctx.metadata.sent - ctx.metadata.toSend + injectionState.dataOutLen;
            log.debug(hdr + 'Modifying Content-Length: ' + oldContentLength + ' -> ' + ctx.metadata.content.length);
            log.debug(ctx.metadata.logHdrM + 'Modifying Content-Length: ' + oldContentLength + ' -> ' + ctx.metadata.content.length);
        }
    }

    return false;
}

/**
 * This function mirrors nodejs ClientRequest functionality. It normalizes
 * the options, which can be either plain url string or an object, into an object.
 * Look into https://github.com/nodejs/node/blob/master/lib/_http_client.js#L22-L29
 * @param {string|Object} options - the outgoing request
 * @returns {Object} - normalized object
 */
function normalizeOutgoingRequestOptions(options) {
    var result;
    if (typeof options === 'string') {
        result = url.parse(options);
        if (!result.hostname) {
            throw new Error('Unable to determine the domain name');
        }
    } else {
        result = util._extend({}, options);
    }
    return result;
}
http._rx_normalizeOutgoingRequestOptions = normalizeOutgoingRequestOptions;

/**
 * @typedef OutUrl
 * @type Object
 * @property {string} hostname - the server address
 * @property {string} host - alias for hostname
 * @property {string} pathname - the path for the request
 * @property {string} path - alias for pathname
 * @property {string} appName - name of the application (process)
 * @property {string} query - the GET parameters query
 * @property {number} port - the server port
 */

/**
 * This function allows us to extract the request information.
 * @param _rx_PROTO_DEFAULT - is filled via .bind() with either http or https version
 * @param {Object} options
 * @param {Metadata} metadata
 * @returns {OutUrl} outUrl
 */
http.__rx_prepareOutgoingRequestParams = function prepareOutgoingRequestParams(_rx_PROTO_DEFAULT, options, metadata) {
    var result = { };

    result.protocol = options.protocol ||  _rx_PROTO_DEFAULT.PROTOCOL;

    result.port = parseInt(options.port || _rx_PROTO_DEFAULT.PORT, 10);
    result.method = options.method || 'GET';
    result.appName = cfg.applicationName;

    result.hostname = options.hostname || options.host;
    result.host = options.host || options.hostname + ((options.protocol === _rx_PROTO_DEFAULT.PROTOCOL && options.port === _rx_PROTO_DEFAULT.PORT) ? '' : ':' + options.port);

    result.pathname = options.pathname || '/';
    result.query = options.query ? String(options.query) : '';
    result.path = options.path ? String(options.path) : '/';
    result.scheme = result.protocol.slice(0, -1);
    result.href = options._rx_pathname || options.href || result.protocol + '//' + result.host + result.path;
    result.uri = result.path.split('?')[0];
    result.log = '[' + metadata.id + '] ' + result.method + ' ' + result.href + ' ';
    result.log_int = result.log + '[...] : ';
    result.dtCookie = metadata.cookieMgr.cookie;

    if (!result.headers) { result.headers = {}; }
    result.headers.Connection = 'keep-alive';

    return result;
};

http._rx_prepareOutgoingRequestParams = http.__rx_prepareOutgoingRequestParams.bind(http, http._rx_PROTO_DEFAULT);


function generateRequestInstead(rx_mod, rx_modName) {
    var requestInstead = function requestInstead(ctx) {
        var options = normalizeOutgoingRequestOptions(ctx._arguments[0]);

        // no session context - probably internal outgoing request (not related to any incoming request)
        if (!ctx.metadata.isValid()) {
            log.debug(outUrl.log_int + 'No metadata in outgoing http(s) request. Skipping...');

            // return on original invocation -> no exception handling required
            return ctx.callOriginal();
        }

        var ret;
        var methodId = null;

        if (!ctx.metadata.outTime || Object.keys(ctx.metadata.outTime).length <= 0) { ctx.metadata.outTime = {}; }
        var outUrl = rx_mod._rx_prepareOutgoingRequestParams(options, ctx.metadata);
        ctx.syncData.outUrl = options;

        // http.get called from https.get - whole job is done in https.get
        if (rx_modName === 'http' && outUrl.protocol === 'https:') {
            log.debug(outUrl.log_int + 'Not doing anything. It\'s http.get called by https.get');
            // return on original invocation -> no exception handling required
            return ctx.callOriginal();
        }

        var argsNew = Array.prototype.slice.call(ctx._arguments);

        if (cfg.debugLogRequestsNodeJS) { log.info(outUrl.log + '[---] : - ms'); }
        if (cfg.debugNativeActiveNodeJS/* && metadata.isValid()*/) {
            var dataOut = cfs.callNative(ctx.metadata.reqProc, 'handleOutgoingRequestStart', [outUrl], outUrl.log_int);

            var newHeader = dataOut.header;
            methodId = ctx.syncData.methodId = dataOut.methodId;
            ctx.metadata.outTime[methodId] = cfs.timer();

            // add x-dynatrace header
            if (newHeader) {
                // check whether the options object exists
                if (options) {
                    // There's a possibility no additional headers were provided by the caller.
                    options.headers = options.headers || {};
                    options.headers[cfg.specHeader] = newHeader;
                }
            }
        }

        argsNew[0] = options;
        argsNew[1] = ctx._arguments[1];

        // call into the original request routine
        // no side effects -> no exception handling required
        ret = cfs.callOriginal(ctx._this, ctx.original, rx_modName + '.request', argsNew);

        // add a new error handler to the request object
        ret.on('error', function responseError(error) {
            var statusCode = 500;
            if (cfg.debugNativeActiveNodeJS/* && metadata.isValid()*/) {
                log.info(outUrl.log_int + 'OUTGOING REQUEST ERROR: ' + error.toString());
                var errorInfo = err.getStacktraceInfoDict(error);
                log.info(errorInfo.getOriginalStackErrMsg());
                cfs.callNative(ctx.metadata.reqProc, 'sendErrorAttachment', err.getStacktraceInfo(error), outUrl.log_int);
                cfs.callNative(ctx.metadata.reqProc, 'handleOutgoingRequestEnd', [methodId, statusCode], outUrl.log_int);
                // This is a special case of support alert for bug APM-54827
                if (error.message === 'Parse Error') {
                    cfs.callNative(cfg.cfgAgent, 'supportAlert', [errorInfo.getOriginalStackErrMsg(), process.execPath]);
                }
            }

            var ts = ctx.metadata.outTime && ctx.metadata.outTime[methodId] ? ' : ' + cfs.timer(ctx.metadata.outTime[methodId], 'mili').toString() + ' ms' : '';
            if (cfg.debugLogRequestsNodeJS) { log.res(statusCode, outUrl.log + '[' + statusCode + ']' + ts + ' - ERROR: ' + error.toString()); }

            if (events.EventEmitter.listenerCount(ret, 'error') <= 1 /* number of our error handlers */) {
                ret.removeAllListeners('error');
                ret.emit('error', error);
            }
        });

        return ret;
    };

    return requestInstead;
}


function requestCallbackBefore(ctx) {
    if (!ctx.syncData.methodId) { return; }
    var resx = ctx._arguments[0];

    if (cfg.debugLogHeadersNodeJS) {
        log.info(ctx.syncData.outUrl.log_int + 'Outgoing response headers:\n' + JSON.stringify(resx.headers, null, 4));
    }
    // remove x-dynatrace header
    try {
        delete ctx.syncData.outUrl.headers[cfg.specHeader];
    }
    catch (error) { }
}


function requestCallbackAfter(ctx) {
    if (!ctx.syncData.methodId) { return; }
    var resx = ctx._arguments[0];

    if (cfg.debugNativeActiveNodeJS/* && metadata.isValid()*/) {
        cfs.callNative(ctx.metadata.reqProc, 'handleOutgoingRequestEnd', [ctx.syncData.methodId, resx.statusCode], ctx.syncData.outUrl.log_int);
    }

    if (cfg.debugLogRequestsNodeJS) {
        var ts = ctx.metadata.outTime && ctx.metadata.outTime[ctx.syncData.methodId] ? ' : ' + cfs.timer(ctx.metadata.outTime[ctx.syncData.methodId], 'mili').toString() + ' ms' : '';
        log.res(resx.statusCode, ctx.syncData.outUrl.log + '[' + resx.statusCode + ']' + ts);
    }
}

if (cfg.debugLogPatchingNodeJS) { log.info('     > patching [http.request]'); }
core.wrap(http, 'request', {
    type: core.CallbackType.callbackLastFill,
    before: requestCallbackBefore,
    after: requestCallbackAfter,
    instead: generateRequestInstead(http, 'http'),
});


// to be used by https module
http.generateRequestInstead = generateRequestInstead;
http.requestCallbackAfter = requestCallbackAfter;
http.requestCallbackBefore = requestCallbackBefore;

// return original module with provided changes
module.exports = http;
