const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const publicRoot = path.join(root, 'public');
const indexSource = fs.readFileSync(path.join(publicRoot, 'index.html'), 'utf8');

test('index html is a thin shell with external css and app scripts', () => {
  assert.match(indexSource, /<link rel="stylesheet" href="css\/app\.css">/);
  assert.match(indexSource, /<script src="js\/preload-mode\.js"><\/script>/);
  assert.match(indexSource, /<script src="js\/app\.js"><\/script>/);
  assert.doesNotMatch(indexSource, /<style>[\s\S]{500,}<\/style>/);
  assert.doesNotMatch(indexSource, /<script>[\s\S]*function animate\(\)[\s\S]*<\/script>/);
  assert.ok(indexSource.length < 160000, 'index.html should stay small enough to inspect safely');
});

test('externalized app assets keep the previous entry points', () => {
  const cssSource = fs.readFileSync(path.join(publicRoot, 'css', 'app.css'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(publicRoot, 'js', 'preload-mode.js'), 'utf8');
  const appSource = fs.readFileSync(path.join(publicRoot, 'js', 'app.js'), 'utf8');

  assert.match(cssSource, /#splash/);
  assert.match(preloadSource, /mineradio-diy-player-mode-v1/);
  assert.match(appSource, /'use strict';/);
  assert.match(appSource, /var MineradioModules = window\.MineradioModules \|\| \(window\.MineradioModules = \{\}\);/);
  assert.match(appSource, /function animate\(\)/);
  assert.match(appSource, /document\.addEventListener\('DOMContentLoaded'/);
});
