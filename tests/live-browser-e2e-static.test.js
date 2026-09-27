'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('live browser playback E2E stays separate from mocked UI E2E', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const config = fs.readFileSync(path.join(root, 'playwright.live.config.cjs'), 'utf8');
  const spec = fs.readFileSync(path.join(root, 'tests', 'live', 'playback-browser-live.spec.cjs'), 'utf8');

  assert.equal(packageJson.scripts['test:live:e2e:playback'], 'playwright test --config playwright.live.config.cjs');
  assert.match(config, /testMatch:\s*'playback-browser-live\.spec\.cjs'/);
  assert.match(config, /playback-live-server\.cjs/);
  assert.doesNotMatch(spec, /page\.route\(/);
  assert.match(spec, /source-ready/);
  assert.match(spec, /media-playing/);
});
