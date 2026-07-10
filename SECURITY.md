# Security policy

PalSphere is intentionally local-only. Its web service binds to `127.0.0.1`, and the installer opens only the Palworld game port (`UDP 8211`) in Windows Firewall.

Do not commit or share any of these generated files:

- `PalSphere Server Info - Private.txt`
- `server/Pal/Saved/`
- `manager/logs/`, `manager/backups/`, or `manager/config-history/`
- `.env` files

The repository `.gitignore` excludes them. Before publishing a fork, run `git status --ignored` and the repository tests.

Please report security issues privately to the repository owner rather than opening a public issue containing passwords, public IP addresses, world saves, or player data.
