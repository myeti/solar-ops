# Installation

[README](../README.md) › [Docs](README.md) › Installation

- [Requirements](#requirements) · [Install](#install) · [Options](#options) · [First launch](#first-launch)
- [Day to day](#day-to-day) · [Updating](#updating) · [Troubleshooting](#troubleshooting)
- [Configuration](#configuration) · [Try it first](#try-it-first)

## Requirements

- A **Debian 12+** or **Ubuntu 22.04+** server, with `sudo`.
- **Node.js 24** (with npm 10+), installed **for the whole system**: SolarOps and the projects run
  with it as the `solarops` user, so not with nvm in your home folder. From NodeSource, for example:

  ```bash
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  ```

  ```bash
  sudo apt-get install -y nodejs
  ```

  SolarOps never installs nor upgrades Node.js itself.
- A domain (or subdomain) pointing at the server, to serve SolarOps over HTTPS. Without one,
  SolarOps is reached through an SSH tunnel.

## Install

```bash
sudo git clone https://github.com/myeti/solar-ops.git /var/solarops
```

```bash
cd /var/solarops && npm run setup
```

The setup asks for SolarOps's **domain** (empty: none, reach it through an SSH tunnel) and the
**e-mail** used for Let's Encrypt. It runs as root (it asks for your `sudo` password if needed) and:

1. installs what is missing among **nginx, certbot** (+ OVH / Cloudflare / DigitalOcean DNS
   plugins), **PostgreSQL**, git, build tools, **pm2**, and **pnpm / yarn** (corepack shims). What
   is already installed is kept as is, never replaced nor upgraded; a version too old stops the
   script, which tells what to upgrade (minimums: Node.js 24, npm 10, git 2.25, nginx 1.18,
   certbot 1.12, pm2 5, PostgreSQL 13, and `pg_dump` at least as recent as the server),
2. creates the `solarops` system user and `/var/lib/solarops` (data), and lets that user create
   projects in `/var/www` (an ACL entry: the folder's owner and permissions are kept),
3. adds `include /var/www/*/etc/nginx.conf;` to nginx (`/etc/nginx/conf.d/solarops.conf`),
4. adds a sudo rule letting `solarops` run **only** `nginx -t` and `systemctl reload nginx`,
5. creates the PostgreSQL role `solarops_admin` (`CREATEDB CREATEROLE`, *not* superuser),
6. sets up `pm2 startup` so projects come back after a reboot, and **pm2-logrotate** (project logs
   rotated above 10 MB and nightly, 14 compressed files kept),
7. builds the UI, installs `solarops.service` and the `solarops` CLI,
8. adds `solarops-certs.timer`, a daily certificate renewal (safety net for SolarOps's scheduler),
9. with a domain, serves SolarOps itself over HTTPS (see [SolarOps itself](guide.md#solarops-itself)).

The setup can also be run as `sudo ./deploy/install.sh` (same questions, same options).

## Options

Options follow `--`: `npm run setup -- --port 4200`.

| Option | Default | Purpose |
| --- | --- | --- |
| `--base-folder <path>` | `/var/www` | Where projects live |
| `--data-dir <path>` | `/var/lib/solarops` | SolarOps's own data |
| `--user <name>` | `solarops` | System user running SolarOps and the projects |
| `--port <port>` | `4100` | Local port of SolarOps |
| `--host <address>` | `127.0.0.1` | Listening address (only change it in containers or behind a firewall) |
| `--skip-postgres` | | Do not install nor configure PostgreSQL |
| `--pg-host <host>` | | Use an existing PostgreSQL server (see below) |
| `--pg-port <port>` | `5432` | Its port |
| `--pg-user <role>` | `solarops_admin` | Its admin role (`CREATEDB CREATEROLE`) |
| `--pg-password <password>` | | Password of that role |
| `--log-max-size <size>` | `10M` | Rotate a project log above this size |
| `--log-retain <count>` | `14` | Rotated logs kept per file |
| `--deps-only` | | Only install the packages, pm2, pnpm and yarn |
| `-h`, `--help` | | Show the help |

**The setup is remembered.** The defaults above only apply to the first setup: running
`npm run setup` again keeps every option of the previous run (port, folders, user, which PostgreSQL
server and role...) and only changes the ones you pass. An empty domain keeps SolarOps's current
address. `npm run update` never changes the setup at all.

### Existing PostgreSQL server

Already have a PostgreSQL server (managed database, other host)?
`--pg-host <host> --pg-user <admin role> --pg-password <password> [--pg-port <port>]` only
installs the client tools (`pg_dump` must be at least the server's major version).

On a local server, an existing role SolarOps did not create is never modified: pass its password
with `--pg-password` (it must have `CREATEDB` and `CREATEROLE`), or choose another `--pg-user`.

### Without a domain

Without a domain, SolarOps only listens on `127.0.0.1:4100`; reach it through an SSH tunnel:

```bash
ssh -L 4100:127.0.0.1:4100 you@your-server
```

Then open <http://localhost:4100>. A domain can be added later: run `npm run setup` again, set it
from the UI (Projects › SolarOps), or use `sudo solarops domain:set <domain> --email <email>`.

## First launch

While no admin exists, SolarOps prints a **one-time setup token** at startup (the setup shows it
too). Open `/setup`, paste the token and create the first admin. Prefer the shell?
`sudo solarops admin:create you@example.com`.

Then head to the [user guide](guide.md).

## Day to day

From the SolarOps folder (`/var/solarops`):

| Command | What it does |
| --- | --- |
| `npm run start` | Start the `solarops` service, and wait until SolarOps answers |
| `npm run stop` | Stop it. The projects keep running: pm2 runs them |
| `npm run restart` | Stop, then start |
| `npm run update` | Update SolarOps (below) |
| `npm run setup` | Change the setup (above) |
| `npm run serve` | Run SolarOps in the foreground, without the service (containers, debugging) |

The commands use `sudo` themselves when needed. Never run SolarOps as root on the server (a plain
`sudo node server/index.js`, for instance): it would create files the service can no longer use,
so SolarOps refuses to start that way. The service's logs: `journalctl -u solarops -f`.

## Updating

```bash
cd /var/solarops && npm run update
```

Type `npm run update`: `npm update`, without `run`, is npm's own command upgrading dependencies.

An update follows **the branch checked out** in the SolarOps folder (choose it with `git checkout`),
never changes the setup, and goes:

1. **Checks**, changing nothing when one fails: SolarOps is set up, the folder is a git clone on
   a branch with an upstream, it has no local change (commit, stash or discard them), and no
   deployment, backup or certificate request is running (restarting would cut it off).
2. **Pull** of the branch (`git pull --ff-only`, as the owner of the folder).
3. **Setup** with the remembered options: dependencies (`npm ci`), UI build, server configuration,
   restart of SolarOps.
4. **Database**: when it starts, SolarOps backs up its database
   (`/var/lib/solarops/backups/`, the last 5 kept), then applies the pending migrations, each in a
   transaction.
5. **Check** that SolarOps answers. If it does not, the update goes back by itself to the previous
   version, and to the database backup when migrations ran.

Your projects keep running all along: nginx and pm2 serve them, only the SolarOps UI restarts.

| Command | What it does |
| --- | --- |
| `npm run update -- --check` | Show the commits an update would bring, its migrations, and whether dependencies or the setup change. Changes nothing |
| `npm run update -- --force` | Rebuild and restart even when up to date |
| `npm run rollback` | Back to the version before the last update, with its database backup when that update migrated the database (it asks first: what changed in SolarOps since then is lost) |

A database migrated by a newer version is refused by an older one (SolarOps does not start, and
says so) rather than damaged: go back to the newer version, or restore the backup (`npm run
rollback`).

**Installs made before these commands**: pull once by hand, then run the setup again. It keeps
the options of that first install, and records them for the next updates:

```bash
sudo git -C /var/solarops pull
```

```bash
cd /var/solarops && npm run setup
```

## Troubleshooting

- **The setup seems stuck** — the long steps (apt, npm) write to `/var/log/solarops-install.log`:
  follow it from another shell with `sudo tail -f /var/log/solarops-install.log`. Interrupting it
  with Ctrl+C is safe: run it again afterwards.
- **"Another package manager is working"** — on a new server, unattended upgrades or cloud-init
  often update the system during the first minutes. The setup waits for them (up to 30 minutes),
  then goes on.
- **`apt-get update` hangs** — the mirror is usually unreachable over IPv6. Check with
  `sudo apt-get -o Acquire::ForceIPv4=true update`; if that works, make it permanent with
  `echo 'Acquire::ForceIPv4 "true";' | sudo tee /etc/apt/apt.conf.d/99force-ipv4`.
- **A step failed** — the end of its output is shown, the full output is in the log. Fix the
  problem and run the command again: it is idempotent.
- **An update failed** — it went back to the previous version by itself; the messages above the
  failure, and `journalctl -u solarops`, tell why.

## Configuration

System-level settings live in `/var/solarops/.env` (documented in [.env.example](../.env.example)):
binding, data folder, session lifetime, commands used for nginx / certbot / pm2, IPv6... The setup
writes them (the `SOLAROPS_SETUP_*` lines are its own memory). They are deliberately not editable
from the UI. Functional settings (base folder, login method, Let's Encrypt e-mail, server public
IPs, project ports) are in **Settings**; SolarOps's own domain and mail relay are on its system
project.

SolarOps stores its own data in SQLite by default, so it keeps working (and stays recoverable)
even if PostgreSQL is down. Set `SOLAROPS_DB_URL` to use PostgreSQL instead (no automatic backup
before migrations then: dump it before updating).

## Try it first

The [Docker test bench](../docker/README.md) runs a disposable Ubuntu "VPS" with systemd, a
PostgreSQL server and a local Let's Encrypt test server: the setup runs on it for real, without
touching a real server.
