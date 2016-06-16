"use strict";

/**
 * Constructs a StackTrace object.
 * @param {Object} [stackObj] object containing stack information (can either be an 'Error' type or anything that was initialized with Error.captureStackTrace(obj)
 */
function StackTrace(stackObj) {
    if (stackObj === undefined) {
        stackObj = {};
        Error.captureStackTrace(stackObj, StackTrace);
    }
    var oldPrepareStackTrace = Error.prepareStackTrace;
    Error.prepareStackTrace = this.rxPrepareStackTrace;
    if (!(stackObj.stack instanceof Array)) {
        stackObj.stack = convertStackStringToFramesArray(stackObj.stack);
    }
    this.stackAsFrames = stackObj.stack;
    Error.prepareStackTrace = oldPrepareStackTrace;
}

StackTrace.prototype.stackAsFrames = [];
StackTrace.prototype.filteredStackAsFrames = [];
StackTrace.prototype.stackAsString = '';

var AGENT_STACKTRACE_FILTER = [   
    /\/nodejsagent\//, 
    /\/agent\/res\//, 
    /\/agent\/nodejs\//
];

/**
 * Returns an array of stackframes of the original stack
 * @return {Array} Original stackframes
 */
StackTrace.prototype.getStackFrames = function () {
    return this.stackAsFrames;
};

/**
 * Returns the callsites retrieved by the nodejs Error.prepareStackTrace method
 * @param {Object} [err] error object
 * @param {Array} [callsites] Array of callsites containing stacktrace information
 */
StackTrace.prototype.rxPrepareStackTrace = function (err, callsites) {
    return callsites;
};

/**
 * Filters out all agent stack frames of the stack
 * @return {Array} the stack without agent stackframes
 */
StackTrace.prototype.getFilteredStackFrames = function () {
    if (this.filteredStackAsFrames.length === 0) {        
        var cfg = global._rx_cfg;
        var full_stackFilter = cfg._stackFilter.concat(AGENT_STACKTRACE_FILTER);
        try {
            this.filteredStackAsFrames = this.stackAsFrames.filter(function (stackElem/*, idx1, arr1*/) {
                return full_stackFilter.every(function (filterElem/*, idx2, arr2*/) {
                    return (!filterElem.test(stackElem.toString().replace(/\\/g, '/')));
                });
            });
        } catch (err) {
            //if we fail to filter just leave the agent frames included
            this.filteredStackAsFrames = this.stackAsFrames;
        }
    }
    return this.filteredStackAsFrames;
};

//TODO DoGr: use regex
/**
 * Returns true if the stack has an agent frame
 * @return {boolean} true if the stack contains an agent frame, otherwise false
 */
StackTrace.prototype.hasAgentStackFrame = function () {
    for (var i = 0; i < this.stackAsFrames.length; i++) {
        if (this.stackAsFrames[i].toString().indexOf('agent') !== -1) {
            return true;
        }
    }
    return false;
};

function CallSite(fileName, lineNumber, functionName, typeName, methodName, columnNumber, native) {
    this.fileName = fileName;
    this.lineNumber = lineNumber;
    this.functionName = functionName;
    this.typeName = typeName;
    this.methodName = methodName;
    this.columnNumber = columnNumber;
    this.native = native;
}

CallSite.prototype.getFileName = function () { return this.fileName; };
CallSite.prototype.getLineNumber = function () { return this.lineNumber; };
CallSite.prototype.getFunctionName = function () { return this.functionName; };
CallSite.prototype.getTypeName = function () { return this.typeName; };
CallSite.prototype.getMethodName = function () { return this.methodName; };
CallSite.prototype.getColumnNumber = function () { return this.columnNumber; };
CallSite.prototype.isNative = function () { return this.native; };
CallSite.prototype.toString = function () { return this.functionName + ' (' + this.fileName + ':' + this.lineNumber + ':' + this.columnNumber + ')'; };

function convertStackStringToFramesArray(stack) {
    if (!stack || typeof stack !== 'string') {
        return [];
    }
    var stringFramesArray = stack.split('\n').slice(1);

    var callsiteFrameArray = stringFramesArray.map(function(frame) {
        if (frame.match(/^\s*[-]{4,}$/)) {
            return new CallSite(frame, -1, '', '', '', -1, false);
        }
        var frameMatch = frame.match(/at (?:(.+)\s+)?\(?(?:(.+?):(\d+):(\d+)|([^)]+))\)?/);
        if (!frameMatch) {
            return;
        }        
        
        var functionName = '';
        var typeName = 'Object';
        var methodName = '';
        var native = false;

        if (frameMatch[1]) {
            var methodMatch = frameMatch[1].match(/([^\.]+)(?:\.(.+))?/);
            if (methodMatch[1]) {
                typeName = methodMatch[1];
            }
            if (methodMatch[2]) {
                methodName = methodMatch[2];
            }
            if (methodName !== '<anonymous>') {
                functionName = frameMatch[1];
            }
        }

        var fileName = frameMatch[2] || '';
        var lineNumber = parseInt(frameMatch[3], 10) || -1;
        var columnNumber = parseInt(frameMatch[4], 10) || -1;

        return new CallSite(fileName, lineNumber, functionName, typeName, methodName, columnNumber, native);

    });

    return callsiteFrameArray;
}

module.exports = StackTrace;