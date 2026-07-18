const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const indexSource = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const packageSource = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
const wallpaperSmokePath = path.join(root, 'tests', 'smoke', 'wallpaper-transition-smoke.js');
const wallpaperAppSmokePath = path.join(root, 'tests', 'smoke', 'wallpaper-main-smoke.js');
const searchRadioSmokePath = path.join(root, 'tests', 'smoke', 'search-radio-flow-smoke.js');

function extractFunction(source, name) {
  const marker = 'function ' + name + '(';
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, name + ' should exist');
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, name + ' should have a body');
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(name + ' body was not closed');
}

test('wallpaper rotation preloads the next media before applying it', () => {
  const source = extractFunction(indexSource, 'swapBackgroundWithTransition');
  assert.match(indexSource, /function preloadWallpaperSwapMedia\(/);
  assert.match(source, /preloadWallpaperSwapMedia\(item\)\.then/);
  assert.ok(
    source.indexOf('preloadWallpaperSwapMedia(item)') < source.indexOf('setCustomBackgroundMedia(media, true)'),
    'new wallpaper should only be applied after preload resolves'
  );
  const overlayBranch = source.slice(source.indexOf("var overlay = document.getElementById('custom-bg-fx');"));
  const coveredOverlay = overlayBranch.slice(overlayBranch.indexOf("overlay.style.transition = 'none'"));
  assert.ok(
    coveredOverlay.indexOf("overlay.style.opacity = '1'") < coveredOverlay.indexOf('setCustomBackgroundMedia(media, true)'),
    'old wallpaper overlay should cover the background before the active media is swapped'
  );
  assert.match(source, /waitForWallpaperSwapPaint\(media\)\.then/);
});

test('fade wallpaper transition never fades the whole background layer to transparent', () => {
  const source = extractFunction(indexSource, 'swapBgFadeDip');
  assert.doesNotMatch(source, /layer\.style\.opacity\s*=\s*['"]0['"]/);
  assert.match(source, /swapBackgroundWithTransition/);
});

test('clearing a custom wallpaper disables rotation and pending swap animation', () => {
  const source = extractFunction(indexSource, 'clearCustomBackgroundImage');
  assert.match(source, /wallpaperSwapToken\+\+/);
  assert.match(source, /stopWallpaperRotation\(\)/);
  assert.match(source, /fx\.wallpaperRotateMode\s*=\s*'off'/);
  assert.match(source, /fx\.wallpaperRotateItems\s*=\s*\[\]/);
  assert.match(source, /setCustomBackgroundMedia\(null/);
  assert.match(source, /updateWallpaperRotateUi\(\)/);
});

test('wallpaper transition has a runnable visual smoke guard', () => {
  assert.ok(fs.existsSync(wallpaperSmokePath), 'wallpaper transition smoke script should exist');
  const smokeSource = fs.readFileSync(wallpaperSmokePath, 'utf8');
  assert.match(packageSource, /"smoke:wallpaper": "node tests\/smoke\/wallpaper-transition-smoke\.js"/);
  assert.match(smokeSource, /chromium\.launch/);
  assert.match(smokeSource, /custom-bg-fx/);
  assert.match(smokeSource, /page\.screenshot/);
  assert.match(smokeSource, /transparentSamples/);
  assert.match(smokeSource, /overlay should cover the previous wallpaper/);
});

test('wallpaper transition has a main-page smoke guard', () => {
  assert.ok(fs.existsSync(wallpaperAppSmokePath), 'main wallpaper smoke script should exist');
  const smokeSource = fs.readFileSync(wallpaperAppSmokePath, 'utf8');
  assert.match(packageSource, /"smoke:wallpaper:app": "node tests\/smoke\/wallpaper-main-smoke\.js"/);
  assert.match(smokeSource, /loadFile\(path\.join\(root, 'public', 'index\.html'\)\)/);
  assert.match(smokeSource, /swapBackgroundWithTransition/);
  assert.match(smokeSource, /custom-bg-fx/);
  assert.match(smokeSource, /capturePage/);
});

test('search playback radio flow has a runnable smoke guard', () => {
  assert.ok(fs.existsSync(searchRadioSmokePath), 'search radio smoke script should exist');
  const smokeSource = fs.readFileSync(searchRadioSmokePath, 'utf8');
  assert.match(packageSource, /"smoke:search-radio": "node tests\/smoke\/search-radio-flow-smoke\.js"/);
  assert.match(smokeSource, /createSearchSeedQueue/);
  assert.match(smokeSource, /mergeRadioRecommendations/);
  assert.match(smokeSource, /assert/);
});
