'use strict';

// Dev-only: seeds a throwaway profile, opens every window and saves screenshots,
// so the UI can be checked without clicking through it. Started by `npm run snapshot`.
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { app, screen } = require('electron');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function capture(win, file) {
  if (!win || win.isDestroyed()) return console.log(`skip ${path.basename(file)} (no window)`);
  const image = await win.webContents.capturePage();
  fs.writeFileSync(file, image.toPNG());
  console.log(`saved ${path.basename(file)}`);
}

async function run(ctx) {
  const out = path.join(ctx.dir, 'shots');
  fs.mkdirSync(out, { recursive: true });
  const shot = (win, name) => capture(win, path.join(out, name));
  const click = (selector) => ctx.windows().pinletWin.webContents.executeJavaScript(
    `document.querySelector(${JSON.stringify(selector)})?.click()`);
  setTimeout(() => app.quit(), 45000);
  ctx.flags.keepPopupsOpen = true;

  await wait(1500);
  await shot(ctx.windows().pinletWin, '01-first-run.png');

  const s = ctx.state();
  const add = (marker) => {
    const m = { id: randomUUID(), ...marker };
    s.library.push(m);
    return m;
  };
  const arrow = add({ name: '빨간 화살표', auto: true, type: 'shape', kind: 'arrow', color: '#F2542D' });
  add({ name: '파란 번호', auto: true, type: 'shape', kind: 'number', color: '#2563EB' });
  add({ name: '초록 체크', auto: true, type: 'shape', kind: 'check', color: '#16A34A' });
  add({ name: '노란 별', auto: true, type: 'shape', kind: 'star', color: '#FACC15' });
  add({ name: '노란 형광펜', auto: true, type: 'shape', kind: 'highlight', color: '#FACC15' });
  const picture = await ctx.images.importFile(path.join(__dirname, '..', '..', 'assets', 'icon.png'));
  const logo = add({ name: 'Pinlet 로고', auto: false, type: 'image', ...picture });
  ctx.commit();

  const wa = screen.getPrimaryDisplay().workArea;
  const ring = ctx.addInstance(s.library[0].id, { cx: wa.x + 320, cy: wa.y + 320 });
  const pointer = ctx.addInstance(arrow.id, { cx: wa.x + 480, cy: wa.y + 320, size: 96, rotation: 20, opacity: 80 });
  ctx.addInstance(logo.id, { cx: wa.x + 640, cy: wa.y + 320, size: 80 });
  await wait(1200);
  await shot(ctx.windows().pinletWin, '02-my-markers.png');

  ctx.openPinlet({ mode: 'new' });
  await wait(600);
  await shot(ctx.windows().pinletWin, '03-dialog-new-shape.png');

  await click('[data-mode="image"]');
  await wait(400);
  await shot(ctx.windows().pinletWin, '04-dialog-new-image.png');

  ctx.openPinlet({ mode: 'edit', markerId: arrow.id });
  await wait(600);
  await shot(ctx.windows().pinletWin, '05-dialog-edit-shape.png');

  ctx.openPinlet({ mode: 'edit', markerId: logo.id });
  await wait(600);
  await shot(ctx.windows().pinletWin, '06-dialog-edit-image.png');

  await click('#dlgCancel');
  ctx.openPinlet({ tab: 'settings' });
  await wait(600);
  await shot(ctx.windows().pinletWin, '07-settings.png');

  ctx.showPopover();
  await wait(800);
  await shot(ctx.windows().popoverWin, '08-popover.png');

  ctx.openMenu(pointer.id, { x: wa.x + 560, y: wa.y + 240 });
  await wait(900);
  await shot(ctx.windows().menuWin, '09-menu.png');
  await shot(ctx.windows().markerWins.get(pointer.id), '10-marker-menu-target.png');
  await shot(ctx.windows().markerWins.get(ring.id), '11-marker-ring.png');
  const ringWin = ctx.windows().markerWins.get(ring.id);
  const half = Math.round(ringWin.getBounds().width / 2);
  ringWin.webContents.sendInputEvent({ type: 'mouseMove', x: half, y: half });
  await wait(300);
  await shot(ringWin, '11b-marker-ring-hover.png');
  ringWin.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });

  ctx.setSetting('lockAll', true);
  ctx.showLockedNotice(ctx.findInstance(ring.id));
  await wait(500);
  await shot(ctx.windows().noticeWin, '12-locked-notice.png');
  ctx.setSetting('lockAll', false);

  await interactionChecks(ctx, { ring, pointer });
  app.quit();
}

// Drives the real windows with synthetic input and reports PASS/FAIL lines.
async function interactionChecks(ctx, { ring, pointer }) {
  const results = [];
  const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  const markerWin = (inst) => ctx.windows().markerWins.get(inst.id);

  // Menu slider resizes the marker window around the same centre.
  const menu = ctx.windows().menuWin;
  const before = markerWin(pointer).getBounds();
  await menu.webContents.executeJavaScript(`(() => {
    const r = document.getElementById('size');
    r.value = 160;
    r.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait(400);
  const after = markerWin(pointer).getBounds();
  check('size slider resizes marker', after.width > before.width, `${before.width} → ${after.width}px`);
  const drift = Math.abs(after.x + after.width / 2 - (before.x + before.width / 2));
  check('resize keeps the centre', drift <= 1, `drift ${drift}px`);
  check('size saved on instance', ctx.findInstance(pointer.id).size === 160);
  ctx.closeMenu();
  await wait(200);

  // Dragging moves the window by the pointer delta.
  const drag = async (inst, dx, dy) => {
    const win = markerWin(inst);
    const b = win.getBounds();
    const c = Math.round(b.width / 2);
    const at = (x, y, extra = {}) => ({ x, y, globalX: b.x + x, globalY: b.y + y, ...extra });
    win.webContents.sendInputEvent({ type: 'mouseMove', ...at(c, c) });
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...at(c, c) });
    await wait(80);
    win.webContents.sendInputEvent({ type: 'mouseMove', modifiers: ['leftButtonDown'], ...at(c + dx, c + dy) });
    await wait(120);
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...at(c + dx, c + dy) });
    await wait(200);
    const n = win.getBounds();
    return { dx: n.x - b.x, dy: n.y - b.y };
  };
  const moved = await drag(ring, 60, 40);
  check('drag moves marker', moved.dx === 60 && moved.dy === 40, `dx ${moved.dx}, dy ${moved.dy}`);

  // A locked marker stays put and shows the notice instead.
  ctx.setSetting('lockAll', true);
  await wait(100);
  const stuck = await drag(ring, 50, 0);
  check('locked marker does not move', stuck.dx === 0 && stuck.dy === 0, `dx ${stuck.dx}`);
  const notice = ctx.windows().noticeWin;
  check('locked drag shows notice', Boolean(notice && notice.isVisible()));
  ctx.setSetting('lockAll', false);

  // Right-click opens the menu for that marker.
  const rb = markerWin(ring).getBounds();
  const rc = Math.round(rb.width / 2);
  const at = { x: rc, y: rc, globalX: rb.x + rc, globalY: rb.y + rc };
  markerWin(ring).webContents.sendInputEvent({ type: 'mouseMove', ...at });
  markerWin(ring).webContents.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, ...at });
  markerWin(ring).webContents.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, ...at });
  await wait(600);
  check('right-click opens menu for marker', ctx.menuTarget() === ring.id && ctx.windows().menuWin.isVisible(),
    `target ${ctx.menuTarget() === ring.id ? 'ok' : ctx.menuTarget()}, visible ${ctx.windows().menuWin.isVisible()}`);
  ctx.closeMenu();

  // Hide all hides every marker window; showing restores them.
  ctx.setSetting('hidden', true);
  await wait(150);
  const hidden = [...ctx.windows().markerWins.values()].every((w) => !w.isVisible());
  ctx.setSetting('hidden', false);
  await wait(150);
  const shown = [...ctx.windows().markerWins.values()].every((w) => w.isVisible());
  check('hide all / show all', hidden && shown);

  // State reaches disk.
  ctx.store.flush();
  const saved = JSON.parse(fs.readFileSync(path.join(ctx.userData, 'pinlet.json'), 'utf8'));
  check('state saved to disk', saved.instances.length === 3 && saved.library.length === 7,
    `${saved.instances.length} on screen, ${saved.library.length} in library`);

  const report = results.join('\n');
  fs.writeFileSync(path.join(ctx.dir, 'checks.txt'), `${report}\n`);
  console.log(report);
}

module.exports = { run };
