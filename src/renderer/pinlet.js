import {
  SHAPES, PALETTE, ICON, markerArt, autoShapeName, colorInfo, escapeHTML, logoSVG, imageURL, isHex
} from './shared/glyphs.js';

const api = window.pinlet;
const $ = (id) => document.getElementById(id);

let app = null; // state from the main process
let tab = 'markers';
let selectedId = null;
let toastTimer = null;

const dlg = {
  open: false,
  editId: null,
  mode: 'shape',
  kind: 'arrow',
  color: '#2563EB',
  image: null, // { file, fileName, format, gif }
  name: '',
  touched: false
};

// ---------------------------------------------------------------- static icons

$('logo').innerHTML = logoSVG(22);
$('closeWin').innerHTML = ICON.close;
$('tipIcon').innerHTML = ICON.info;
$('editBtn').innerHTML = `${ICON.pencil}편집`;
$('addBtn').innerHTML = `${ICON.plus}화면에 추가`;
$('dlgClose').innerHTML = ICON.close;
$('dropIcon').innerHTML = ICON.upload;
$('deleteMarker').innerHTML = `${ICON.trash}마커 삭제`;

// ---------------------------------------------------------------- helpers

function toast(text) {
  const el = $('toast');
  el.innerHTML = `${ICON.check}<span></span>`;
  el.querySelector('span').textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 1800);
}

const selected = () => app?.library.find((m) => m.id === selectedId) || null;

async function addToScreen(marker) {
  if (!marker) return;
  if (await api.addToScreen(marker.id, 'window')) toast(`‘${marker.name}’ 마커를 화면에 추가했어요`);
}

// ---------------------------------------------------------------- render: tabs, grid, footer, settings

function renderTabs() {
  for (const btn of document.querySelectorAll('[data-tab]')) {
    btn.setAttribute('aria-selected', String(btn.dataset.tab === tab));
  }
  $('tab-markers').hidden = tab !== 'markers';
  $('tab-settings').hidden = tab !== 'settings';
}

function renderGrid() {
  const tiles = app.library.map((m) => `
    <button class="tile" data-id="${escapeHTML(m.id)}" aria-pressed="${m.id === selectedId}" title="${escapeHTML(m.name)}">
      ${m.gif ? '<span class="gif-chip">GIF</span>' : ''}
      <span class="tile-art">${markerArt(m, 44)}</span>
      <span class="tile-name">${escapeHTML(m.name)}</span>
    </button>`).join('');
  $('grid').innerHTML = `${tiles}
    <button class="tile tile-add" id="addTile">
      ${ICON.plus}
      <span class="tile-name">추가하기</span>
      <small>도형 · 이미지</small>
    </button>`;
  $('firstRunTip').hidden = app.library.length !== 1;
  $('count').textContent = String(app.library.length);
}

function renderFooter() {
  const m = selected();
  $('footHint').hidden = !m;
  $('footActions').hidden = !m;
  $('footEmpty').hidden = Boolean(m);
}

function renderSettings() {
  const s = app.settings;
  for (const row of document.querySelectorAll('[data-setting]')) {
    row.setAttribute('aria-checked', String(Boolean(s[row.dataset.setting])));
  }
  for (const btn of $('placement').querySelectorAll('[data-value]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.value === s.placement));
  }
  $('keyHidden').textContent = app.shortcuts.hidden;
  $('keyLock').textContent = app.shortcuts.lockAll;
  $('keyOpen').textContent = app.shortcuts.open;
}

function renderAll() {
  if (!app) return;
  if (!app.library.some((m) => m.id === selectedId)) selectedId = app.library[0]?.id ?? null;
  renderTabs();
  renderGrid();
  renderFooter();
  renderSettings();
}

// ---------------------------------------------------------------- dialog

function autoName() {
  if (dlg.mode === 'image') return dlg.image ? dlg.image.fileName : '';
  return autoShapeName(dlg.kind, dlg.color);
}

function syncName() {
  const input = $('nameInput');
  const auto = autoName();
  input.placeholder = auto;
  if (!dlg.touched && input.value !== auto) input.value = auto;
  $('nameHint').textContent = dlg.editId
    ? '화면에 놓인 이 마커도 함께 바뀌어요'
    : dlg.mode === 'image' ? '비워 두면 파일 이름을 써요' : '비워 두면 색과 모양으로 이름이 붙어요';
}

function renderShapeMode() {
  $('shapePreview').innerHTML = markerArt({ type: 'shape', kind: dlg.kind, color: dlg.color }, 64);
  $('shapeGrid').innerHTML = SHAPES.map((s) => `
    <button class="shape-btn" data-kind="${s.kind}" aria-label="${s.label}" aria-pressed="${s.kind === dlg.kind}">
      ${markerArt({ type: 'shape', kind: s.kind, color: dlg.color }, 28)}
    </button>`).join('');
  const preset = colorInfo(dlg.color);
  $('colorName').textContent = preset ? preset.name : '직접 고른 색';
  const swatches = PALETTE.map((p) => `
    <button class="swatch${p.hex === '#FFFFFF' ? ' light' : ''}" data-color="${p.hex}" style="background:${p.hex}"
      aria-label="${p.name}" aria-pressed="${preset?.hex === p.hex}"></button>`).join('');
  const custom = !preset;
  $('swatches').innerHTML = `${swatches}
    <label class="swatch swatch-custom" title="직접 고르기" aria-pressed="${custom}" ${custom ? `style="background:${dlg.color}"` : ''}>
      ${custom ? '' : ICON.plus}
      <input type="color" id="customColor" value="${dlg.color.toLowerCase()}" aria-label="색 직접 고르기">
    </label>`;
}

function renderImageMode() {
  const img = dlg.image;
  $('modeImageEmpty').hidden = Boolean(img);
  $('modeImageChosen').hidden = !img;
  if (!img) return;
  $('imagePreviewImg').src = imageURL(img.file);
  $('imageGif').hidden = !img.gif;
  $('fileName').textContent = img.fileName;
  $('fileMeta').textContent = img.gif
    ? 'GIF · 움직임 그대로 화면에 재생돼요'
    : `${img.format} · 투명한 부분은 투명하게 보여요`;
}

function renderDialog() {
  $('dialog').hidden = !dlg.open;
  if (!dlg.open) return;
  const isShape = dlg.mode === 'shape';
  $('dlgTitle').textContent = dlg.editId ? '마커 편집' : '새 마커 만들기';
  $('dlgSubmit').textContent = dlg.editId ? '저장' : '만들기';
  $('deleteMarker').hidden = !dlg.editId;
  for (const btn of $('dlgMode').querySelectorAll('[data-mode]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.mode === dlg.mode));
  }
  $('modeShape').hidden = !isShape;
  if (isShape) {
    $('modeImageEmpty').hidden = true;
    $('modeImageChosen').hidden = true;
    renderShapeMode();
  } else {
    renderImageMode();
  }
  // One name input, moved into whichever layout is showing.
  const slot = isShape ? $('nameSlotShape') : $('nameSlotImage');
  if ($('nameField').parentElement !== slot) slot.appendChild($('nameField'));
  $('dlgSubmit').disabled = !isShape && !dlg.image;
  syncName();
}

function showError(text) {
  $('dlgError').textContent = text || '';
  $('dlgError').hidden = !text;
}

function openNew(image = null) {
  Object.assign(dlg, {
    open: true, editId: null, mode: image ? 'image' : 'shape', kind: 'arrow', color: '#2563EB', image, name: '', touched: false
  });
  $('nameInput').value = '';
  showError('');
  renderDialog();
  if (!image) $('nameInput').blur();
}

function openEdit(markerId) {
  const m = app?.library.find((x) => x.id === markerId);
  if (!m) return;
  selectedId = m.id;
  const isImage = m.type === 'image';
  Object.assign(dlg, {
    open: true,
    editId: m.id,
    mode: isImage ? 'image' : 'shape',
    kind: isImage ? 'arrow' : m.kind,
    color: isImage ? '#2563EB' : m.color,
    image: isImage ? { file: m.file, fileName: m.fileName, format: m.format, gif: m.gif } : null,
    name: m.name,
    touched: !m.auto
  });
  $('nameInput').value = m.auto ? '' : m.name;
  showError('');
  renderAll();
  renderDialog();
}

function closeDialog() {
  dlg.open = false;
  renderDialog();
}

async function takeImage(result) {
  if (!result) return;
  if (result.error) return showError(result.error);
  showError('');
  dlg.mode = 'image';
  dlg.image = result;
  renderDialog();
}

async function submit() {
  const auto = autoName();
  const typed = $('nameInput').value.trim();
  const base = { name: typed || auto, auto: !typed || typed === auto };
  const data = dlg.mode === 'image'
    ? { ...base, type: 'image', file: dlg.image?.file, fileName: dlg.image?.fileName }
    : { ...base, type: 'shape', kind: dlg.kind, color: dlg.color };
  if (dlg.mode === 'image' && !dlg.image) return;
  if (dlg.editId) {
    const saved = await api.updateMarker(dlg.editId, data);
    if (!saved) return showError('저장하지 못했어요. 다시 시도해 주세요.');
    selectedId = saved.id;
    toast(`‘${saved.name}’ 마커를 저장했어요`);
  } else {
    const created = await api.createMarker(data);
    if (!created) return showError('만들지 못했어요. 다시 시도해 주세요.');
    selectedId = created.id;
    toast(`‘${created.name}’ 마커를 만들었어요`);
  }
  closeDialog();
}

// ---------------------------------------------------------------- events

document.querySelector('[role="tablist"]').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-tab]');
  if (!btn) return;
  tab = btn.dataset.tab;
  renderTabs();
});

$('closeWin').addEventListener('click', () => api.hideWindow());

$('grid').addEventListener('click', (e) => {
  if (e.target.closest('#addTile')) return openNew();
  const tile = e.target.closest('.tile[data-id]');
  if (!tile) return;
  selectedId = tile.dataset.id;
  for (const t of $('grid').querySelectorAll('.tile[data-id]')) t.setAttribute('aria-pressed', String(t === tile));
  renderFooter();
});

$('grid').addEventListener('dblclick', (e) => {
  const tile = e.target.closest('.tile[data-id]');
  if (tile) addToScreen(app.library.find((m) => m.id === tile.dataset.id));
});

$('addBtn').addEventListener('click', () => addToScreen(selected()));
$('editBtn').addEventListener('click', () => selected() && openEdit(selectedId));

for (const row of document.querySelectorAll('[data-setting]')) {
  row.addEventListener('click', () => {
    api.setSetting(row.dataset.setting, row.getAttribute('aria-checked') !== 'true');
  });
}

$('placement').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-value]');
  if (btn) api.setSetting('placement', btn.dataset.value);
});

$('dlgMode').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-mode]');
  if (!btn || btn.dataset.mode === dlg.mode) return;
  dlg.mode = btn.dataset.mode;
  showError('');
  renderDialog();
});

$('shapeGrid').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-kind]');
  if (!btn) return;
  dlg.kind = btn.dataset.kind;
  renderDialog();
});

$('swatches').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-color]');
  if (!btn) return;
  dlg.color = btn.dataset.color;
  renderDialog();
});

$('swatches').addEventListener('input', (e) => {
  if (e.target.id !== 'customColor' || !isHex(e.target.value)) return;
  dlg.color = e.target.value.toUpperCase();
  $('shapePreview').innerHTML = markerArt({ type: 'shape', kind: dlg.kind, color: dlg.color }, 64);
  syncName();
});

$('swatches').addEventListener('change', (e) => {
  if (e.target.id === 'customColor') renderDialog();
});

$('nameInput').addEventListener('input', (e) => {
  dlg.touched = e.target.value.trim() !== '';
  dlg.name = e.target.value;
});

$('pickFile').addEventListener('click', async () => takeImage(await api.pickImage()));
$('changeFile').addEventListener('click', async () => takeImage(await api.pickImage()));
$('dlgClose').addEventListener('click', closeDialog);
$('dlgCancel').addEventListener('click', closeDialog);
$('dlgSubmit').addEventListener('click', submit);

$('deleteMarker').addEventListener('click', async () => {
  const m = app.library.find((x) => x.id === dlg.editId);
  if (!m || !(await api.deleteMarker(m.id))) return;
  closeDialog();
  toast(`‘${m.name}’ 마커를 지웠어요`);
});

$('dialog').addEventListener('mousedown', (e) => {
  if (e.target === $('dialog')) closeDialog();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && dlg.open) closeDialog();
  else if (e.key === 'Enter' && dlg.open && e.target.id === 'nameInput') submit();
});

// Image files can be dropped onto the dialog or anywhere in the window.
function imageFrom(e) {
  const file = [...(e.dataTransfer?.files || [])][0];
  return file ? api.pathForFile(file) : '';
}

document.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.querySelector('.win').classList.toggle('dropping', !dlg.open);
  $('modeImageEmpty').classList.add('over');
});
document.addEventListener('dragleave', (e) => {
  if (e.relatedTarget) return;
  document.querySelector('.win').classList.remove('dropping');
  $('modeImageEmpty').classList.remove('over');
});
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  document.querySelector('.win').classList.remove('dropping');
  $('modeImageEmpty').classList.remove('over');
  const filePath = imageFrom(e);
  if (!filePath) return;
  const result = await api.importImagePath(filePath);
  if (!result) return;
  if (!dlg.open) {
    if (result.error) return toast(result.error);
    return openNew(result);
  }
  takeImage(result);
});

// ---------------------------------------------------------------- boot

api.onState((next) => {
  app = next;
  renderAll();
});

api.onOpen((options = {}) => {
  tab = options.tab === 'settings' ? 'settings' : 'markers';
  renderTabs();
  if (options.mode === 'new') openNew();
  else if (options.mode === 'edit') openEdit(options.markerId);
});

api.getState().then((initial) => {
  app = initial;
  renderAll();
});
