# PalSphere verification

Verified on July 9, 2026 against the installed Palworld 1.0 dedicated server.

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
