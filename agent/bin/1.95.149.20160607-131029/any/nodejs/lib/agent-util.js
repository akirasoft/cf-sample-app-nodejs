"use strict";


/** optimized function invocation using call instead of apply
    @param thisObj {any} the this object or null
    @param method {function} the function to be invoked
    @param args {any[]} the function arguments
    @returns {any} the return value of method */
function invoke(thisObj, method, args) {
    switch (args.length) {
        case 0:
            return method.call(thisObj);

        case 1:
            return method.call(thisObj, args[0]);

        case 2:
            return method.call(thisObj, args[0], args[1]);

        case 3:
            return method.call(thisObj, args[0], args[1], args[2]);

        case 4:
            return method.call(thisObj, args[0], args[1], args[2], args[3]);

        case 5:
            return method.call(thisObj, args[0], args[1], args[2], args[3], args[4]);

        default:
            return method.apply(thisObj, args);
    }
}

module.exports.invoke = invoke;
