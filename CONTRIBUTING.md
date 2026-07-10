# Contributing

PalSphere is a dependency-light Windows application. The manager uses only Node.js built-in modules.

1. Install Node.js 20 or later for development.
2. Run `npm test`.
3. Run `npm run check`.
4. Do not add downloaded Palworld, SteamCMD, runtime, save, backup, log, or credential files.
5. Keep the manager bound to localhost and do not expose its REST credentials to the browser or network.

Installer changes should preserve existing worlds and configuration when rerun. Any destructive maintenance flow must create a safety backup first.
