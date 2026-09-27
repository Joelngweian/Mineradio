const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { createDesktopLyricsController } = require('../desktop/desktop-lyrics-controller');
const { createWallpaperController } = require('../desktop/wallpaper-controller');
const { registerIpcHandlers } = require('../desktop/ipc-handlers');

class FakeWindow {
  static instances = [];

  constructor(options) {
    this.options = options;
    this.bounds = {
      x: options.x || 0,
      y: options.y || 0,
      width: options.width,
      height: options.height,
    };
    this.destroyed = false;
    this.handlers = new Map();
    this.messages = [];
    this.webContents = {
      once: (event, callback) => this.once(`web:${event}`, callback),
      send: (channel, payload) => this.messages.push({ channel, payload }),
    };
    FakeWindow.instances.push(this);
  }

  isDestroyed() { return this.destroyed; }
  setBounds(bounds) { this.bounds = { ...bounds }; }
  getBounds() { return { ...this.bounds }; }
  setOpacity(value) { this.opacity = value; }
  setIgnoreMouseEvents(value) { this.ignoreMouse = value; }
  setAlwaysOnTop() { this.alwaysOnTop = true; }
  setVisibleOnAllWorkspaces() { this.visibleOnAllWorkspaces = true; }
  showInactive() { this.shown = true; }
  loadURL(url) { this.url = url; return Promise.resolve(); }
  once(event, callback) { this.handlers.set(event, callback); }
  on(event, callback) { this.handlers.set(event, callback); }
  close() {
    this.destroyed = true;
    this.handlers.get('closed')?.();
  }
}

function createScreen() {
  const display = { bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
  return {
    getPrimaryDisplay: () => display,
    getDisplayMatching: () => display,
    getCursorScreenPoint: () => ({ x: 500, y: 500 }),
  };
}

test('desktop lyrics controller preserves click-through lock and move behavior', () => {
  FakeWindow.instances = [];
  const mainMessages = [];
  const controller = createDesktopLyricsController({
    BrowserWindow: FakeWindow,
    screen: createScreen(),
    path,
    spawn: () => { throw new Error('not expected outside Windows'); },
    getOverlayUrl: (page) => `http://127.0.0.1:3000/${page}`,
    getMainWindow: () => ({ isDestroyed: () => false, webContents: { send: (channel, payload) => mainMessages.push({ channel, payload }) } }),
    platform: 'linux',
  });

  controller.open({ clickThrough: true, opacity: 0.8 });
  const window = FakeWindow.instances[0];
  assert.equal(window.url, 'http://127.0.0.1:3000/desktop-lyrics.html');
  assert.equal(window.ignoreMouse, true);
  assert.equal(window.alwaysOnTop, true);

  assert.equal(controller.setLockState(false), false);
  controller.setPointerCapture(true);
  assert.equal(window.ignoreMouse, false);
  assert.deepEqual(controller.moveBy(30, -20), { ok: true });
  assert.equal(controller.setLockState(true), true);
  assert.equal(window.ignoreMouse, true);
  assert.ok(mainMessages.some(({ channel }) => channel === 'mineradio-desktop-lyrics-lock-state'));
});

test('wallpaper controller keeps the overlay mouse-through and sends updates', () => {
  FakeWindow.instances = [];
  const controller = createWallpaperController({
    BrowserWindow: FakeWindow,
    screen: createScreen(),
    path,
    execFile: () => { throw new Error('not expected outside Windows'); },
    getOverlayUrl: (page) => `http://127.0.0.1:3000/${page}`,
    platform: 'linux',
  });

  controller.open({ mode: 'wallpaper' });
  const window = FakeWindow.instances[0];
  assert.equal(window.url, 'http://127.0.0.1:3000/wallpaper.html');
  assert.equal(window.ignoreMouse, true);
  controller.update({ enabled: false });
  assert.deepEqual(window.messages.at(-1), {
    channel: 'mineradio-wallpaper-state',
    payload: { mode: 'wallpaper', enabled: false },
  });
});

test('IPC registration retains every desktop overlay and window channel', () => {
  const handlers = new Map();
  registerIpcHandlers({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    app: { relaunch() {}, exit() {} },
    shell: { openPath: async () => '' },
    dialog: { showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true }) },
    fs,
    path,
    getSenderWindow: () => null,
    toggleFullscreen() {},
    exitFullscreenToWindow() {},
    getWindowState: () => ({}),
    configureGlobalHotkeys: () => ({ ok: true }),
    openGoogleMusicLoginWindow: async () => ({ ok: true }),
    clearGoogleLoginSession: async () => ({ ok: true }),
    getUpdateDownloadDir: () => path.join(process.cwd(), 'updates'),
    desktopLyrics: {
      enable() {}, close() {}, update() {}, setPointerCapture() {}, setHotBounds() {}, setLockState: () => true, moveBy: () => ({ ok: true }),
    },
    wallpaper: { open() {}, close() {}, update() {} },
  });

  [
    'desktop-window-minimize',
    'desktop-window-toggle-maximize',
    'desktop-window-toggle-fullscreen',
    'desktop-window-exit-fullscreen-windowed',
    'desktop-window-get-state',
    'desktop-window-close',
    'mineradio-desktop-lyrics-set-enabled',
    'mineradio-desktop-lyrics-update',
    'mineradio-desktop-lyrics-set-lock-state',
    'mineradio-desktop-lyrics-move-by',
    'mineradio-wallpaper-set-enabled',
    'mineradio-wallpaper-update',
  ].forEach((channel) => assert.equal(typeof handlers.get(channel), 'function', channel));
});

test('main process is reduced to composition and lifecycle wiring', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.js'), 'utf8');
  assert.match(source, /createDesktopLyricsController\(/);
  assert.match(source, /createWallpaperController\(/);
  assert.match(source, /registerIpcHandlers\(/);
  assert.doesNotMatch(source, /ipcMain\.handle\(/);
  assert.doesNotMatch(source, /function createDesktopLyricsWindow\(/);
  assert.doesNotMatch(source, /function createWallpaperWindow\(/);
});
