'use strict';

const { server, startServer, shutdownServer } = require('./server-app');

if (require.main === module) startServer();

module.exports = server;
module.exports.startServer = startServer;
module.exports.shutdownServer = shutdownServer;
