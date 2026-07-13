# PalSphere verification

Verified through July 12, 2026 against the installed Palworld 1.0 dedicated server.

- Parsed, validated, serialized, and round-tripped all 119 installed settings.
- Served dashboard and assets from `127.0.0.1:8219` with a restrictive content-security policy.
- Saved settings offline and rejected online edits with HTTP 409.
- Created and restored a portable world backup with the `Level.sav` checksum unchanged.
- Started the real server from the manager and observed UDP 8211 on `0.0.0.0`.
- Reached authenticated Palworld REST readiness and reported `v1.0.0.100427`.
- Confirmed Save Now advanced the world-save timestamp.
- Gracefully saved and stopped the server in 4.7 seconds with no Palworld process left behind.
- Saved a new description, launched the server, and confirmed the running Palworld API reported the exact configured name and description.
- Ran Update & Verify through the manager; SteamCMD validated 6.05 GB, reported app 2394010 fully installed, and exited 0.
- Exercised Dashboard, Settings, Saves & Backups, Activity, modals, search, edit/discard, online lock, Start, and Save & Stop in the browser.
- Browser console completed with no warnings or errors.
- Double-click launcher helper parsed and restarted the localhost manager successfully.
- Added and verified PalSphere 1.1 crash recovery: 15-second monitoring, a 30-second restart delay, three bounded attempts in ten minutes, intentional-stop suppression, and manual lockout reset.
- Verified simulated unexpected exits recover, deliberate stops never relaunch, and repeated crashes enter a visible lockout instead of looping forever.
- Verified the live recovery policy API and dashboard controls, including a real browser save with no console errors.
- Registered the `PalSphere Server Studio` Windows sign-in task so the hidden watchdog returns after login.
- Added live-save and rolling-backup freshness visibility plus an automatic portable world snapshot before server updates.
- Confirmed the only matching enabled inbound game-management firewall allowance is the program-scoped UDP 8211 Palworld rule; REST 8212 and RCON 25575 are not exposed.
- Added Palworld native Workshop mod discovery, install/update, enable/disable, global bypass, and remove operations with offline-only mutation guards.
- Verified official-style `Info.json` parsing, client-only rejection, active-state preservation during updates, and `PalModSettings.ini` preservation with temporary server fixtures.
- Verified ZIP import end to end through the Windows extraction helper, including traversal rejection, 512 MB upload limits, 2 GB expanded limits, and a 20,000-file ceiling.
- Exercised the Mods page in the browser at desktop and PalSphere's 1040 px minimum layout width; navigation, empty states, import controls, compatibility guidance, and the browser console were clean.
- Verified Workshop URL/ID parsing and Valve metadata lookup with Creative Menu item `3625287786`; the live API confirmed its Palworld app ID, title, and 680,430-byte file size.
- Confirmed anonymous SteamCMD rejects that item, while the signed-in Steam-client handoff opens the exact item without asking PalSphere to collect credentials.
- Exercised the v1.8.2 paste-link and folder-import flows with a real Creative Menu Workshop package.
- Verified Palworld created `Mods/ManagedMods/CreativeMenu/InstallManifest.json`, deployed `CreativeMenu_P.pak`, and reached REST-ready online state with the mod active.
- Passed the automated tests, installer dry-run, Git publish-set audit, release validation, and the PalSphere 1.8.2 archive build.
