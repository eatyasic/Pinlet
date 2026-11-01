// Marker shapes, palette and small helpers shared by every renderer window.
// Shapes are drawn on a 48×48 grid; ports of the design's glyph component.

export const BRAND = '#2F5BFF';

export const SHAPES = [
  { kind: 'ring', label: '원' },
  { kind: 'arrow', label: '화살표' },
  { kind: 'pin', label: '핀' },
  { kind: 'dot', label: '점' },
  { kind: 'star', label: '별' },
  { kind: 'check', label: '체크' },
  { kind: 'cross', label: '엑스' },
  { kind: 'number', label: '번호' },
  { kind: 'box', label: '상자' },
  { kind: 'cursor', label: '커서' },
  { kind: 'highlight', label: '형광펜' },
  { kind: 'alert', label: '느낌표' }
];

export const PALETTE = [
  { hex: '#F2542D', name: '빨강', adj: '빨간' },
  { hex: '#F59E0B', name: '주황', adj: '주황' },
  { hex: '#FACC15', name: '노랑', adj: '노란' },
  { hex: '#16A34A', name: '초록', adj: '초록' },
  { hex: '#2563EB', name: '파랑', adj: '파란' },
  { hex: '#7C3AED', name: '보라', adj: '보라' },
  { hex: '#18181B', name: '검정', adj: '검은' },
  { hex: '#FFFFFF', name: '흰색', adj: '흰' }
];

const DEFAULT_COLOR = {
  ring: '#F2542D', arrow: '#F2542D', pin: '#F2542D', dot: '#F2542D', star: '#FACC15', check: '#16A34A',
  cross: '#F2542D', number: '#2563EB', box: '#F2542D', cursor: '#18181B', highlight: '#FACC15', alert: '#F2542D'
};

const HEX = /^#[0-9a-f]{6}$/i;

export const isHex = (value) => typeof value === 'string' && HEX.test(value);

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const BODY = {
  arrow: ({ c, halo }) => `<g transform="rotate(-45 24 24)"><polygon points="24,4 42,22 31,22 31,44 17,44 17,22 6,22" fill="${c}" stroke="${halo}" stroke-width="3" stroke-linejoin="round" paint-order="stroke"/></g>`,
  ring: ({ c, halo }) => `<circle cx="24" cy="24" r="17" fill="none" stroke="${halo}" stroke-width="7"/><circle cx="24" cy="24" r="17" fill="none" stroke="${c}" stroke-width="4"/>`,
  pin: ({ c, halo, ink }) => `<path d="M24 4C15.7 4 9 10.6 9 18.8C9 29.6 24 44 24 44C24 44 39 29.6 39 18.8C39 10.6 32.3 4 24 4Z" fill="${c}" stroke="${halo}" stroke-width="2.5" stroke-linejoin="round" paint-order="stroke"/><circle cx="24" cy="18.5" r="5.5" fill="${ink}"/>`,
  dot: ({ c, halo }) => `<circle cx="24" cy="24" r="19" fill="${c}" fill-opacity="0.2"/><circle cx="24" cy="24" r="9" fill="${c}" stroke="${halo}" stroke-width="2.5" paint-order="stroke"/>`,
  star: ({ c, halo }) => `<polygon points="24,5 28.7,17.5 42.1,18.1 31.6,26.5 35.2,39.4 24,32 12.8,39.4 16.4,26.5 5.9,18.1 19.3,17.5" fill="${c}" stroke="${halo}" stroke-width="2.5" stroke-linejoin="round" paint-order="stroke"/>`,
  check: ({ c, halo }) => `<polyline points="11,25 20,34 37,14" fill="none" stroke="${halo}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><polyline points="11,25 20,34 37,14" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`,
  cross: ({ c, halo }) => `<path d="M14 14L34 34M34 14L14 34" fill="none" stroke="${halo}" stroke-width="9" stroke-linecap="round"/><path d="M14 14L34 34M34 14L14 34" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round"/>`,
  number: ({ c, halo, ink }) => `<circle cx="24" cy="24" r="17" fill="${c}" stroke="${halo}" stroke-width="2.5" paint-order="stroke"/><text x="24" y="30.6" text-anchor="middle" font-size="19" font-weight="600" fill="${ink}" font-family="-apple-system, 'Segoe UI', sans-serif">1</text>`,
  box: ({ c, halo }) => `<rect x="6" y="11" width="36" height="26" rx="4" fill="none" stroke="${halo}" stroke-width="7"/><rect x="6" y="11" width="36" height="26" rx="4" fill="none" stroke="${c}" stroke-width="4"/>`,
  cursor: ({ c, halo }) => `<path d="M15 7V37L22.5 30L27.5 41.5L32.5 39.3L27.6 28H37.5Z" fill="${c}" stroke="${halo}" stroke-width="2.5" stroke-linejoin="round" paint-order="stroke"/>`,
  highlight: ({ c }) => `<rect x="3" y="17" width="42" height="14" rx="3" fill="${c}" fill-opacity="0.75"/>`,
  alert: ({ c, halo, ink }) => `<circle cx="24" cy="24" r="17" fill="${c}" stroke="${halo}" stroke-width="2.5" paint-order="stroke"/><path d="M24 14.5V26.5" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/><circle cx="24" cy="32.6" r="2.4" fill="${ink}"/>`
};

export function glyphSVG(kind, color, size) {
  const draw = BODY[kind] || BODY.ring;
  const c = isHex(color) ? color : DEFAULT_COLOR[kind] || '#F2542D';
  const L = luminance(c);
  const ink = L > 0.45 ? '#18181B' : '#FFFFFF';
  const halo = L > 0.8 ? 'rgba(24,24,27,0.4)' : '#FFFFFF';
  return `<svg width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true">${draw({ c, ink, halo })}</svg>`;
}

export const imageURL = (file) => `pinlet://images/${encodeURIComponent(file)}`;

// The visual for a library marker: an SVG shape or the user's image.
export function markerArt(marker, size) {
  if (!marker) return '';
  if (marker.type === 'image') {
    return `<img class="art-img" src="${imageURL(marker.file)}" width="${size}" height="${size}" alt="" draggable="false">`;
  }
  return glyphSVG(marker.kind, marker.color, size);
}

export const colorInfo = (hex) => PALETTE.find((p) => isHex(hex) && p.hex.toLowerCase() === hex.toLowerCase()) || null;
export const shapeLabel = (kind) => (SHAPES.find((s) => s.kind === kind) || SHAPES[0]).label;

export function autoShapeName(kind, color) {
  const p = colorInfo(color);
  return p ? `${p.adj} ${shapeLabel(kind)}` : shapeLabel(kind);
}

export function markerMeta(marker) {
  if (!marker) return '';
  if (marker.type === 'image') return `이미지 · ${marker.format || ''}`;
  const p = colorInfo(marker.color);
  return `도형 · ${p ? p.name : '직접 고른 색'}`;
}

export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

export function logoSVG(size, color = BRAND) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true"><circle cx="26" cy="19" r="10" fill="none" stroke="${color}" stroke-width="6"/><path d="M13 6H19V35L16 42L13 35Z" fill="${color}"/></svg>`;
}

const icon = (body, size = 16, stroke = 'currentColor', width = 1.5) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICON = {
  close: icon('<path d="M3 3L13 13M13 3L3 13"/>', 14),
  plus: icon('<path d="M8 3V13M3 8H13"/>'),
  pencil: icon('<path d="M10.5 2.5L13.5 5.5L5.5 13.5H2.5V10.5Z"/><path d="M9 4L12 7"/>'),
  trash: icon('<path d="M2.5 4H13.5M6 4V2.5H10V4M4 4L4.7 13.5H11.3L12 4"/>'),
  eye: icon('<path d="M1.5 8C1.5 8 3.9 3.5 8 3.5C12.1 3.5 14.5 8 14.5 8C14.5 8 12.1 12.5 8 12.5C3.9 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/>'),
  eyeOff: icon('<path d="M2 2L14 14"/><path d="M6.6 3.7C7 3.6 7.5 3.5 8 3.5C12.1 3.5 14.5 8 14.5 8C14.1 8.8 13.5 9.6 12.8 10.3M10.4 11.9C9.7 12.3 8.9 12.5 8 12.5C3.9 12.5 1.5 8 1.5 8C2.1 6.9 2.9 5.9 3.9 5.1"/>'),
  lock: icon('<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5A2.5 2.5 0 0 1 10.5 5V7"/>'),
  gear: icon('<circle cx="8" cy="8" r="2.2"/><circle cx="8" cy="8" r="5"/><path d="M8 1.5V3M8 13V14.5M1.5 8H3M13 8H14.5M3.4 3.4L4.5 4.5M11.5 11.5L12.6 12.6M3.4 12.6L4.5 11.5M11.5 4.5L12.6 3.4"/>'),
  power: icon('<path d="M8 1.8V7.2"/><path d="M4.4 4.2A5 5 0 1 0 11.6 4.2"/>'),
  copy: icon('<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5V3A1.5 1.5 0 0 0 9 1.5H3A1.5 1.5 0 0 0 1.5 3V9A1.5 1.5 0 0 0 3 10.5H3.5"/>'),
  reset: icon('<path d="M2.8 8A5.2 5.2 0 1 0 4.4 4.3"/><path d="M4.6 1.8V4.6H1.8"/>', 13),
  download: icon('<path d="M8 2.7V10M5 7L8 10L11 7"/><path d="M2.7 9.3V12A1.3 1.3 0 0 0 4 13.3H12A1.3 1.3 0 0 0 13.3 12V9.3"/>'),
  upload: icon('<path d="M8 10V2.7M5 5.7L8 2.7L11 5.7"/><path d="M2.7 9.3V12A1.3 1.3 0 0 0 4 13.3H12A1.3 1.3 0 0 0 13.3 12V9.3"/>', 28, 'currentColor', 1),
  info: icon('<circle cx="8" cy="8" r="6.2"/><path d="M8 7.2V11"/><path d="M8 5H8.01"/>'),
  check: icon('<path d="M3.5 8.5L6.5 11.5L12.5 4.5"/>', 16, 'currentColor', 1.8)
};
