/*jslint node: true*/
"use strict";


var querystring  = require('querystring');
var setCookieLib = require('set-cookie-parser');
var cookieLib    = require('cookie');
var dtUtil = require("../lib/agent-util");

// common functions


var CRLF = '\r\n';

/*var str_endsWith   =*/ module.exports.str_endsWith   = function str_endsWith  (str, sub) { return (str.substr(str.length - sub.length, sub.length) === sub); };
var str_startsWith = module.exports.str_startsWith = function str_startsWith(str, sub) { return (str.substr(0, sub.length) === sub); };


var getClientAddress = module.exports.getClientAddress = function getClientAddress(req) {
    return (req && req.connection ? req.connection.remoteAddress : '0.0.0.0');
};


var cookieMgr = module.exports.cookieMgr = function cookieMgr(str) {
    var self = {
        cookie   : '',
        setCookie: ''
    };

    if (str) {
        var options = setCookieLib.parse(str)[0];
        var name  = options.name;
        var value = options.value;
        delete(options.name);
        delete(options.value);

        self.cookie    = querystring.unescape(cookieLib.serialize(name, value));
        self.setCookie = querystring.unescape(cookieLib.serialize(name, value, options));
    }

    return self;
};


var parseCookie = module.exports.parseCookie = function parseCookie(cookie) {
    if (!cookie) { return {}; }
    return cookieLib.parse(cookie);
};


var timer = module.exports.timer = function timer(tm, r) {
    if (!tm) {
        return process.hrtime();
    }
    var td = process.hrtime(tm);
    var ds, dn, dt = 0;
    switch (r) {
        case 'sec'   : ds = 1  ; dn = 1e9; break;
        case 'micro' : ds = 1e6; dn = 1e3; break;
        case 'nano'  : ds = 1e9; dn = 1  ; break;
        case 'mili'  : // default: mili
                       /* falls through */
        default      : ds = 1e3; dn = 1e6; break;
    }
    try {
        dt = parseInt(td[0] * ds + td[1] / dn, 10);
    }
    catch (error) {}
    return dt;
};


var DEFAULT = module.exports.DEFAULT = {
    CONTENT_LENGTH   : -1,
    CONTENT_TYPE     : '',
    CONTENT_ENCODING : ''
};


module.exports.Metadata = function Metadata(id, req, url) {
    var cfg = global._rx_cfg;

    var self = {
        'id'          : id || cfg.EMPTY_ID,
        'started'     : req ? timer() : 0,
        'method'      : req ? req.method : '',
        'host'        : (req && req.headers) ? req.headers.host : '',
        'url'         : url ? (url._rx_pathname || url.pathname) : '',
        'query'       : url ? url.query : '',
        'headers'     : (req && req.allHeaders) ? req.allHeaders.join(CRLF) : '',
        'clientIP'    : req ? getClientAddress(req) : '',
        'reqType'     : cfg.REQUEST_TYPE.UNKNOWN,
        'reqProc'     : null,
        'hdrArgs'     : null,
        'hdrSend'     : false,
        'content'     : { length: DEFAULT.CONTENT_LENGTH, type: DEFAULT.CONTENT_TYPE, encoding: DEFAULT.CONTENT_ENCODING },
        'injState'    : cfg.INJECTION.NEED_MORE,
        'wasClosed'   : false,
        'sent'        : 0,
        'toSend'      : 0,
        'sendEnc'     : null,
        'isCORS'      : false,
        'dtCookieSet' : false,
        'cookieMgr'   : new cookieMgr()
    };

    self.cookies  = (req && req.headers) ? req.headers.cookie || '' : '';
    self.dtPC     = self.cookies ? parseCookie(self.cookies)[cfg.getCookieName('dtPC')] || '' : '';

    if (self.cookies) {
        self.cookieMgr = new cookieMgr(parseCookie(self.cookies)[cfg.getCookieName('dtCookie')] || '');
    }
    if (!self.cookieMgr.cookie && url && url.query) {
        self.cookieMgr = new cookieMgr(querystring.unescape(parseCookie(url.query)[cfg.getCookieName('dtCookie')] || ''));
    }

    var logHdr   = '[' + (id || cfg.EMPTY_ID) + '] ';
    if (req) { logHdr += self.method   + ' '; }
    if (url) { logHdr += self.url + ' ';      }

    self.logHdrS = logHdr + '[---] : - ms';
    self.logHdrM = logHdr + '[...] : ';
    self.logHdrE = logHdr + '[###] : ';

    self.isValid = function() { return (self.id !== cfg.EMPTY_ID); };
    return self;
};


module.exports.addCookie = function addCookie(hdrCookie, newCookie) {
    var setcookieval = hdrCookie;
    /*jshint -W035 */  // allow empty block ON
    if (setcookieval && setcookieval.constructor === String) {
        setcookieval = setcookieval.split(',');
    }
    else if (setcookieval && setcookieval.constructor === Array) {
        // nothing here
    }
    else {
        setcookieval = [];
    }
    /*jshint +W035 */  // allow empty block OFF
    setcookieval.push(newCookie);
    return setcookieval;
};


module.exports.parseHeaders = function parseHeaders(hdrs) {
    var out = {};
    var h1 = hdrs ? hdrs.split(CRLF) : [];
    var h2 = h1.filter(function(e) { if (e && !str_startsWith(e, 'HTTP/')) { return e; } } );
    h2.forEach(function(e) {
        var l = e.split(':');
        if (l.length === 2) {
            out[l[0].trim().toLowerCase()] = l[1].trim();
        }
    });
    return out;
};


module.exports.toGzip = function toGzip(hdr) {
    var out = false;
    try { hdr.split(',').forEach(function(e) { if (e.trim() === 'gzip') { out = true; } }); }
    catch (error) {}
    return out;
};


module.exports.callNative = function callNative(obj, methodName, methodParams, addr) {
    var log = global._rx_log;
    var cfg = global._rx_cfg;

    if (cfg.debugLogNativeCallsNodeJS) { log.nativeEnter(methodName, addr); }
    if (cfg.debugParamsdumpActiveNodeJS && methodParams) {
        log.paramsHdr(methodName);
        log.msgHdr(log.stringify(methodParams), '-', methodName);
    }
    var ret;
    try {
        ret = obj[methodName].apply(obj, methodParams);
    }
    catch (error) {
        log.error('ERROR (' + methodName + '): ' + error.toString());
    }
    if (cfg.debugParamsdumpActiveNodeJS && ret) {
        log.outputHdr(methodName);
        log.msgHdr(log.stringify(ret), '-', methodName);
    }
    if (cfg.debugLogNativeCallsNodeJS) { log.nativeExit(methodName, addr); }
    return ret;
};


module.exports.callOriginal = function callOriginal(obj, method, methodName, methodParams, addr) {
    var log = global._rx_log;
    var cfg = global._rx_cfg;

    //methodName = methodName.replace('()', '');
    if (cfg.debugLogOriginalCallsNodeJS) {
        log.originalEnter(methodName, addr);
    }
    if (cfg.debugParamsdumpActiveNodeJS && methodParams) {
        log.paramsHdr(methodName);
        log.msgHdr(log.stringify(methodParams), '-', methodName);
    }

    
    var ret;
    try {
        ret = dtUtil.invoke(obj, method, methodParams);
    } catch (e) {
        log.info(methodName + " threw: " + e);
        throw e;
    }

    if (cfg.debugParamsdumpActiveNodeJS && ret) {
        log.outputHdr(methodName);
        log.msgHdr(log.stringify(ret), '-', methodName);
    }
    if (cfg.debugLogOriginalCallsNodeJS) {
        log.originalExit(methodName, addr);
    }
    return ret;
};


module.exports.decorateWithLogger = function decorateWithLogger(func) {
    var funcName = func.name;
    var funcNew = function() {
        var log = global._rx_log;
        var cfg = global._rx_cfg;

        if (cfg.debugLogEnterExitNodeJS) {
            log.methodEnter(funcName);
        }
        if (cfg.debugParamsdumpActiveNodeJS && arguments) {
            log.paramsHdr(funcName);
            log.msgHdr(log.stringify(arguments), '-', funcName);
        }

        var ret;
        try {
            ret = dtUtil.invoke(this, func, arguments);
        } catch (e) {
            log.info(funcName + " threw: " + e);
            throw e;
        }

        if (cfg.debugParamsdumpActiveNodeJS && ret) {
            log.outputHdr(funcName);
            log.msgHdr(log.stringify(ret), '-', funcName);
        }
        if (cfg.debugLogEnterExitNodeJS) {
            log.methodExit(funcName);
        }
        return ret;
    };
    /*strict: funcNew.name = funcName; */
    return funcNew;
};


module.exports.getLoadedModules = function getLoadedModules(xfilter) {
    var list = Object.keys(require('module')._cache).sort();
    if (xfilter) {
        if (typeof xfilter === 'string') { xfilter = [xfilter]; }   // change string to Array
        return list.filter(function(e/*, i, a*/) {
            return xfilter.every(function(fe/*, fi, fa*/) {
                return e.indexOf(fe) === -1;
            });
        });
    }
    return list;
};


module.exports.updateConfig = function updateConfig(config) {
    var cfg = global._rx_cfg;
    var log = global._rx_log;
    Object.keys(config).forEach(function(e/*, i, a*/) {
        if (e !== config[e]) {
            log.info('  * ' + e + ' -> ' + config[e]);
            cfg[e] = config[e];
        }
    });
};
