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
