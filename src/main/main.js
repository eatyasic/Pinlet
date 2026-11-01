'use strict';

const {
  app, BrowserWindow, Tray, nativeImage, ipcMain, screen, protocol, globalShortcut, dialog
} = require('electron');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { createStore } = require('./store');
const { createImages } = require('./images');
const { createDesktops } = require('./desktops');

const IS_MAC = process.platform === 'darwin';
const ROOT = path.join(__dirname, '..', '..');
const RENDERER_DIR = path.join(ROOT, 'src', 'renderer');
const ASSETS_DIR = path.join(ROOT, 'assets');
const PRELOAD = path.join(__dirname, '..', 'preload.js');

// Snapshot mode (npm run snapshot) runs against a throwaway profile and captures every window.
const SNAPSHOT_DIR = process.env.PINLET_SNAPSHOT || '';
if (SNAPSHOT_DIR) app.setPath('userData', path.join(SNAPSHOT_DIR, 'userData'));

const SHADOW_PAD = 16; // transparent margin around popover and menu for the CSS shadow
const POPOVER_W = 320 + SHADOW_PAD * 2;
const NOTICE_W = 300;
const NOTICE_H = 84;
const DEFAULT_SIZE = 72;

const SHAPE_KINDS = new Set(['ring', 'arrow', 'pin', 'dot', 'star', 'check', 'cross', 'number', 'box', 'cursor', 'highlight', 'alert']);
const HEX = /^#[0-9a-f]{6}$/i;

const SHORTCUTS = {
  hidden: 'Control+Alt+H',
  lockAll: 'Control+Alt+L',
  open: 'Control+Alt+P'
};
const SHORTCUT_LABELS = IS_MAC
  ? { hidden: '⌃ ⌥ H', lockAll: '⌃ ⌥ L', open: '⌃ ⌥ P', duplicate: '⌘D', remove: '⌫' }
  : { hidden: 'Ctrl + Alt + H', lockAll: 'Ctrl + Alt + L', open: 'Ctrl + Alt + P', duplicate: 'Ctrl+D', remove: 'Del' };

protocol.registerSchemesAsPrivileged([
  { scheme: 'pinlet', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

let store;
let images;
let tray = null;
let pinletWin = null;
let popoverWin = null;
let menuWin = null;
let noticeWin = null;
let quitting = false;
let popoverHeight = 420;
let popoverHiddenAt = 0;
let menuTarget = null;
let menuAnchor = null;
let noticeTimer = null;
const flags = { keepPopupsOpen: false };

const markerWins = new Map(); // instance id → BrowserWindow
const markerSenders = new Map(); // webContents id → instance id
const drags = new Map(); // instance id → drag origin

// Windows virtual desktops (see desktops.js). Markers the shell tracks are pinned to every
// desktop; markers it ignores show on every desktop anyway, so "current desktop only" hides
// them while another desktop is active.
let desktops = { supported: false };
let activeDesktop = -1;
let desktopTimer = null;
const shellTracked = new Map(); // instance id → whether the shell manages the window's desktop

const state = () => store.get();
const spacesSupported = () => IS_MAC || desktops.supported;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
// A square window big enough for the marker at any rotation, plus room for the outline and drag shadow.
const winSide = (size) => Math.ceil((size + 16) * 1.42) + 16;

function defaults() {
  return {
    library: [{ id: randomUUID(), name: '빨간 원', auto: true, type: 'shape', kind: 'ring', color: '#F2542D' }],
    instances: [],
    settings: { openOnLaunch: true, launchAtLogin: false, placement: 'cursor', hidden: false, lockAll: false }
  };
}

function webPreferences(extra = {}) {
  return { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, ...extra };
}

// ---------------------------------------------------------------- protocol

function registerProtocol() {
  protocol.handle('pinlet', async (request) => {
    const url = new URL(request.url);
    const base = url.host === 'app' ? RENDERER_DIR : url.host === 'images' ? images.dir : null;
    if (!base) return new Response('Not found', { status: 404 });
    const full = path.resolve(base, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
    if (!full.startsWith(base + path.sep)) return new Response('Not found', { status: 404 });
    try {
      const body = await fs.promises.readFile(full);
      const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
      return new Response(body, { headers: { 'content-type': type, 'cache-control': 'no-cache' } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

// ---------------------------------------------------------------- state helpers

function findMarker(id) {
  return state().library.find((m) => m.id === id) || null;
}

function findInstance(id) {
  return state().instances.find((i) => i.id === id) || null;
}

function isLocked(inst) {
  return inst.locked || state().settings.lockAll;
}

function cleanMarker(input) {
  if (!input || typeof input !== 'object') return null;
  const name = String(input.name ?? '').trim().slice(0, 40);
  const auto = Boolean(input.auto);
  if (input.type === 'image') {
    if (!images.isStored(input.file)) return null;
    const format = path.extname(input.file).slice(1).toUpperCase();
    const fileName = String(input.fileName || input.file).slice(0, 120);
    return { type: 'image', file: input.file, fileName, format, gif: format === 'GIF', name: name || fileName, auto };
  }
  if (!SHAPE_KINDS.has(input.kind) || !HEX.test(input.color || '')) return null;
  return { type: 'shape', kind: input.kind, color: input.color.toUpperCase(), name: name || '마커', auto };
}

function cleanPatch(patch) {
  const out = {};
  if (!patch || typeof patch !== 'object') return out;
  if ('size' in patch) out.size = clamp(Math.round(num(patch.size, DEFAULT_SIZE)), 24, 240);
  if ('opacity' in patch) out.opacity = clamp(Math.round(num(patch.opacity, 100)), 10, 100);
  if ('rotation' in patch) out.rotation = clamp(Math.round(num(patch.rotation, 0)), -180, 180);
  if ('onTop' in patch) out.onTop = Boolean(patch.onTop);
  if ('locked' in patch) out.locked = Boolean(patch.locked);
  if ('space' in patch) out.space = patch.space === 'current' ? 'current' : 'all';
  return out;
}

function uiState() {
  const s = state();
  const counts = {};
  for (const inst of s.instances) counts[inst.markerId] = (counts[inst.markerId] || 0) + 1;
  return {
    library: s.library,
    counts,
    total: s.instances.length,
    settings: s.settings,
    platform: process.platform,
    spacesSupported: spacesSupported(),
    shortcuts: SHORTCUT_LABELS
  };
}

function broadcast() {
  const payload = uiState();
  for (const win of [pinletWin, popoverWin]) {
    if (win && !win.isDestroyed()) win.webContents.send('state', payload);
  }
}

function commit() {
  store.save();
  broadcast();
}

// ---------------------------------------------------------------- marker windows

function markerPayload(inst) {
  const m = findMarker(inst.markerId);
  return {
    id: inst.id,
    size: inst.size,
    opacity: inst.opacity,
    rotation: inst.rotation,
    side: winSide(inst.size),
    locked: isLocked(inst),
    menuOpen: menuTarget === inst.id,
    marker: m && { type: m.type, kind: m.kind, color: m.color, file: m.file, name: m.name }
  };
}

function pushMarker(id) {
  const inst = findInstance(id);
  const win = markerWins.get(id);
  if (inst && win && !win.isDestroyed()) win.webContents.send('marker:data', markerPayload(inst));
}

function applyWindowLevel(win, inst) {
  if (inst.onTop) win.setAlwaysOnTop(true, 'floating');
  else win.setAlwaysOnTop(false);
  if (desktops.supported) {
    syncDesktop(inst.id);
  } else if (IS_MAC) {
    const all = inst.space !== 'current';
    win.setVisibleOnAllWorkspaces(all, { visibleOnFullScreen: all, skipTransformProcessType: true });
  }
}

function placeMarkerWindow(inst) {
  const win = markerWins.get(inst.id);
  if (!win || win.isDestroyed()) return;
  const side = winSide(inst.size);
  win.setBounds({ x: Math.round(inst.cx - side / 2), y: Math.round(inst.cy - side / 2), width: side, height: side });
}

function createMarkerWindow(inst) {
  const side = winSide(inst.size);
  const win = new BrowserWindow({
    width: side,
    height: side,
    x: Math.round(inst.cx - side / 2),
    y: Math.round(inst.cy - side / 2),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    acceptFirstMouse: true,
    enableLargerThanScreen: true,
    show: false,
    webPreferences: webPreferences()
  });
  const senderId = win.webContents.id;
  markerWins.set(inst.id, win);
  markerSenders.set(senderId, inst.id);
  win.setIgnoreMouseEvents(true, { forward: true });
  applyWindowLevel(win, inst);
  win.webContents.once('did-finish-load', () => {
    pushMarker(inst.id);
    if (markerShown(inst)) win.showInactive();
  });
  // A window that is shown again gets a new shell view, so its desktop pin is reapplied.
  win.on('show', () => syncDesktop(inst.id));
  win.on('closed', () => {
    markerWins.delete(inst.id);
    markerSenders.delete(senderId);
  });
  win.loadURL('pinlet://app/marker.html');
}

function closeMarkerWindow(id) {
  const win = markerWins.get(id);
  if (win && !win.isDestroyed()) win.destroy();
  markerWins.delete(id);
}

function instanceFromSender(event) {
  const id = markerSenders.get(event.sender.id);
  return id ? findInstance(id) : null;
}

// Keeps restored markers on a connected display.
function ensureOnScreen(inst) {
  const onSomeDisplay = screen.getAllDisplays().some(({ bounds: b }) =>
    inst.cx >= b.x && inst.cx <= b.x + b.width && inst.cy >= b.y && inst.cy <= b.y + b.height);
  if (onSomeDisplay) return;
  const wa = screen.getPrimaryDisplay().workArea;
  inst.cx = wa.x + wa.width / 2;
  inst.cy = wa.y + wa.height / 2;
}

function placementPoint(size, source) {
  const cursor = screen.getCursorScreenPoint();
  const wa = screen.getDisplayNearestPoint(cursor).workArea;
  const pad = size / 2 + 12;
  // Dropping the marker right under the "화면에 추가" button would cover it, so adds from
  // the Pinlet window fall back to the screen centre.
  const b = source === 'window' && pinletWin && pinletWin.isVisible() ? pinletWin.getBounds() : null;
  const overWindow = b && cursor.x >= b.x && cursor.x <= b.x + b.width && cursor.y >= b.y && cursor.y <= b.y + b.height;
  let p = cursor;
  if (state().settings.placement === 'center' || overWindow) {
    const step = (state().instances.length % 6) * 28;
    p = { x: wa.x + wa.width / 2 + step, y: wa.y + wa.height / 2 + step };
  }
  return {
    x: clamp(p.x, wa.x + pad, wa.x + wa.width - pad),
    y: clamp(p.y, wa.y + pad, wa.y + wa.height - pad)
  };
}

// ---------------------------------------------------------------- Windows virtual desktops

function markerShown(inst) {
  if (state().settings.hidden) return false;
  if (!desktops.supported || inst.space !== 'current' || shellTracked.get(inst.id) !== false) return true;
  return inst.desktop == null || inst.desktop === activeDesktop;
}

function refreshMarkers() {
  for (const inst of state().instances) {
    const win = markerWins.get(inst.id);
    if (!win || win.isDestroyed()) continue;
    const show = markerShown(inst);
    if (show && !win.isVisible()) win.showInactive();
    else if (!show && win.isVisible()) win.hide();
  }
}

function rememberDesktop(inst) {
  if (!desktops.supported || inst.space !== 'current') return;
  const n = desktops.current();
  if (n >= 0) inst.desktop = activeDesktop = n;
}

// Pins or unpins a visible marker window. The shell may not have registered a window that
// was just shown, so a failure is retried once before the window counts as untracked.
function syncDesktop(id, retries = 1) {
  const inst = findInstance(id);
  const win = markerWins.get(id);
  if (!desktops.supported || !inst || !win || win.isDestroyed() || !win.isVisible()) return;
  const tracked = desktops.pin(win, inst.space !== 'current') === 1;
  if (!tracked && retries > 0) {
    setTimeout(() => syncDesktop(id, retries - 1), 600);
    return;
  }
  shellTracked.set(id, tracked);
  if (!markerShown(inst)) win.hide();
  watchDesktops();
}

// Untracked "current desktop only" markers need to hear when the active desktop changes.
function watchDesktops() {
  const needed = state().instances.some((i) => i.space === 'current' && shellTracked.get(i.id) === false);
  if (needed && !desktopTimer) {
    desktopTimer = setInterval(() => {
      const n = desktops.current();
      if (n < 0 || n === activeDesktop) return;
      activeDesktop = n;
      refreshMarkers();
    }, 250);
  } else if (!needed && desktopTimer) {
    clearInterval(desktopTimer);
    desktopTimer = null;
  }
}

// ---------------------------------------------------------------- instances

function setHidden(hidden) {
  state().settings.hidden = hidden;
  refreshMarkers();
  if (hidden) closeMenu();
}

function addInstance(markerId, overrides = {}, source = '') {
  if (!findMarker(markerId)) return null;
  const size = overrides.size || DEFAULT_SIZE;
  const p = overrides.cx != null ? { x: overrides.cx, y: overrides.cy } : placementPoint(size, source);
  const inst = {
    id: randomUUID(),
    markerId,
    cx: p.x,
    cy: p.y,
    size,
    opacity: 100,
    rotation: 0,
    onTop: true,
    locked: false,
    space: 'all',
    ...overrides
  };
  inst.cx = p.x;
  inst.cy = p.y;
  rememberDesktop(inst);
  state().instances.push(inst);
  if (state().settings.hidden) setHidden(false);
  createMarkerWindow(inst);
  commit();
  return inst;
}

function removeInstance(id) {
  if (menuTarget === id) closeMenu();
  const s = state();
  s.instances = s.instances.filter((i) => i.id !== id);
  closeMarkerWindow(id);
  shellTracked.delete(id);
  watchDesktops();
  commit();
}

function updateInstance(id, patch) {
  const inst = findInstance(id);
  if (!inst) return;
  const clean = cleanPatch(patch);
  const sizeChanged = 'size' in clean && clean.size !== inst.size;
  Object.assign(inst, clean);
  if ('space' in clean) rememberDesktop(inst);
  const win = markerWins.get(id);
  if (win && !win.isDestroyed()) {
    if (sizeChanged) placeMarkerWindow(inst);
    if ('onTop' in clean || 'space' in clean) applyWindowLevel(win, inst);
  }
  pushMarker(id);
  store.save();
}

// ---------------------------------------------------------------- notice (locked marker)

function showLockedNotice(inst) {
  if (!noticeWin || noticeWin.isDestroyed()) {
    noticeWin = new BrowserWindow({
      width: NOTICE_W,
      height: NOTICE_H,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      focusable: false,
      skipTaskbar: true,
      show: false,
      webPreferences: webPreferences()
    });
    noticeWin.setIgnoreMouseEvents(true);
    noticeWin.setAlwaysOnTop(true, 'pop-up-menu');
    if (IS_MAC) noticeWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    noticeWin.loadURL('pinlet://app/notice.html');
  }
  const wa = screen.getDisplayNearestPoint({ x: Math.round(inst.cx), y: Math.round(inst.cy) }).workArea;
  let y = Math.round(inst.cy + inst.size / 2 + 4);
  if (y + NOTICE_H > wa.y + wa.height) y = Math.round(inst.cy - inst.size / 2 - NOTICE_H - 4);
  const x = clamp(Math.round(inst.cx - NOTICE_W / 2), wa.x, wa.x + wa.width - NOTICE_W);
  noticeWin.setPosition(x, y);
  noticeWin.showInactive();
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => noticeWin && !noticeWin.isDestroyed() && noticeWin.hide(), 1800);
}

// ---------------------------------------------------------------- right-click menu

function bringAppForward() {
  if (IS_MAC) app.focus({ steal: true });
}

function createMenuWindow() {
  menuWin = new BrowserWindow({
    width: 272 + SHADOW_PAD * 2,
    height: 480,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: webPreferences({ backgroundThrottling: false })
  });
  menuWin.setAlwaysOnTop(true, 'pop-up-menu');
  if (IS_MAC) menuWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  menuWin.on('blur', () => {
    if (!flags.keepPopupsOpen) closeMenu();
  });
  menuWin.loadURL('pinlet://app/menu.html');
}

function menuPayload(inst) {
  return {
    instance: inst,
    marker: findMarker(inst.markerId),
    lockAll: state().settings.lockAll,
    spacesSupported: spacesSupported(),
    spaceWord: IS_MAC ? '스페이스' : '데스크톱',
    shortcuts: SHORTCUT_LABELS
  };
}

function openMenu(instanceId, anchor) {
  const inst = findInstance(instanceId);
  if (!inst) return;
  const previous = menuTarget;
  menuTarget = instanceId;
  if (previous && previous !== instanceId) pushMarker(previous);
  pushMarker(instanceId);
  menuAnchor = anchor || screen.getCursorScreenPoint();
  if (!menuWin || menuWin.isDestroyed()) createMenuWindow();
  const send = () => menuWin.webContents.send('menu:data', menuPayload(inst));
  if (menuWin.webContents.isLoading()) menuWin.webContents.once('did-finish-load', send);
  else send();
}

// The renderer reports its size after rendering; only then is the menu positioned and shown.
function showMenuAt(width, height) {
  if (!menuWin || menuWin.isDestroyed() || !menuTarget || !menuAnchor) return;
  const w = Math.ceil(width);
  const h = Math.ceil(height);
  const wa = screen.getDisplayNearestPoint(menuAnchor).workArea;
  let x = menuAnchor.x - SHADOW_PAD + 2;
  let y = menuAnchor.y - SHADOW_PAD + 2;
  if (x + w - SHADOW_PAD > wa.x + wa.width) x = menuAnchor.x - w + SHADOW_PAD - 2;
  if (y + h - SHADOW_PAD > wa.y + wa.height) y = wa.y + wa.height - h + SHADOW_PAD;
  y = Math.max(y, wa.y - SHADOW_PAD);
  menuWin.setBounds({ x: Math.round(x), y: Math.round(y), width: w, height: h });
  if (!menuWin.isVisible()) {
    bringAppForward();
    menuWin.show();
    menuWin.focus();
  }
}

function closeMenu() {
  const target = menuTarget;
  menuTarget = null;
  menuAnchor = null;
  if (menuWin && !menuWin.isDestroyed() && menuWin.isVisible()) menuWin.hide();
  if (target) pushMarker(target);
}

// ---------------------------------------------------------------- Pinlet window

function createPinletWindow() {
  pinletWin = new BrowserWindow({
    width: 880,
    height: 640,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#FFFFFF',
    title: 'Pinlet',
    icon: path.join(ASSETS_DIR, 'icon.png'),
    show: false,
    webPreferences: webPreferences()
  });
  pinletWin.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    pinletWin.hide();
  });
  pinletWin.on('closed', () => {
    pinletWin = null;
  });
  pinletWin.loadURL('pinlet://app/pinlet.html');
}

function openPinlet(options = {}) {
  if (!pinletWin || pinletWin.isDestroyed()) createPinletWindow();
  const win = pinletWin;
  const reveal = () => {
    win.webContents.send('pinlet:open', options);
    bringAppForward();
    if (!win.isVisible()) win.center();
    win.show();
    win.focus();
  };
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', reveal);
  else reveal();
}

// ---------------------------------------------------------------- tray + popover

function createTray() {
  const icon = nativeImage.createFromPath(path.join(ASSETS_DIR, IS_MAC ? 'trayTemplate.png' : 'tray-win.png'));
  if (IS_MAC) icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Pinlet');
  tray.on('click', togglePopover);
  tray.on('right-click', togglePopover);
}

function createPopover() {
  popoverWin = new BrowserWindow({
    width: POPOVER_W,
    height: popoverHeight,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: webPreferences({ backgroundThrottling: false })
  });
  popoverWin.setAlwaysOnTop(true, 'pop-up-menu');
  if (IS_MAC) popoverWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  popoverWin.on('blur', () => {
    if (!flags.keepPopupsOpen) hidePopover();
  });
  popoverWin.loadURL('pinlet://app/tray.html');
}

function positionPopover() {
  const tb = tray ? tray.getBounds() : { x: 0, y: 0, width: 0, height: 0 };
  const anchor = tb.width ? { x: tb.x + tb.width / 2, y: tb.y + tb.height / 2 } : screen.getCursorScreenPoint();
  const wa = screen.getDisplayNearestPoint({ x: Math.round(anchor.x), y: Math.round(anchor.y) }).workArea;
  const x = clamp(Math.round(anchor.x - POPOVER_W / 2), wa.x - SHADOW_PAD, wa.x + wa.width - POPOVER_W + SHADOW_PAD);
  const trayAtBottom = anchor.y > wa.y + wa.height / 2;
  const y = trayAtBottom
    ? Math.round((tb.width ? tb.y : anchor.y) - popoverHeight + SHADOW_PAD - 6)
    : Math.round((tb.width ? tb.y + tb.height : anchor.y) - SHADOW_PAD + 6);
  popoverWin.setBounds({ x, y, width: POPOVER_W, height: popoverHeight });
}

function showPopover() {
  if (!popoverWin || popoverWin.isDestroyed()) createPopover();
  popoverWin.webContents.send('state', uiState());
  positionPopover();
  bringAppForward();
  popoverWin.show();
  popoverWin.focus();
}

function hidePopover() {
  if (popoverWin && !popoverWin.isDestroyed() && popoverWin.isVisible()) {
    popoverWin.hide();
    popoverHiddenAt = Date.now();
  }
}

function togglePopover() {
  if (popoverWin && popoverWin.isVisible()) return hidePopover();
  // The click that blurred the popover would otherwise reopen it immediately.
  if (Date.now() - popoverHiddenAt < 300) return;
  showPopover();
}

// ---------------------------------------------------------------- settings

function setSetting(key, value) {
  const s = state().settings;
  switch (key) {
    case 'hidden':
      setHidden(Boolean(value));
      break;
    case 'lockAll':
      s.lockAll = Boolean(value);
      for (const inst of state().instances) pushMarker(inst.id);
      break;
    case 'openOnLaunch':
      s.openOnLaunch = Boolean(value);
      break;
    case 'launchAtLogin':
      s.launchAtLogin = Boolean(value);
      if (!SNAPSHOT_DIR) app.setLoginItemSettings({ openAtLogin: s.launchAtLogin });
      break;
    case 'placement':
      s.placement = value === 'center' ? 'center' : 'cursor';
      break;
    default:
      return;
  }
  commit();
}

function registerShortcuts() {
  const bindings = [
    [SHORTCUTS.hidden, () => setSetting('hidden', !state().settings.hidden)],
    [SHORTCUTS.lockAll, () => setSetting('lockAll', !state().settings.lockAll)],
    [SHORTCUTS.open, () => openPinlet()]
  ];
  for (const [accelerator, handler] of bindings) {
    if (!globalShortcut.register(accelerator, handler)) console.warn(`[pinlet] shortcut unavailable: ${accelerator}`);
  }
}

async function confirm(win, message, detail, okLabel) {
  const options = { type: 'warning', buttons: [okLabel, '취소'], defaultId: 0, cancelId: 1, message, detail };
  const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
  return response === 0;
}

// ---------------------------------------------------------------- IPC

function registerIpc() {
  ipcMain.handle('state:get', () => uiState());

  ipcMain.handle('marker:add-to-screen', (_e, markerId, source) => {
    if (source === 'tray') hidePopover();
    return Boolean(addInstance(markerId, {}, source));
  });

  ipcMain.handle('library:create', (_e, input) => {
    const clean = cleanMarker(input);
    if (!clean) return null;
    const marker = { id: randomUUID(), ...clean };
    state().library.push(marker);
    commit();
    return marker;
  });

  ipcMain.handle('library:update', (_e, id, input) => {
    const marker = findMarker(id);
    const clean = cleanMarker(input);
    if (!marker || !clean) return null;
    for (const key of ['kind', 'color', 'file', 'fileName', 'format', 'gif']) delete marker[key];
    Object.assign(marker, clean);
    for (const inst of state().instances) if (inst.markerId === id) pushMarker(inst.id);
    images.prune(new Set(state().library.map((m) => m.file).filter(Boolean)));
    commit();
    return marker;
  });

  ipcMain.handle('library:delete', async (_e, id) => {
    const marker = findMarker(id);
    if (!marker) return false;
    const placed = state().instances.filter((i) => i.markerId === id);
    if (placed.length && !(await confirm(pinletWin, `‘${marker.name}’ 마커를 지울까요?`,
      `화면에 놓인 ${placed.length}개도 함께 지워져요.`, '지우기'))) return false;
    for (const inst of placed) {
      if (menuTarget === inst.id) closeMenu();
      closeMarkerWindow(inst.id);
    }
    const s = state();
    s.instances = s.instances.filter((i) => i.markerId !== id);
    s.library = s.library.filter((m) => m.id !== id);
    images.prune(new Set(s.library.map((m) => m.file).filter(Boolean)));
    commit();
    return true;
  });

  ipcMain.handle('image:pick', async () => {
    const options = {
      title: '마커로 쓸 이미지',
      properties: ['openFile'],
      filters: [{ name: '이미지', extensions: images.extensions }]
    };
    const result = pinletWin ? await dialog.showOpenDialog(pinletWin, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    try {
      return await images.importFile(result.filePaths[0]);
    } catch {
      return { error: '이 파일은 쓸 수 없어요. PNG · JPG · GIF · WEBP · SVG 이미지를 골라 주세요.' };
    }
  });

  ipcMain.handle('image:import-path', async (_e, filePath) => {
    if (typeof filePath !== 'string' || !filePath) return null;
    try {
      return await images.importFile(filePath);
    } catch {
      return { error: '이 파일은 쓸 수 없어요. PNG · JPG · GIF · WEBP · SVG 이미지를 골라 주세요.' };
    }
  });

  ipcMain.handle('settings:set', (_e, key, value) => setSetting(key, value));

  ipcMain.handle('markers:clear', async () => {
    const count = state().instances.length;
    if (!count) return true;
    hidePopover();
    if (!(await confirm(null, `화면의 마커 ${count}개를 모두 지울까요?`, '내 마커 목록은 그대로 남아요.', '모두 지우기'))) return false;
    closeMenu();
    for (const id of [...markerWins.keys()]) closeMarkerWindow(id);
    state().instances = [];
    commit();
    return true;
  });

  ipcMain.on('pinlet:open', (_e, options) => {
    hidePopover();
    openPinlet(options && typeof options === 'object' ? options : {});
  });
  ipcMain.on('pinlet:hide', () => pinletWin && pinletWin.hide());
  ipcMain.on('app:quit', () => app.quit());

  ipcMain.on('popover:size', (_e, height) => {
    popoverHeight = clamp(Math.ceil(num(height, popoverHeight)), 120, 900);
    if (popoverWin && popoverWin.isVisible()) positionPopover();
  });
  ipcMain.on('popover:hide', () => hidePopover());

  // Marker windows
  ipcMain.on('marker:ignore', (e, ignore) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win && markerSenders.has(e.sender.id)) win.setIgnoreMouseEvents(Boolean(ignore), { forward: true });
  });

  ipcMain.on('marker:drag-start', (e, x, y) => {
    const inst = instanceFromSender(e);
    if (!inst || isLocked(inst)) return;
    drags.set(inst.id, { sx: num(x, 0), sy: num(y, 0), cx: inst.cx, cy: inst.cy });
  });

  ipcMain.on('marker:drag-move', (e, x, y) => {
    const inst = instanceFromSender(e);
    const origin = inst && drags.get(inst.id);
    const win = inst && markerWins.get(inst.id);
    if (!origin || !win) return;
    inst.cx = origin.cx + num(x, origin.sx) - origin.sx;
    inst.cy = origin.cy + num(y, origin.sy) - origin.sy;
    const side = winSide(inst.size);
    win.setPosition(Math.round(inst.cx - side / 2), Math.round(inst.cy - side / 2));
  });

  ipcMain.on('marker:drag-end', (e) => {
    const inst = instanceFromSender(e);
    if (inst && drags.delete(inst.id)) store.save();
  });

  ipcMain.on('marker:menu', (e) => {
    const inst = instanceFromSender(e);
    if (inst) openMenu(inst.id);
  });

  ipcMain.on('marker:locked', (e) => {
    const inst = instanceFromSender(e);
    if (inst) showLockedNotice(inst);
  });

  // Right-click menu
  const fromMenu = (e) => menuWin && !menuWin.isDestroyed() && e.sender === menuWin.webContents;

  ipcMain.on('menu:size', (e, width, height) => {
    if (fromMenu(e)) showMenuAt(num(width, 304), num(height, 480));
  });
  ipcMain.on('menu:close', (e) => {
    if (fromMenu(e)) closeMenu();
  });
  ipcMain.on('instance:update', (e, id, patch) => {
    if (fromMenu(e) && id === menuTarget) updateInstance(id, patch);
  });
  ipcMain.on('instance:duplicate', (e, id) => {
    const inst = fromMenu(e) && findInstance(id);
    if (!inst) return;
    closeMenu();
    const { markerId, size, opacity, rotation, onTop, locked, space } = inst;
    addInstance(markerId, { size, opacity, rotation, onTop, locked, space, cx: inst.cx + 28, cy: inst.cy + 28 });
  });
  ipcMain.on('instance:remove', (e, id) => {
    if (fromMenu(e) && findInstance(id)) removeInstance(id);
  });
  ipcMain.on('menu:edit', (e, markerId) => {
    if (!fromMenu(e) || !findMarker(markerId)) return;
    closeMenu();
    openPinlet({ mode: 'edit', markerId });
  });
}

// ---------------------------------------------------------------- lifecycle

function start() {
  store = createStore(path.join(app.getPath('userData'), 'pinlet.json'), defaults);
  images = createImages(path.join(app.getPath('userData'), 'images'));

  app.whenReady().then(() => {
    if (IS_MAC && app.dock) app.dock.hide();
    registerProtocol();
    registerIpc();

    const s = state();
    s.instances = s.instances.filter((i) => findMarker(i.markerId));
    for (const inst of s.instances) {
      Object.assign(inst, { size: DEFAULT_SIZE, opacity: 100, rotation: 0, onTop: true, locked: false, space: 'all', ...inst }, cleanPatch(inst));
      ensureOnScreen(inst);
    }
    images.prune(new Set(s.library.map((m) => m.file).filter(Boolean)));
    store.save();

    const vendor = app.isPackaged ? path.join(process.resourcesPath, 'vendor') : path.join(ROOT, 'vendor', 'win');
    desktops = SNAPSHOT_DIR && process.env.PINLET_FAKE_DESKTOPS
      ? require('./snapshot').fakeDesktops()
      : createDesktops(vendor);
    if (desktops.supported) activeDesktop = desktops.current();

    for (const inst of s.instances) createMarkerWindow(inst);
    createTray();
    createPopover();
    registerShortcuts();
    if (s.settings.openOnLaunch || SNAPSHOT_DIR) openPinlet();

    if (SNAPSHOT_DIR) {
      require('./snapshot').run({
        dir: SNAPSHOT_DIR, flags, state, store, images, commit, addInstance, openPinlet, showPopover, openMenu, closeMenu, setSetting,
        windows: () => ({ pinletWin, popoverWin, menuWin, noticeWin, markerWins }),
        menuTarget: () => menuTarget,
        virtualDesktops: () => ({ desktops, tracked: shellTracked }),
        showLockedNotice, findInstance, updateInstance, userData: app.getPath('userData')
      });
    }
  });

  app.on('second-instance', () => openPinlet());
  app.on('activate', () => openPinlet());
  app.on('window-all-closed', () => {
    // Pinlet keeps running in the menu bar / tray.
  });
  app.on('before-quit', () => {
    quitting = true;
    store.flush();
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
}

if (SNAPSHOT_DIR || app.requestSingleInstanceLock()) start();
else app.quit();
