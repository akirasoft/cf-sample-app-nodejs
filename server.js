/**
 * Created by cgfrost on 14/03/2014.
 */

/*jslint node: true */
var cfenv = require("cfenv")
var appEnv = cfenv.getAppEnv()
var ruxitEnv = appEnv.getServiceCreds(/ruxit/)
var ruxitServer = ruxitEnv.server
var ruxitTenant = ruxitEnv.tenant
var ruxitToken = ruxitEnv.tenanttoken

try {
    require('/home/vcap/app/agent/bin/1.95.149.20160607-131029/any/nodejs/nodejsagent.js') ({
      server: ruxitServer,
      tenant: ruxitTenant,
      tenanttoken: ruxitToken,
      loglevelcon: 'none'
    });
} catch (err) {
 console.log("ERROR! Can not find the ruxit nodejs agent!", err);
}

"use strict";

var lessMiddleware = require('less-middleware');
var express = require('express');
var app = express();


// Configuration
app.set('views', __dirname + '/views');
app.set('view options', {layout: true});
app.set('view engine', 'jade');
app.use(lessMiddleware(__dirname + '/public'));
app.use(express.static(__dirname + '/public'));

require("./routes/controller.js")(app);

var port = process.env.PORT || 3000;

var webServer = app.listen(port, function () {
    console.log('Listening on port %d', webServer.address().port);
});
