'use strict';

function buildLaunchArguments(values, { publicLobby = false } = {}) {
  const args = [
    `-port=${Number(values.PublicPort || 8211)}`,
    `-players=${Number(values.ServerPlayerMaxNum || 32)}`,
    `-logformat=${values.LogFormatType || 'Text'}`,
  ];
  if (publicLobby) args.push('-publiclobby');
  return args;
}

module.exports = { buildLaunchArguments };
