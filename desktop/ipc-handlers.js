function registerIpcHandlers({
  ipcMain,
  app,
  shell,
  dialog,
  fs,
  path,
  getSenderWindow,
  toggleFullscreen,
  exitFullscreenToWindow,
  getWindowState,
  configureGlobalHotkeys,
  openGoogleMusicLoginWindow,
  clearGoogleLoginSession,
  getUpdateDownloadDir,
  desktopLyrics,
  wallpaper,
}) {
  ipcMain.handle('desktop-window-minimize', (event) => {
    getSenderWindow(event)?.minimize();
  });

  ipcMain.handle('desktop-window-toggle-maximize', (event) => {
    toggleFullscreen(getSenderWindow(event));
  });

  ipcMain.handle('desktop-window-toggle-fullscreen', (event) => {
    toggleFullscreen(getSenderWindow(event));
  });

  ipcMain.handle('desktop-window-exit-fullscreen-windowed', (event) => {
    exitFullscreenToWindow(getSenderWindow(event));
  });

  ipcMain.handle('desktop-window-get-state', (event) => getWindowState(getSenderWindow(event)));
  ipcMain.handle('desktop-window-close', (event) => getSenderWindow(event)?.close());
  ipcMain.handle('mineradio-hotkeys-configure-global', (_event, bindings) => configureGlobalHotkeys(bindings));

  ipcMain.handle('mineradio-export-json-file', async (event, payload = {}) => {
    try {
      const owner = getSenderWindow(event);
      const defaultName = String(payload.defaultName || 'mineradio-export.json').replace(/[\\/:*?"<>|]+/g, '-');
      const result = await dialog.showSaveDialog(owner, {
        title: '导出 Mineradio 存档',
        defaultPath: defaultName.toLowerCase().endsWith('.json') ? defaultName : `${defaultName}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      const text = typeof payload.text === 'string' ? payload.text : JSON.stringify(payload.data || {}, null, 2);
      fs.writeFileSync(result.filePath, text, 'utf8');
      return { ok: true, filePath: result.filePath };
    } catch (error) {
      return { ok: false, error: error.message || 'EXPORT_FAILED' };
    }
  });

  ipcMain.handle('mineradio-import-json-file', async (event) => {
    try {
      const result = await dialog.showOpenDialog(getSenderWindow(event), {
        title: '导入 Mineradio 存档',
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: false, canceled: true };
      const filePath = result.filePaths[0];
      return { ok: true, filePath, text: fs.readFileSync(filePath, 'utf8') };
    } catch (error) {
      return { ok: false, error: error.message || 'IMPORT_FAILED' };
    }
  });

  ipcMain.handle('google-account-open-login', async (event) => openGoogleMusicLoginWindow(getSenderWindow(event)));
  ipcMain.handle('google-account-clear-login', async () => clearGoogleLoginSession());

  ipcMain.handle('mineradio-open-update-installer', async (_event, filePath) => {
    try {
      const target = path.resolve(String(filePath || ''));
      const updateDir = path.resolve(getUpdateDownloadDir());
      if (!target || !target.startsWith(updateDir + path.sep)) return { ok: false, error: 'INVALID_UPDATE_PATH' };
      if (!fs.existsSync(target)) return { ok: false, error: 'UPDATE_FILE_MISSING' };
      const error = await shell.openPath(target);
      return error ? { ok: false, error } : { ok: true };
    } catch (error) {
      return { ok: false, error: error.message || 'OPEN_UPDATE_FAILED' };
    }
  });

  ipcMain.handle('mineradio-restart-app', async () => {
    try {
      app.relaunch();
      app.exit(0);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message || 'RESTART_FAILED' };
    }
  });

  ipcMain.handle('mineradio-desktop-lyrics-set-enabled', async (_event, enabled, payload) => {
    try {
      if (enabled) desktopLyrics.enable(payload || {});
      else desktopLyrics.close();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message || 'DESKTOP_LYRICS_FAILED' };
    }
  });

  ipcMain.handle('mineradio-desktop-lyrics-update', async (_event, payload) => {
    try {
      desktopLyrics.update(payload || {});
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message || 'DESKTOP_LYRICS_UPDATE_FAILED' };
    }
  });

  ipcMain.handle('mineradio-desktop-lyrics-set-dragging', async () => ({ ok: true }));

  ipcMain.handle('mineradio-desktop-lyrics-set-pointer-capture', async (_event, active) => {
    try {
      desktopLyrics.setPointerCapture(active);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message || 'DESKTOP_LYRICS_POINTER_FAILED' };
    }
  });

  ipcMain.handle('mineradio-desktop-lyrics-set-hot-bounds', async (_event, bounds) => {
    try {
      desktopLyrics.setHotBounds(bounds);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message || 'DESKTOP_LYRICS_HOT_BOUNDS_FAILED' };
    }
  });

  ipcMain.handle('mineradio-desktop-lyrics-set-lock-state', async (_event, locked) => {
    try {
      return { ok: true, locked: desktopLyrics.setLockState(locked) };
    } catch (error) {
      return { ok: false, error: error.message || 'DESKTOP_LYRICS_LOCK_FAILED' };
    }
  });

  ipcMain.handle('mineradio-desktop-lyrics-move-by', async (_event, dx, dy) => {
    try {
      return desktopLyrics.moveBy(dx, dy);
    } catch (error) {
      return { ok: false, error: error.message || 'DESKTOP_LYRICS_MOVE_FAILED' };
    }
  });

  ipcMain.handle('mineradio-wallpaper-set-enabled', async (_event, enabled, payload) => {
    try {
      if (enabled) wallpaper.open(payload || {});
      else wallpaper.close();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message || 'WALLPAPER_FAILED' };
    }
  });

  ipcMain.handle('mineradio-wallpaper-update', async (_event, payload) => {
    try {
      wallpaper.update(payload || {});
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message || 'WALLPAPER_UPDATE_FAILED' };
    }
  });
}

module.exports = { registerIpcHandlers };
