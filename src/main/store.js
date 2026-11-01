'use strict';

const fs = require('fs');
const path = require('path');

// A JSON file in userData, written atomically and debounced so that drags and
// slider changes don't hammer the disk.
function createStore(file, defaults) {
  let data = load();
  let timer = null;

  function load() {
    try {
      return normalize(JSON.parse(fs.readFileSync(file, 'utf8')), defaults());
    } catch {
      return defaults();
    }
  }

  function flush() {
    clearTimeout(timer);
    timer = null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  }

  function save() {
    clearTimeout(timer);
    timer = setTimeout(flush, 250);
  }

  return { get: () => data, save, flush };
}

function normalize(raw, base) {
  return {
    library: Array.isArray(raw.library) ? raw.library : base.library,
    instances: Array.isArray(raw.instances) ? raw.instances : [],
    settings: { ...base.settings, ...(raw.settings || {}) }
  };
}

module.exports = { createStore };
