'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildLaunchArguments } = require('../lib/launch');

const values = { PublicPort: 9010, ServerPlayerMaxNum: 24, LogFormatType: 'Json' };

test('dedicated server launch stays off the community list by default', () => {
  const args = buildLaunchArguments(values);
  assert.deepEqual(args, ['-port=9010', '-players=24', '-logformat=Json']);
  assert.ok(!args.includes('-publiclobby'));
});

test('community listing adds only Palworld official public lobby flag', () => {
  const args = buildLaunchArguments(values, { publicLobby: true });
  assert.deepEqual(args, ['-port=9010', '-players=24', '-logformat=Json', '-publiclobby']);
  assert.ok(!args.some((arg) => arg.startsWith('-publicip=')));
});
