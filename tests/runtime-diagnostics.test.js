const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { DIAGNOSTICS_SCHEMA, snapshotRuntimeDiagnostics } = require('../server/services/runtime-diagnostics');

test('runtime diagnostics exposes useful service state without cookies or download URLs', () => {
  const jobs = new Map([
    ['old', { mode: 'installer', status: 'ready', progress: 100, updatedAt: 10, error: '' }],
    ['new', { mode: 'patch', status: 'error', progress: 42, updatedAt: 20, error: 'fetch https://secret.example/file?token=abc failed' }],
  ]);
  const report = snapshotRuntimeDiagnostics({
    version: '1.4.2',
    hasCookie: true,
    ytmSession: { getState: () => ({ hasClient: true, hasVisitorData: true, hasWebPo: false, hasDom: true }) },
    ytmAudioService: { getState: () => ({ cachedFormats: 3 }) },
    updateJobs: jobs,
    now: () => 0,
  });

  assert.equal(report.schema, DIAGNOSTICS_SCHEMA);
  assert.equal(report.login.accountConfigured, true);
  assert.equal(report.ytm.session.clientReady, true);
  assert.equal(report.ytm.audio.cachedFormats, 3);
  assert.equal(report.updates.jobs[0].mode, 'patch');
  assert.match(report.updates.jobs[0].error, /\[url\]/);
  assert.doesNotMatch(JSON.stringify(report), /secret\.example|token=abc/);
});

test('runtime diagnostics route returns the safe server snapshot', async (t) => {
  const { server } = require('../server-app');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const payload = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${address.port}/api/diagnostics/runtime`, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    }).on('error', reject);
  });

  assert.equal(payload.status, 200);
  const report = JSON.parse(payload.body);
  assert.equal(report.schema, DIAGNOSTICS_SCHEMA);
  assert.equal(typeof report.login.accountConfigured, 'boolean');
  assert.doesNotMatch(payload.body, /SID=|SAPISID=|\.google-cookie/i);
});
