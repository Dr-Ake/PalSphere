'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildConfig, parseConfig } = require('../manager/lib/config');
const { buildSchema } = require('../manager/lib/schema');

const root = path.resolve(__dirname, '..');
const defaultPath = path.join(root, 'server', 'DefaultPalWorldSettings.ini');
const configPath = path.join(root, 'server', 'Pal', 'Saved', 'Config', 'WindowsServer', 'PalWorldSettings.ini');
const privateInfoPath = path.join(root, 'PalSphere Server Info - Private.txt');

if (!fs.existsSync(defaultPath)) throw new Error(`Palworld default configuration is missing: ${defaultPath}`);
if (fs.existsSync(configPath) && process.env.PALSPHERE_FORCE_CONFIG !== '1') {
  process.stdout.write('Existing Palworld configuration preserved.\n');
  process.exit(0);
}

const serverName = String(process.env.PALSPHERE_SERVER_NAME || 'PalSphere Palworld Server').trim();
const serverPassword = String(process.env.PALSPHERE_SERVER_PASSWORD || '').trim();
const adminPassword = String(process.env.PALSPHERE_ADMIN_PASSWORD || '').trim();
if (!serverName) throw new Error('A server name is required.');
if (!serverPassword) throw new Error('A server password is required.');
if (adminPassword.length < 20) throw new Error('The generated administrator password is unexpectedly short.');

const defaultText = fs.readFileSync(defaultPath, 'utf8');
const parsed = parseConfig(defaultText);
const schema = buildSchema(parsed.entries, parsed.entries);
const values = { ...parsed.values };
const gamePort = Number(process.env.PALSPHERE_GAME_PORT || values.PublicPort || 8211);
if (!Number.isInteger(gamePort) || gamePort < 1 || gamePort > 65535) throw new Error('The game port must be an integer from 1 to 65535.');
const managedValues = {
  ServerName: serverName,
  ServerDescription: 'A friendly Palworld server • Hosted by PalSphere',
  ServerPassword: serverPassword,
  AdminPassword: adminPassword,
  PublicIP: '',
  PublicPort: gamePort,
  ServerPlayerMaxNum: 32,
  RESTAPIEnabled: true,
  RESTAPIPort: 8212,
  RCONEnabled: false,
  bIsUseBackupSaveData: true,
  bIsShowJoinLeftMessage: true,
};

for (const [key, value] of Object.entries(managedValues)) {
  if (Object.hasOwn(values, key)) values[key] = value;
}

const output = buildConfig(values, schema, schema.map((field) => field.key));
parseConfig(output);
fs.mkdirSync(path.dirname(configPath), { recursive: true });
const temp = `${configPath}.palsphere.tmp`;
fs.writeFileSync(temp, output, 'utf8');
fs.renameSync(temp, configPath);

const privateInfo = [
  'PALSPHERE SERVER INFORMATION - KEEP PRIVATE',
  '============================================================',
  '',
  `Server name: ${serverName}`,
  `Join password: ${serverPassword}`,
  `Administrator password: ${adminPassword}`,
  `Game port: UDP ${gamePort}`,
  '',
  'Router setup:',
  `Forward external UDP ${gamePort} to this computer on internal UDP ${gamePort}.`,
  'Reserve this computer\'s LAN address in the router so it does not change.',
  '',
  'Never upload this file, your server configuration, saves, logs, or backups.',
  `Created: ${new Date().toISOString()}`,
  '',
].join('\r\n');
fs.writeFileSync(privateInfoPath, privateInfo, { encoding: 'utf8', mode: 0o600 });
process.stdout.write('Fresh PalSphere server configuration created.\n');
