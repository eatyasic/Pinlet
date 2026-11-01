import { ICON, markerArt, escapeHTML, logoSVG } from './shared/glyphs.js';

const api = window.pinlet;
const $ = (id) => document.getElementById(id);
const QUICK_SLOTS = 5;

let app = null;

$('logo').innerHTML = logoSVG(20);
$('openWin').innerHTML = ICON.gear;

function render() {
  if (!app) return;
  const { settings, shortcuts } = app;
  $('count').textContent = `화면에 마커 ${app.total}개`;

  const quick = app.library.slice(0, QUICK_SLOTS).map((m) => `
    <button data-id="${escapeHTML(m.id)}" aria-label="${escapeHTML(m.name)} 추가" title="${escapeHTML(m.name)}">
      ${markerArt(m, 26)}
    </button>`).join('');
  $('quick').innerHTML = `${quick}<button class="new" id="newMarker" aria-label="새 마커 만들기" title="새 마커 만들기">${ICON.plus}</button>`;
  $('hint').textContent = settings.placement === 'center'
    ? '누르면 화면 가운데에 바로 놓여요 · ＋로 새 마커 만들기'
    : '누르면 커서 근처에 바로 놓여요 · ＋로 새 마커 만들기';

  $('toggleHidden').innerHTML = `${settings.hidden ? ICON.eye : ICON.eyeOff}<span>${settings.hidden ? '모든 마커 보이기' : '모든 마커 숨기기'}</span><span class="kbd">${shortcuts.hidden}</span>`;
  $('toggleLock').innerHTML = `${ICON.lock}<span>모든 마커 잠금</span><span class="switch"></span>`;
  $('toggleLock').setAttribute('aria-checked', String(settings.lockAll));
  $('clearAll').innerHTML = `${ICON.trash}<span>모든 마커 지우기</span>`;
  $('clearAll').disabled = app.total === 0;
  $('clearAll').style.opacity = app.total === 0 ? '0.45' : '';
  $('openSettings').innerHTML = `${ICON.gear}<span>설정 열기…</span><span class="kbd">${shortcuts.open}</span>`;
  $('quit').innerHTML = `${ICON.power}<span>Pinlet 종료</span><span class="kbd">${app.platform === 'darwin' ? '⌘Q' : ''}</span>`;

  const ready = app.update.state === 'ready';
  $('updateBlock').hidden = !ready;
  if (ready) $('installUpdate').innerHTML = `${ICON.download}<span>${escapeHTML(app.update.version)} 버전 설치</span><span class="kbd">다시 시작</span>`;
}

$('quick').addEventListener('click', (e) => {
  if (e.target.closest('#newMarker')) return api.openPinlet({ mode: 'new' });
  const btn = e.target.closest('[data-id]');
  if (btn) api.addToScreen(btn.dataset.id, 'tray');
});

$('openWin').addEventListener('click', () => api.openPinlet({ tab: 'markers' }));
$('openSettings').addEventListener('click', () => api.openPinlet({ tab: 'settings' }));
$('toggleHidden').addEventListener('click', () => api.setSetting('hidden', !app.settings.hidden));
$('toggleLock').addEventListener('click', () => api.setSetting('lockAll', !app.settings.lockAll));
$('clearAll').addEventListener('click', () => api.clearMarkers());
$('quit').addEventListener('click', () => api.quit());
$('installUpdate').addEventListener('click', () => api.installUpdate());

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') api.hidePopover();
  if (e.key === 'q' && (e.metaKey || e.ctrlKey)) api.quit();
});

// The window is sized to the content plus the transparent shadow margin.
new ResizeObserver(() => api.popoverSize(document.body.scrollHeight)).observe($('pop'));

api.onState((next) => {
  app = next;
  render();
});
api.getState().then((initial) => {
  app = initial;
  render();
});
