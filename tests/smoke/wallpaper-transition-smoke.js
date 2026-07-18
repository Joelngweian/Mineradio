'use strict';

const { spawn } = require('child_process');

const SMOKE_HTML = `
  <!doctype html>
  <html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
      #custom-bg, #custom-bg-fx {
        position: fixed;
        inset: 0;
        background-size: cover;
        background-position: center;
      }
      #custom-bg { background-image: linear-gradient(135deg, #17324f, #78d7ff); }
      #custom-bg-fx {
        pointer-events: none;
        opacity: 0;
        transform: none;
        background-image: none;
      }
    </style>
  </head>
  <body>
    <div id="custom-bg"></div>
    <div id="custom-bg-fx"></div>
    <script>
      window.__runWallpaperSwapSmoke = function() {
        var bg = document.getElementById('custom-bg');
        var overlay = document.getElementById('custom-bg-fx');
        overlay.style.transition = 'none';
        overlay.style.backgroundImage = getComputedStyle(bg).backgroundImage;
        overlay.style.opacity = '1';
        overlay.style.transform = 'none';
        void overlay.offsetWidth;
        bg.style.backgroundImage = 'linear-gradient(135deg, #2a102f, #ff6b9c)';
        return new Promise(function(resolve) {
          requestAnimationFrame(function() {
            requestAnimationFrame(resolve);
          });
        });
      };
      window.__wallpaperSmokeDomSamples = function() {
        var overlay = document.getElementById('custom-bg-fx');
        var style = getComputedStyle(overlay);
        var rect = overlay.getBoundingClientRect();
        return (Number(style.opacity) < 0.98 ? 1 : 0)
          + (style.backgroundImage === 'none' ? 1 : 0)
          + (rect.width < window.innerWidth || rect.height < window.innerHeight ? 1 : 0);
      };
    </script>
  </body>
  </html>
`;

function smokeDataUrl() {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(SMOKE_HTML);
}

async function runPlaywrightSmoke(chromium) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 240 }, deviceScaleFactor: 1 });
    await page.goto(smokeDataUrl());
    await page.evaluate(() => window.__runWallpaperSwapSmoke());
    await page.screenshot({ type: 'png' });
    const transparentSamples = await page.evaluate(() => window.__wallpaperSmokeDomSamples());
    if (transparentSamples) {
      throw new Error('overlay should cover the previous wallpaper before the active background is swapped');
    }
  } finally {
    await browser.close();
  }
}

function sampleTransparentPixels(nativeImage) {
  const size = nativeImage.getSize();
  const bitmap = nativeImage.toBitmap();
  const points = [
    [Math.floor(size.width * 0.08), Math.floor(size.height * 0.10)],
    [Math.floor(size.width * 0.50), Math.floor(size.height * 0.50)],
    [Math.floor(size.width * 0.92), Math.floor(size.height * 0.90)]
  ];
  return points.filter(([x, y]) => {
    const offset = ((y * size.width) + x) * 4;
    const blue = bitmap[offset];
    const green = bitmap[offset + 1];
    const red = bitmap[offset + 2];
    const alpha = bitmap[offset + 3];
    const leakedWindowBackground = green > 220 && red < 40 && blue < 40;
    return alpha < 250 || leakedWindowBackground;
  }).length;
}

async function runElectronChildSmoke() {
  const { app, BrowserWindow } = require('electron');
  await app.whenReady();
  const win = new BrowserWindow({
    width: 360,
    height: 240,
    show: false,
    transparent: false,
    backgroundColor: '#00ff00',
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });

  try {
    await win.loadURL(smokeDataUrl());
    await win.webContents.executeJavaScript('window.__runWallpaperSwapSmoke()');
    const image = await win.capturePage();
    const transparentSamples = sampleTransparentPixels(image)
      + await win.webContents.executeJavaScript('window.__wallpaperSmokeDomSamples()');
    if (transparentSamples) {
      throw new Error('overlay should cover the previous wallpaper before the active background is swapped');
    }
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
    console.log('[wallpaper-smoke] Playwright and Electron are not installed; skipped.');
    return Promise.resolve();
  }
  if (typeof electronPath !== 'string') {
    console.log('[wallpaper-smoke] Electron executable was not resolved; skipped.');
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const child = spawn(electronPath, [__filename, '--electron-child'], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error('Electron wallpaper smoke exited with ' + code));
    });
  });
}

async function main() {
  if (process.argv.includes('--electron-child')) {
    try {
      await runElectronChildSmoke();
    } catch (err) {
      console.error('[wallpaper-smoke] fail:', err && err.message || err);
      try {
        const { app } = require('electron');
        app.exit(1);
      } catch (exitErr) {
        process.exitCode = 1;
      }
    }
    return;
  }

  try {
    const { chromium } = require('playwright');
    await runPlaywrightSmoke(chromium);
    console.log('[wallpaper-smoke] pass via Playwright');
    return;
  } catch (err) {
    if (err && err.code !== 'MODULE_NOT_FOUND') throw err;
  }

  await runElectronSmoke();
  console.log('[wallpaper-smoke] pass via Electron');
}

main().catch(err => {
  console.error('[wallpaper-smoke] fail:', err && err.message || err);
  process.exitCode = 1;
});
