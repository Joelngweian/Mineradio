'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');

function sampleVisiblePixels(nativeImage) {
  const size = nativeImage.getSize();
  const bitmap = nativeImage.toBitmap();
  const points = [
    [Math.floor(size.width * 0.12), Math.floor(size.height * 0.14)],
    [Math.floor(size.width * 0.50), Math.floor(size.height * 0.50)],
    [Math.floor(size.width * 0.88), Math.floor(size.height * 0.86)]
  ];
  return points.filter(([x, y]) => {
    const offset = ((y * size.width) + x) * 4;
    return bitmap[offset + 3] > 240;
  }).length;
}

async function runElectronChildSmoke() {
  const { app, BrowserWindow } = require('electron');
  await app.whenReady();
  const win = new BrowserWindow({
    width: 900,
    height: 620,
    show: false,
    transparent: false,
    backgroundColor: '#101114',
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });

  try {
    await win.loadFile(path.join(root, 'public', 'index.html'));
    const result = await win.webContents.executeJavaScript(`(() => {
      const overlay = document.getElementById('custom-bg-fx');
      if (!overlay) throw new Error('custom-bg-fx missing');
      if (typeof window.swapBackgroundWithTransition !== 'function') throw new Error('swapBackgroundWithTransition missing');
      overlay.style.transition = 'none';
      overlay.style.opacity = '1';
      overlay.style.backgroundImage = 'linear-gradient(135deg, rgb(32, 52, 88), rgb(114, 210, 230))';
      overlay.style.transform = 'none';
      return {
        hasOverlay: !!overlay,
        canSwap: typeof window.swapBackgroundWithTransition === 'function'
      };
    })()`);
    assert.equal(result.hasOverlay, true);
    assert.equal(result.canSwap, true);
    const image = await win.capturePage();
    assert.ok(sampleVisiblePixels(image) >= 3, 'main wallpaper frame should stay opaque while overlay is visible');
  } finally {
    win.destroy();
    app.quit();
  }
}

function runElectronSmoke() {
  let electronPath;
  try {
    electronPath = require('electron');
  } catch (err) {
    console.log('[wallpaper-main-smoke] Electron is not installed; skipped.');
    return Promise.resolve();
  }
  if (typeof electronPath !== 'string') {
    console.log('[wallpaper-main-smoke] Electron executable was not resolved; skipped.');
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const child = spawn(electronPath, [__filename, '--electron-child'], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error('Electron main wallpaper smoke exited with ' + code));
    });
  });
}

async function main() {
  if (process.argv.includes('--electron-child')) {
    try {
      await runElectronChildSmoke();
    } catch (err) {
      console.error('[wallpaper-main-smoke] fail:', err && err.message || err);
      try {
        const { app } = require('electron');
        app.exit(1);
      } catch (exitErr) {
        process.exitCode = 1;
      }
    }
    return;
  }
  await runElectronSmoke();
  console.log('[wallpaper-main-smoke] pass');
}

main().catch(err => {
  console.error('[wallpaper-main-smoke] fail:', err && err.message || err);
  process.exitCode = 1;
});
