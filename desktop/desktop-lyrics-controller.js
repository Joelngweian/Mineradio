function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function createDesktopLyricsController({
  BrowserWindow,
  screen,
  path,
  spawn,
  getOverlayUrl,
  getMainWindow,
  logger = console,
  platform = process.platform,
}) {
  let lyricsWindow = null;
  let lyricsState = {};
  let userBounds = null;
  let programmaticMove = false;
  let pointerCapture = false;
  let mouseIgnored = null;
  let mousePoller = null;
  let mousePollerBuffer = '';
  let hotBounds = null;
  let lastMiddleAt = 0;

  function isWindowAvailable() {
    return !!lyricsWindow && !lyricsWindow.isDestroyed();
  }

  function defaultBounds(payload = lyricsState) {
    const display = userBounds ? screen.getDisplayMatching(userBounds) : screen.getPrimaryDisplay();
    const bounds = display.bounds;
    const yRatio = clampNumber(payload.y, 0.08, 0.92, 0.76);
    const width = Math.round(Math.min(Math.max(880, bounds.width * 0.72), bounds.width - 96));
    const height = Math.round(Math.min(Math.max(340, bounds.height * 0.38), 560, bounds.height - 96));
    return {
      x: Math.round(bounds.x + (bounds.width - width) / 2),
      y: Math.round(bounds.y + bounds.height * yRatio - height / 2),
      width,
      height,
    };
  }

  function constrainBounds(bounds) {
    const display = screen.getDisplayMatching(bounds);
    const area = display.bounds;
    const next = {
      ...bounds,
      width: Math.round(Math.min(Math.max(320, bounds.width), area.width)),
      height: Math.round(Math.min(Math.max(180, bounds.height), area.height)),
    };
    const maxX = area.x + Math.max(0, area.width - next.width);
    const maxY = area.y + Math.max(0, area.height - next.height);
    next.x = Math.round(clampNumber(next.x, area.x, maxX, area.x));
    next.y = Math.round(clampNumber(next.y, area.y, maxY, area.y));
    return next;
  }

  function setBounds(bounds) {
    if (!isWindowAvailable()) return;
    const nextBounds = constrainBounds(bounds);
    const currentBounds = lyricsWindow.getBounds();
    if (
      currentBounds.x === nextBounds.x
      && currentBounds.y === nextBounds.y
      && currentBounds.width === nextBounds.width
      && currentBounds.height === nextBounds.height
    ) return;
    programmaticMove = true;
    lyricsWindow.setBounds(nextBounds, false);
    setTimeout(() => { programmaticMove = false; }, 120);
  }

  function rememberBounds() {
    if (!isWindowAvailable() || programmaticMove) return;
    userBounds = lyricsWindow.getBounds();
  }

  function applyMouseBehavior() {
    if (!isWindowAvailable()) return;
    const locked = lyricsState.clickThrough !== false;
    const shouldIgnore = locked || !pointerCapture;
    if (mouseIgnored === shouldIgnore) return;
    mouseIgnored = shouldIgnore;
    lyricsWindow.setIgnoreMouseEvents(shouldIgnore, { forward: true });
  }

  function getHotBoundsOnScreen() {
    if (!isWindowAvailable()) return null;
    const windowBounds = lyricsWindow.getBounds();
    if (!hotBounds) return windowBounds;
    return {
      x: windowBounds.x + hotBounds.left,
      y: windowBounds.y + hotBounds.top,
      width: Math.max(1, hotBounds.right - hotBounds.left),
      height: Math.max(1, hotBounds.bottom - hotBounds.top),
    };
  }

  function containsPoint(point, bounds) {
    if (!point || !bounds) return false;
    return point.x >= bounds.x
      && point.x <= bounds.x + bounds.width
      && point.y >= bounds.y
      && point.y <= bounds.y + bounds.height;
  }

  function sendState() {
    if (!isWindowAvailable()) return;
    lyricsWindow.webContents.send('mineradio-desktop-lyrics-state', lyricsState);
  }

  function broadcastLockState() {
    const locked = lyricsState.clickThrough !== false;
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mineradio-desktop-lyrics-lock-state', { locked });
    }
    sendState();
  }

  function broadcastEnabledState(enabled) {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mineradio-desktop-lyrics-enabled-state', { enabled: !!enabled });
    }
  }

  function handleGlobalMiddleClick() {
    if (!isWindowAvailable() || !lyricsState.enabled) return;
    const now = Date.now();
    if (now - lastMiddleAt < 260) return;
    const point = screen.getCursorScreenPoint();
    if (!containsPoint(point, getHotBoundsOnScreen())) return;
    lastMiddleAt = now;
    const nextLocked = lyricsState.clickThrough === false;
    lyricsState = { ...lyricsState, clickThrough: nextLocked };
    pointerCapture = !nextLocked;
    applyMouseBehavior();
    broadcastLockState();
  }

  function startMousePoller() {
    if (platform !== 'win32' || mousePoller) return;
    const script = `
$ErrorActionPreference = "SilentlyContinue"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MineradioMousePoll {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
}
"@
$prev = $false
while ($true) {
  $down = (([MineradioMousePoll]::GetAsyncKeyState(4) -band 0x8000) -ne 0)
  if ($down -and -not $prev) {
    [Console]::Out.WriteLine("MMB")
    [Console]::Out.Flush()
  }
  $prev = $down
  Start-Sleep -Milliseconds 50
}
`;
    try {
      mousePoller = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      mousePoller.stdout.on('data', (chunk) => {
        mousePollerBuffer += chunk.toString('utf8');
        const lines = mousePollerBuffer.split(/\r?\n/);
        mousePollerBuffer = lines.pop() || '';
        lines.forEach((line) => {
          if (line.trim() === 'MMB') handleGlobalMiddleClick();
        });
      });
      mousePoller.on('exit', () => {
        mousePoller = null;
        mousePollerBuffer = '';
      });
      mousePoller.on('error', () => {
        mousePoller = null;
        mousePollerBuffer = '';
      });
    } catch (_) {
      mousePoller = null;
      mousePollerBuffer = '';
    }
  }

  function stopMousePoller() {
    if (!mousePoller) return;
    try { mousePoller.kill(); } catch (_) {}
    mousePoller = null;
    mousePollerBuffer = '';
  }

  function position(payload = lyricsState, options = {}) {
    if (!isWindowAvailable()) return;
    const shouldUseManualBounds = userBounds && !options.force;
    setBounds(shouldUseManualBounds ? userBounds : defaultBounds(payload));
    if (typeof lyricsWindow.setOpacity === 'function') {
      lyricsWindow.setOpacity(clampNumber(payload.opacity, 0.28, 1, 0.92));
    }
  }

  function open(payload = {}) {
    const previousY = lyricsState.y;
    const previousOpacity = lyricsState.opacity;
    lyricsState = { ...lyricsState, ...payload, enabled: true };
    const hasY = Object.prototype.hasOwnProperty.call(payload || {}, 'y');
    const nextY = clampNumber(lyricsState.y, 0.08, 0.92, 0.76);
    const yChanged = hasY && Number.isFinite(Number(previousY))
      && Math.abs(nextY - clampNumber(previousY, 0.08, 0.92, 0.76)) > 0.001;
    const opacityChanged = Object.prototype.hasOwnProperty.call(payload || {}, 'opacity')
      && Math.abs(clampNumber(lyricsState.opacity, 0.28, 1, 0.92) - clampNumber(previousOpacity, 0.28, 1, 0.92)) > 0.001;
    if (yChanged) userBounds = null;
    if (isWindowAvailable()) {
      if (yChanged) position(lyricsState, { force: true });
      else if (opacityChanged && typeof lyricsWindow.setOpacity === 'function') {
        lyricsWindow.setOpacity(clampNumber(lyricsState.opacity, 0.28, 1, 0.92));
      }
      applyMouseBehavior();
      sendState();
      return lyricsWindow;
    }

    lyricsWindow = new BrowserWindow({
      width: 920,
      height: 190,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: true,
      focusable: false,
      skipTaskbar: true,
      show: false,
      title: 'Mineradio Desktop Lyrics',
      webPreferences: {
        preload: path.join(__dirname, 'overlay-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    try {
      lyricsWindow.setAlwaysOnTop(true, 'screen-saver');
      lyricsWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } catch (error) {
      logger.warn('Desktop lyrics topmost setup skipped:', error.message);
    }
    startMousePoller();
    applyMouseBehavior();
    position(lyricsState, { force: yChanged || !userBounds });
    lyricsWindow.once('ready-to-show', () => {
      if (!isWindowAvailable()) return;
      lyricsWindow.showInactive();
      sendState();
    });
    lyricsWindow.webContents.once('did-finish-load', sendState);
    lyricsWindow.on('closed', () => {
      lyricsWindow = null;
      mouseIgnored = null;
    });
    lyricsWindow.on('moved', rememberBounds);
    lyricsWindow.loadURL(getOverlayUrl('desktop-lyrics.html')).catch((error) => logger.warn('Desktop lyrics load failed:', error.message));
    return lyricsWindow;
  }

  function close() {
    lyricsState = { ...lyricsState, enabled: false };
    pointerCapture = false;
    mouseIgnored = null;
    hotBounds = null;
    stopMousePoller();
    if (isWindowAvailable()) {
      sendState();
      lyricsWindow.close();
    }
    lyricsWindow = null;
    broadcastEnabledState(false);
  }

  function enable(payload = {}) {
    const window = open(payload);
    broadcastEnabledState(true);
    return window;
  }

  function update(payload = {}) {
    const nextState = { ...lyricsState, ...payload };
    if (nextState.enabled) return open(payload);
    lyricsState = nextState;
    sendState();
    return null;
  }

  function setPointerCapture(active) {
    pointerCapture = !!active;
    applyMouseBehavior();
  }

  function setHotBounds(bounds) {
    const left = clampNumber(bounds && bounds.left, -2000, 4000, 0);
    const top = clampNumber(bounds && bounds.top, -2000, 4000, 0);
    const right = clampNumber(bounds && bounds.right, left + 1, 6000, left + 1);
    const bottom = clampNumber(bounds && bounds.bottom, top + 1, 6000, top + 1);
    hotBounds = { left, top, right, bottom };
  }

  function setLockState(locked) {
    lyricsState = { ...lyricsState, clickThrough: !!locked };
    if (lyricsState.clickThrough !== false) pointerCapture = false;
    applyMouseBehavior();
    broadcastLockState();
    return lyricsState.clickThrough !== false;
  }

  function moveBy(dx, dy) {
    if (!isWindowAvailable()) return { ok: false, error: 'NO_DESKTOP_LYRICS_WINDOW' };
    if (lyricsState.clickThrough !== false) return { ok: false, error: 'DESKTOP_LYRICS_LOCKED' };
    const bounds = lyricsWindow.getBounds();
    const next = {
      ...bounds,
      x: Math.round(bounds.x + clampNumber(dx, -160, 160, 0)),
      y: Math.round(bounds.y + clampNumber(dy, -160, 160, 0)),
    };
    lyricsWindow.setBounds(next, false);
    userBounds = lyricsWindow.getBounds();
    return { ok: true };
  }

  return {
    close,
    enable,
    moveBy,
    open,
    position,
    setHotBounds,
    setLockState,
    setPointerCapture,
    update,
  };
}

module.exports = { createDesktopLyricsController };
