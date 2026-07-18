'use strict';

const { server, startServer } = require('./server-app');

if (require.main === module) startServer();

module.exports = server;
module.exports.startServer = startServer;
