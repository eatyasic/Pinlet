import { ICON, markerArt, markerMeta } from './shared/glyphs.js';

const api = window.pinlet;
const $ = (id) => document.getElementById(id);

let inst = null;
let marker = null;
let pending = {};
let frame = 0;
let spaceWord = '스페이스'; // "데스크톱" on Windows

$('resetRotation').innerHTML = ICON.reset;

function send(patch) {
  Object.assign(inst, patch);
  Object.assign(pending, patch);
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    api.updateInstance(inst.id, pending);
    pending = {};
  });
}

function renderValues() {
  $('sizeValue').textContent = `${inst.size}px`;
  $('opacityValue').textContent = `${inst.opacity}%`;
  $('rotationValue').textContent = `${inst.rotation}°`;
  $('onTop').setAttribute('aria-checked', String(inst.onTop));
  for (const btn of $('spaces').querySelectorAll('[data-space]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.space === inst.space));
  }
  $('spacesHint').textContent = inst.space === 'current'
    ? `지금 보고 있는 ${spaceWord}에서만 보여요`
    : `모든 ${spaceWord}에서 같은 자리에 보여요`;
}

function render(payload) {
  inst = { ...payload.instance };
  marker = payload.marker;
  pending = {};
  $('thumb').innerHTML = markerArt(marker, 22);
  $('name').textContent = marker?.name || '';
  $('meta').textContent = markerMeta(marker);
  $('size').value = inst.size;
  $('opacity').value = inst.opacity;
  $('rotation').value = inst.rotation;
  $('spacesBlock').hidden = !payload.spacesSupported;
  spaceWord = payload.spaceWord;
  $('spacesTitle').textContent = `표시할 ${spaceWord}`;
  $('spaces').querySelector('[data-space="all"]').textContent = `모든 ${spaceWord}`;
  $('spaces').querySelector('[data-space="current"]').textContent = `현재 ${spaceWord}만`;
  $('locked').setAttribute('aria-checked', String(inst.locked || payload.lockAll));
  $('locked').setAttribute('aria-disabled', String(payload.lockAll));
  $('lockHint').hidden = !payload.lockAll;
  $('edit').innerHTML = `${ICON.pencil}<span>마커 편집…</span><span class="kbd">이름 · 모양 · 색</span>`;
  $('duplicate').innerHTML = `${ICON.copy}<span>복제</span><span class="kbd">${payload.shortcuts.duplicate}</span>`;
  $('remove').innerHTML = `${ICON.trash}<span>화면에서 지우기</span><span class="kbd">${payload.shortcuts.remove}</span>`;
  renderValues();
  // The window is still hidden here, so rAF may not fire; a timeout lets layout settle first.
  setTimeout(() => api.menuSize(document.body.offsetWidth, document.body.scrollHeight), 0);
}

$('size').addEventListener('input', (e) => { send({ size: Number(e.target.value) }); renderValues(); });
$('opacity').addEventListener('input', (e) => { send({ opacity: Number(e.target.value) }); renderValues(); });
$('rotation').addEventListener('input', (e) => { send({ rotation: Number(e.target.value) }); renderValues(); });
$('resetRotation').addEventListener('click', () => {
  $('rotation').value = 0;
  send({ rotation: 0 });
  renderValues();
});

$('spaces').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-space]');
  if (!btn) return;
  send({ space: btn.dataset.space });
  renderValues();
});

$('onTop').addEventListener('click', () => {
  send({ onTop: !inst.onTop });
  renderValues();
});

$('locked').addEventListener('click', () => {
  if ($('locked').getAttribute('aria-disabled') === 'true') return;
  send({ locked: !inst.locked });
  $('locked').setAttribute('aria-checked', String(inst.locked));
});

$('edit').addEventListener('click', () => marker && api.editMarker(marker.id));
$('duplicate').addEventListener('click', () => api.duplicateInstance(inst.id));
$('remove').addEventListener('click', () => api.removeInstance(inst.id));

document.addEventListener('keydown', (e) => {
  if (!inst) return;
  const mod = e.metaKey || e.ctrlKey;
  if (e.key === 'Escape') api.closeMenu();
  else if (mod && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    api.duplicateInstance(inst.id);
  } else if ((e.key === 'Backspace' || e.key === 'Delete') && e.target.tagName !== 'INPUT') {
    api.removeInstance(inst.id);
  }
});

new ResizeObserver(() => {
  if (inst) api.menuSize(document.body.offsetWidth, document.body.scrollHeight);
}).observe($('pop'));

api.onMenu(render);
