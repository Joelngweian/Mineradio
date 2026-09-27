function createWallpaperController({
  BrowserWindow,
  screen,
  path,
  execFile,
  getOverlayUrl,
  logger = console,
  platform = process.platform,
  architecture = process.arch,
}) {
  let wallpaperWindow = null;
  let wallpaperState = {};

  function isWindowAvailable() {
    return !!wallpaperWindow && !wallpaperWindow.isDestroyed();
  }

  function nativeWindowHandleDecimal(window) {
    const handle = window.getNativeWindowHandle();
    if (architecture === 'x64') return handle.readBigUInt64LE(0).toString();
    return String(handle.readUInt32LE(0));
  }

  function attachToWorkerW(window) {
    if (platform !== 'win32' || !window || window.isDestroyed()) return;
    const hwnd = nativeWindowHandleDecimal(window);
    const script = `
$ErrorActionPreference = "Stop"
if (-not ("MineradioNativeWin" -as [type])) {
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MineradioNativeWin {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr childAfter, string className, string windowName);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam, uint fuFlags, uint uTimeout, out IntPtr lpdwResult);
}
"@
}
$progman = [MineradioNativeWin]::FindWindow("Progman", $null)
$result = [IntPtr]::Zero
[MineradioNativeWin]::SendMessageTimeout($progman, 0x052C, [IntPtr]::Zero, [IntPtr]::Zero, 0, 1000, [ref]$result) | Out-Null
$script:workerw = [IntPtr]::Zero
$enum = [MineradioNativeWin+EnumWindowsProc]{
  param([IntPtr]$top, [IntPtr]$param)
  $shell = [MineradioNativeWin]::FindWindowEx($top, [IntPtr]::Zero, "SHELLDLL_DefView", $null)
  if ($shell -ne [IntPtr]::Zero) {
    $script:workerw = [MineradioNativeWin]::FindWindowEx([IntPtr]::Zero, $top, "WorkerW", $null)
  }
  return $true
}
[MineradioNativeWin]::EnumWindows($enum, [IntPtr]::Zero) | Out-Null
if ($script:workerw -eq [IntPtr]::Zero) { $script:workerw = $progman }
$target = [IntPtr]::new([Int64]${hwnd})
[MineradioNativeWin]::SetParent($target, $script:workerw) | Out-Null
[MineradioNativeWin]::SetWindowPos($target, [IntPtr]::Zero, 0, 0, 0, 0, 0x0013) | Out-Null
`;
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      timeout: 5000,
    }, (error) => {
      if (error) logger.warn('Wallpaper WorkerW attach failed:', error.message);
    });
  }

  function position() {
    if (!isWindowAvailable()) return;
    wallpaperWindow.setBounds(screen.getPrimaryDisplay().bounds, false);
  }

  function sendState() {
    if (!isWindowAvailable()) return;
    wallpaperWindow.webContents.send('mineradio-wallpaper-state', wallpaperState);
  }

  function open(payload = {}) {
    wallpaperState = { ...wallpaperState, ...payload, enabled: true };
    if (isWindowAvailable()) {
      position();
      sendState();
      return wallpaperWindow;
    }
    wallpaperWindow = new BrowserWindow({
      ...screen.getPrimaryDisplay().bounds,
      frame: false,
      transparent: false,
      backgroundColor: '#050608',
      hasShadow: false,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      show: false,
      title: 'Mineradio Wallpaper',
      webPreferences: {
        preload: path.join(__dirname, 'overlay-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    wallpaperWindow.setIgnoreMouseEvents(true, { forward: true });
    wallpaperWindow.once('ready-to-show', () => {
      if (!isWindowAvailable()) return;
      position();
      wallpaperWindow.showInactive();
      attachToWorkerW(wallpaperWindow);
      sendState();
    });
    wallpaperWindow.webContents.once('did-finish-load', sendState);
    wallpaperWindow.on('closed', () => { wallpaperWindow = null; });
    wallpaperWindow.loadURL(getOverlayUrl('wallpaper.html')).catch((error) => logger.warn('Wallpaper load failed:', error.message));
    return wallpaperWindow;
  }

  function close() {
    wallpaperState = { ...wallpaperState, enabled: false };
    if (isWindowAvailable()) {
      sendState();
      wallpaperWindow.close();
    }
    wallpaperWindow = null;
  }

  function update(payload = {}) {
    wallpaperState = { ...wallpaperState, ...payload };
    if (wallpaperState.enabled) {
      open(wallpaperState);
      position();
      sendState();
    } else {
      sendState();
    }
  }

  return { close, open, position, update };
}

module.exports = { createWallpaperController };
