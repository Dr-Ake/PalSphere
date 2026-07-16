'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const publicDir = path.resolve(__dirname, '..', 'public');

test('manager UI assets are present and use external scripts/styles', () => {
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  assert.match(html, /PalSphere Server Studio/);
  assert.match(html, /src="\/app\.js"/);
  assert.match(html, /href="\/styles\.css"/);
  assert.doesNotMatch(html, /<script[^>]*>\s*[^<]/);
  for (const asset of ['app.js', 'styles.css', 'palsphere-logo.svg']) {
    assert.ok(fs.statSync(path.join(publicDir, asset)).size > 100, `${asset} should not be empty`);
  }
});

test('every declared page has a matching navigation target', () => {
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const nav = [...html.matchAll(/data-page="([^"]+)"/g)].map((match) => match[1]);
  const panels = [...html.matchAll(/data-page-panel="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(new Set(nav), new Set(panels));
});

test('crash recovery controls and status surfaces are wired into the UI', () => {
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  for (const id of ['watchdog-state-badge', 'watchdog-enabled', 'watchdog-poll', 'watchdog-delay', 'watchdog-attempts', 'watchdog-window', 'save-watchdog', 'startup-enabled', 'startup-state']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(app, /\/api\/manager\/settings/);
  assert.match(app, /\/api\/manager\/startup/);
  assert.match(app, /saveWatchdogSettings/);
  assert.match(app, /status\.watchdog/);
});

test('status refresh can be manual or automatically repeated by preference', () => {
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  for (const id of ['refresh-status', 'auto-refresh']) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /id="auto-refresh"[^>]*checked/);
  assert.match(app, /handleStatusRefresh/);
  assert.match(app, /setAutoRefresh/);
  assert.match(app, /palsphere:auto-refresh/);
  assert.match(app, /TRANSITIONAL_SERVER_STATES/);
  assert.match(app, /syncTransitionRefresh/);
  assert.doesNotMatch(app, /setInterval\(\(\) => refreshStatus\(\), 2500\)/);
});

test('Palworld community listing toggle is wired to persistent manager settings', () => {
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  for (const id of ['community-listing-enabled', 'community-listing-state', 'community-listing-detail']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(app, /handleCommunityListingToggle/);
  assert.match(app, /publicLobby/);
  assert.match(app, /Direct IP only/);
});

test('join message editor displays a fixed PalSphere signature', () => {
  const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf8');
  assert.match(app, /field\.type === 'brandedtext'/);
  assert.match(app, /brand-suffix/);
  assert.match(styles, /\.branded-text-wrap/);
  assert.match(styles, /\.brand-suffix/);
});

test('settings actions remain sticky beneath the main header while scrolling', () => {
  const styles = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf8');
  assert.match(styles, /\.settings-toolbar\s*\{[^}]*position:\s*sticky/);
  assert.match(styles, /\.settings-toolbar\s*\{[^}]*top:\s*82px/);
  assert.match(styles, /\.settings-toolbar\s*\{[^}]*z-index:\s*19/);
});

test('native Palworld server mod management is wired into the UI', () => {
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  for (const id of ['mods-global-enabled', 'mods-installed-list', 'workshop-url-input', 'lookup-workshop-item', 'open-workshop-item', 'check-workshop-download', 'install-workshop-item', 'steam-mod-picker', 'import-steam-mod', 'mod-zip-file', 'choose-mod-zip']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(app, /\/api\/mods\/import-steam/);
  assert.match(app, /\/api\/mods\/upload/);
  assert.match(app, /\/api\/mods\/toggle/);
  assert.match(app, /\/api\/mods\/remove/);
  assert.match(app, /\/api\/mods\/workshop\/lookup/);
  assert.match(app, /\/api\/mods\/workshop\/open/);
  assert.match(app, /serverCompatible/);
  assert.match(app, /clientFilesIncluded/);
  assert.match(html, /You click Subscribe in Steam/);
  assert.match(app, /PalSphere cannot subscribe for your Steam account/);
  assert.match(app, /Steam is open/);
});

test('portable and active-world built-in backups have separate restore tabs', () => {
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  for (const id of ['backup-tab-portable', 'backup-tab-built-in', 'backup-panel-portable', 'backup-panel-built-in', 'built-in-backup-table-body', 'backup-active-world']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(app, /setBackupView/);
  assert.match(app, /handleBuiltInRestore/);
  assert.match(app, /\/api\/restore-built-in/);
  assert.match(html, /Only recovery points belonging to the currently configured world are shown and counted/);
});
