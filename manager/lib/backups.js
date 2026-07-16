'use strict';

const fs = require('fs');
const path = require('path');

const WORLD_ID_PATTERN = /^[A-F0-9]{32}$/i;
const BUILT_IN_BACKUP_PATTERN = /^\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}$/;
const RESTORED_WORLD_ENTRIES = ['Level.sav', 'LevelMeta.sav', 'Players'];

function readConfiguredWorldId(gameUserSettingsPath) {
  if (!gameUserSettingsPath || !fs.existsSync(gameUserSettingsPath)) return null;
  const settings = fs.readFileSync(gameUserSettingsPath, 'utf8');
  const match = settings.match(/^DedicatedServerName=([^\r\n]+)$/m);
  const worldId = match?.[1]?.trim();
  return WORLD_ID_PATTERN.test(worldId || '') ? worldId : null;
}

function worldAt(savesPath, worldId, { requireLevel = true } = {}) {
  if (!WORLD_ID_PATTERN.test(worldId || '')) return null;
  const worldPath = path.join(savesPath, '0', worldId);
  const levelPath = path.join(worldPath, 'Level.sav');
  if (!fs.existsSync(worldPath) || !fs.statSync(worldPath).isDirectory()) return null;
  if (!fs.existsSync(levelPath)) {
    if (requireLevel) return null;
    return { id: worldId, path: worldPath, modifiedAt: fs.statSync(worldPath).mtimeMs };
  }
  return { id: worldId, path: worldPath, modifiedAt: fs.statSync(levelPath).mtimeMs };
}

function findActiveWorld(savesPath, gameUserSettingsPath) {
  let configured = null;
  try {
    configured = worldAt(savesPath, readConfiguredWorldId(gameUserSettingsPath), { requireLevel: false });
  } catch {
    // A live save can briefly swap files, but the configured world remains authoritative.
  }
  if (configured) return configured;

  const serverSavesPath = path.join(savesPath, '0');
  if (!fs.existsSync(serverSavesPath)) return null;
  const candidates = [];
  for (const entry of fs.readdirSync(serverSavesPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const candidate = worldAt(savesPath, entry.name);
      if (candidate) candidates.push(candidate);
    } catch {
      // Palworld can rotate save files while the manager is reading status.
    }
  }
  return candidates.sort((a, b) => b.modifiedAt - a.modifiedAt)[0] || null;
}

function createdAtFromBackupName(name) {
  const match = name.match(/^(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function directoryStats(directory) {
  let bytes = 0;
  let files = 0;
  let players = 0;
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        bytes += fs.statSync(full).size;
        files += 1;
        if (path.relative(directory, full).split(path.sep)[0].toLowerCase() === 'players') players += 1;
      }
    }
  };
  walk(directory);
  return { bytes, files, players };
}

function emptyBuiltInBackups() {
  return { worldId: null, count: 0, latest: null, latestAt: null, backups: [] };
}

function listBuiltInBackups(savesPath, gameUserSettingsPath) {
  const activeWorld = findActiveWorld(savesPath, gameUserSettingsPath);
  if (!activeWorld) return emptyBuiltInBackups();
  const backupRoot = path.join(activeWorld.path, 'backup', 'world');
  if (!fs.existsSync(backupRoot)) return { ...emptyBuiltInBackups(), worldId: activeWorld.id };

  const backups = [];
  let entries;
  try {
    entries = fs.readdirSync(backupRoot, { withFileTypes: true });
  } catch {
    return { ...emptyBuiltInBackups(), worldId: activeWorld.id };
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !BUILT_IN_BACKUP_PATTERN.test(entry.name)) continue;
    const full = path.join(backupRoot, entry.name);
    try {
      if (!fs.existsSync(path.join(full, 'Level.sav'))) continue;
      const stats = directoryStats(full);
      backups.push({
        name: entry.name,
        createdAt: createdAtFromBackupName(entry.name),
        bytes: stats.bytes,
        files: stats.files,
        players: stats.players,
        hasLevelMeta: fs.existsSync(path.join(full, 'LevelMeta.sav')),
      });
    } catch {
      // A rolling backup may disappear between readdir and stat as Palworld prunes it.
    }
  }
  backups.sort((a, b) => b.name.localeCompare(a.name));
  return {
    worldId: activeWorld.id,
    count: backups.length,
    latest: backups[0]?.name || null,
    latestAt: backups[0]?.createdAt || null,
    backups,
  };
}

function restoreBuiltInWorldBackup(savesPath, gameUserSettingsPath, name) {
  if (!BUILT_IN_BACKUP_PATTERN.test(name || '')) throw new Error('Built-in backup name is invalid.');
  const activeWorld = findActiveWorld(savesPath, gameUserSettingsPath);
  if (!activeWorld) throw new Error('The active Palworld world was not found.');
  const source = path.join(activeWorld.path, 'backup', 'world', name);
  if (!fs.existsSync(path.join(source, 'Level.sav'))) throw new Error('Built-in backup was not found or is incomplete.');

  const nonce = `${process.pid}-${Date.now()}`;
  const staged = path.join(activeWorld.path, `.palsphere-restore-${nonce}`);
  const previous = path.join(activeWorld.path, `.palsphere-previous-${nonce}`);
  const movedPrevious = [];
  const movedRestored = [];
  try {
    fs.cpSync(source, staged, { recursive: true, force: true });
    fs.mkdirSync(previous);
    for (const entry of RESTORED_WORLD_ENTRIES) {
      const live = path.join(activeWorld.path, entry);
      if (!fs.existsSync(live)) continue;
      fs.renameSync(live, path.join(previous, entry));
      movedPrevious.push(entry);
    }
    for (const entry of RESTORED_WORLD_ENTRIES) {
      const replacement = path.join(staged, entry);
      if (!fs.existsSync(replacement)) continue;
      fs.renameSync(replacement, path.join(activeWorld.path, entry));
      movedRestored.push(entry);
    }
    fs.rmSync(previous, { recursive: true, force: true });
  } catch (error) {
    for (const entry of movedRestored) fs.rmSync(path.join(activeWorld.path, entry), { recursive: true, force: true });
    for (const entry of movedPrevious) {
      const saved = path.join(previous, entry);
      if (fs.existsSync(saved)) fs.renameSync(saved, path.join(activeWorld.path, entry));
    }
    throw error;
  } finally {
    fs.rmSync(staged, { recursive: true, force: true });
    fs.rmSync(previous, { recursive: true, force: true });
  }

  return { worldId: activeWorld.id, restored: name };
}

module.exports = {
  BUILT_IN_BACKUP_PATTERN,
  findActiveWorld,
  listBuiltInBackups,
  restoreBuiltInWorldBackup,
};
