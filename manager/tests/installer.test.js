'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');

test('installer uses official downloads and the Palworld dedicated server app', () => {
  const installer = fs.readFileSync(path.join(root, 'scripts', 'Install-PalSphere.ps1'), 'utf8');
  assert.match(installer, /https:\/\/steamcdn-a\.akamaihd\.net\/client\/installer\/steamcmd\.zip/);
  assert.match(installer, /https:\/\/nodejs\.org\/dist\/index\.json/);
  assert.match(installer, /https:\/\/aka\.ms\/vc14\/vc_redist\.x64\.exe/);
  assert.match(installer, /https:\/\/download\.microsoft\.com\/.+\/dxwebsetup\.exe/);
  assert.match(installer, /'2394010'/);
  assert.match(installer, /Get-FileHash.+SHA256/);
  assert.match(installer, /Existing world, configuration, passwords, and saves were preserved/);
});

test('gitignore excludes every generated or private server area', () => {
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  for (const entry of ['/server/', '/_steamcmd/', '/_prerequisites/', '/.runtime/', '/manager/backups/', '/manager/logs/', '/manager/config-history/', '/PalSphere Server Info - Private.txt']) {
    assert.match(ignore, new RegExp(entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('public package has no npm runtime dependencies', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const manager = fs.readFileSync(path.join(root, 'manager', 'server-manager.js'), 'utf8');
  const installer = fs.readFileSync(path.join(root, 'scripts', 'Install-PalSphere.ps1'), 'utf8');
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.devDependencies, undefined);
  assert.match(manifest.scripts.test, /node --test/);
  assert.match(manager, new RegExp(`MANAGER_VERSION = '${manifest.version}'`));
  assert.match(installer, new RegExp(`PalSphereVersion = '${manifest.version}'`));
});

test('Windows startup is controlled by the real scheduled-task helper', () => {
  const manager = fs.readFileSync(path.join(root, 'manager', 'server-manager.js'), 'utf8');
  const startup = fs.readFileSync(path.join(root, 'scripts', 'Register-PalSphereStartup.ps1'), 'utf8');
  assert.match(manager, /\/api\/manager\/startup/);
  assert.match(manager, /Register-PalSphereStartup\.ps1/);
  assert.match(startup, /Register-ScheduledTask/);
  assert.match(startup, /Unregister-ScheduledTask/);
});
