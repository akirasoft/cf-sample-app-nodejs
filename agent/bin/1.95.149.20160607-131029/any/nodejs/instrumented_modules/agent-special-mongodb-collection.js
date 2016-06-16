/*jslint node: true*/
"use strict";

var path = require('path');

var hooking = require('../lib/agent-hooking');
var core = require('../lib/core');


module.exports = function(args) {
    var Collection = require(path.join(path.dirname(args[1].id), args[0]));

    var hookMethods = [
        'update',
        'findOne',
        'distinct',
        'save',
        'insert',
        'findAndModify',
        'findAndRemove',
        'count',
        'remove'
    ];

    hookMethods.forEach(function (fname) {
        core.wrap(Collection.prototype, fname, {
            type: core.CallbackType.callbackLast,
            before: hooking.genCallbackBefore(fname),
            after: hooking.genCallbackAfter(fname),
            enter: hooking.genEnter(fname),
            exit: hooking.genExit(fname)
        });
    });

    core.wrap(Collection.prototype, 'find', {
        type: core.CallbackType.noCallback,
        enter: function(ctx) {

            var index=ctx._arguments.length-1;

            if (typeof ctx._arguments[index] !== "function") {
                // fill in an empty callback
                [].push.call(ctx._arguments, function (err, result) {
                    return result;
                });
                index = index + 1;
            }
            ctx._arguments[index] = core.directAsyncWrap(ctx._arguments[index], {
                before: hooking.genCallbackBefore('find'),
                after: hooking.genCallbackAfter('find'),
            }, 'find', ctx.syncData);

            hooking.genEnter('find')(ctx);
        },
        exit: hooking.genExit('find')
    });

    return Collection;
};
