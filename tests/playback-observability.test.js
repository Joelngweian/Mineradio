const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'modules', 'playback-observability.js')).href;

function createAudio() {
  const listeners = new Map();
  return {
    readyState: 3,
    networkState: 2,
    currentTime: 12.5,
    duration: 180,
    paused: false,
    ended: false,
    error: null,
    addEventListener(name, listener) {
      const list = listeners.get(name) || [];
      list.push(listener);
      listeners.set(name, list);
    },
    removeEventListener(name, listener) {
      const list = listeners.get(name) || [];
      listeners.set(name, list.filter((item) => item !== listener));
    },
    emit(name) {
      (listeners.get(name) || []).slice().forEach((listener) => listener({ type: name }));
    },
  };
}

test('playback observability records bounded per-session phases without source URLs', async () => {
  const { createPlaybackObservability } = await import(moduleUrl);
  let now = 100;
  const trace = createPlaybackObservability({ now: () => now, maxSessions: 2, maxEventsPerSession: 3 });

  trace.begin({ token: 7, sessionId: 'pb_test_123456789', index: 2, song: {
    id: 'ytm-1', name: 'Track', artist: 'Artist', source: 'youtube', url: 'https://secret.example/audio?token=abc',
  } });
  now += 20;
  trace.mark('source-ready', { quality: 'hires' }, 7);
  now += 15;
  trace.fail('audio-play', new Error('Request to https://secret.example/audio?token=abc failed'), { manual: false }, 7);
  now += 10;
  trace.mark('media-playing', { media: { readyState: 4 } }, 7);

  const snapshot = trace.snapshot();
  assert.equal(snapshot.activeToken, 7);
  assert.equal(snapshot.sessions.length, 1);
  assert.equal(snapshot.sessions[0].track.id, 'ytm-1');
  assert.equal(snapshot.sessions[0].sessionId, 'pb_test_123456789');
  assert.equal(snapshot.sessions[0].events.length, 3);
  assert.equal(snapshot.sessions[0].events[0].atMs, 20);
  assert.equal(snapshot.sessions[0].events[0].stage, 'source-ready');
  const failure = snapshot.sessions[0].events.find((event) => event.type === 'failure');
  assert.match(failure.details.error.message, /\[url\]/);
  assert.doesNotMatch(JSON.stringify(snapshot), /secret\.example|token=abc/);
});

test('playback observability binds media readiness and media error details to the active session', async () => {
  const { createPlaybackObservability } = await import(moduleUrl);
  const trace = createPlaybackObservability();
  const audio = createAudio();
  trace.begin({ token: 3, song: { id: 'track-3' } });
  const unbind = trace.bindAudio(audio, () => 3);

  audio.emit('waiting');
  audio.error = { code: 2, message: 'network unavailable' };
  audio.emit('error');

  const events = trace.snapshot().sessions[0].events;
  const waiting = events.find((event) => event.stage === 'media-waiting');
  const failure = events.find((event) => event.stage === 'media-error');
  assert.equal(waiting.details.media.currentTime, 12.5);
  assert.equal(failure.details.media.error.name, 'MEDIA_ERR_NETWORK');
  assert.equal(failure.details.error.message, 'network unavailable');

  unbind();
  audio.emit('playing');
  assert.equal(trace.snapshot().sessions[0].events.some((event) => event.stage === 'media-playing'), false);
});

test('playback observability closes replaced sessions and ignores stale tokens', async () => {
  const { createPlaybackObservability } = await import(moduleUrl);
  const trace = createPlaybackObservability();
  trace.begin({ token: 1, song: { id: 'first' } });
  trace.begin({ token: 2, song: { id: 'second' } });
  assert.equal(trace.mark('stale', null, 1), false);
  assert.equal(trace.finish('completed', { reason: 'ended' }, 2), true);

  const snapshot = trace.snapshot();
  assert.equal(snapshot.activeToken, null);
  assert.equal(snapshot.sessions[0].status, 'superseded');
  assert.equal(snapshot.sessions[1].status, 'completed');
});
