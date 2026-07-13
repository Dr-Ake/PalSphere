'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const PALWORLD_WORKSHOP_APP_ID = '1623730';
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_EXPANDED_FILES = 20000;

function parseJsonFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(text);
}

function safePackageName(value) {
  const packageName = String(value || '').trim();
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(packageName)) {
    throw new Error('The mod Info.json has an invalid PackageName. Use only letters, numbers, dots, underscores, and hyphens.');
  }
  return packageName;
}

function parseWorkshopId(value) {
  const input = String(value || '').trim();
  if (/^\d{6,20}$/.test(input)) return input;
  let parsed;
  try { parsed = new URL(input); } catch { throw new Error('Enter a Steam Workshop item URL or numeric ID.'); }
  const host = parsed.hostname.toLowerCase();
  if (!['steamcommunity.com', 'www.steamcommunity.com'].includes(host) || parsed.pathname.toLowerCase() !== '/sharedfiles/filedetails/') {
    throw new Error('Enter a steamcommunity.com shared-file URL or numeric Workshop ID.');
  }
  const id = parsed.searchParams.get('id') || '';
  if (!/^\d{6,20}$/.test(id)) throw new Error('The Steam Workshop URL does not contain a valid item ID.');
  return id;
}

function normalizeDependencies(value) {
  if (!value) return [];
  const entries = Array.isArray(value) ? value : [value];
  return entries.map((entry) => {
    if (typeof entry === 'string' || typeof entry === 'number') return String(entry);
    if (!entry || typeof entry !== 'object') return null;
    return entry.PackageName || entry.ModName || entry.Name || entry.Title || entry.WorkshopId || entry.Id || null;
  }).filter(Boolean).map(String);
}

function packageWorkshopId(packageRoot) {
  const directoryName = path.basename(path.resolve(packageRoot));
  if (/^\d{6,20}$/.test(directoryName)) return directoryName;
  const metadataPath = path.join(packageRoot, '.workshop.json');
  if (!fs.existsSync(metadataPath)) return null;
  try {
    const metadata = parseJsonFile(metadataPath);
    const workshopId = String(metadata.publishedfileid || metadata.PublishedFileId || metadata.workshopId || '').trim();
    return /^\d{6,20}$/.test(workshopId) ? workshopId : null;
  } catch {
    return null;
  }
}

function normalizeModInfo(info, { directoryName = '', workshopId = null, active = false, deployed = false } = {}) {
  if (!info || typeof info !== 'object' || Array.isArray(info)) throw new Error('Info.json must contain a JSON object.');
  const packageName = safePackageName(info.PackageName);
  const rules = Array.isArray(info.InstallRule) ? info.InstallRule : (Array.isArray(info.InstallRules) ? info.InstallRules : []);
  const serverRules = rules.filter((rule) => rule && rule.IsServer === true);
  const installTypes = [...new Set(serverRules.map((rule) => String(rule.Type || 'Unknown')).filter(Boolean))];
  return {
    packageName,
    name: String(info.ModName || packageName),
    version: String(info.Version || 'Unknown'),
    author: String(info.Author || 'Unknown'),
    directoryName,
    workshopId,
    serverCompatible: serverRules.length > 0,
    clientFilesIncluded: rules.some((rule) => rule && rule.IsServer !== true),
    installTypes,
    dependencies: normalizeDependencies(info.Dependencies),
    active: Boolean(active),
    deployed: Boolean(deployed),
  };
}

function parseModSettings(text = '') {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  let inSection = false;
  let globalEnabled = false;
  const activePackages = [];
  for (const line of lines) {
    const section = line.trim().match(/^\[([^\]]+)\]$/);
    if (section) {
      inSection = section[1].toLowerCase() === 'palmodsettings';
      continue;
    }
    if (!inSection || /^\s*[#;]/.test(line)) continue;
    const match = line.match(/^\s*([^=]+?)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const key = match[1].toLowerCase();
    if (key === 'bglobalenablemod') globalEnabled = /^(true|1|yes)$/i.test(match[2]);
    if (key === 'activemodlist' && match[2]) activePackages.push(match[2]);
  }
  return { globalEnabled, activePackages: [...new Set(activePackages)] };
}

function updateModSettings(text, { globalEnabled, activePackages, workshopRootDir }) {
  const original = String(text || '').replace(/^\uFEFF/, '');
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  let lines = original ? original.split(/\r?\n/) : [];
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  let start = lines.findIndex((line) => /^\s*\[PalModSettings\]\s*$/i.test(line));
  if (start < 0) {
    if (lines.length) lines.push('');
    start = lines.length;
    lines.push('[PalModSettings]');
  }
  let end = lines.findIndex((line, index) => index > start && /^\s*\[[^\]]+\]\s*$/.test(line));
  if (end < 0) end = lines.length;
  const managedKeys = workshopRootDir === undefined ? 'bGlobalEnableMod|ActiveModList' : 'bGlobalEnableMod|ActiveModList|WorkshopRootDir';
  const managedPattern = new RegExp(`^\\s*(?:${managedKeys})\\s*=`, 'i');
  const preserved = lines.slice(start + 1, end).filter((line) => !managedPattern.test(line));
  const active = [...new Set((activePackages || []).map(safePackageName))].sort((a, b) => a.localeCompare(b));
  const managed = [`bGlobalEnableMod=${globalEnabled ? 'true' : 'false'}`, ...active.map((name) => `ActiveModList=${name}`)];
  if (workshopRootDir !== undefined) managed.push(`WorkshopRootDir=${path.resolve(String(workshopRootDir))}`);
  lines.splice(start + 1, end - start - 1, ...managed, ...preserved);
  return `${lines.join(newline)}${newline}`;
}

function directoryStats(directory) {
  let bytes = 0;
  let files = 0;
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Mod packages may not contain symbolic links.');
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        files += 1;
        bytes += fs.statSync(full).size;
        if (files > MAX_EXPANDED_FILES) throw new Error(`The mod contains more than ${MAX_EXPANDED_FILES.toLocaleString()} files.`);
        if (bytes > MAX_EXPANDED_BYTES) throw new Error('The expanded mod is larger than 2 GB.');
      }
    }
  };
  walk(directory);
  return { bytes, files };
}

function findInfoFile(directory, maxDepth = 4) {
  const found = [];
  const walk = (current, depth) => {
    if (depth > maxDepth) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Mod packages may not contain symbolic links.');
      const full = path.join(current, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === 'info.json') found.push(full);
      else if (entry.isDirectory() && entry.name !== '__MACOSX') walk(full, depth + 1);
    }
  };
  walk(directory, 0);
  if (!found.length) throw new Error('No Info.json was found. Choose a Palworld Workshop mod package.');
  if (found.length > 1) throw new Error('The archive contains multiple Info.json files. Import one mod at a time.');
  return found[0];
}

function atomicWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, content, 'utf8');
  fs.renameSync(temp, filePath);
}

function steamInstallRoots() {
  const roots = new Set();
  const add = (value) => {
    if (!value) return;
    const resolved = path.resolve(String(value).replace(/\//g, path.sep));
    if (fs.existsSync(resolved)) roots.add(resolved);
  };
  add(process.env.STEAM_PATH);
  add(path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam'));
  add(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Steam'));
  if (process.platform === 'win32') {
    try {
      const result = execFileSync('reg.exe', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8', windowsHide: true, timeout: 1500 });
      add(result.match(/SteamPath\s+REG_SZ\s+(.+)$/im)?.[1]?.trim());
    } catch { /* Steam is not registered for this user. */ }
  }
  for (const root of [...roots]) {
    const librariesPath = path.join(root, 'steamapps', 'libraryfolders.vdf');
    if (!fs.existsSync(librariesPath)) continue;
    const text = fs.readFileSync(librariesPath, 'utf8');
    for (const match of text.matchAll(/"path"\s+"([^"]+)"/g)) add(match[1].replace(/\\\\/g, '\\'));
  }
  return [...roots];
}

function sourceId(sourcePath) {
  return crypto.createHash('sha256').update(path.resolve(sourcePath).toLowerCase()).digest('hex').slice(0, 24);
}

class ModManager {
  constructor({ installRoot, serverDir, logEvent = () => {} }) {
    this.installRoot = installRoot;
    this.serverDir = serverDir;
    this.modsDir = path.join(serverDir, 'Mods');
    this.workshopDir = path.join(this.modsDir, 'Workshop');
    this.managedDir = path.join(this.modsDir, 'ManagedMods');
    this.settingsPath = path.join(this.modsDir, 'PalModSettings.ini');
    this.stagingDir = path.join(installRoot, 'manager', 'mod-staging');
    this.logEvent = logEvent;
    fs.mkdirSync(this.workshopDir, { recursive: true });
    fs.mkdirSync(this.stagingDir, { recursive: true });
  }

  readSettings() {
    return parseModSettings(fs.existsSync(this.settingsPath) ? fs.readFileSync(this.settingsPath, 'utf8') : '');
  }

  writeSettings(settings) {
    const current = fs.existsSync(this.settingsPath) ? fs.readFileSync(this.settingsPath, 'utf8') : '';
    atomicWrite(this.settingsPath, updateModSettings(current, { ...settings, workshopRootDir: this.workshopDir }));
  }

  installedInternal() {
    const settings = this.readSettings();
    const active = new Set(settings.activePackages);
    if (!fs.existsSync(this.workshopDir)) return [];
    return fs.readdirSync(this.workshopDir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith('.palsphere-')).flatMap((entry) => {
      const directory = path.join(this.workshopDir, entry.name);
      const infoPath = path.join(directory, 'Info.json');
      if (!fs.existsSync(infoPath)) return [];
      try {
        const rawInfo = parseJsonFile(infoPath);
        const rawPackageName = safePackageName(rawInfo.PackageName);
        const info = normalizeModInfo(rawInfo, {
          directoryName: entry.name,
          workshopId: packageWorkshopId(directory),
          active: active.has(rawPackageName),
          deployed: fs.existsSync(path.join(this.managedDir, rawPackageName, 'InstallManifest.json')),
        });
        return [{ ...info, _path: directory }];
      } catch (error) {
        return [{
          packageName: entry.name,
          name: entry.name,
          version: 'Unknown',
          author: 'Unknown',
          directoryName: entry.name,
          serverCompatible: false,
          clientFilesIncluded: false,
          installTypes: [],
          dependencies: [],
          active: false,
          deployed: false,
          invalid: true,
          error: error.message,
          _path: directory,
        }];
      }
    });
  }

  discoverSteamMods() {
    const workshopRoots = steamInstallRoots().map((root) => path.join(root, 'steamapps', 'workshop', 'content', PALWORLD_WORKSHOP_APP_ID));
    const sources = [];
    for (const workshopRoot of workshopRoots) {
      if (!fs.existsSync(workshopRoot)) continue;
      for (const entry of fs.readdirSync(workshopRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const directory = path.join(workshopRoot, entry.name);
        const infoPath = path.join(directory, 'Info.json');
        if (!fs.existsSync(infoPath)) continue;
        try {
          sources.push({ ...normalizeModInfo(parseJsonFile(infoPath), { directoryName: entry.name, workshopId: entry.name }), sourceId: sourceId(directory), _path: directory });
        } catch { /* Ignore malformed Workshop entries. */ }
      }
    }
    return sources;
  }

  list() {
    const settings = this.readSettings();
    const installedInternal = this.installedInternal();
    const installedByPackage = new Map(installedInternal.map((mod) => [mod.packageName, mod]));
    const available = this.discoverSteamMods().map((mod) => {
      const installed = installedByPackage.get(mod.packageName);
      return {
        ...mod,
        installed: Boolean(installed),
        updateAvailable: Boolean(installed && installed.version !== mod.version),
        installedVersion: installed?.version || null,
        _path: undefined,
      };
    });
    return {
      globalEnabled: settings.globalEnabled,
      activePackages: settings.activePackages,
      installed: installedInternal.map((mod) => ({ ...mod, _path: undefined })),
      available,
      workshopFolder: this.workshopDir,
    };
  }

  installFromDirectory(sourceDirectory) {
    const infoPath = findInfoFile(sourceDirectory);
    const packageRoot = path.dirname(infoPath);
    directoryStats(packageRoot);
    const rawInfo = parseJsonFile(infoPath);
    const workshopId = packageWorkshopId(packageRoot);
    const destinationName = workshopId || safePackageName(rawInfo.PackageName);
    const info = normalizeModInfo(rawInfo, { directoryName: destinationName, workshopId });
    if (!info.serverCompatible) throw new Error(`${info.name} does not declare dedicated-server support (no InstallRule with IsServer: true).`);
    const destination = path.join(this.workshopDir, destinationName);
    const existing = this.installedInternal().find((mod) => mod.packageName === info.packageName);
    if (fs.existsSync(destination) && (!existing || path.resolve(existing._path) !== path.resolve(destination))) {
      throw new Error(`A different package already occupies the ${destinationName} Workshop folder.`);
    }
    const temporary = path.join(this.workshopDir, `.palsphere-${info.packageName}-${Date.now()}`);
    const replaced = existing ? `${existing._path}.replaced-${Date.now()}` : null;
    fs.cpSync(packageRoot, temporary, { recursive: true, force: true, errorOnExist: false });
    try {
      if (existing) fs.renameSync(existing._path, replaced);
      if (fs.existsSync(destination) && (!existing || path.resolve(existing._path) !== path.resolve(destination))) fs.rmSync(destination, { recursive: true, force: true });
      fs.renameSync(temporary, destination);
      if (replaced) fs.rmSync(replaced, { recursive: true, force: true });
    } catch (error) {
      if (fs.existsSync(temporary)) fs.rmSync(temporary, { recursive: true, force: true });
      if (replaced && fs.existsSync(replaced) && !fs.existsSync(existing._path)) fs.renameSync(replaced, existing._path);
      throw error;
    }
    const settings = this.readSettings();
    const activePackages = existing ? settings.activePackages : [...new Set([...settings.activePackages, info.packageName])];
    this.writeSettings({ globalEnabled: existing ? settings.globalEnabled : true, activePackages });
    this.logEvent('mod', existing ? `Updated mod ${info.name} to ${info.version}.` : `Installed mod ${info.name} ${info.version}.`, { packageName: info.packageName, version: info.version });
    return { ...info, updated: Boolean(existing) };
  }

  installFromSteam(sourceKey) {
    const source = this.discoverSteamMods().find((candidate) => candidate.sourceId === sourceKey);
    if (!source) throw new Error('That Steam Workshop mod was not found. Refresh the Mods page and try again.');
    return this.installFromDirectory(source._path);
  }

  async installFromArchive(buffer, filename = 'mod.zip') {
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Choose a ZIP archive to import.');
    if (buffer.length > MAX_ARCHIVE_BYTES) throw new Error('The mod ZIP is larger than 512 MB.');
    if (path.extname(filename).toLowerCase() !== '.zip') throw new Error('PalSphere currently accepts ZIP mod packages.');
    const staging = fs.mkdtempSync(path.join(this.stagingDir, 'import-'));
    const archive = path.join(staging, 'mod.zip');
    const expanded = path.join(staging, 'expanded');
    fs.writeFileSync(archive, buffer);
    fs.mkdirSync(expanded);
    try {
      const expander = path.join(this.installRoot, 'scripts', 'Expand-PalSphereMod.ps1');
      if (!fs.existsSync(expander)) throw new Error('The PalSphere mod extraction helper is missing. Run Install PalSphere.bat to repair the installation.');
      await execFileAsync('powershell.exe', [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', expander,
        '-ArchivePath', archive,
        '-DestinationPath', expanded,
        '-MaximumExpandedBytes', String(MAX_EXPANDED_BYTES),
        '-MaximumFileCount', String(MAX_EXPANDED_FILES),
      ], { windowsHide: true, timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
      return this.installFromDirectory(expanded);
    } catch (error) {
      if (/Info\.json|dedicated-server|contains|larger|symbolic/i.test(error.message)) throw error;
      throw new Error(`The ZIP could not be extracted: ${error.message}`);
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }

  setGlobalEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Global mod state must be on or off.');
    const settings = this.readSettings();
    this.writeSettings({ ...settings, globalEnabled: enabled });
    this.logEvent('mod', enabled ? 'Enabled the Palworld mod system.' : 'Disabled all Palworld mods globally.', { enabled });
    return this.list();
  }

  setModEnabled(packageName, enabled) {
    const safeName = safePackageName(packageName);
    if (typeof enabled !== 'boolean') throw new Error('Mod state must be on or off.');
    const installed = this.installedInternal().find((mod) => mod.packageName === safeName);
    if (!installed) throw new Error('That installed mod was not found.');
    if (enabled && !installed.serverCompatible) throw new Error('This package does not declare dedicated-server support.');
    const settings = this.readSettings();
    const active = new Set(settings.activePackages);
    if (enabled) active.add(safeName); else active.delete(safeName);
    this.writeSettings({ globalEnabled: enabled ? true : settings.globalEnabled, activePackages: [...active] });
    this.logEvent('mod', `${enabled ? 'Enabled' : 'Disabled'} mod ${installed.name}.`, { packageName: safeName, enabled });
    return this.list();
  }

  remove(packageName) {
    const safeName = safePackageName(packageName);
    const installed = this.installedInternal().find((mod) => mod.packageName === safeName);
    if (!installed) throw new Error('That installed mod was not found.');
    const settings = this.readSettings();
    this.writeSettings({ ...settings, activePackages: settings.activePackages.filter((name) => name !== safeName) });
    fs.rmSync(installed._path, { recursive: true, force: true });
    this.logEvent('mod', `Removed mod ${installed.name}.`, { packageName: safeName, version: installed.version });
    return this.list();
  }
}

module.exports = {
  MAX_ARCHIVE_BYTES,
  ModManager,
  findInfoFile,
  normalizeModInfo,
  parseModSettings,
  parseWorkshopId,
  safePackageName,
  updateModSettings,
};
