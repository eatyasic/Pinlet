// Launches Pinlet against a throwaway profile and saves a screenshot of every window.
// Usage: npm run snapshot [-- <output dir>]
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const electron = require('electron');

const dir = process.argv[2]
  ? path.resolve(process.argv[2])
  : fs.mkdtempSync(path.join(os.tmpdir(), 'pinlet-snapshot-'));
fs.rmSync(path.join(dir, 'userData'), { recursive: true, force: true });
fs.rmSync(path.join(dir, 'shots'), { recursive: true, force: true });

const child = spawn(electron, [path.join(__dirname, '..')], {
  stdio: 'inherit',
  env: { ...process.env, PINLET_SNAPSHOT: dir }
});
child.on('exit', (code) => {
  console.log(`screenshots: ${path.join(dir, 'shots')}`);
  process.exit(code ?? 0);
});
