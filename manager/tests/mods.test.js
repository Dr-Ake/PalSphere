'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const {
  ModManager,
  normalizeModInfo,
  parseModSettings,
  parseWorkshopId,
  updateModSettings,
} = require('../lib/mods');

function fixtureInfo(overrides = {}) {
  return {
    ModName: 'Farming Quivern',
    PackageName: 'FarmingQuivern',
    Version: '1.2.3',
    Author: 'Pal Tamer',
    Dependencies: ['PalSchema'],
    InstallRule: [
      { Type: 'Paks', Targets: ['./Paks/'] },
      { Type: 'Paks', IsServer: true, Targets: ['./Paks/'] },
    ],
    ...overrides,
  };
}

test('normalizes official Palworld Workshop metadata and server compatibility', () => {
  const mod = normalizeModInfo(fixtureInfo());
  assert.equal(mod.packageName, 'FarmingQuivern');
  assert.equal(mod.serverCompatible, true);
  assert.equal(mod.clientFilesIncluded, true);
  assert.deepEqual(mod.installTypes, ['Paks']);
  assert.deepEqual(mod.dependencies, ['PalSchema']);
});

test('rejects package names that could escape the Workshop directory', () => {
  assert.throws(() => normalizeModInfo(fixtureInfo({ PackageName: '..\\outside' })), /invalid PackageName/);
});

test('accepts a Workshop item URL or numeric ID and rejects unrelated URLs', () => {
  assert.equal(parseWorkshopId('3625287786'), '3625287786');
  assert.equal(parseWorkshopId('https://steamcommunity.com/sharedfiles/filedetails/?id=3625287786'), '3625287786');
  assert.throws(() => parseWorkshopId('https://example.com/sharedfiles/filedetails/?id=3625287786'), /steamcommunity\.com/);
  assert.throws(() => parseWorkshopId('https://steamcommunity.com/workshop/?id=3625287786'), /shared-file URL/);
});

test('reads active packages only from the PalModSettings section', () => {
  const parsed = parseModSettings([
    '[OtherSettings]',
    'ActiveModList=Ignored',
    '[PalModSettings]',
    'bGlobalEnableMod=true',
    'ActiveModList=FarmingQuivern',
    'ActiveModList=PalSchema',
  ].join('\r\n'));
  assert.equal(parsed.globalEnabled, true);
  assert.deepEqual(parsed.activePackages, ['FarmingQuivern', 'PalSchema']);
});

test('updates managed mod settings while preserving unrelated values', () => {
  const updated = updateModSettings([
    '[PalModSettings]',
    'bGlobalEnableMod=false',
    'ActiveModList=OldMod',
    'WorkshopRootDir=D:\\SteamLibrary\\steamapps\\workshop\\content\\1623730',
    '',
    '[OtherSettings]',
    'Value=1',
  ].join('\r\n'), { globalEnabled: true, activePackages: ['PalSchema', 'FarmingQuivern'] });
  assert.match(updated, /bGlobalEnableMod=true/);
  assert.match(updated, /ActiveModList=FarmingQuivern\r\nActiveModList=PalSchema/);
  assert.doesNotMatch(updated, /OldMod/);
  assert.match(updated, /WorkshopRootDir=D:\\SteamLibrary/);
  assert.match(updated, /\[OtherSettings\]\r\nValue=1/);
});

test('sets an explicit Workshop directory when requested', () => {
  const updated = updateModSettings([
    '[PalModSettings]',
    'bGlobalEnableMod=false',
    'WorkshopRootDir=',
    'ConfigVersion=1.0',
  ].join('\r\n'), {
    globalEnabled: true,
    activePackages: ['CreativeMenu'],
    workshopRootDir: 'D:\\PalSphere\\server\\Mods\\Workshop',
  });
  assert.match(updated, /ActiveModList=CreativeMenu/);
  assert.match(updated, /WorkshopRootDir=D:\\PalSphere\\server\\Mods\\Workshop/);
  assert.doesNotMatch(updated, /WorkshopRootDir=\r?\n/);
  assert.match(updated, /ConfigVersion=1\.0/);
});

test('installs, enables, disables, and removes a server-compatible package', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'palsphere-mod-test-'));
  const serverDir = path.join(root, 'server');
  const source = path.join(root, 'source');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'Info.json'), JSON.stringify(fixtureInfo()), 'utf8');
  fs.mkdirSync(path.join(source, 'Paks'));
  fs.writeFileSync(path.join(source, 'Paks', 'FarmingQuivern.pak'), 'fixture', 'utf8');
  try {
    const manager = new ModManager({ installRoot: root, serverDir });
    const installed = manager.installFromDirectory(source);
    assert.equal(installed.packageName, 'FarmingQuivern');
    assert.equal(manager.list().installed[0].active, true);
    assert.equal(manager.list().globalEnabled, true);

    manager.setModEnabled('FarmingQuivern', false);
    assert.equal(manager.list().installed[0].active, false);

    fs.writeFileSync(path.join(source, 'Info.json'), JSON.stringify(fixtureInfo({ Version: '2.0.0' })), 'utf8');
    const updated = manager.installFromDirectory(source);
    assert.equal(updated.updated, true);
    assert.equal(manager.list().installed[0].version, '2.0.0');
    assert.equal(manager.list().installed[0].active, false, 'updating should preserve a disabled mod state');

    manager.remove('FarmingQuivern');
    assert.equal(manager.list().installed.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('preserves the numeric Workshop ID required by Palworld server deployment', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'palsphere-workshop-id-test-'));
  const serverDir = path.join(root, 'server');
  const source = path.join(root, 'downloaded-package');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'Info.json'), JSON.stringify(fixtureInfo({ PackageName: 'CreativeMenu' })), 'utf8');
  fs.writeFileSync(path.join(source, '.workshop.json'), JSON.stringify({ publishedfileid: '3625287786' }), 'utf8');
  fs.mkdirSync(path.join(source, 'Paks'));
  fs.writeFileSync(path.join(source, 'Paks', 'CreativeMenu_P.pak'), 'fixture', 'utf8');
  try {
    const manager = new ModManager({ installRoot: root, serverDir });
    const installed = manager.installFromDirectory(source);
    assert.equal(installed.workshopId, '3625287786');
    assert.equal(installed.directoryName, '3625287786');
    assert.ok(fs.existsSync(path.join(manager.workshopDir, '3625287786', 'Info.json')));
    assert.equal(fs.existsSync(path.join(manager.workshopDir, 'CreativeMenu')), false);
    assert.equal(manager.list().installed[0].packageName, 'CreativeMenu');
    assert.equal(manager.list().installed[0].active, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('refuses to install a client-only package', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'palsphere-mod-test-'));
  const serverDir = path.join(root, 'server');
  const source = path.join(root, 'source');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'Info.json'), JSON.stringify(fixtureInfo({ InstallRule: [{ Type: 'Paks' }] })), 'utf8');
  try {
    const manager = new ModManager({ installRoot: root, serverDir });
    assert.throws(() => manager.installFromDirectory(source), /does not declare dedicated-server support/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('securely expands and installs a Workshop-format ZIP', { skip: process.platform !== 'win32' }, async () => {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'palsphere-mod-zip-test-'));
  const serverDir = path.join(root, 'server');
  const source = path.join(root, 'source');
  const archive = path.join(root, 'FarmingQuivern.zip');
  fs.mkdirSync(path.join(source, 'Paks'), { recursive: true });
  fs.writeFileSync(path.join(source, 'Info.json'), JSON.stringify(fixtureInfo()), 'utf8');
  fs.writeFileSync(path.join(source, 'Paks', 'FarmingQuivern.pak'), 'fixture', 'utf8');
  const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
  try {
    execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `Compress-Archive -Path ${quote(path.join(source, '*'))} -DestinationPath ${quote(archive)} -Force`], { windowsHide: true });
    const manager = new ModManager({ installRoot: projectRoot, serverDir });
    const installed = await manager.installFromArchive(fs.readFileSync(archive), path.basename(archive));
    assert.equal(installed.packageName, 'FarmingQuivern');
    assert.ok(fs.existsSync(path.join(serverDir, 'Mods', 'Workshop', 'FarmingQuivern', 'Info.json')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects ZIP entries that escape the extraction folder', { skip: process.platform !== 'win32' }, async () => {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'palsphere-mod-slip-test-'));
  const serverDir = path.join(root, 'server');
  const archive = path.join(root, 'unsafe.zip');
  const escaped = path.join(projectRoot, 'manager', 'mod-staging', 'escape.txt');
  const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
  const createArchive = [
    'Add-Type -AssemblyName System.IO.Compression',
    `$stream = [System.IO.File]::Open(${quote(archive)}, [System.IO.FileMode]::Create)`,
    '$zip = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create)',
    `$entry = $zip.CreateEntry('../../escape.txt')`,
    '$writer = [System.IO.StreamWriter]::new($entry.Open())',
    "$writer.Write('unsafe')",
    '$writer.Dispose()',
    '$zip.Dispose()',
    '$stream.Dispose()',
  ].join('; ');
  try {
    execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', createArchive], { windowsHide: true });
    const manager = new ModManager({ installRoot: projectRoot, serverDir });
    await assert.rejects(() => manager.installFromArchive(fs.readFileSync(archive), path.basename(archive)), /unsafe path/);
    assert.equal(fs.existsSync(escaped), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
