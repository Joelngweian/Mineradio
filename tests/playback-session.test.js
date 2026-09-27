const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'modules', 'playback-session.js')).href;

test('playback sessions expose unique trace IDs alongside abortable numeric tokens', async () => {
  const { create } = await import(moduleUrl);
  const sessions = create();
  const first = sessions.begin({ id: 'first' });
  const second = sessions.begin({ id: 'second' });

  assert.match(first.id, /^pb_[A-Za-z0-9_]+$/);
  assert.match(second.id, /^pb_[A-Za-z0-9_]+$/);
  assert.notEqual(first.id, second.id);
  assert.equal(first.signal.aborted, true);
  assert.equal(sessions.isCurrent(second.token), true);
});
