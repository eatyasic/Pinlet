// Rasterizes the Pinlet "P" monogram into the PNG icons Electron needs.
// The mark is defined on a 48×48 grid (same geometry as the design):
//   bowl: ring centred at (26,19), radius 10, stroke 6
//   stem: polygon 13,6 → 19,6 → 19,35 → 16,42 → 13,35
// Run with `npm run icons`; output goes to assets/.
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'assets');
const BRAND = [0x2f, 0x5b, 0xff];
const INK = [0x18, 0x18, 0x1b];
const WHITE = [0xff, 0xff, 0xff];
const STEM = [[13, 6], [19, 6], [19, 35], [16, 42], [13, 35]];
const SAMPLES = 4;

function inPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inMonogram(x, y) {
  const d = Math.hypot(x - 26, y - 19);
  return Math.abs(d - 10) <= 3 || inPolygon(x, y, STEM);
}

function inRoundRect(x, y, x0, y0, w, h, r) {
  if (x < x0 || y < y0 || x > x0 + w || y > y0 + h) return false;
  const cx = Math.min(Math.max(x, x0 + r), x0 + w - r);
  const cy = Math.min(Math.max(y, y0 + r), y0 + h - r);
  return Math.hypot(x - cx, y - cy) <= r;
}

// Maps a canvas point to the 48-grid so the mark's bounding box (x 13–39, y 6–42)
// is centred and `markHeight` (fraction of the canvas) tall.
function toGrid(px, py, size, markHeight) {
  const scale = 36 / (size * markHeight);
  return [26 + (px - size / 2) * scale, 24 + (py - size / 2) * scale];
}

// paint(px, py) returns [rgb, alpha] for one sample point, or null for transparent.
function render(size, paint) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const hit = paint(x + (sx + 0.5) / SAMPLES, y + (sy + 0.5) / SAMPLES);
          if (!hit) continue;
          const [rgb, alpha] = hit;
          r += rgb[0] * alpha; g += rgb[1] * alpha; b += rgb[2] * alpha; a += alpha;
        }
      }
      const n = SAMPLES * SAMPLES;
      const i = (y * size + x) * 4;
      if (a > 0) {
        rgba[i] = Math.round(r / a);
        rgba[i + 1] = Math.round(g / a);
        rgba[i + 2] = Math.round(b / a);
      }
      rgba[i + 3] = Math.round((a / n) * 255);
    }
  }
  return rgba;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// macOS menu bar: black mark on transparent, flagged as a template image at runtime.
function trayTemplate(size) {
  return render(size, (px, py) => {
    const [x, y] = toGrid(px, py, size, 0.86);
    return inMonogram(x, y) ? [INK, 1] : null;
  });
}

// Windows / Linux tray: white mark on a brand-blue rounded square.
function trayTile(size) {
  const r = size * 0.22;
  return render(size, (px, py) => {
    if (!inRoundRect(px, py, 0, 0, size, size, r)) return null;
    const [x, y] = toGrid(px, py, size, 0.66);
    return [inMonogram(x, y) ? WHITE : BRAND, 1];
  });
}

// App icon: macOS-style inset rounded square (824 of 1024) with the mark in white.
function appIcon(size) {
  const inset = size * (100 / 1024);
  const side = size - inset * 2;
  const r = side * 0.225;
  return render(size, (px, py) => {
    if (!inRoundRect(px, py, inset, inset, side, side, r)) return null;
    const [x, y] = toGrid(px, py, size, 0.46);
    return [inMonogram(x, y) ? WHITE : BRAND, 1];
  });
}

fs.mkdirSync(OUT, { recursive: true });
const outputs = [
  ['trayTemplate.png', 16, trayTemplate],
  ['trayTemplate@2x.png', 32, trayTemplate],
  ['tray-win.png', 16, trayTile],
  ['tray-win@2x.png', 32, trayTile],
  ['icon.png', 1024, appIcon]
];
for (const [name, size, draw] of outputs) {
  fs.writeFileSync(path.join(OUT, name), encodePNG(size, draw(size)));
  console.log(`assets/${name} (${size}px)`);
}
