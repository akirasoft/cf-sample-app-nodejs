/*jslint node: true*/
"use strict";

var ErrorInfo = require('./agent-errorinfo.js');

var getStacktraceInfoDict = function getStacktraceInfoDict(error) {
    if (!error || typeof error === 'string') {
        error = new Error(error);
    }    
    return new ErrorInfo(error);
};
module.exports.getStacktraceInfoDict = getStacktraceInfoDict;


var getStacktraceInfo = function getStacktraceInfo(error) {
    var errorInfo = getStacktraceInfoDict(error);
    var o = [errorInfo.name, errorInfo.message];

    for (var i = 0; i < errorInfo.getFilteredFrames().length; i++) {
        o.push('');   // fake 'class' element
        o.push(errorInfo.getFilteredFrames()[i].getFunctionName() || 'anonymous');
        o.push(errorInfo.getFilteredFrames()[i].getFileName());
        o.push(errorInfo.getFilteredFrames()[i].getLineNumber());
    }
    return o;
};
module.exports.getStacktraceInfo = getStacktraceInfo;

module.exports.errorHandler = function errorHandler(metadata, type, error) {
    var log = global._rx_log;
    var cfg = global._rx_cfg;
    var cfs = require('./agent-common');

    if (!error) { error = 'Unknown error'; }

    var hdr = metadata ? metadata.logHdrM || '' : '';
    var errMsg = error.toString();
    if (errMsg === '[object Object]') { errMsg = require('util').inspect(error); }
    log.info(hdr + 'ERROR in ' + type + ': ' + errMsg);

    if (!metadata && error['error@context'] && error['error@context'].metadata) {
        metadata = error['error@context'].metadata;
    }

    if (cfg.debugNativeActiveNodeJS && metadata && metadata.reqProc) {
        cfs.callNative(metadata.reqProc, 'sendErrorAttachment', getStacktraceInfo(error), hdr);
    }
};