const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'modules', 'failure-diagnostics.js')).href;

test('failure diagnostics exports a redacted playback report through the desktop bridge', async () => {
  const { createFailureDiagnosticExporter } = await import(moduleUrl);
  let exported = null;
  const exporter = createFailureDiagnosticExporter({
    now: () => new Date(2026, 8, 26, 12, 34, 56).getTime(),
    apiJson: async () => ({ cookie: 'hidden', updateUrl: 'https://secret.example/update?token=abc', ytm: { cachedFormats: 2 } }),
    getContext: () => ({ appVersion: '1.4.2', sourceUrl: 'https://secret.example/audio?sig=abc' }),
    getTrace: () => ({ sessions: [{ track: { name: 'Song', url: 'https://secret.example/track' } }] }),
    getDesktopApi: () => ({
      exportJsonFile: async (payload) => {
        exported = payload;
        return { ok: true, filePath: 'C:/diagnostic.json' };
      },
    }),
  });

  exporter.recordFailure('audio-play', new Error('Request to https://secret.example/audio?token=abc failed'), { authorization: 'secret' });
  const outcome = await exporter.exportReport();

  assert.equal(outcome.result.ok, true);
  assert.match(exported.defaultName, /^mineradio-failure-diagnostic-20260926-123456\.json$/);
  assert.doesNotMatch(exported.text, /secret\.example|token=abc|authorization|hidden/);
  assert.match(exported.text, /audio-play/);
});
