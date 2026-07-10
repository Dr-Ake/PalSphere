'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { buildConfig, coerceValue, parseConfig, splitTopLevel } = require('../lib/config');
const { buildSchema, makeLabel } = require('../lib/schema');

const root = path.resolve(__dirname, '..', '..');
const defaultText = fs.readFileSync(path.join(__dirname, 'fixtures', 'DefaultPalWorldSettings.ini'), 'utf8');
const liveText = defaultText
  .replace('ServerName="Default Palworld Server"', 'ServerName="PalSphere Test Server"')
  .replace('RESTAPIEnabled=False', 'RESTAPIEnabled=True');

test('parses every fixture setting exactly once', () => {
  const parsed = parseConfig(defaultText);
  assert.equal(parsed.entries.length, 14);
  assert.equal(new Set(parsed.entries.map((entry) => entry.key)).size, parsed.entries.length);
  assert.equal(parsed.values.PublicPort, 8211);
  assert.deepEqual(parsed.values.CrossplayPlatforms, ['Steam', 'Xbox', 'PS5', 'Mac']);
});

test('top-level parser does not split nested lists or quoted commas', () => {
  assert.deepEqual(splitTopLevel('One=1,List=(A,B,C),Name="Pal, Home"'), ['One=1', 'List=(A,B,C)', 'Name="Pal, Home"']);
});

test('schema exposes every live and default setting', () => {
  const defaults = parseConfig(defaultText);
  const live = parseConfig(liveText);
  const schema = buildSchema(defaults.entries, live.entries);
  assert.equal(schema.length, 14);
  assert.equal(schema.find((field) => field.key === 'AdminPassword').type, 'password');
  assert.equal(schema.find((field) => field.key === 'AutoSaveSpan').group, 'saves');
  assert.equal(schema.find((field) => field.key === 'CrossplayPlatforms').type, 'multiselect');
});

const installedDefaultPath = path.join(root, 'server', 'DefaultPalWorldSettings.ini');
test('validates the complete installed Palworld configuration when available', { skip: !fs.existsSync(installedDefaultPath) }, () => {
  const installed = parseConfig(fs.readFileSync(installedDefaultPath, 'utf8'));
  assert.ok(installed.entries.length >= 100);
  assert.equal(new Set(installed.entries.map((entry) => entry.key)).size, installed.entries.length);
  assert.equal(installed.values.PublicPort, 8211);
});

test('round-trips all settings and escaped string values', () => {
  const defaults = parseConfig(defaultText);
  const live = parseConfig(liveText);
  const schema = buildSchema(defaults.entries, live.entries);
  const values = Object.fromEntries(schema.map((field) => [field.key, field.currentValue]));
  values.ServerName = 'Ghaleon’s Pals, Friends & "Fun"';
  values.RESTAPIEnabled = true;
  values.DenyTechnologyList = ['PALBOX', 'RepairBench'];
  const output = buildConfig(values, schema, schema.map((field) => field.key));
  const parsed = parseConfig(output);
  assert.equal(parsed.entries.length, schema.length);
  assert.equal(parsed.values.ServerName, values.ServerName);
  assert.equal(parsed.values.RESTAPIEnabled, true);
  assert.deepEqual(parsed.values.DenyTechnologyList, values.DenyTechnologyList);
});

test('validates numeric bounds and friendly labels', () => {
  const field = { type: 'number', integer: true, min: 1, max: 65535, label: 'Public port' };
  assert.equal(coerceValue('8211', field), 8211);
  assert.throws(() => coerceValue('70000', field), /at most 65535/);
  assert.equal(makeLabel('bEnablePlayerToPlayerDamage'), 'Enable Player To Player Damage');
});
