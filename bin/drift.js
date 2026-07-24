#!/usr/bin/env node

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..');
const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Local');
const installedExe = path.join(localAppData, 'Programs', 'Drift', 'Drift.exe');

if (fs.existsSync(installedExe)) {
  console.log(`Launching installed Drift from ${installedExe}...`);
  spawn(installedExe, process.argv.slice(2), { detached: true, stdio: 'ignore' }).unref();
  process.exit(0);
}

const mainOutput = path.join(rootDir, 'out', 'main', 'index.js');
if (fs.existsSync(mainOutput)) {
  console.log('Launching local Drift development build...');
  const electronBin = require('electron');
  const child = spawn(electronBin, [rootDir, ...process.argv.slice(2)], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code || 0));
} else {
  console.log('Drift build not found. Running installer...');
  try {
    execSync(`powershell -ExecutionPolicy Bypass -File "${path.join(rootDir, 'install.ps1')}" -FromSource`, { stdio: 'inherit' });
  } catch (err) {
    console.error('Failed to run Drift installer:', err.message);
    process.exit(1);
  }
}
