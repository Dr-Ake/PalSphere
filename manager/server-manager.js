'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const { buildConfig, parseConfig } = require('./lib/config');
const { GROUPS, buildSchema } = require('./lib/schema');
const { CrashWatchdog, normalizeWatchdogSettings } = require('./lib/watchdog');

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(ROOT, 'server');
const PUBLIC_DIR = path.join(__dirname, 'public');
const CONFIG_PATH = path.join(SERVER_DIR, 'Pal', 'Saved', 'Config', 'WindowsServer', 'PalWorldSettings.ini');
const DEFAULT_CONFIG_PATH = path.join(SERVER_DIR, 'DefaultPalWorldSettings.ini');
const SAVES_PATH = path.join(SERVER_DIR, 'Pal', 'Saved', 'SaveGames');
const BACKUPS_PATH = path.join(__dirname, 'backups');
const CONFIG_HISTORY_PATH = path.join(__dirname, 'config-history');
const LOGS_PATH = path.join(__dirname, 'logs');
const ACTIVITY_PATH = path.join(LOGS_PATH, 'activity.jsonl');
const UPDATE_LOG_PATH = path.join(LOGS_PATH, 'update.log');
const MANAGER_SETTINGS_PATH = path.join(__dirname, 'manager-settings.json');
const SUPERVISOR_STATE_PATH = path.join(LOGS_PATH, 'supervisor-state.json');
const MANIFEST_PATH = path.join(SERVER_DIR, 'steamapps', 'appmanifest_2394010.acf');
const STEAMCMD_PATH = path.join(ROOT, '_steamcmd', 'steamcmd.exe');
const PALSERVER_PATH = path.join(SERVER_DIR, 'PalServer.exe');
const STARTUP_SCRIPT_PATH = path.join(ROOT, 'scripts', 'Register-PalSphereStartup.ps1');
const HOST = process.env.PAL_MANAGER_HOST || '127.0.0.1';
const PORT = Number(process.env.PAL_MANAGER_PORT || 8219);
const TEST_MODE = process.env.PAL_MANAGER_TEST_MODE === '1';
const MANAGER_VERSION = '1.2.1';
const AUTOSTART_TASK_NAME = 'PalSphere Server Studio';

for (const directory of [BACKUPS_PATH, CONFIG_HISTORY_PATH, LOGS_PATH]) {
  fs.mkdirSync(directory, { recursive: true });
}

let updateProcess = null;
let shuttingDown = false;
let publicIpCache = null;
let runtimeCache = { at: 0, data: null };
let autostartCache = { at: 0, enabled: false };
let watchdog = null;

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, filePath);
}

let managerSettings = {
  watchdog: normalizeWatchdogSettings(readJsonFile(MANAGER_SETTINGS_PATH, {}).watchdog),
};

function persistManagerSettings() {
  writeJsonFile(MANAGER_SETTINGS_PATH, managerSettings);
}

function persistDesiredRunning(desiredRunning) {
  writeJsonFile(SUPERVISOR_STATE_PATH, {
    desiredRunning: Boolean(desiredRunning),
    updatedAt: new Date().toISOString(),
  });
}

function timestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function logEvent(type, message, details = {}) {
  const event = { at: new Date().toISOString(), type, message, details };
  fs.appendFileSync(ACTIVITY_PATH, `${JSON.stringify(event)}\n`, 'utf8');
  return event;
}

function readConfigBundle() {
  const defaultParsed = parseConfig(fs.readFileSync(DEFAULT_CONFIG_PATH, 'utf8'));
  const liveParsed = parseConfig(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const schema = buildSchema(defaultParsed.entries, liveParsed.entries);
  const values = Object.fromEntries(schema.map((field) => [field.key, field.currentValue]));
  return {
    groups: GROUPS,
    schema,
    values,
    defaults: Object.fromEntries(schema.map((field) => [field.key, field.defaultValue])),
    order: schema.map((field) => field.key),
  };
}

function getBuildId() {
  try {
    const manifest = fs.readFileSync(MANIFEST_PATH, 'utf8');
    return manifest.match(/"buildid"\s+"(\d+)"/)?.[1] || 'Unknown';
  } catch {
    return 'Unknown';
  }
}

async function taskExists(imageName) {
  try {
    const { stdout } = await execFileAsync('tasklist.exe', ['/FI', `IMAGENAME eq ${imageName}`, '/FO', 'CSV', '/NH'], { windowsHide: true });
    return stdout.toLowerCase().includes(`"${imageName.toLowerCase()}"`);
  } catch {
    return false;
  }
}

async function isServerRunning() {
  return (await taskExists('PalServer.exe')) || (await taskExists('PalServer-Win64-Shipping-Cmd.exe'));
}

async function isUpdateRunning() {
  if (updateProcess && updateProcess.exitCode === null) return true;
  return taskExists('steamcmd.exe');
}

async function isAutostartEnabled() {
  if (Date.now() - autostartCache.at < 60000) return autostartCache.enabled;
  try {
    await execFileAsync('schtasks.exe', ['/Query', '/TN', AUTOSTART_TASK_NAME], { windowsHide: true });
    autostartCache = { at: Date.now(), enabled: true };
  } catch {
    autostartCache = { at: Date.now(), enabled: false };
  }
  return autostartCache.enabled;
}

async function setAutostartEnabled(enabled) {
  if (typeof enabled !== 'boolean') throw new Error('Windows startup must be enabled or disabled.');
  if (!fs.existsSync(STARTUP_SCRIPT_PATH)) throw new Error('PalSphere startup helper is missing. Run Install PalSphere.bat to repair the installation.');
  if (!TEST_MODE) {
    const args = [
      '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', STARTUP_SCRIPT_PATH,
      '-InstallRoot', ROOT,
      ...(enabled ? [] : ['-Remove']),
    ];
    await execFileAsync('powershell.exe', args, { windowsHide: true });
  }
  autostartCache = { at: Date.now(), enabled };
  logEvent('settings', enabled ? 'Windows startup enabled for PalSphere.' : 'Windows startup disabled for PalSphere.', { enabled });
  return enabled;
}

function getLanIp() {
  const candidates = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const entry of interfaces || []) {
      if (entry.family === 'IPv4' && !entry.internal) candidates.push(entry.address);
    }
  }
  return candidates.find((ip) => /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(ip)) || candidates[0] || '127.0.0.1';
}

function httpRequest(url, { method = 'GET', headers = {}, body, timeout = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const payload = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const requestHeaders = payload === null ? headers : { ...headers, 'Content-Length': Buffer.byteLength(payload) };
    const request = client.request(url, { method, headers: requestHeaders, timeout }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        const result = { status: response.statusCode, text: data, headers: response.headers };
        if (data) {
          try { result.json = JSON.parse(data); } catch { /* text response */ }
        }
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(result);
        else reject(Object.assign(new Error(`Request failed with HTTP ${response.statusCode}.`), { result }));
      });
    });
    request.on('timeout', () => request.destroy(new Error('Request timed out.')));
    request.on('error', reject);
    if (payload !== null) request.write(payload);
    request.end();
  });
}

function getRestContext() {
  const { values } = readConfigBundle();
  return {
    enabled: values.RESTAPIEnabled === true,
    port: Number(values.RESTAPIPort || 8212),
    password: String(values.AdminPassword || ''),
  };
}

async function palApi(endpoint, method = 'GET', body) {
  const context = getRestContext();
  if (!context.enabled) throw new Error('Palworld REST API is disabled in server settings.');
  if (!context.password) throw new Error('An admin password is required for safe manager controls.');
  const encoded = Buffer.from(`admin:${context.password}`, 'utf8').toString('base64');
  return httpRequest(`http://127.0.0.1:${context.port}/v1/api/${endpoint}`, {
    method,
    body,
    headers: {
      Authorization: `Basic ${encoded}`,
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    timeout: 5000,
  });
}

async function getPalRuntime() {
  if (Date.now() - runtimeCache.at < 2000) return runtimeCache.data;
  const running = await isServerRunning();
  if (!running) {
    runtimeCache = { at: Date.now(), data: { restReady: false, playerCount: 0, players: [] } };
    return runtimeCache.data;
  }
  try {
    const [info, players] = await Promise.all([palApi('info'), palApi('players')]);
    const playerList = players.json?.players || (Array.isArray(players.json) ? players.json : []);
    runtimeCache = {
      at: Date.now(),
      data: {
        restReady: true,
        playerCount: playerList.length,
        players: playerList,
        serverVersion: info.json?.version || null,
        worldGuid: info.json?.worldguid || null,
        runtimeServerName: info.json?.servername || null,
        runtimeDescription: info.json?.description || null,
      },
    };
  } catch (error) {
    runtimeCache = { at: Date.now(), data: { restReady: false, playerCount: 0, players: [], restError: error.message } };
  }
  return runtimeCache.data;
}

function countBuiltInBackups() {
  if (!fs.existsSync(SAVES_PATH)) return { count: 0, latest: null };
  const found = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'world' && full.toLowerCase().includes(`${path.sep}backup${path.sep}`)) {
          for (const backup of fs.readdirSync(full, { withFileTypes: true })) {
            if (backup.isDirectory()) {
              const backupPath = path.join(full, backup.name);
              found.push({ name: backup.name, full: backupPath, modifiedAt: fs.statSync(backupPath).mtime.toISOString() });
            }
          }
        } else walk(full);
      }
    }
  };
  walk(SAVES_PATH);
  found.sort((a, b) => b.name.localeCompare(a.name));
  return { count: found.length, latest: found[0]?.name || null, latestAt: found[0]?.modifiedAt || null };
}

function getLatestLiveSave() {
  if (!fs.existsSync(SAVES_PATH)) return null;
  let latest = 0;
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.toLowerCase() === 'backup') continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.sav')) latest = Math.max(latest, fs.statSync(full).mtimeMs);
    }
  };
  walk(SAVES_PATH);
  return latest ? new Date(latest).toISOString() : null;
}

function directorySize(directory) {
  if (!fs.existsSync(directory)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) total += directorySize(full);
    else total += fs.statSync(full).size;
  }
  return total;
}

function listManagerBackups() {
  if (!fs.existsSync(BACKUPS_PATH)) return [];
  return fs.readdirSync(BACKUPS_PATH, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^Palworld-/.test(entry.name))
    .map((entry) => {
      const full = path.join(BACKUPS_PATH, entry.name);
      const stat = fs.statSync(full);
      return { name: entry.name, createdAt: stat.birthtime.toISOString(), bytes: directorySize(full) };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

function createBackup(reason = 'manual') {
  if (!fs.existsSync(SAVES_PATH)) throw new Error('No Palworld saves exist yet.');
  const name = `Palworld-${timestamp()}`;
  const destination = path.join(BACKUPS_PATH, name, 'SaveGames');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(SAVES_PATH, destination, { recursive: true, force: true });
  fs.writeFileSync(path.join(BACKUPS_PATH, name, 'backup.json'), JSON.stringify({ name, reason, createdAt: new Date().toISOString() }, null, 2));
  const backups = listManagerBackups();
  for (const stale of backups.slice(12)) fs.rmSync(path.join(BACKUPS_PATH, stale.name), { recursive: true, force: true });
  logEvent('backup', `Created ${reason} backup.`, { name });
  return name;
}

function restoreBackup(name) {
  if (!/^Palworld-[A-Za-z0-9_.-]+$/.test(name)) throw new Error('Backup name is invalid.');
  const source = path.join(BACKUPS_PATH, name, 'SaveGames');
  if (!fs.existsSync(source)) throw new Error('Backup was not found.');
  const safety = createBackup('pre-restore');
  fs.rmSync(SAVES_PATH, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(SAVES_PATH), { recursive: true });
  fs.cpSync(source, SAVES_PATH, { recursive: true, force: true });
  logEvent('restore', `Restored backup ${name}.`, { name, safetyBackup: safety });
  return safety;
}

function readActivity(limit = 80) {
  if (!fs.existsSync(ACTIVITY_PATH)) return [];
  return fs.readFileSync(ACTIVITY_PATH, 'utf8').trim().split(/\r?\n/).filter(Boolean).slice(-limit).reverse().map((line) => {
    try { return JSON.parse(line); } catch { return { at: null, type: 'log', message: line, details: {} }; }
  });
}

function tailFile(filePath, maxChars = 12000) {
  if (!fs.existsSync(filePath)) return '';
  const text = fs.readFileSync(filePath, 'utf8');
  return text.slice(-maxChars);
}

async function buildStatus() {
  const { values, schema } = readConfigBundle();
  const [running, updating, autostartEnabled] = await Promise.all([isServerRunning(), isUpdateRunning(), isAutostartEnabled()]);
  const runtime = running ? await getPalRuntime() : { restReady: false, playerCount: 0, players: [] };
  const builtInBackups = countBuiltInBackups();
  const watchdogStatus = watchdog?.getStatus() || { ...managerSettings.watchdog, desiredRunning: false, phase: managerSettings.watchdog.enabled ? 'idle' : 'disabled' };
  const latestLiveSaveAt = getLatestLiveSave();
  const liveSaveAgeSeconds = latestLiveSaveAt ? Math.max(0, Math.round((Date.now() - new Date(latestLiveSaveAt).getTime()) / 1000)) : null;
  const staleSaveThreshold = Math.max(120, Number(values.AutoSaveSpan || 30) * 2.5);
  const protectionWarnings = [];
  if (!values.bIsUseBackupSaveData) protectionWarnings.push('Palworld rolling backups are disabled.');
  if (!watchdogStatus.enabled) protectionWarnings.push('Automatic crash recovery is disabled.');
  if (running && liveSaveAgeSeconds !== null && liveSaveAgeSeconds > staleSaveThreshold) protectionWarnings.push('The live world save appears older than its configured autosave interval.');
  const recoveryPending = !running && ['waiting', 'restarting'].includes(watchdogStatus.phase);
  return {
    managerVersion: MANAGER_VERSION,
    state: updating ? 'updating' : running ? (runtime.restReady ? 'online' : 'starting') : recoveryPending ? 'recovering' : 'offline',
    running,
    updating,
    restReady: runtime.restReady,
    restError: runtime.restError || null,
    playerCount: runtime.playerCount || 0,
    players: runtime.players || [],
    serverVersion: runtime.serverVersion || null,
    worldGuid: runtime.worldGuid || null,
    runtimeServerName: runtime.runtimeServerName || null,
    runtimeDescription: runtime.runtimeDescription || null,
    buildId: getBuildId(),
    serverName: values.ServerName,
    description: values.ServerDescription,
    playerLimit: values.ServerPlayerMaxNum,
    autoSaveSeconds: values.AutoSaveSpan,
    rollingBackups: values.bIsUseBackupSaveData,
    joinPassword: values.ServerPassword,
    lanIp: getLanIp(),
    publicIp: publicIpCache,
    port: Number(values.PublicPort || 8211),
    builtInBackupCount: builtInBackups.count,
    latestBuiltInBackup: builtInBackups.latest,
    latestBuiltInBackupAt: builtInBackups.latestAt,
    latestLiveSaveAt,
    liveSaveAgeSeconds,
    managerBackupCount: listManagerBackups().length,
    settingCount: schema.length,
    controlsReady: values.RESTAPIEnabled && Boolean(values.AdminPassword),
    watchdog: watchdogStatus,
    protectionWarnings,
    protectionHealthy: protectionWarnings.length === 0,
    autostartEnabled,
  };
}

async function waitFor(condition, timeoutMs, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

async function assertServerCanStart() {
  if (TEST_MODE) throw new Error('Process control is disabled in test mode.');
  if (await isUpdateRunning()) throw new Error('Wait for the server update to finish.');
  if (await isServerRunning()) throw new Error('The Palworld server is already running.');
  const { values } = readConfigBundle();
  if (!values.RESTAPIEnabled || !values.AdminPassword) {
    throw new Error('Turn on REST API and set an admin password before using managed start/stop controls.');
  }
  return values;
}

async function launchServer(source = 'manual') {
  const values = await assertServerCanStart();
  const args = [
    `-port=${Number(values.PublicPort || 8211)}`,
    `-players=${Number(values.ServerPlayerMaxNum || 32)}`,
    `-logformat=${values.LogFormatType || 'Text'}`,
  ];
  const child = spawn(PALSERVER_PATH, args, {
    cwd: SERVER_DIR,
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  });
  child.unref();
  logEvent('server', source === 'watchdog' ? 'Crash watchdog requested a server start.' : 'Server start requested.', { pid: child.pid, args, source });
  runtimeCache.at = 0;
  const started = await waitFor(isServerRunning, 15000);
  if (!started) throw new Error('Palworld did not start within 15 seconds.');
  return { pid: child.pid };
}

async function startServer() {
  await assertServerCanStart();
  watchdog.manualStartRequested();
  try {
    const result = await launchServer('manual');
    watchdog.noteStartSucceeded();
    return result;
  } catch (error) {
    watchdog.noteStartFailed(error);
    throw error;
  }
}

async function saveServer() {
  if (!(await isServerRunning())) throw new Error('The server is not running.');
  await palApi('save', 'POST');
  logEvent('save', 'World save requested through Palworld REST API.');
}

async function stopServer() {
  if (TEST_MODE) throw new Error('Process control is disabled in test mode.');
  watchdog.intentionalStopRequested('Save & Stop');
  if (!(await isServerRunning())) {
    watchdog.noteServerStopped();
    return { alreadyStopped: true };
  }
  await saveServer();
  await palApi('shutdown', 'POST', { waittime: 2, message: 'Server Manager is safely shutting down the server.' });
  logEvent('server', 'Graceful shutdown requested.');
  const stopped = await waitFor(async () => !(await isServerRunning()), 30000, 1000);
  runtimeCache.at = 0;
  if (!stopped) throw Object.assign(new Error('Graceful shutdown timed out. Use Force Stop only if the server remains stuck.'), { requiresForce: true });
  watchdog.noteServerStopped();
  return { stopped: true };
}

async function forceStopServer() {
  if (TEST_MODE) throw new Error('Process control is disabled in test mode.');
  watchdog.intentionalStopRequested('force stop');
  for (const image of ['PalServer-Win64-Shipping-Cmd.exe', 'PalServer.exe']) {
    try { await execFileAsync('taskkill.exe', ['/IM', image, '/T', '/F'], { windowsHide: true }); } catch { /* already stopped */ }
  }
  logEvent('server', 'Server was force-stopped.');
  runtimeCache.at = 0;
  watchdog.noteServerStopped();
}

const initialSupervisorState = readJsonFile(SUPERVISOR_STATE_PATH, { desiredRunning: false });
watchdog = new CrashWatchdog({
  settings: managerSettings.watchdog,
  desiredRunning: initialSupervisorState.desiredRunning === true,
  isRunning: isServerRunning,
  isUpdating: isUpdateRunning,
  restart: () => launchServer('watchdog'),
  log: logEvent,
  persistDesired: persistDesiredRunning,
});

function saveSettings(requestValues) {
  const bundle = readConfigBundle();
  const values = { ...bundle.values, ...requestValues };
  const content = buildConfig(values, bundle.schema, bundle.order);
  const historyName = `PalWorldSettings-${timestamp()}.ini`;
  fs.copyFileSync(CONFIG_PATH, path.join(CONFIG_HISTORY_PATH, historyName));
  const temp = `${CONFIG_PATH}.manager.tmp`;
  fs.writeFileSync(temp, content, 'utf8');
  parseConfig(fs.readFileSync(temp, 'utf8'));
  fs.renameSync(temp, CONFIG_PATH);
  logEvent('settings', 'Server settings saved.', { historyName });
  return readConfigBundle();
}

function saveManagerControlSettings(requestValues) {
  managerSettings = {
    ...managerSettings,
    watchdog: normalizeWatchdogSettings(requestValues.watchdog || managerSettings.watchdog),
  };
  persistManagerSettings();
  watchdog.updateSettings(managerSettings.watchdog);
  logEvent('settings', 'PalSphere recovery settings saved.', { watchdog: managerSettings.watchdog });
  return managerSettings;
}

async function updateServer() {
  if (TEST_MODE) throw new Error('Updates are disabled in test mode.');
  if (await isServerRunning()) throw new Error('Stop the server before updating.');
  if (await isUpdateRunning()) throw new Error('An update is already running.');
  watchdog.intentionalStopRequested('server update');
  let safetyBackup = null;
  if (getLatestLiveSave()) safetyBackup = createBackup('pre-update');
  fs.writeFileSync(UPDATE_LOG_PATH, `Palworld update started ${new Date().toISOString()}\n`, 'utf8');
  const stdout = fs.openSync(UPDATE_LOG_PATH, 'a');
  const stderr = fs.openSync(UPDATE_LOG_PATH, 'a');
  updateProcess = spawn(STEAMCMD_PATH, [
    '+force_install_dir', SERVER_DIR,
    '+login', 'anonymous',
    '+app_update', '2394010', 'validate',
    '+quit',
  ], { cwd: path.dirname(STEAMCMD_PATH), windowsHide: true, detached: false, stdio: ['ignore', stdout, stderr] });
  fs.closeSync(stdout);
  fs.closeSync(stderr);
  logEvent('update', 'Server update and validation started.', { pid: updateProcess.pid, safetyBackup });
  updateProcess.on('exit', (code) => {
    fs.appendFileSync(UPDATE_LOG_PATH, `\nSteamCMD exited with code ${code} at ${new Date().toISOString()}\n`);
    logEvent(code === 0 ? 'update' : 'error', code === 0 ? 'Server update completed.' : `Server update failed with code ${code}.`, { code });
  });
  return { pid: updateProcess.pid, safetyBackup };
}

async function refreshPublicIp() {
  try {
    const result = await httpRequest('https://api.ipify.org?format=json', { timeout: 8000 });
    publicIpCache = result.json?.ip || null;
  } catch {
    publicIpCache = null;
  }
  return publicIpCache;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

function readJsonBody(request, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > maxBytes) request.destroy(new Error('Request body is too large.'));
    });
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Request body must be valid JSON.')); }
    });
    request.on('error', reject);
  });
}

function serveStatic(requestPath, response) {
  const relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
  const resolved = path.resolve(PUBLIC_DIR, relative);
  if (!resolved.startsWith(`${PUBLIC_DIR}${path.sep}`) && resolved !== path.join(PUBLIC_DIR, 'index.html')) {
    sendJson(response, 403, { error: 'Forbidden.' });
    return;
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    sendJson(response, 404, { error: 'Not found.' });
    return;
  }
  const body = fs.readFileSync(resolved);
  response.writeHead(200, {
    'Content-Type': MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'no-cache',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
  response.end(body);
}

async function handleApi(request, response, pathname) {
  if (request.method === 'GET' && pathname === '/api/health') {
    return sendJson(response, 200, { ok: true, version: MANAGER_VERSION, installRoot: ROOT });
  }
  if (request.method === 'GET' && pathname === '/api/status') return sendJson(response, 200, await buildStatus());
  if (request.method === 'GET' && pathname === '/api/settings') return sendJson(response, 200, readConfigBundle());
  if (request.method === 'GET' && pathname === '/api/manager/settings') return sendJson(response, 200, managerSettings);
  if (request.method === 'GET' && pathname === '/api/backups') return sendJson(response, 200, { manager: listManagerBackups(), builtIn: countBuiltInBackups() });
  if (request.method === 'GET' && pathname === '/api/activity') return sendJson(response, 200, { events: readActivity(), updateLog: tailFile(UPDATE_LOG_PATH) });

  if (request.method === 'POST' && pathname === '/api/settings') {
    if (await isServerRunning()) return sendJson(response, 409, { error: 'Stop the server before changing settings.' });
    if (await isUpdateRunning()) return sendJson(response, 409, { error: 'Wait for the update to finish before changing settings.' });
    const body = await readJsonBody(request);
    return sendJson(response, 200, saveSettings(body.values || {}));
  }
  if (request.method === 'POST' && pathname === '/api/manager/settings') {
    const body = await readJsonBody(request);
    return sendJson(response, 200, saveManagerControlSettings(body));
  }
  if (request.method === 'POST' && pathname === '/api/manager/startup') {
    const body = await readJsonBody(request);
    return sendJson(response, 200, { ok: true, enabled: await setAutostartEnabled(body.enabled) });
  }
  if (request.method === 'POST' && pathname === '/api/server/start') return sendJson(response, 202, { ok: true, ...(await startServer()) });
  if (request.method === 'POST' && pathname === '/api/server/save') { await saveServer(); return sendJson(response, 200, { ok: true }); }
  if (request.method === 'POST' && pathname === '/api/server/stop') return sendJson(response, 200, { ok: true, ...(await stopServer()) });
  if (request.method === 'POST' && pathname === '/api/server/force-stop') { await forceStopServer(); return sendJson(response, 200, { ok: true }); }
  if (request.method === 'POST' && pathname === '/api/update') return sendJson(response, 202, { ok: true, ...(await updateServer()) });
  if (request.method === 'POST' && pathname === '/api/network/refresh') return sendJson(response, 200, { publicIp: await refreshPublicIp() });
  if (request.method === 'POST' && pathname === '/api/backup') {
    if (await isServerRunning()) return sendJson(response, 409, { error: 'Stop the server before creating a portable backup. Palworld rolling backups continue while online.' });
    return sendJson(response, 201, { ok: true, name: createBackup('manual') });
  }
  if (request.method === 'POST' && pathname === '/api/restore') {
    if (await isServerRunning()) return sendJson(response, 409, { error: 'Stop the server before restoring a backup.' });
    const body = await readJsonBody(request);
    return sendJson(response, 200, { ok: true, safetyBackup: restoreBackup(body.name) });
  }
  if (request.method === 'POST' && pathname === '/api/open') {
    const body = await readJsonBody(request);
    const choices = { server: SERVER_DIR, saves: SAVES_PATH, backups: BACKUPS_PATH, config: path.dirname(CONFIG_PATH) };
    if (!choices[body.target]) return sendJson(response, 400, { error: 'Folder target is invalid.' });
    if (!TEST_MODE) spawn('explorer.exe', [choices[body.target]], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
    return sendJson(response, 200, { ok: true });
  }
  if (request.method === 'POST' && pathname === '/api/open-game') {
    if (!TEST_MODE) spawn('cmd.exe', ['/d', '/s', '/c', 'start', '""', '"steam://run/1623730"'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return sendJson(response, 200, { ok: true });
  }
  if (request.method === 'POST' && pathname === '/api/manager/quit') {
    if (await isServerRunning()) return sendJson(response, 409, { error: 'Stop the Palworld server before closing its crash watchdog.' });
    if (await isUpdateRunning()) return sendJson(response, 409, { error: 'Wait for the server update to finish before closing PalSphere.' });
    sendJson(response, 200, { ok: true });
    shuttingDown = true;
    watchdog.intentionalStopRequested('PalSphere closed while the server was offline');
    watchdog.stop();
    setTimeout(() => server.close(() => process.exit(0)), 100);
    return;
  }
  return sendJson(response, 404, { error: 'API endpoint not found.' });
}

const server = http.createServer(async (request, response) => {
  const remote = request.socket.remoteAddress;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return sendJson(response, 403, { error: 'Local access only.' });
  try {
    const url = new URL(request.url, `http://${HOST}:${PORT}`);
    if (url.pathname.startsWith('/api/')) await handleApi(request, response, url.pathname);
    else serveStatic(decodeURIComponent(url.pathname), response);
  } catch (error) {
    logEvent('error', error.message, { stack: error.stack });
    if (!response.headersSent) sendJson(response, error.requiresForce ? 409 : 500, { error: error.message, requiresForce: Boolean(error.requiresForce) });
    else response.end();
  }
});

function startManager() {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, HOST, async () => {
      server.removeListener('error', reject);
      logEvent('manager', `Palworld Server Manager ${MANAGER_VERSION} started.`, { host: HOST, port: PORT, testMode: TEST_MODE });
      refreshPublicIp();
      try {
        await watchdog.start();
        resolve(server);
      } catch (error) {
        server.close();
        reject(error);
      }
    });
  });
}

function stopManager(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  watchdog.stop();
  logEvent('manager', `PalSphere received ${signal} and stopped its watchdog.`);
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => stopManager('SIGINT'));
process.on('SIGTERM', () => stopManager('SIGTERM'));

process.on('uncaughtException', (error) => {
  try { logEvent('crash', error.message, { stack: error.stack }); } catch { /* ignore */ }
  if (!shuttingDown) process.exitCode = 1;
});
process.on('unhandledRejection', (error) => {
  try { logEvent('crash', error?.message || String(error), { stack: error?.stack }); } catch { /* ignore */ }
});

if (require.main === module) {
  startManager().catch((error) => {
    if (error.code !== 'EADDRINUSE') logEvent('crash', `Manager failed to start: ${error.message}`, { stack: error.stack });
    process.exit(error.code === 'EADDRINUSE' ? 0 : 1);
  });
}

module.exports = {
  BACKUPS_PATH,
  CONFIG_PATH,
  ROOT,
  buildStatus,
  createBackup,
  isServerRunning,
  listManagerBackups,
  readConfigBundle,
  restoreBackup,
  saveSettings,
  startManager,
};
