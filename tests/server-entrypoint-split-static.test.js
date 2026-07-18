const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const entrySource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const appPath = path.join(root, 'server-app.js');
const updateServicePath = path.join(root, 'server', 'update-service.js');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('server entrypoint stays thin and delegates to the app module', () => {
  assert.ok(entrySource.split(/\r?\n/).length <= 40, 'server.js should remain a thin bootstrap file');
  assert.match(entrySource, /require\('\.\/server-app'\)/);
  assert.match(entrySource, /require\.main === module/);
  assert.doesNotMatch(entrySource, /http\.createServer/);
  assert.ok(fs.existsSync(appPath), 'server-app.js should own the HTTP app wiring');
});

test('update and beat-cache implementation is outside the HTTP app file', () => {
  assert.ok(fs.existsSync(updateServicePath), 'server/update-service.js should exist');
  const appSource = fs.readFileSync(appPath, 'utf8');
  const updateSource = fs.readFileSync(updateServicePath, 'utf8');

  assert.match(appSource, /require\('\.\/server\/update-service'\)/);
  assert.doesNotMatch(appSource, /async function fetchLatestUpdateInfo\(/);
  assert.doesNotMatch(appSource, /function startUpdateDownloadJob\(/);
  assert.doesNotMatch(appSource, /function startUpdatePatchJob\(/);
  assert.match(updateSource, /async function fetchLatestUpdateInfo\(/);
  assert.match(updateSource, /function startUpdateDownloadJob\(/);
  assert.match(updateSource, /function startUpdatePatchJob\(/);
  assert.match(updateSource, /function beatCacheRootInfo\(/);
});

test('packaged app includes split server files', () => {
  const files = packageJson && packageJson.build && packageJson.build.files;
  assert.ok(Array.isArray(files), 'electron-builder files list should be explicit');
  assert.ok(files.includes('server.js'), 'server.js entrypoint should be packaged');
  assert.ok(files.includes('server-app.js'), 'server-app.js HTTP app should be packaged');
  assert.ok(files.includes('server/**/*'), 'server service modules should be packaged');
});
