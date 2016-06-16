/*jslint node: true*/
"use strict";

// special requests handlers

var log = global._rx_log;
var cfg = global._rx_cfg;
var cfs = require('./agent-common');

var querystring = require('querystring');
var zlib        = require('zlib');


function createDebugPage(resx) {
    var on_off = {true: 'on', false:'off'};
    resx.writeHead(200, 'OK', {'Content-Type': 'text/html'});
    var style  = '<style>BODY{font-family:helvetica;font-size:16px;} ' +
                 'table,th,td{border:1px solid black;border-collapse:collapse;} ' +
                 'th,td{padding:5px;} ' +
                 'th{background:gray;color:white;} ' +
                 'td.on{text-align:center;} ' +
                 'td.off{text-align:center;} ' +
                 'font.on{color:white;font-weight:bold;} ' +
                 'font.off{color:grey;} ' +
                 'font.sp{color:grey;font-weight:lighter;font-size:18px;text-shadow: 1px 0px 0px black;} ' +
                 'a{text-decoration:none;text-shadow: 1px 1px 0px black;} ' +
                 'a.on{background-color:#00CC66;outline: grey inset 1px;} ' +
                 'a.off{background-color:#FF6666;outline: grey outset 1px;} ' +
                 '</style>';
    var msg =    '<html><head>' + style + '</head><body>\n' +
                 '<table><caption>NodejsAgent debug flags</caption><tr><th>parameter</th><th>value</th><th>description</th></tr>\n';
    cfg.debugFlags.forEach(function singleFlag(flag) {
        msg +=   '<tr><td>' + flag + '</td>' +
                 '<td class="' + on_off[cfg[flag]] + '">' +
                 '<a href="/nodejsagentconfig?' + flag + '=' + !cfg[flag] + '" class="' + on_off[cfg[flag]] + '">' +
                 '<font class="' + on_off[cfg[flag]] + '">&nbsp;on</font>' +
                 '<font class="sp"> | </font>' +
                 '<font class="' + on_off[!cfg[flag]] + '">off&nbsp;</font>' +
                 '</a></td><td>' + cfg.getDesc(flag) + '</td></tr>\n';
    });
    msg +=       '</table>\n';
    msg +=       '<ul>Additional info:\n' +
                 '<li><a href="/nodejsagentmoduleversions">Module versions</a></li>\n' +
                 '<li><a href="/nodejsagentappfiles">All application files</a></li>\n' +
                 '<li><a href="/nodejsagentrequires">All \'requires\'</a></li>\n' +
                 '<li><a href="/nodejsagentloadedfiles">All loaded files (without agent)</a></li>\n' +
                 '<li><a href="/nodejsagentloadedfilessall">All loaded files (with agent)</a></li>\n' +
                 '</ul>\n';
    msg +=       '</body></html>\n';
    return msg;
}


module.exports.generateConfigPage = function generateConfigPage(res, url_parts, id) {
    var msg = '';
    try {
        var tmp_query = querystring.parse(url_parts.query);
        if (Object.keys(tmp_query).length > 0) {
            Object.keys(tmp_query).forEach(function configOption(opt) {
                msg += 'cfg.' + opt + ' : ';
                var obj = cfg;
                var pth = opt.split('.');
                var lth = pth.pop();

                Object.keys(pth).forEach(function addElement(el) { obj = obj[pth[el]]; });

                msg += obj[lth];
                obj[lth] = tmp_query[opt];
                msg += ' -> ' + obj[lth] + '\n';

                log.info('[' + id + '] Configuration change: ' + msg.trim());
            });
            msg = createDebugPage(res);
        }
        else {
            msg = createDebugPage(res);
        }
    }
    catch (error) {
        msg = 'ERROR while parsing options: ' + error.toString();
        log.error('[' + id + '] ' + msg);
        res.writeHead(200, 'OK', {'Content-Type': 'text/plain'});
    }
    return res.end(msg);
};


module.exports.generateModuleList = function generateModuleList(filter) {
    var finder = require('./find-package-json');
    var modules = cfs.getLoadedModules(filter);

    var val = finder().next().value;
    if(val && val.__path) {
        modules.push(val.__path);
    }

    return modules;
};


module.exports.generateFilteredModuleList = function generateFilteredModuleList() {
    return module.exports.generateModuleList(['nodejsagent', 'agentnodejs', 'node_modules', '\.json']);
};

global.generateFilteredModuleList = module.exports.generateFilteredModuleList;


module.exports.generateRequireList = function generateRequireList() {
    return global._rx_modules.sort().join('\n');
};


module.exports.generateVersionsList = function generateVersionsList() {
    var o = '';
    Object.keys(global._rx_modulesInfo).sort().forEach(function(e) { o += e + ': ' + global._rx_modulesInfo[e] + '\n'; });
    return o;
};

module.exports.handleGenericSpecialRequest = cfs.decorateWithLogger(function handleGenericSpecialRequest(res, responseBody, statusCode, headers) {
    res._rx_writeHead(statusCode, headers);
    return res._rx_end(responseBody || '');
});

module.exports.handleJSAgentRequest = cfs.decorateWithLogger(function handleJSAgentRequest(res, req, metadata, jsAgentBody, statusCode, headers) {
    var ret;
    log.info(metadata.logHdrM + '>>> request for jsAgent');
    if (!jsAgentBody) { log.warn(metadata.logHdrM + 'WARNING! NO jsAgent PROVIDED!'); }

    // headers and caching decisions are already handled by native code
    if (statusCode === 304) {
        res._rx_writeHead(statusCode, headers);
        ret = res._rx_end();
    }
    // if agent can be gzipped - do it
    else if (jsAgentBody && cfs.toGzip(req.headers['accept-encoding'])) {
        log.debug(metadata.logHdrM + '>>> gzipping jsAgent...');
        zlib.gzip(jsAgentBody, function gzippedAgent(u, b) {
            headers['Content-Encoding'] = 'gzip';
            res._rx_writeHead(200, 'OK', headers);
            ret = res._rx_end(b);
        });
    }
    else {
        res._rx_writeHead(statusCode, 'OK', headers);
        ret = res._rx_end(jsAgentBody || '');
    }
    if (cfg.debugLogRequestsNodeJS) { log.res(res.statusCode, metadata.logHdrE.replace('###', res.statusCode.toString()) + cfs.timer(metadata.started, 'mili').toString() + ' ms'); }
    return ret;
});


module.exports.handleHealthCheckPage = cfs.decorateWithLogger(function handleHealthCheckPage(res, req, metadata, healthcheckBody, headers) {
    log.debug(metadata.logHdrM + '>>> healthcheck page');
    res._rx_writeHead(200, 'OK', headers);
    var ret = res._rx_end(healthcheckBody);
    if (cfg.debugLogRequestsNodeJS) { log.res(res.statusCode, metadata.logHdrE.replace('###', res.statusCode.toString()) + cfs.timer(metadata.started, 'mili').toString() + ' ms'); }
    return ret;
});


module.exports.handleBeaconCors = cfs.decorateWithLogger(function handleBeaconCors(res, req, metadata, isCORS) {
    var ret;
    log.debug(metadata.logHdrM + '>>> ' + (isCORS ? 'CORS' : 'beacon') + ' signal');
    var beaconRetVal = {"responseBody": "FL(nodejs)", "responseHeaders": {}};
    switch (metadata.method) {
        case 'OPTIONS':
        case 'GET':
            // The data should be in the query, and was already delivered to UemSensor during the previous native call.
            // Now we'll just need to handle the beacon.
            if (cfg.debugNativeActiveNodeJS) {
                beaconRetVal = cfs.callNative(metadata.reqProc, 'beacon', [""]);
            }
            ret = sendBeaconResponse(res, isCORS, beaconRetVal.responseBody, beaconRetVal.responseHeaders);
            if (cfg.debugLogRequestsNodeJS) { log.res(res.statusCode, metadata.logHdrE.replace('###', res.statusCode.toString()) + cfs.timer(metadata.started, 'mili').toString() + ' ms'); }
            break;
        case 'POST':
            var beaconPostBody = '';
            req.on('data', function beaconData(data) {
                beaconPostBody += data;
                // against data flooding
                if (beaconPostBody.length > 1e6) {
                    var statusCode = 413;
                    beaconPostBody = '';
                    res._rx_writeHead(statusCode, {'Content-Type': 'text/plain'});
                    res.end();
                    req.connection.destroy();
                    log.error(metadata.logHdrE.replace('###', statusCode.toString()) + cfs.timer(metadata.started, 'mili').toString() + ' ms - ERROR! Too big data chunk!');
                }
            });
            req.on('end', function beaconEnd() {
                if (cfg.debugNativeActiveNodeJS) {
                    beaconRetVal = cfs.callNative(metadata.reqProc, 'beacon', [beaconPostBody]);
                }
                ret = sendBeaconResponse(res, isCORS, beaconRetVal.responseBody, beaconRetVal.responseHeaders);
                if (cfg.debugLogRequestsNodeJS) { log.res(res.statusCode, metadata.logHdrE.replace('###', res.statusCode.toString()) + cfs.timer(metadata.started, 'mili').toString() + ' ms'); }
            });
            break;
        default:
            var statusCode = 413;
            log.warn(metadata.logHdrE.replace('###', statusCode.toString()) + cfs.timer(metadata.started, 'mili').toString() + ' ms - ERROR! This method is not supported in BEACON signal!');
            res._rx_writeHead(statusCode, {'Content-Type': 'text/plain'});
            res.end();
            req.connection.destroy();
    }
    return ret;
});


var sendBeaconResponse = cfs.decorateWithLogger(function sendBeaconResponse(res, isCORS, beaconBody, headers) {
    res._rx_writeHead(200, 'OK', headers);
    return res._rx_end(beaconBody);
});
