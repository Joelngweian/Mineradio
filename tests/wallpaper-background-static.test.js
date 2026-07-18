const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const indexSource = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

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
