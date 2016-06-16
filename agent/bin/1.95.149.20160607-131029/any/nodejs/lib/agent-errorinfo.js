"use strict";

var StackTrace = require('./agent-stacktrace.js');

/**
 * Constructs an ErrorInfo object
 * @param {Error} [error] error object to create additional information on
 */
function ErrorInfo(error) {
    if (error instanceof Error) {
        this.stackTrace = new StackTrace(error);
        this.error = error;
        this.name = error.name || 'Error';
        this.message = error.message || 'Unknown error';
    } else {
        throw new Error('ErrorInfo can only be created with an instance of an Error type!');
    }
}

ErrorInfo.prototype.origStackErrMsg = '';
ErrorInfo.prototype.filteredStackErrMsg = '';

/**
 * Returns the callstack as an array of frames excluding agent frames
 * @return {Array} Filtered stack frames
 */
ErrorInfo.prototype.getFilteredFrames = function () {
    return this.stackTrace.getFilteredStackFrames();
};

/**
 * Returns the error and callstack as a nodejs standard complient string representation excluding the agent frames
 * @return {Array} String representation of the error and callstack to the error
 */
ErrorInfo.prototype.getFilteredStackErrMsg = function () {
    if (this.filteredStackErrMsg === '') {
        this.filteredStackErrMsg = stackToErrorString(this.error, this.getFilteredFrames());
    }
    return this.filteredStackErrMsg;
};

/**
 * Returns the callstack as an array of frames including agent frames (original callstack as is)
 * @return {Array} Stack frames of the call
 */
ErrorInfo.prototype.getOriginalFrames = function () {
    return this.stackTrace.getStackFrames();
};

/**
 * Returns the error and callstack as a nodejs standard complient string representation including the agent frames
 * @return {Array} String representation of the error and callstack to the error
 */
ErrorInfo.prototype.getOriginalStackErrMsg = function () {
    if (this.origStackErrMsg === '') {
        this.origStackErrMsg = stackToErrorString(this.error, this.getOriginalFrames());
    }
    return this.origStackErrMsg;
};

/**
 * Returns true if the error callstack has an agent frame included
 * @return {boolean} true is error callstack has an agent frame, otherwise false
 */
ErrorInfo.prototype.hasAgentFrame = function () {
    return this.stackTrace.hasAgentStackFrame();
};

/**
 * Returns a nodejs standard compliant string representation of the given error object.
 * @param {Error} [error] error object 
 * @param {Array} [stackFrames] array of stackframes
 * @return {string} nodes compliant standard error string (error.toString() + callstack to error)
 */
function stackToErrorString(error, stackFrames) {
    var stack = [];
    stack.push(error.toString());
    for (var i = 0; i < stackFrames.length; i++) {
        var callsite = stackFrames[i];
        var stackFrame = callsite.toString();
        stack.push('    at ' + stackFrame);
    }
    return stack.join('\n');
}

module.exports = ErrorInfo;
