# PalSphere Server Studio

PalSphere is a local Windows control panel and one-click installer for a private Palworld Dedicated Server. It downloads the official server through SteamCMD, creates a safe first configuration, manages saves and updates, and automatically recovers ordinary server crashes.

PalSphere does **not** redistribute Palworld, SteamCMD, Node.js, DirectX, or Microsoft runtime binaries. The installer downloads each component from its official publisher.

## What it provides

- One-click Windows installation and repair
- Portable Node.js LTS runtime with SHA-256 verification
- Official SteamCMD and Palworld Dedicated Server app `2394010`
- Microsoft Visual C++ and DirectX runtime installation
- Program-scoped Windows Firewall rule that follows the configured game UDP port
- Local-only browser dashboard on `127.0.0.1:8219`
- Optional Palworld Community Servers listing with a persistent dashboard toggle
- Editing for every setting supplied by the installed Palworld server
- Graceful save, shutdown, update, backup, and restore controls
- Palworld rolling backups plus 12 portable world snapshots
- Bounded crash recovery with restart-loop protection
- Quiet watchdog startup at Windows sign-in
- Automatic portable safety backup before updates

## Requirements

- 64-bit Windows 10 or Windows 11
- Administrator access during installation
- About 12 GB of free space for the first installation
- A fast SSD, 4 or more CPU cores, and preferably 16 GB or more memory
- Router access if friends will connect over the internet

Pocketpair's current server guide recommends 4+ CPU cores, 16 GB memory, fast storage, and forwardable UDP port 8211. See the [official Palworld requirements](https://docs.palworldgame.com/getting-started/requirements/).

## Install

1. Download the repository ZIP from GitHub and extract it to a permanent writable folder such as `C:\PalSphere`. Do not run it from inside the ZIP or a temporary Downloads preview.
2. Double-click **Install PalSphere.bat**.
3. Approve the Windows administrator prompt.
4. Choose a server name and optionally enter a join password. Leaving it blank generates a secure password.
5. Wait while the installer downloads roughly 6 GB of official server files.
6. PalSphere opens automatically when installation finishes.

Generated passwords are stored in `PalSphere Server Info - Private.txt`. Keep that file private. The repository ignores it automatically.

The installer is safe to rerun as a repair/update operation. Existing configuration, passwords, saves, and worlds are preserved.

## Uninstall

Double-click **Uninstall PalSphere.bat**. If you choose to remove downloaded files, the uninstaller first creates a timestamped ZIP containing the world, portable backups, manager settings, and private server information. It removes only generated runtimes and server data; the PalSphere source folder and uninstall backup remain.

## Start and manage the server

After installation, double-click **Launch PalSphere.bat**. Use the dashboard's **Start server** and **Save & Stop** controls rather than launching `PalServer.exe` directly.

PalSphere itself remains local-only. Closing the browser tab does not stop the manager or game server. Use **Close studio** only after the Palworld server is offline.

## Let friends connect

Windows Firewall is configured automatically. Router forwarding cannot be automated safely because every router is different.

In the router:

1. Reserve the server computer's LAN address using DHCP reservation.
2. Forward the configured external **UDP game port** to that LAN address on the same internal port. The default is `8211`; the dashboard always shows the current value.
3. Do not forward the TCP version of the game port, the REST API port, the manager port, or the RCON port.

Friends connect using the public address shown on the PalSphere dashboard. Players on the same home network use the LAN address.

The **Palworld server list** toggle on the dashboard controls whether the next server launch appears under Palworld's **Community Servers** list. Leave it off for direct-IP-only access. Turn it on while the server is stopped to add Palworld's official `-publiclobby` launch option; no public IP is hardcoded. A join password remains strongly recommended for listed servers.

## Crash recovery

The default watchdog policy:

- Checks the Palworld process every 15 seconds
- Waits 30 seconds after an unexpected exit
- Attempts at most 3 restarts within 10 minutes
- Pauses after repeated failures instead of looping forever
- Disarms during Save & Stop, force-stop, updates, and intentional maintenance

PalSphere never restores an older world backup automatically. Backup restoration remains a deliberate manual action to avoid rolling back valid progress.

Windows startup is optional. Use the **Start PalSphere with Windows** toggle on **Activity & tools** to create or remove the current user's sign-in task immediately. Disabling it does not stop a server that is already running; it only prevents PalSphere and automatic server recovery from starting after the next Windows restart or sign-in.

## Repository contents

```text
Install PalSphere.bat          One-click elevated installer/repair
Launch PalSphere.bat           Normal day-to-day launcher
Uninstall PalSphere.bat        Safe removal with world backup
manager/                       Local manager service and dashboard
scripts/                       Installation, firewall, startup, and setup tools
.github/workflows/test.yml     GitHub Actions checks
```

The following are generated locally and excluded from Git:

```text
.runtime/                      Portable Node.js
_steamcmd/                     Valve SteamCMD files
_prerequisites/                Microsoft runtime installers
server/                        Palworld Dedicated Server and all live data
manager/backups/               Portable world snapshots
manager/config-history/        Local configuration history
manager/logs/                  Activity and update logs
```

## Development

PalSphere has no npm runtime dependencies. For development, install Node.js 20 or later and run:

```powershell
npm test
npm run check
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-PalSphere.ps1 -DryRun -NonInteractive
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Test-PalSphereRelease.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Build-PalSphereRelease.ps1
```

Before publishing, verify that `git status --ignored` shows server files, saves, logs, backups, and private information as ignored.

## Security and project status

Read [SECURITY.md](SECURITY.md) before publishing logs or reports. PalSphere binds only to localhost and opens only the Palworld game port in Windows Firewall.

PalSphere is an independent community project and is not affiliated with, endorsed by, or sponsored by Pocketpair, Valve, Microsoft, or the Node.js project. Palworld and related names are trademarks of their respective owners. Downloaded components remain subject to their publishers' licenses and terms.

PalSphere source code is available under the [MIT License](LICENSE).
