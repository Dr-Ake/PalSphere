'use strict';

const { SERVER_DESCRIPTION_SUFFIX, SERVER_DESCRIPTION_SUFFIXES } = require('./branding');
const { DESCRIPTIONS, LABEL_OVERRIDES } = require('./descriptions');

const GROUPS = [
  { id: 'identity', label: 'Identity & Access', icon: 'sparkles', description: 'Name, passwords, players, and platforms.' },
  { id: 'world', label: 'World & Progression', icon: 'globe', description: 'Time, experience, drops, and world randomization.' },
  { id: 'players', label: 'Players & Survival', icon: 'user', description: 'Player stats, penalties, stamina, and durability.' },
  { id: 'pals', label: 'Pals & Combat', icon: 'paw', description: 'Pal spawning, capture, damage, hunger, and breeding.' },
  { id: 'bases', label: 'Bases & Guilds', icon: 'home', description: 'Building, workers, guilds, items, and gathering.' },
  { id: 'multiplayer', label: 'Multiplayer & PvP', icon: 'users', description: 'PvP, hardcore, travel, visibility, and shared features.' },
  { id: 'saves', label: 'Saves & Maintenance', icon: 'save', description: 'Autosaves, rolling backups, cleanup, and retention.' },
  { id: 'network', label: 'Network & Admin', icon: 'network', description: 'Ports, admin services, logs, and authentication.' },
  { id: 'advanced', label: 'Advanced', icon: 'sliders', description: 'Performance and specialist settings.' },
];

const GROUP_KEYS = {
  identity: ['ServerName','ServerDescription','AdminPassword','ServerPassword','ServerPlayerMaxNum','CoopPlayerMaxNum','Region','CrossplayPlatforms','bUseAuth','bAllowClientMod','bShowPlayerList','bIsShowJoinLeftMessage','ChatPostLimitPerMinute'],
  world: ['Difficulty','RandomizerType','RandomizerSeed','bIsRandomizerPalLevelRandom','DayTimeSpeedRate','NightTimeSpeedRate','ExpRate','WorkSpeedRate','SupplyDropSpan','EnablePredatorBossPal','CollectionDropRate','CollectionObjectHpRate','CollectionObjectRespawnSpeedRate','EnemyDropItemRate','ItemCorruptionMultiplier'],
  players: ['PlayerDamageRateAttack','PlayerDamageRateDefense','PlayerStomachDecreaceRate','PlayerStaminaDecreaceRate','PlayerAutoHPRegeneRate','PlayerAutoHpRegeneRateInSleep','DeathPenalty','ItemWeightRate','EquipmentDurabilityDamageRate','BlockRespawnTime','RespawnPenaltyDurationThreshold','RespawnPenaltyTimeScale','bAllowEnhanceStat_Health','bAllowEnhanceStat_Attack','bAllowEnhanceStat_Stamina','bAllowEnhanceStat_Weight','bAllowEnhanceStat_WorkSpeed'],
  pals: ['PalCaptureRate','PalSpawnNumRate','PalDamageRateAttack','PalDamageRateDefense','PalStomachDecreaceRate','PalStaminaDecreaceRate','PalAutoHPRegeneRate','PalAutoHpRegeneRateInSleep','PalEggDefaultHatchingTime','MonsterFarmActionSpeedRate'],
  bases: ['BuildObjectHpRate','BuildObjectDamageRate','BuildObjectDeteriorationDamageRate','DropItemMaxNum','PhysicsActiveDropItemMaxNum','DropItemMaxNum_UNKO','DropItemAliveMaxHours','BaseCampMaxNum','BaseCampWorkerMaxNum','BaseCampMaxNumInGuild','GuildPlayerMaxNum','GuildRejoinCooldownMinutes','MaxBuildingLimitNum','bBuildAreaLimit','ItemContainerForceMarkDirtyInterval','DenyTechnologyList'],
  multiplayer: ['bIsMultiplay','bIsPvP','bHardcore','bPalLost','bCharacterRecreateInHardcore','bCanPickupOtherGuildDeathPenaltyDrop','bEnableNonLoginPenalty','bEnableFastTravel','bEnableFastTravelOnlyBaseCamp','bIsStartLocationSelectByMap','bExistPlayerAfterLogout','bEnableDefenseOtherGuildPlayer','bInvisibleOtherGuildBaseCampAreaFX','bEnablePlayerToPlayerDamage','bEnableFriendlyFire','bEnableInvaderEnemy','bActiveUNKO','bAllowGlobalPalboxExport','bAllowGlobalPalboxImport','bAdditionalDropItemWhenPlayerKillingInPvPMode','AdditionalDropItemWhenPlayerKillingInPvPMode','AdditionalDropItemNumWhenPlayerKillingInPvPMode','bDisplayPvPItemNumOnWorldMap_BaseCamp','bDisplayPvPItemNumOnWorldMap_Player','bEnableVoiceChat','VoiceChatMaxVolumeDistance','VoiceChatZeroVolumeDistance','bEnableBuildingPlayerUIdDisplay'],
  saves: ['AutoSaveSpan','bIsUseBackupSaveData','bAutoResetGuildNoOnlinePlayers','AutoResetGuildTimeNoOnlinePlayers','AutoTransferMasterCheckIntervalSeconds','AutoTransferMasterThresholdDays','MaxGuildsPerFrame','PlayerDataPalStorageUpdateCheckTickInterval'],
  network: ['PublicPort','PublicIP','RCONEnabled','RCONPort','RESTAPIEnabled','RESTAPIPort','BanListURL','LogFormatType'],
};

const TYPE_OVERRIDES = {
  AdminPassword: { type: 'password', secret: true },
  ServerPassword: { type: 'password', secret: true },
  ServerName: { type: 'text' },
  ServerDescription: { type: 'brandedtext', suffix: SERVER_DESCRIPTION_SUFFIX, legacySuffixes: SERVER_DESCRIPTION_SUFFIXES },
  Region: { type: 'text' },
  PublicIP: { type: 'text' },
  BanListURL: { type: 'text' },
  RandomizerSeed: { type: 'text' },
  AdditionalDropItemWhenPlayerKillingInPvPMode: { type: 'text' },
  Difficulty: { type: 'select', options: ['None','Normal','Difficult'] },
  RandomizerType: { type: 'select', options: ['None','Region','All'] },
  DeathPenalty: { type: 'select', options: ['None','Item','ItemAndEquipment','All'] },
  LogFormatType: { type: 'select', options: ['Text','Json'] },
  CrossplayPlatforms: { type: 'multiselect', options: ['Steam','Xbox','PS5','Mac'] },
  DenyTechnologyList: { type: 'stringlist' },
};

const LIMITS = {
  ServerPlayerMaxNum: { min: 1, max: 32, integer: true },
  CoopPlayerMaxNum: { min: 1, max: 32, integer: true },
  PublicPort: { min: 1, max: 65535, integer: true },
  RCONPort: { min: 1, max: 65535, integer: true },
  RESTAPIPort: { min: 1, max: 65535, integer: true },
  BaseCampMaxNumInGuild: { min: 1, max: 10, integer: true },
  BaseCampWorkerMaxNum: { min: 1, max: 50, integer: true },
  ChatPostLimitPerMinute: { min: 1, max: 999, integer: true },
  AutoSaveSpan: { min: 10, max: 3600 },
  ServerReplicatePawnCullDistance: { min: 5000, max: 15000 },
};

const ACRONYMS = new Map([
  ['Hp', 'HP'], ['Pvp', 'PvP'], ['Rcon', 'RCON'], ['Restapi', 'REST API'],
  ['Ip', 'IP'], ['Id', 'ID'], ['Unko', 'UNKO'], ['Uid', 'UID'], ['Fx', 'FX'],
]);

function makeLabel(key) {
  if (LABEL_OVERRIDES[key]) return LABEL_OVERRIDES[key];
  let label = key
    .replace(/^b(?=[A-Z])/, '')
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  label = label.charAt(0).toUpperCase() + label.slice(1);
  for (const [word, replacement] of ACRONYMS) {
    label = label.replace(new RegExp(`\\b${word}\\b`, 'g'), replacement);
  }
  return label;
}

function groupForKey(key) {
  for (const [group, keys] of Object.entries(GROUP_KEYS)) {
    if (keys.includes(key)) return group;
  }
  return 'advanced';
}

function inferType(entry) {
  if (TYPE_OVERRIDES[entry.key]) return TYPE_OVERRIDES[entry.key];
  if (typeof entry.value === 'boolean') return { type: 'toggle' };
  if (typeof entry.value === 'number') return { type: 'number', integer: Number.isInteger(entry.value) && !entry.raw.includes('.') };
  if (Array.isArray(entry.value)) return { type: 'stringlist' };
  return { type: 'text' };
}

function buildSchema(defaultEntries, liveEntries = []) {
  const liveByKey = new Map(liveEntries.map((entry) => [entry.key, entry]));
  const combined = [...defaultEntries];
  for (const entry of liveEntries) {
    if (!combined.some((candidate) => candidate.key === entry.key)) combined.push(entry);
  }
  return combined.map((entry, index) => {
    const type = inferType(entry);
    const limits = LIMITS[entry.key] || {};
    return {
      key: entry.key,
      label: makeLabel(entry.key),
      group: groupForKey(entry.key),
      description: DESCRIPTIONS[entry.key] || `Palworld server setting: ${makeLabel(entry.key)}.`,
      defaultValue: entry.value,
      currentValue: liveByKey.has(entry.key) ? liveByKey.get(entry.key).value : entry.value,
      order: index,
      ...type,
      ...limits,
    };
  });
}

module.exports = { DESCRIPTIONS, GROUPS, buildSchema, groupForKey, makeLabel };
