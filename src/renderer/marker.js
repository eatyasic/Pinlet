import { markerArt } from './shared/glyphs.js';

const api = window.pinlet;
const box = document.getElementById('box');
const art = document.getElementById('art');

let data = null;
let artKey = '';
let ignoring = true;
let dragging = false;
let pending = null;

function render() {
  if (!data) return;
  const outer = data.size + 16;
  box.style.width = `${outer}px`;
  box.style.height = `${outer}px`;
  box.style.setProperty('--rot', `${data.rotation}deg`);
  art.style.opacity = String(data.opacity / 100);
  box.classList.toggle('target', data.menuOpen);
  if (data.menuOpen) box.classList.remove('hover');
  const key = JSON.stringify([data.marker, data.size]);
  if (key !== artKey) {
    artKey = key;
    art.innerHTML = markerArt(data.marker, data.size);
  }
}

// The window is a square around the rotated marker; clicks outside the marker itself
// pass through to whatever is underneath.
function hitsMarker(e) {
  if (!data) return false;
  const x = e.clientX - window.innerWidth / 2;
  const y = e.clientY - window.innerHeight / 2;
  const t = (-data.rotation * Math.PI) / 180;
  const lx = x * Math.cos(t) - y * Math.sin(t);
  const ly = x * Math.sin(t) + y * Math.cos(t);
  const half = data.size / 2 + 8;
  return Math.abs(lx) <= half && Math.abs(ly) <= half;
}

function setIgnore(value) {
  if (value === ignoring) return;
  ignoring = value;
  api.setIgnoreMouse(value);
}

function flushMove() {
  if (pending) api.dragMove(pending.x, pending.y);
  pending = null;
}

window.addEventListener('mousemove', (e) => {
  if (dragging) {
    if (!pending) requestAnimationFrame(flushMove);
    pending = { x: e.screenX, y: e.screenY };
    return;
  }
  const hit = hitsMarker(e);
  setIgnore(!hit);
  box.classList.toggle('hover', hit && !data?.menuOpen);
});

document.addEventListener('mouseleave', () => {
  if (dragging) return;
  box.classList.remove('hover');
  setIgnore(true);
});

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || !hitsMarker(e)) return;
  if (data.locked) {
    box.classList.remove('nudge');
    void box.offsetWidth;
    box.classList.add('nudge');
    api.lockedNotice();
    return;
  }
  dragging = true;
  box.classList.add('dragging');
  api.dragStart(e.screenX, e.screenY);
});

window.addEventListener('mouseup', () => {
  if (!dragging) return;
  flushMove();
  dragging = false;
  box.classList.remove('dragging');
  api.dragEnd();
});

window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (hitsMarker(e)) api.openMenu();
});

box.addEventListener('animationend', () => box.classList.remove('nudge'));

api.onMarker((next) => {
  data = next;
  render();
});
