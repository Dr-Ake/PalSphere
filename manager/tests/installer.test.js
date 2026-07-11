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

test('network setup follows runtime addresses and the configured game port', () => {
  const firewall = fs.readFileSync(path.join(root, 'scripts', 'Configure-PalSphereFirewall.ps1'), 'utf8');
  const initializer = fs.readFileSync(path.join(root, 'scripts', 'Initialize-PalSphereConfig.js'), 'utf8');
  const manager = fs.readFileSync(path.join(root, 'manager', 'server-manager.js'), 'utf8');
  assert.match(firewall, /-Program \$serverExe/);
  assert.match(firewall, /-Protocol UDP/);
  assert.doesNotMatch(firewall, /-LocalPort\s+8211/);
  assert.match(initializer, /PALSPHERE_GAME_PORT/);
  assert.match(initializer, /UDP \$\{gamePort\}/);
  assert.match(manager, /resolveLanIp/);
  assert.match(manager, /PAL_PUBLIC_IP_LOOKUP_URL/);
  assert.match(manager, /net\.isIP\(discoveredIp\)/);
  assert.doesNotMatch(manager, /64\.188\.248\.97|192\.168\.0\./);
});

test('fresh installs include the PalSphere hosting signature in the join message', () => {
  const initializer = fs.readFileSync(path.join(root, 'scripts', 'Initialize-PalSphereConfig.js'), 'utf8');
  assert.match(initializer, /ServerDescription: 'A friendly Palworld server • Hosted by PalSphere'/);
});

test('launcher identifies its own manager and cleans up an orphan after the install folder moves', () => {
  const manager = fs.readFileSync(path.join(root, 'manager', 'server-manager.js'), 'utf8');
  const launcher = fs.readFileSync(path.join(root, 'manager', 'launch-manager.ps1'), 'utf8');
  assert.match(manager, /installRoot: ROOT/);
  assert.match(launcher, /response\.installRoot/);
  assert.match(launcher, /Compatibility with managers launched before installRoot/);
  assert.match(launcher, /Stop-OrphanedManager/);
  assert.match(launcher, /Test-Path -LiteralPath \$runningScript/);
  assert.match(launcher, /PalServer-Win64-Shipping-Cmd/);
  assert.match(launcher, /Stop-Process -Id \$listener\.OwningProcess/);
});
