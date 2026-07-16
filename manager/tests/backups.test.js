'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { findActiveWorld, listBuiltInBackups, restoreBuiltInWorldBackup } = require('../lib/backups');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'palsphere-backups-'));
  const savesPath = path.join(root, 'SaveGames');
  const settingsPath = path.join(root, 'GameUserSettings.ini');
  fs.mkdirSync(path.join(savesPath, '0'), { recursive: true });
  return { root, savesPath, settingsPath };
}

function makeWorld(savesPath, worldId, level = 'live world') {
  const worldPath = path.join(savesPath, '0', worldId);
  fs.mkdirSync(path.join(worldPath, 'Players'), { recursive: true });
  fs.writeFileSync(path.join(worldPath, 'Level.sav'), level);
  fs.writeFileSync(path.join(worldPath, 'LevelMeta.sav'), 'live meta');
  return worldPath;
}

function makeBuiltInBackup(worldPath, name, level = name, player = null) {
  const backupPath = path.join(worldPath, 'backup', 'world', name);
  fs.mkdirSync(backupPath, { recursive: true });
  fs.writeFileSync(path.join(backupPath, 'Level.sav'), level);
  fs.writeFileSync(path.join(backupPath, 'LevelMeta.sav'), `${level} meta`);
  if (player) {
    fs.mkdirSync(path.join(backupPath, 'Players'));
    fs.writeFileSync(path.join(backupPath, 'Players', 'PLAYER.sav'), player);
  }
  return backupPath;
}

test('built-in backup inventory only counts the configured active world', (t) => {
  const { root, savesPath, settingsPath } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const oldWorldId = 'A'.repeat(32);
  const activeWorldId = 'B'.repeat(32);
  const oldWorld = makeWorld(savesPath, oldWorldId);
  const activeWorld = makeWorld(savesPath, activeWorldId);
  makeBuiltInBackup(oldWorld, '2026.07.10-10.00.00');
  makeBuiltInBackup(activeWorld, '2026.07.16-09.00.00');
  makeBuiltInBackup(activeWorld, '2026.07.16-10.00.00', 'newer world', 'player data');
  const legacy = path.join(savesPath, '0', 'backup', 'world', '2026.07.09-10.00.00');
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'Level.sav'), 'legacy');
  fs.writeFileSync(settingsPath, `[Pal]\nDedicatedServerName=${activeWorldId}\n`);

  const result = listBuiltInBackups(savesPath, settingsPath);
  assert.equal(result.worldId, activeWorldId);
  assert.equal(result.count, 2);
  assert.deepEqual(result.backups.map((backup) => backup.name), ['2026.07.16-10.00.00', '2026.07.16-09.00.00']);
  assert.equal(result.backups[0].players, 1);
  assert.equal(result.latest, '2026.07.16-10.00.00');
});

test('active world discovery falls back to the newest valid live world', (t) => {
  const { root, savesPath, settingsPath } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const olderId = 'C'.repeat(32);
  const newerId = 'D'.repeat(32);
  const older = makeWorld(savesPath, olderId);
  const newer = makeWorld(savesPath, newerId);
  const oldTime = new Date('2026-07-10T12:00:00Z');
  const newTime = new Date('2026-07-11T12:00:00Z');
  fs.utimesSync(path.join(older, 'Level.sav'), oldTime, oldTime);
  fs.utimesSync(path.join(newer, 'Level.sav'), newTime, newTime);

  assert.equal(findActiveWorld(savesPath, settingsPath).id, newerId);
});

test('configured world remains authoritative during a temporary live-save file swap', (t) => {
  const { root, savesPath, settingsPath } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configuredId = '1'.repeat(32);
  const otherId = '2'.repeat(32);
  const configured = makeWorld(savesPath, configuredId);
  makeWorld(savesPath, otherId);
  makeBuiltInBackup(configured, '2026.07.16-07.00.00');
  fs.rmSync(path.join(configured, 'Level.sav'));
  fs.writeFileSync(settingsPath, `DedicatedServerName=${configuredId}\n`);

  const result = listBuiltInBackups(savesPath, settingsPath);
  assert.equal(result.worldId, configuredId);
  assert.equal(result.count, 1);
});

test('built-in restore replaces world and player data but preserves settings and backup history', (t) => {
  const { root, savesPath, settingsPath } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const worldId = 'E'.repeat(32);
  const world = makeWorld(savesPath, worldId, 'current world');
  fs.writeFileSync(path.join(world, 'Players', 'CURRENT.sav'), 'current player');
  fs.writeFileSync(path.join(world, 'WorldOption.sav'), 'current settings');
  const name = '2026.07.16-08.30.00';
  const backup = makeBuiltInBackup(world, name, 'restored world', 'restored player');
  fs.writeFileSync(settingsPath, `DedicatedServerName=${worldId}\n`);

  const result = restoreBuiltInWorldBackup(savesPath, settingsPath, name);
  assert.equal(result.worldId, worldId);
  assert.equal(fs.readFileSync(path.join(world, 'Level.sav'), 'utf8'), 'restored world');
  assert.equal(fs.readFileSync(path.join(world, 'LevelMeta.sav'), 'utf8'), 'restored world meta');
  assert.deepEqual(fs.readdirSync(path.join(world, 'Players')), ['PLAYER.sav']);
  assert.equal(fs.readFileSync(path.join(world, 'Players', 'PLAYER.sav'), 'utf8'), 'restored player');
  assert.equal(fs.readFileSync(path.join(world, 'WorldOption.sav'), 'utf8'), 'current settings');
  assert.ok(fs.existsSync(path.join(backup, 'Level.sav')));
});

test('built-in restore rejects names outside the active-world inventory', (t) => {
  const { root, savesPath, settingsPath } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const worldId = 'F'.repeat(32);
  const world = makeWorld(savesPath, worldId, 'untouched');
  fs.writeFileSync(settingsPath, `DedicatedServerName=${worldId}\n`);

  assert.throws(() => restoreBuiltInWorldBackup(savesPath, settingsPath, '..\\..\\other'), /name is invalid/);
  assert.equal(fs.readFileSync(path.join(world, 'Level.sav'), 'utf8'), 'untouched');
});
