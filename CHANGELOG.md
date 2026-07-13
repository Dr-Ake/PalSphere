# Changelog

## 1.8.2 - 2026-07-12

- Preserves a mod's numeric Steam Workshop ID as its server source-folder name so Palworld actually discovers and deploys it.
- Reads the Workshop ID from the downloaded directory or `.workshop.json` metadata during folder and ZIP imports.
- Writes an explicit absolute `WorkshopRootDir` instead of relying on Palworld's blank default value.
- Recognizes a manually installed Workshop item when its Steam link is looked up again.

## 1.8.1 - 2026-07-12

- Fixed the Workshop handoff to launch the installed Steam desktop client directly and verify that it started.
- Clarified that PalSphere opens the item while the user clicks Subscribe inside their signed-in Steam client.
- Reports a useful error when Steam is missing or fails to start instead of claiming the item was opened.

## 1.8.0 - 2026-07-12

- Added Steam Workshop URL and numeric-ID lookup directly in the Mods page.
- Verifies item metadata through Valve's public API and rejects items belonging to other games.
- Opens the exact item in the signed-in Steam client for authenticated subscription and download.
- Watches Steam's local Workshop folder for two minutes and offers server installation as soon as the download is ready.
- Keeps mod installation locked while the Palworld server runs, while lookup and Steam subscription remain available.

## 1.7.0 - 2026-07-12

- Added a dedicated Mods area built around Palworld's native Workshop server-mod system.
- Added local Steam Workshop discovery plus ZIP import for packages containing `Info.json`.
- Added install, update/reinstall, enable/disable, global bypass, and remove controls.
- Rejects packages without an `IsServer: true` install rule and labels packages that include client-side files.
- Locks every mod change while Palworld or SteamCMD is running.
- Validates package names, archive paths, expanded size, and file count before installation.

## 1.6.0 - 2026-07-10

- Made the settings search, preset, discard, and save toolbar stay visible beneath the header while scrolling.

## 1.5.0 - 2026-07-10

- Replaced generic filler with plain-English descriptions for all 119 installed Palworld settings.
- Added direction, units, dependencies, performance warnings, and honest notices for undocumented internal options.
- Improved labels for cryptic legacy, networking, PvP, backup, and player-limit settings.

## 1.4.0 - 2026-07-10

- Turned `ServerDescription` into a clear Join message editor.
- Added a fixed `Hosted by PalSphere` signature while keeping the owner-written message customizable.

## 1.3.0 - 2026-07-10

- Added a persistent dashboard toggle for showing the server in Palworld's Community Servers list.
- Community listing uses Palworld's official `-publiclobby` launch option and never hardcodes a public IP.

## 1.2.1 - 2026-07-10

- Added a live dashboard toggle for enabling or disabling Windows sign-in startup.

## 1.2.0 - 2026-07-10

- Added a portable, checksum-verified Node.js runtime and one-click GitHub-ready installer.
- Added official SteamCMD, Palworld, Visual C++, and DirectX download automation.
- Added safe first-run configuration and private credential generation.
- Added repair installs that preserve existing worlds and settings.
- Added safe uninstall with a world and private-settings archive.
- Added repository security exclusions, clean-install fixtures, GitHub Actions, and public documentation.

## 1.1.0 - 2026-07-10

- Added bounded crash detection and automatic recovery.
- Added restart-policy controls and recovery status to the dashboard.
- Added live-save and rolling-backup freshness visibility.
- Added automatic portable backups before server updates.
- Added quiet manager startup at Windows sign-in.
