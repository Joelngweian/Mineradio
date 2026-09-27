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
  assert.match(indexSource, /<script type="module" src="js\/app\.js"><\/script>/);
  assert.doesNotMatch(indexSource, /<style>[\s\S]{500,}<\/style>/);
  assert.doesNotMatch(indexSource, /<script>[\s\S]*function animate\(\)[\s\S]*<\/script>/);
  assert.ok(indexSource.length < 160000, 'index.html should stay small enough to inspect safely');
});

test('externalized app assets keep the previous entry points', () => {
  const cssRoot = path.join(publicRoot, 'css');
  const cssEntry = fs.readFileSync(path.join(cssRoot, 'app.css'), 'utf8');
  const cssFiles = [
    'base.css',
    'background.css',
    'onboarding-search.css',
    'home.css',
    'chrome.css',
    'controls.css',
    'overlays.css',
    'fx-console.css',
    'queue.css',
    'lyrics.css',
  ];
  const cssSource = cssFiles.map((file) => fs.readFileSync(path.join(cssRoot, file), 'utf8')).join('\n');
  const preloadSource = fs.readFileSync(path.join(publicRoot, 'js', 'preload-mode.js'), 'utf8');
  const appSource = fs.readFileSync(path.join(publicRoot, 'js', 'app.js'), 'utf8');

  cssFiles.forEach((file) => assert.match(cssEntry, new RegExp(`@import url\\('./${file.replace('.', '\\.')}'\\);`)));
  assert.match(cssSource, /#splash/);
  assert.match(preloadSource, /mineradio-diy-player-mode-v1/);
  assert.match(appSource, /import \* as apiClient from '\.\/modules\/api-client\.js';/);
  assert.match(appSource, /const MineradioModules = Object\.freeze\(/);
  assert.match(appSource, /function animate\(\)/);
  assert.match(appSource, /document\.addEventListener\('DOMContentLoaded'/);
});
