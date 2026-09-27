const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'modules', 'resource-lifecycle.js')).href;

test('resource lifecycle replaces named scopes and cancels scheduled work', async () => {
  const { createResourceLifecycle } = await import(moduleUrl);
  const calls = [];
  const timers = new Map();
  const idles = new Map();
  let nextId = 0;
  const lifecycle = createResourceLifecycle({
    setTimeout(callback) { const id = ++nextId; timers.set(id, callback); return id; },
    clearTimeout(id) { calls.push(`clear-timeout:${id}`); timers.delete(id); },
    requestIdleCallback(callback) { const id = ++nextId; idles.set(id, callback); return id; },
    cancelIdleCallback(id) { calls.push(`clear-idle:${id}`); idles.delete(id); },
    requestAnimationFrame(callback) { const id = ++nextId; timers.set(id, callback); return id; },
    cancelAnimationFrame(id) { calls.push(`clear-frame:${id}`); timers.delete(id); },
  });

  const first = lifecycle.createScope('playback');
  first.timeout(() => calls.push('timeout'), 20, 'beat');
  first.idle(() => calls.push('idle'), 20, 'analysis');
  const second = lifecycle.createScope('playback');

  assert.equal(first.disposed(), true);
  assert.equal(second.disposed(), false);
  assert.deepEqual(calls, ['clear-timeout:1', 'clear-idle:2']);
  assert.equal(timers.size, 0);
  assert.equal(idles.size, 0);
});

test('resource lifecycle aborts controllers, terminates workers, and disposes every scope', async () => {
  const { createResourceLifecycle } = await import(moduleUrl);
  const lifecycle = createResourceLifecycle();
  const scope = lifecycle.createScope('analysis');
  const controller = scope.abortController('audio');
  let terminated = 0;
  let disposed = 0;
  scope.trackWorker({ terminate() { terminated += 1; } }, () => { disposed += 1; });

  lifecycle.disposeAll();

  assert.equal(scope.disposed(), true);
  assert.equal(controller.signal.aborted, true);
  assert.equal(terminated, 1);
  assert.equal(disposed, 1);
  assert.equal(lifecycle.scopeCount(), 0);
});
