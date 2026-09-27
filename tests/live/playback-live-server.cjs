'use strict';

process.env.PORT = process.env.MINERADIO_LIVE_E2E_PORT || '4311';
process.env.HOST = '127.0.0.1';

const { startServer } = require('../../server-app');

const server = startServer();
let closing = false;

function closeServer() {
  if (closing) return;
  closing = true;
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2_000).unref();
}

process.once('SIGINT', closeServer);
process.once('SIGTERM', closeServer);
