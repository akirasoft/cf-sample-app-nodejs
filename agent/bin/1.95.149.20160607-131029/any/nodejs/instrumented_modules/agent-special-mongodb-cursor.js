/*jslint node: true*/
"use strict";

/* For now we do not instrument a Cursor object - there's no need to do this */
var path = require('path');
var core = require('../lib/core');


module.exports = function(args) {
    var Cursor = require(path.join(path.dirname(args[1].id), args[0]));

    core.wrap(Cursor.prototype,'toArray',{type:core.CallbackType.callbackLast});
    return Cursor;
};
