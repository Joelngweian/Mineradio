const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'modules', 'playback-recovery.js')).href;
const appSource = require('node:fs').readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');

test('playback recovery retries one transient source or media failure', async () => {
  const { shouldRecoverPlaybackFailure } = await import(moduleUrl);

  assert.equal(shouldRecoverPlaybackFailure({ error: { status: 403 }, attempt: 0 }), true);
  assert.equal(shouldRecoverPlaybackFailure({ error: { name: 'MediaError', code: 'MEDIA_ERR_NETWORK' }, attempt: 0 }), true);
  assert.equal(shouldRecoverPlaybackFailure({ error: { name: 'MediaError', code: 'MEDIA_ERR_DECODE' }, attempt: 0 }), true);
  assert.equal(shouldRecoverPlaybackFailure({ error: new Error('temporary source lookup failed'), attempt: 0 }), true);
});

test('playback recovery never retries user or availability failures', async () => {
  const { shouldRecoverPlaybackFailure } = await import(moduleUrl);

  assert.equal(shouldRecoverPlaybackFailure({ error: { name: 'NotAllowedError' }, attempt: 0 }), false);
  assert.equal(shouldRecoverPlaybackFailure({ error: { name: 'AbortError' }, attempt: 0 }), false);
  assert.equal(shouldRecoverPlaybackFailure({ error: { code: 'MEDIA_ERR_ABORTED' }, attempt: 0 }), false);
  assert.equal(shouldRecoverPlaybackFailure({ error: new Error('unavailable'), restricted: true, attempt: 0 }), false);
  assert.equal(shouldRecoverPlaybackFailure({ error: { status: 404 }, attempt: 0 }), false);
});

test('playback recovery is bounded to one retry and exposes a short delay', async () => {
  const { MAX_PLAYBACK_RECOVERY_ATTEMPTS, recoveryDelayMs, shouldRecoverPlaybackFailure } = await import(moduleUrl);

  assert.equal(MAX_PLAYBACK_RECOVERY_ATTEMPTS, 1);
  assert.equal(recoveryDelayMs(1), 650);
  assert.equal(shouldRecoverPlaybackFailure({ error: { status: 503 }, attempt: 1 }), false);
});

test('player routes source and media failures through a session-bound recovery path', () => {
  assert.match(appSource, /import \* as playbackRecoveryModule from '\.\/modules\/playback-recovery\.js'/);
  assert.match(appSource, /function schedulePlaybackRecovery\(idx, token, opts, phase, error, details\)/);
  assert.match(appSource, /if \(state\.scheduled\) return true/);
  assert.match(appSource, /playbackTaskScope\.timeout\(function\(\)/);
  assert.match(appSource, /audio\._mineradioPlaybackToken = token/);
  assert.match(appSource, /bindPlaybackRecoveryEvents\(audio\)/);
  assert.match(appSource, /schedulePlaybackRecovery\(idx, token, opts, 'source-url'/);
  assert.match(appSource, /schedulePlaybackRecovery\(idx, token, opts, 'audio-start'/);
});
