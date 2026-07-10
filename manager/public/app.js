'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const AUTO_REFRESH_INTERVAL_MS = 2500;
const AUTO_REFRESH_STORAGE_KEY = 'palsphere:auto-refresh';
const TRANSITION_REFRESH_INTERVAL_MS = 2500;
const TRANSITION_REFRESH_MAX_ATTEMPTS = 48;
const TRANSITIONAL_SERVER_STATES = new Set(['starting', 'recovering', 'updating']);

function loadAutoRefreshPreference() {
  try {
    const stored = localStorage.getItem(AUTO_REFRESH_STORAGE_KEY);
    return stored === null ? false : stored === 'true';
  } catch {
    return false;
  }
}

const state = {
  page: 'dashboard',
  group: 'identity',
  search: '',
  status: null,
  bundle: null,
  baseline: null,
  backups: null,
  activity: null,
  managerSettings: null,
  busy: new Set(),
  lastServerState: null,
  autoRefresh: loadAutoRefreshPreference(),
  statusRefreshTimer: null,
  transitionRefreshTimer: null,
  transitionRefreshAttempts: 0,
  transitionRefreshExhausted: false,
};

const pageMeta = {
  dashboard: ['SERVER OVERVIEW', 'Dashboard'],
  settings: ['WORLD CONFIGURATION', 'Server settings'],
  backups: ['WORLD PROTECTION', 'Saves & backups'],
  activity: ['MAINTENANCE', 'Activity & tools'],
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || (options.body ? 'POST' : 'GET'),
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: 'no-store',
  });
  let payload = {};
  try { payload = await response.json(); } catch { /* no JSON */ }
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed with HTTP ${response.status}.`);
    error.payload = payload;
    throw error;
  }
  return payload;
}

function escapeText(value) {
  return String(value ?? '');
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isDirty() {
  if (!state.bundle || !state.baseline) return false;
  return Object.keys(state.bundle.values).some((key) => !sameValue(state.bundle.values[key], state.baseline[key]));
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** power)).toFixed(power ? 1 : 0)} ${units[power]}`;
}

function formatDate(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function relativeTime(value) {
  if (!value) return '';
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}

function timeUntil(value) {
  if (!value) return '';
  const seconds = Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 1000));
  return seconds <= 1 ? 'now' : `in ${seconds} sec`;
}

function toast(title, message = '', kind = 'success', duration = 4500) {
  const region = $('#toast-region');
  const item = document.createElement('div');
  item.className = `toast ${kind}`;
  const icon = document.createElement('div');
  icon.className = 'toast-icon';
  icon.textContent = kind === 'error' ? '!' : '✓';
  const copy = document.createElement('div');
  const strong = document.createElement('strong');
  strong.textContent = title;
  const span = document.createElement('span');
  span.textContent = message;
  copy.append(strong, span);
  const close = document.createElement('button');
  close.textContent = '×';
  close.addEventListener('click', () => item.remove());
  item.append(icon, copy, close);
  region.append(item);
  setTimeout(() => item.remove(), duration);
}

function confirmAction({ title, message, confirmText = 'Continue', danger = false, icon = '?' }) {
  return new Promise((resolve) => {
    const backdrop = $('#modal-backdrop');
    $('#modal-title').textContent = title;
    $('#modal-message').textContent = message;
    $('#modal-icon').textContent = icon;
    const confirmButton = $('#modal-confirm');
    confirmButton.textContent = confirmText;
    confirmButton.className = `button ${danger ? 'danger' : 'primary'}`;
    backdrop.hidden = false;

    const finish = (result) => {
      backdrop.hidden = true;
      confirmButton.removeEventListener('click', yes);
      $('#modal-cancel').removeEventListener('click', no);
      backdrop.removeEventListener('click', outside);
      resolve(result);
    };
    const yes = () => finish(true);
    const no = () => finish(false);
    const outside = (event) => { if (event.target === backdrop) finish(false); };
    confirmButton.addEventListener('click', yes);
    $('#modal-cancel').addEventListener('click', no);
    backdrop.addEventListener('click', outside);
  });
}

async function withBusy(key, work) {
  if (state.busy.has(key)) return;
  state.busy.add(key);
  updateActionStates();
  try {
    return await work();
  } catch (error) {
    toast('That did not work', error.message, 'error', 6500);
    throw error;
  } finally {
    state.busy.delete(key);
    updateActionStates();
  }
}

function setPage(page) {
  state.page = page;
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.page === page));
  $$('.page').forEach((panel) => panel.classList.toggle('active', panel.dataset.pagePanel === page));
  const [eyebrow, title] = pageMeta[page];
  $('#page-eyebrow').textContent = eyebrow;
  $('#page-title').textContent = title;
  if (page === 'backups') refreshBackups();
  if (page === 'activity') refreshActivity();
  window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
}

function updateActionStates() {
  if (!state.status) return;
  const running = state.status.running;
  const blocked = state.status.updating || state.busy.size > 0;
  $$('.running-only').forEach((element) => { element.hidden = !running; });
  $$('.stopped-only').forEach((element) => { element.hidden = running; });
  ['#start-server-top', '#start-server-hero'].forEach((selector) => { $(selector).disabled = blocked || running; });
  ['#stop-server-top', '#stop-server-hero', '#save-now-top'].forEach((selector) => { $(selector).disabled = blocked || !running || !state.status.restReady; });
  $('#force-stop').disabled = blocked || !running;
  $('#update-server').disabled = blocked || running;
  $('#create-backup').disabled = blocked || running;
  if ($('#save-watchdog')) $('#save-watchdog').disabled = state.busy.has('watchdog');
  if ($('#startup-enabled')) $('#startup-enabled').disabled = state.busy.has('startup');
  $('#settings-lock').hidden = !running && !state.status.updating;
  renderDirtyState();
}

function renderStatus() {
  const status = state.status;
  if (!status) return;
  const pill = $('#global-status');
  pill.className = `status-pill ${status.state}`;
  $('.status-label', pill).textContent = status.state;
  $('#server-name').textContent = status.serverName || 'Palworld Server';
  $('#server-description').textContent = status.description || 'A private Palworld world for friends.';
  $('#hero-kicker').textContent = status.state === 'online' ? 'World is live' : status.state === 'starting' ? 'World is waking up' : status.state === 'recovering' ? 'Automatic recovery in progress' : status.state === 'updating' ? 'Server update in progress' : 'Ready for adventure';
  $('#world-state-label').textContent = status.state.toUpperCase();
  $('#player-count').textContent = status.playerCount;
  $('#player-limit').textContent = status.playerLimit;
  $('#player-note').textContent = status.running ? (status.playerCount ? status.players.map((player) => player.name || player.playerId || 'Player').slice(0, 3).join(', ') : 'Waiting for friends') : 'Server is offline';
  $('#autosave-seconds').textContent = Number(status.autoSaveSeconds).toLocaleString();
  $('#autosave-note').textContent = status.latestLiveSaveAt ? `Last live save ${relativeTime(status.latestLiveSaveAt)}` : (status.rollingBackups ? 'Rolling backups enabled' : 'Rolling backups are off');
  $('#builtin-backup-count').textContent = status.builtInBackupCount;
  $('#latest-backup').textContent = status.latestBuiltInBackupAt ? `Latest ${relativeTime(status.latestBuiltInBackupAt)}` : 'No backup detected';
  $('#build-id').textContent = status.buildId;
  $('#server-version').textContent = status.serverVersion || 'Palworld 1.0 dedicated server';
  $('#manager-version').textContent = `Manager v${status.managerVersion}`;
  $('#settings-count').textContent = status.settingCount;
  $('#public-address').textContent = status.publicIp ? `${status.publicIp}:${status.port}` : 'Click to refresh public IP';
  $('#lan-address').textContent = `${status.lanIp}:${status.port}`;
  $('#save-layer-auto').textContent = `Every ${Number(status.autoSaveSeconds).toLocaleString()} sec`;
  $('#save-layer-built-in').textContent = status.rollingBackups ? 'On' : 'Off';
  $('#save-layer-manual').textContent = `${status.managerBackupCount} saved`;
  $('#save-layer-recovery').textContent = status.watchdog.enabled ? (status.watchdog.phase === 'locked' ? 'Paused' : 'Armed') : 'Off';
  $('#protection-badge').textContent = status.protectionHealthy ? 'Protected' : 'Needs attention';
  $('#protection-badge').className = `mini-badge ${status.protectionHealthy ? 'success' : ''}`;
  $('#check-build').textContent = `Build ${status.buildId}`;
  $('#check-autosave').textContent = `Every ${status.autoSaveSeconds} seconds`;
  $('#check-watchdog').textContent = status.watchdog.enabled ? `Checks every ${status.watchdog.pollIntervalSeconds} seconds` : 'Automatic recovery disabled';
  $('#check-watchdog-row').classList.toggle('done', status.watchdog.enabled && status.watchdog.phase !== 'locked');
  $('#check-autostart').textContent = status.autostartEnabled ? 'Quiet startup at Windows sign-in' : 'Disabled in recovery settings';
  $('#check-autostart-row').classList.toggle('done', status.autostartEnabled);
  $('#check-router').textContent = `UDP ${status.port} → ${status.lanIp}`;
  renderWatchdogStatus();
  renderStartupStatus();
  updateActionStates();
}

function renderStartupStatus() {
  if (!state.status || !$('#startup-enabled')) return;
  if (!state.busy.has('startup')) $('#startup-enabled').checked = Boolean(state.status.autostartEnabled);
  $('#startup-state').textContent = state.status.autostartEnabled ? 'Enabled' : 'Disabled';
  $('#startup-live-detail').textContent = state.status.autostartEnabled
    ? 'Starts the hidden manager at sign-in and restores a server that was expected online.'
    : 'PalSphere and the game server will remain off after Windows restarts.';
}

function renderWatchdogStatus() {
  const watchdog = state.status?.watchdog;
  if (!watchdog || !$('#watchdog-state-badge')) return;
  const labels = {
    monitoring: 'Monitoring', waiting: 'Restart scheduled', restarting: 'Restarting',
    starting: 'Arming', locked: 'Paused', disabled: 'Disabled', idle: 'Ready',
  };
  const badge = $('#watchdog-state-badge');
  badge.textContent = labels[watchdog.phase] || watchdog.phase;
  badge.className = `mini-badge ${watchdog.enabled && !['locked', 'disabled'].includes(watchdog.phase) ? 'success' : ''}`;
  let detail = watchdog.enabled ? 'Armed when the server is started' : 'Automatic recovery is disabled';
  if (watchdog.phase === 'monitoring') detail = `Monitoring every ${watchdog.pollIntervalSeconds} seconds`;
  if (watchdog.phase === 'waiting') detail = `Restarting ${timeUntil(watchdog.nextRestartAt)}`;
  if (watchdog.phase === 'restarting') detail = 'Starting Palworld now';
  if (watchdog.phase === 'locked') detail = watchdog.lastError || 'Restart limit reached; use Start server to reset it';
  $('#watchdog-live-detail').textContent = detail;
}

function renderWatchdogPolicy() {
  const settings = state.managerSettings?.watchdog;
  if (!settings) return;
  $('#watchdog-enabled').checked = settings.enabled;
  $('#watchdog-poll').value = settings.pollIntervalSeconds;
  $('#watchdog-delay').value = settings.restartDelaySeconds;
  $('#watchdog-attempts').value = settings.maxRestarts;
  $('#watchdog-window').value = settings.restartWindowMinutes;
  renderWatchdogStatus();
}

async function refreshStatus({ quiet = true } = {}) {
  try {
    const previous = state.status?.state;
    state.status = await api('/api/status');
    renderStatus();
    if (previous && previous !== state.status.state) {
      if (state.status.state === 'online') toast('Server is online', 'Your world is ready for players.');
      if (state.status.state === 'recovering') toast('Server crash detected', 'PalSphere scheduled an automatic restart.', 'error', 6500);
      if (state.status.state === 'offline' && previous !== 'updating') toast('Server is offline', 'The world is safely stopped.');
      refreshActivity();
      refreshBackups();
      renderSettings();
    }
    state.lastServerState = state.status.state;
  } catch (error) {
    if (!quiet) toast('Could not refresh status', error.message, 'error');
  }
  syncTransitionRefresh();
}

function clearTransitionRefresh({ resetAttempts = true } = {}) {
  if (state.transitionRefreshTimer) clearTimeout(state.transitionRefreshTimer);
  state.transitionRefreshTimer = null;
  if (resetAttempts) {
    state.transitionRefreshAttempts = 0;
    state.transitionRefreshExhausted = false;
  }
}

function syncTransitionRefresh() {
  const isTransitioning = TRANSITIONAL_SERVER_STATES.has(state.status?.state);
  if (state.autoRefresh || !isTransitioning) {
    clearTransitionRefresh();
    return;
  }
  if (state.transitionRefreshTimer) return;
  if (state.transitionRefreshAttempts >= TRANSITION_REFRESH_MAX_ATTEMPTS) {
    if (!state.transitionRefreshExhausted) {
      state.transitionRefreshExhausted = true;
      toast('Status checks paused', 'The server is taking longer than expected. Use Refresh to check it again.', 'error', 6500);
    }
    return;
  }
  state.transitionRefreshTimer = setTimeout(async () => {
    state.transitionRefreshTimer = null;
    state.transitionRefreshAttempts += 1;
    await refreshStatus();
  }, TRANSITION_REFRESH_INTERVAL_MS);
}

function setAutoRefresh(enabled, { persist = true, refreshNow = false } = {}) {
  state.autoRefresh = Boolean(enabled);
  $('#auto-refresh').checked = state.autoRefresh;
  if (state.statusRefreshTimer) {
    clearInterval(state.statusRefreshTimer);
    state.statusRefreshTimer = null;
  }
  if (state.autoRefresh) {
    clearTransitionRefresh();
    if (refreshNow) refreshStatus();
    state.statusRefreshTimer = setInterval(() => refreshStatus(), AUTO_REFRESH_INTERVAL_MS);
  } else {
    syncTransitionRefresh();
  }
  if (persist) {
    try { localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, String(state.autoRefresh)); } catch { /* preference storage unavailable */ }
  }
}

async function handleStatusRefresh() {
  const button = $('#refresh-status');
  if (button.disabled) return;
  clearTransitionRefresh();
  button.disabled = true;
  button.classList.add('is-refreshing');
  button.setAttribute('aria-busy', 'true');
  try {
    await refreshStatus({ quiet: false });
  } finally {
    button.disabled = false;
    button.classList.remove('is-refreshing');
    button.removeAttribute('aria-busy');
  }
}

function markSetting(key, value) {
  state.bundle.values[key] = value;
  renderDirtyState();
  const card = document.querySelector(`[data-setting-card="${CSS.escape(key)}"]`);
  if (card) card.classList.toggle('changed', !sameValue(value, state.baseline[key]));
}

function buildControl(field) {
  const wrapper = document.createElement('div');
  wrapper.className = 'setting-control';
  const disabled = Boolean(state.status?.running || state.status?.updating);
  const value = state.bundle.values[field.key];

  if (field.type === 'toggle') {
    const line = document.createElement('div');
    line.className = 'toggle-wrap';
    const label = document.createElement('span');
    label.className = 'toggle-label';
    label.textContent = value ? 'Enabled' : 'Disabled';
    const toggle = document.createElement('label');
    toggle.className = 'toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(value);
    input.disabled = disabled;
    const track = document.createElement('span');
    track.className = 'toggle-track';
    input.addEventListener('change', () => {
      label.textContent = input.checked ? 'Enabled' : 'Disabled';
      markSetting(field.key, input.checked);
    });
    toggle.append(input, track);
    line.append(label, toggle);
    wrapper.append(line);
    return wrapper;
  }

  if (field.type === 'select') {
    const select = document.createElement('select');
    select.className = 'setting-select';
    select.disabled = disabled;
    for (const optionValue of field.options) {
      const option = document.createElement('option');
      option.value = optionValue;
      option.textContent = optionValue.replace(/([a-z])([A-Z])/g, '$1 $2');
      option.selected = optionValue === value;
      select.append(option);
    }
    select.addEventListener('change', () => markSetting(field.key, select.value));
    wrapper.append(select);
    return wrapper;
  }

  if (field.type === 'multiselect') {
    const multi = document.createElement('div');
    multi.className = 'multi-select';
    for (const optionValue of field.options) {
      const option = document.createElement('label');
      option.className = 'multi-option';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = optionValue;
      input.checked = Array.isArray(value) && value.includes(optionValue);
      input.disabled = disabled;
      const text = document.createElement('span');
      text.textContent = optionValue;
      input.addEventListener('change', () => {
        const selected = [...multi.querySelectorAll('input:checked')].map((candidate) => candidate.value);
        markSetting(field.key, selected);
      });
      option.append(input, text);
      multi.append(option);
    }
    wrapper.append(multi);
    return wrapper;
  }

  const input = document.createElement('input');
  input.className = 'setting-input';
  input.disabled = disabled;
  input.value = field.type === 'stringlist' ? (Array.isArray(value) ? value.join(', ') : value || '') : value ?? '';
  if (field.type === 'number') {
    input.type = 'number';
    input.step = field.integer ? '1' : '0.1';
    if (field.min !== undefined) input.min = field.min;
    if (field.max !== undefined) input.max = field.max;
  } else if (field.type === 'password') input.type = 'password';
  else input.type = 'text';
  input.addEventListener('input', () => {
    let next = input.value;
    if (field.type === 'number') next = input.value === '' ? '' : Number(input.value);
    if (field.type === 'stringlist') next = input.value.split(',').map((part) => part.trim()).filter(Boolean);
    markSetting(field.key, next);
  });

  if (field.type === 'password') {
    const row = document.createElement('div');
    row.className = 'password-wrap';
    const reveal = document.createElement('button');
    reveal.type = 'button';
    reveal.className = 'reveal-button';
    reveal.textContent = '◉';
    reveal.title = 'Show or hide password';
    reveal.addEventListener('click', () => { input.type = input.type === 'password' ? 'text' : 'password'; });
    row.append(input, reveal);
    wrapper.append(row);
  } else wrapper.append(input);
  return wrapper;
}

function renderDirtyState() {
  if (!state.bundle || !state.status) return;
  const dirty = isDirty();
  const locked = state.status.running || state.status.updating;
  $('#dirty-badge').hidden = !dirty;
  $('#save-settings').disabled = locked || !dirty || state.busy.size > 0;
  $('#reset-settings').disabled = locked || !dirty || state.busy.size > 0;
}

function renderSettingsGroups() {
  if (!state.bundle) return;
  const container = $('#settings-groups');
  container.replaceChildren();
  for (const group of state.bundle.groups) {
    const count = state.bundle.schema.filter((field) => field.group === group.id).length;
    const button = document.createElement('button');
    button.className = `group-tab ${state.group === group.id ? 'active' : ''}`;
    button.dataset.group = group.id;
    button.textContent = group.label;
    const badge = document.createElement('span');
    badge.className = 'count';
    badge.textContent = count;
    button.append(badge);
    button.addEventListener('click', () => { state.group = group.id; state.search = ''; $('#settings-search').value = ''; renderSettings(); });
    container.append(button);
  }
}

function renderSettings() {
  if (!state.bundle) return;
  renderSettingsGroups();
  const activeGroup = state.bundle.groups.find((group) => group.id === state.group) || state.bundle.groups[0];
  const query = state.search.trim().toLowerCase();
  const fields = state.bundle.schema.filter((field) => {
    const matchesSearch = !query || `${field.label} ${field.key} ${field.description}`.toLowerCase().includes(query);
    return matchesSearch && (query || field.group === state.group);
  });
  $('#group-eyebrow').textContent = query ? 'SEARCH RESULTS' : 'SETTINGS CATEGORY';
  $('#group-title').textContent = query ? `Results for “${state.search}”` : activeGroup.label;
  $('#group-description').textContent = query ? 'Searching across every installed Palworld server option.' : activeGroup.description;
  $('#visible-settings-count').textContent = fields.length;
  $('#no-settings').hidden = fields.length > 0;
  const grid = $('#settings-grid');
  grid.replaceChildren();
  for (const field of fields) {
    const card = document.createElement('article');
    card.className = `setting-card ${!sameValue(state.bundle.values[field.key], state.baseline[field.key]) ? 'changed' : ''}`;
    card.dataset.settingCard = field.key;
    const info = document.createElement('div');
    info.className = 'setting-info';
    const key = document.createElement('code');
    key.className = 'setting-key';
    key.textContent = field.key;
    const label = document.createElement('strong');
    label.textContent = field.label;
    const description = document.createElement('p');
    description.textContent = field.description;
    info.append(key, label, description);
    card.append(info, buildControl(field));
    grid.append(card);
  }
  renderDirtyState();
}

async function loadSettings() {
  state.bundle = await api('/api/settings');
  state.baseline = deepClone(state.bundle.values);
  renderSettings();
}

async function saveSettings() {
  return withBusy('settings', async () => {
    const payload = await api('/api/settings', { method: 'POST', body: { values: state.bundle.values } });
    state.bundle = payload;
    state.baseline = deepClone(payload.values);
    renderSettings();
    await refreshStatus();
    toast('Settings saved', 'The next server launch will use your changes.');
  });
}

function applyPreset(name) {
  if (!name || state.status.running || state.status.updating) return;
  const patches = {
    casual: { ExpRate: 2, PalCaptureRate: 1.5, PalEggDefaultHatchingTime: 0.5, DeathPenalty: 'Item', PlayerStaminaDecreaceRate: 0.75, PalStaminaDecreaceRate: 0.75, WorkSpeedRate: 1.25 },
    survival: { ExpRate: 0.8, PalCaptureRate: 0.8, PlayerDamageRateDefense: 1.25, PalDamageRateDefense: 1.15, DeathPenalty: 'All', PlayerStomachDecreaceRate: 1.25, PalStomachDecreaceRate: 1.2, bEnableInvaderEnemy: true },
  };
  if (name === 'vanilla') {
    for (const field of state.bundle.schema) {
      if (!['identity', 'network'].includes(field.group)) state.bundle.values[field.key] = deepClone(state.bundle.defaults[field.key]);
    }
  } else Object.assign(state.bundle.values, patches[name]);
  renderSettings();
  toast('Preset applied', 'Review the highlighted changes, then save.');
}

async function handleStart() {
  if (isDirty()) {
    const shouldSave = await confirmAction({ title: 'Save changes and start?', message: 'PalSphere will save your edited settings first, then launch the server with the new configuration.', confirmText: 'Save & start', icon: '▶' });
    if (!shouldSave) return;
    await saveSettings();
  }
  await withBusy('start', async () => {
    await api('/api/server/start', { method: 'POST' });
    toast('Starting server', 'Palworld is loading the world. This can take about 20 seconds.');
    await refreshStatus();
  });
}

async function handleStop() {
  const confirmed = await confirmAction({ title: 'Save and stop the server?', message: 'PalSphere will request an immediate world save, notify connected players, and then shut down cleanly.', confirmText: 'Save & stop', danger: true, icon: '■' });
  if (!confirmed) return;
  await withBusy('stop', async () => {
    await api('/api/server/stop', { method: 'POST' });
    await refreshStatus();
    await refreshBackups();
    toast('Server stopped safely', 'The latest world progress was saved before shutdown.');
  });
}

async function handleSaveNow() {
  await withBusy('save', async () => {
    await api('/api/server/save', { method: 'POST' });
    toast('World saved', 'Palworld confirmed the save request.');
    setTimeout(refreshBackups, 1200);
  });
}

async function copyText(value, label) {
  if (!value) return;
  try { await navigator.clipboard.writeText(value); }
  catch {
    const area = document.createElement('textarea');
    area.value = value; document.body.append(area); area.select(); document.execCommand('copy'); area.remove();
  }
  toast(`${label} copied`, value);
}

function renderBackups() {
  if (!state.backups || !state.status) return;
  const manager = state.backups.manager;
  $('#backup-autosave').textContent = `${state.status.autoSaveSeconds} seconds`;
  $('#backup-stat-auto').textContent = `${state.status.autoSaveSeconds} sec`;
  $('#backup-stat-rolling').textContent = state.status.rollingBackups ? 'Enabled' : 'Disabled';
  $('#backup-stat-rolling-count').textContent = `${state.backups.builtIn.count} copies found`;
  $('#backup-stat-portable').textContent = manager.length;
  const body = $('#backup-table-body');
  body.replaceChildren();
  $('#backup-empty').hidden = manager.length > 0;
  for (const backup of manager) {
    const row = document.createElement('tr');
    const name = document.createElement('td'); name.textContent = backup.name;
    const created = document.createElement('td'); created.textContent = formatDate(backup.createdAt);
    const size = document.createElement('td'); size.textContent = formatBytes(backup.bytes);
    const action = document.createElement('td');
    const restore = document.createElement('button'); restore.className = 'button soft'; restore.textContent = 'Restore'; restore.disabled = state.status.running;
    restore.addEventListener('click', () => handleRestore(backup.name));
    action.append(restore); row.append(name, created, size, action); body.append(row);
  }
}

async function refreshBackups() {
  try { state.backups = await api('/api/backups'); renderBackups(); }
  catch (error) { if (state.page === 'backups') toast('Could not load backups', error.message, 'error'); }
}

async function handleBackup() {
  const confirmed = await confirmAction({ title: 'Create a portable backup?', message: 'PalSphere will copy the complete world save into its protected backup folder. The server must remain stopped.', confirmText: 'Create backup', icon: '◫' });
  if (!confirmed) return;
  await withBusy('backup', async () => {
    const result = await api('/api/backup', { method: 'POST' });
    await refreshBackups(); await refreshStatus();
    toast('Portable backup created', result.name);
  });
}

async function handleRestore(name) {
  const confirmed = await confirmAction({ title: 'Restore this world backup?', message: `The current live world will first receive a safety backup, then ${name} will replace it. The server must stay stopped.`, confirmText: 'Restore world', danger: true, icon: '↶' });
  if (!confirmed) return;
  await withBusy('restore', async () => {
    const result = await api('/api/restore', { method: 'POST', body: { name } });
    await refreshBackups();
    toast('World restored', `Safety copy: ${result.safetyBackup}`);
  });
}

function renderActivity() {
  if (!state.activity) return;
  const list = $('#activity-list');
  list.replaceChildren();
  const glyphs = { manager: '⌾', server: '▶', save: '↻', backup: '◫', restore: '↶', settings: '⌁', update: '↥', watchdog: 'R', error: '!', crash: '!' };
  for (const event of state.activity.events) {
    const item = document.createElement('div'); item.className = 'activity-item';
    const glyph = document.createElement('div'); glyph.className = 'activity-glyph'; glyph.textContent = glyphs[event.type] || '·';
    const copy = document.createElement('div');
    const strong = document.createElement('strong'); strong.textContent = event.message;
    const time = document.createElement('time'); time.textContent = relativeTime(event.at);
    copy.append(strong, time); item.append(glyph, copy); list.append(item);
  }
  if (!state.activity.events.length) list.textContent = 'No manager activity yet.';
  $('#update-log').textContent = state.activity.updateLog || 'No update has been run from PalSphere yet.';
  $('#update-state-badge').textContent = state.status?.updating ? 'Updating' : 'Idle';
  $('#update-state-badge').className = `mini-badge ${state.status?.updating ? 'success' : ''}`;
}

async function refreshActivity() {
  try { state.activity = await api('/api/activity'); renderActivity(); }
  catch (error) { if (state.page === 'activity') toast('Could not load activity', error.message, 'error'); }
}

async function handleUpdate() {
  const confirmed = await confirmAction({ title: 'Update and verify the server?', message: 'The server must stay offline. SteamCMD will download the newest build and verify all server files; world saves and live settings are preserved.', confirmText: 'Start update', icon: '↥' });
  if (!confirmed) return;
  await withBusy('update', async () => {
    const result = await api('/api/update', { method: 'POST' });
    await refreshStatus(); await refreshActivity();
    toast('Update started', result.safetyBackup ? `Safety backup created: ${result.safetyBackup}` : 'Track SteamCMD progress in the update output panel.');
  });
}

async function saveWatchdogSettings() {
  await withBusy('watchdog', async () => {
    const watchdog = {
      enabled: $('#watchdog-enabled').checked,
      pollIntervalSeconds: Number($('#watchdog-poll').value),
      restartDelaySeconds: Number($('#watchdog-delay').value),
      maxRestarts: Number($('#watchdog-attempts').value),
      restartWindowMinutes: Number($('#watchdog-window').value),
    };
    state.managerSettings = await api('/api/manager/settings', { method: 'POST', body: { watchdog } });
    renderWatchdogPolicy();
    await refreshStatus();
    await refreshActivity();
    toast('Recovery policy saved', watchdog.enabled ? 'Crash recovery is ready and will arm whenever the server starts.' : 'Automatic crash recovery is disabled.');
  });
}

async function handleStartupToggle() {
  const input = $('#startup-enabled');
  const requested = input.checked;
  try {
    await withBusy('startup', async () => {
      const result = await api('/api/manager/startup', { method: 'POST', body: { enabled: requested } });
      state.status.autostartEnabled = result.enabled;
      renderStatus();
      await refreshActivity();
      toast(result.enabled ? 'Windows startup enabled' : 'Windows startup disabled', result.enabled
        ? 'PalSphere will start quietly the next time this Windows user signs in.'
        : 'PalSphere will no longer start automatically with Windows.');
    });
  } catch {
    input.checked = !requested;
    renderStartupStatus();
  }
}

async function handleForceStop() {
  const confirmed = await confirmAction({ title: 'Force stop Palworld?', message: 'This bypasses the normal save and shutdown process. Use it only when Save & Stop has failed and the server is frozen.', confirmText: 'Force stop', danger: true, icon: '!' });
  if (!confirmed) return;
  await withBusy('force-stop', async () => {
    await api('/api/server/force-stop', { method: 'POST' });
    await refreshStatus();
    toast('Server force-stopped', 'Check your latest backup before the next launch.', 'error');
  });
}

function wireEvents() {
  $$('.nav-item').forEach((button) => button.addEventListener('click', () => setPage(button.dataset.page)));
  $$('[data-go-page]').forEach((button) => button.addEventListener('click', () => setPage(button.dataset.goPage)));
  ['#start-server-top', '#start-server-hero'].forEach((selector) => $(selector).addEventListener('click', handleStart));
  ['#stop-server-top', '#stop-server-hero'].forEach((selector) => $(selector).addEventListener('click', handleStop));
  $('#save-now-top').addEventListener('click', handleSaveNow);
  $('#save-settings').addEventListener('click', saveSettings);
  $('#reset-settings').addEventListener('click', () => { state.bundle.values = deepClone(state.baseline); renderSettings(); toast('Changes discarded'); });
  $('#settings-search').addEventListener('input', (event) => { state.search = event.target.value; renderSettings(); });
  $('#preset-picker').addEventListener('change', (event) => { applyPreset(event.target.value); event.target.value = ''; });
  $('#create-backup').addEventListener('click', handleBackup);
  $('#update-server').addEventListener('click', handleUpdate);
  $('#save-watchdog').addEventListener('click', saveWatchdogSettings);
  $('#startup-enabled').addEventListener('change', handleStartupToggle);
  $('#force-stop').addEventListener('click', handleForceStop);
  $('#refresh-status').addEventListener('click', handleStatusRefresh);
  $('#auto-refresh').addEventListener('change', (event) => setAutoRefresh(event.target.checked, { refreshNow: event.target.checked }));
  $('#refresh-activity').addEventListener('click', refreshActivity);
  $('#launch-palworld').addEventListener('click', () => api('/api/open-game', { method: 'POST' }).then(() => toast('Launching Palworld', 'Steam should open the game.')).catch((error) => toast('Could not launch game', error.message, 'error')));
  $('#copy-lan-address').addEventListener('click', () => copyText(`${state.status.lanIp}:${state.status.port}`, 'LAN address'));
  $('#copy-public-address').addEventListener('click', async () => {
    if (!state.status.publicIp) {
      await withBusy('network', async () => { await api('/api/network/refresh', { method: 'POST' }); await refreshStatus(); });
    }
    if (state.status.publicIp) copyText(`${state.status.publicIp}:${state.status.port}`, 'Public address');
    else toast('Public IP unavailable', 'Check your internet connection and try again.', 'error');
  });
  $$('[data-open-folder]').forEach((button) => button.addEventListener('click', () => api('/api/open', { method: 'POST', body: { target: button.dataset.openFolder } }).catch((error) => toast('Could not open folder', error.message, 'error'))));
  $('#close-manager').addEventListener('click', async () => {
    if (state.status?.running) { toast('Server is still running', 'Stop the server before closing PalSphere.', 'error'); return; }
    if (!(await confirmAction({ title: 'Close PalSphere Server Studio?', message: 'This closes the local manager service. Your server is already offline.', confirmText: 'Close studio', icon: '×' }))) return;
    await api('/api/manager/quit', { method: 'POST' });
    document.body.innerHTML = '<div class="loading-screen"><img src="/palsphere-logo.svg" class="loading-logo" alt=""><div class="loading-copy"><strong>PalSphere is closed</strong><span>You can close this tab and double-click the launcher whenever you need it.</span></div></div>';
  });
}

async function initialize() {
  wireEvents();
  try {
    [state.bundle, state.status, state.backups, state.activity, state.managerSettings] = await Promise.all([
      api('/api/settings'), api('/api/status'), api('/api/backups'), api('/api/activity'), api('/api/manager/settings'),
    ]);
    state.baseline = deepClone(state.bundle.values);
    renderStatus(); renderSettings(); renderBackups(); renderActivity(); renderWatchdogPolicy();
    if (!state.status.publicIp) api('/api/network/refresh', { method: 'POST' }).then(() => refreshStatus()).catch(() => {});
    $('#app').classList.remove('is-loading');
    $('#loading-screen').classList.add('done');
    setTimeout(() => $('#loading-screen').remove(), 500);
    setAutoRefresh(state.autoRefresh, { persist: false });
    setInterval(() => { if (state.page === 'activity') refreshActivity(); }, 5000);
  } catch (error) {
    $('.loading-copy strong').textContent = 'PalSphere could not connect';
    $('.loading-copy span').textContent = error.message;
    $('.loading-bar').hidden = true;
  }
}

document.addEventListener('DOMContentLoaded', initialize);
