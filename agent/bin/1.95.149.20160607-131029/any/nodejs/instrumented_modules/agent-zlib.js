/*jslint node: true*/
"use strict";

var core = require('../lib/core.js');

var zlib;
try { zlib = require('zlib'); } catch (err) { }

if (zlib && zlib.Deflate && zlib.Deflate.prototype) {
    var proto = Object.getPrototypeOf(zlib.Deflate.prototype);
    if (proto._transform) {
        // streams2
        core.wrap(proto, "_transform", { type: core.CallbackType.callbackLast });
    }
    else if (proto.write && proto.flush && proto.end) {
        // plain ol' streams
        core.wrapMultiple(
          proto,
          [
            'write',
            'flush',
            'end'
          ],
          { type: core.CallbackType.callbackLast }
        );
    }
}

module.exports = zlib;
