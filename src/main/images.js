'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const MAX_BYTES = 50 * 1024 * 1024;
const STORED_NAME = /^[0-9a-f-]{36}\.(png|jpg|gif|webp|svg)$/;

// User images are copied into userData/images under a random name, so markers
// keep working after the original file is moved or deleted.
function createImages(dir) {
  fs.mkdirSync(dir, { recursive: true });

  async function importFile(src) {
    const ext = path.extname(src).toLowerCase();
    if (!EXTENSIONS.has(ext)) throw new Error('unsupported');
    const stat = await fs.promises.stat(src);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('too-large');
    const storedExt = ext === '.jpeg' ? '.jpg' : ext;
    const file = randomUUID() + storedExt;
    await fs.promises.copyFile(src, path.join(dir, file));
    const format = storedExt.slice(1).toUpperCase();
    return { file, fileName: path.basename(src), format, gif: format === 'GIF' };
  }

  function isStored(file) {
    return typeof file === 'string' && STORED_NAME.test(file) && fs.existsSync(path.join(dir, file));
  }

  // Removes images no marker points at (e.g. picked in a dialog that was cancelled).
  function prune(keep) {
    for (const name of fs.readdirSync(dir)) {
      if (!keep.has(name)) fs.rmSync(path.join(dir, name), { force: true });
    }
  }

  return { dir, extensions: [...EXTENSIONS].map((e) => e.slice(1)), importFile, isStored, prune };
}

module.exports = { createImages };
