const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'modules', 'radio-queue.js')).href;

test('radio queue exposes loading and ready states while recommendations arrive', async () => {
  const { create } = await import(moduleUrl);
  const states = [];
  let resolveRequest;
  const controller = create({
    apiJson: () => new Promise((resolve) => { resolveRequest = resolve; }),
    applyRecommendations: (seed, songs) => songs.length,
    onStateChange: (state) => states.push(state),
  });
  const seed = { id: 'seed', name: 'Seed Song', artist: 'Artist', source: 'youtube' };

  const pending = controller.prime(seed);
  assert.equal(controller.getState().status, 'loading');
  assert.equal(controller.getState().seed.name, 'Seed Song');

  resolveRequest({ songs: [{ id: 'next', name: 'Next', artist: 'Artist', cover: 'cover' }] });
  await pending;

  assert.equal(controller.getState().status, 'ready');
  assert.deepEqual(states.map((state) => state.status), ['loading', 'ready']);
});

test('radio queue shows a retryable error after an empty request and can retry the same seed', async () => {
  const { create } = await import(moduleUrl);
  let songs = [];
  const controller = create({
    apiJson: async () => ({ songs }),
    applyRecommendations: (seed, items) => items.length,
  });
  const seed = { id: 'seed', name: 'Seed Song', artist: 'Artist', source: 'youtube' };

  await controller.prime(seed);
  assert.equal(controller.getState().status, 'error');
  assert.equal(controller.getState().retryable, true);

  songs = [{ id: 'next', name: 'Next', artist: 'Artist', cover: 'cover' }];
  await controller.retry();
  assert.equal(controller.getState().status, 'ready');
});

test('queue UI renders radio loading and retry controls through the delegated action path', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'queue.css'), 'utf8');

  assert.match(app, /renderQueueRecommendationStateHtml\(\)/);
  assert.match(app, /data-action="queue-radio-retry"/);
  assert.match(app, /'queue-radio-retry': function\(\) \{ retryQueueRadioRecommendations\(\); \}/);
  assert.match(app, /playbackTaskScope\.timeout\(callback, delay, 'radio-prime-retry'\)/);
  assert.match(css, /\.queue-recommendation-state\{/);
  assert.match(css, /@keyframes queue-recommendation-spin/);
});
