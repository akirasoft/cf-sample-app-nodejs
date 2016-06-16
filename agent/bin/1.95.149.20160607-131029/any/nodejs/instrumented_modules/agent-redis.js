var redis = require('redis');
var core = require('../lib/core.js');

core.wrap(redis.RedisClient.prototype, 'send_command', {
    type: core.CallbackType.callbackLast
});

module.exports = redis;
