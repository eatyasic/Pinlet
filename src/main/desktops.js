'use strict';

// Windows virtual desktops. Electron can only show a window on every space on macOS,
// so on Windows markers go through VirtualDesktopAccessor.dll
// (MIT, github.com/Ciantic/VirtualDesktopAccessor, release 2024-12-16-windows11).
// The DLL calls undocumented shell interfaces whose layout changes between Windows
// builds, so it is only loaded on the builds that release supports.
const os = require('os');
const path = require('path');

const DLL = 'VirtualDesktopAccessor.dll';
const SUPPORTED_BUILDS = new Set([26100, 26200]); // Windows 11 24H2, 25H2

const unsupported = { supported: false };

function windowsBuild() {
  const [major, , build] = os.release().split('.').map(Number);
  return major === 10 ? build : 0;
}

function createDesktops(dir) {
  if (process.platform !== 'win32' || process.arch !== 'x64') return unsupported;
  if (!SUPPORTED_BUILDS.has(windowsBuild())) return unsupported;
  try {
    const koffi = require('koffi');
    const lib = koffi.load(path.join(dir, DLL));
    const desktopCount = lib.func('int GetDesktopCount()');
    const currentDesktop = lib.func('int GetCurrentDesktopNumber()');
    const pinWindow = lib.func('int PinWindow(intptr_t hwnd)');
    const unpinWindow = lib.func('int UnPinWindow(intptr_t hwnd)');
    const isPinnedWindow = lib.func('int IsPinnedWindow(intptr_t hwnd)');
    if (desktopCount() < 1) return unsupported;
    const hwnd = (win) => win.getNativeWindowHandle().readBigUInt64LE(0);
    return {
      supported: true,
      current: () => currentDesktop(),
      // 1 on success, -1 when the shell does not track the window (it then shows on every desktop).
      pin: (win, all) => (all ? pinWindow : unpinWindow)(hwnd(win)),
      isPinned: (win) => isPinnedWindow(hwnd(win))
    };
  } catch (err) {
    console.warn(`Virtual desktops unavailable: ${err.message}`);
    return unsupported;
  }
}

module.exports = { createDesktops, DLL };
