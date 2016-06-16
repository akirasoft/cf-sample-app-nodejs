/*jslint node: true*/
"use strict";

var path = require('path');

var hooking = require('../lib/agent-hooking');
var core = require('../lib/core');


module.exports = function (args) {
    var Db = require(path.join(path.dirname(args[1].id), args[0]));

    var hookMethods = [
        'addUser',
        'admin',
        'authenticate',
        'close',
        'collection',
        'collections',
        //'command',
        'createCollection',
        'createIndex',
        'db',
        'dropCollection',
        'ensureIndex',
        'eval',
        'executeDbAdminCommand',
        'indexInformation',
        //'listCollections',
        'logout',
        'renameCollection',
        'removeUser',
        'stats',
        'open'
    ];

    hookMethods.forEach(function (fname) {
        core.wrap(Db.prototype, fname, {
            type: core.CallbackType.callbackLast,
            before: hooking.genCallbackBefore(fname),
            after: hooking.genCallbackAfter(fname),
            enter: hooking.genEnter(fname),
            exit: hooking.genExit(fname)
        });
    });


    core.wrap(Db.prototype, 'dropDatabase', {
        type: core.CallbackType.auto,
        before: hooking.genCallbackBefore('dropDatabase'),
        after: hooking.genCallbackAfter('dropDatabase'),
        enter:hooking.genEnter('dropDatabase'),
        exit: hooking.genExit('dropDatabase')
    });

    return Db;
};
