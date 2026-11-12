# User guide

[README](../README.md) › [Docs](README.md) › User guide

- [Getting started](#getting-started)
- [Projects](#projects)
- [Deployments](#deployments) · [Webhooks](#webhooks)
- [Databases](#databases) · [Mail](#mail) · [Environment variables](#environment-variables)
- [Domains and HTTPS](#domains-and-https) · [Shared certificates](#shared-certificates-wildcards) ·
  [DNS records](#dns-records)
- [Dashboard](#dashboard) · [Alerts](#alerts) · [Admins and login](#admins-and-login)
- [Existing projects and databases](#existing-projects-and-databases)
- [SolarOps itself](#solarops-itself)

## Getting started

1. **Infrastructure** — check *PostgreSQL* (pre-configured by the installer), add *Mail relays*,
   *Git credentials* for private repositories, and *DNS accounts* if you want DNS validation or
   automatic DNS records.
2. **Projects › New project** — give it a name and a type: **application** or **static site**.
   The uid, folder and pm2 process derive from the name.
3. **Deployment** — repository URL + branch, then *Deploy now*. Enable the webhook to deploy on push.
4. **Database** — *Provision the database*: role + database + `DB_*` variables.
5. **Network** — domain, then *Obtain certificate*.
6. **Start** the application (static sites have nothing to start). Logs, metrics and the history
   of every operation are one click away.

## Projects

- **Applications** run with pm2 (start / stop / restart, live logs rotated by pm2-logrotate) on
  their own port, given as `PORT`. Each new application gets the first free slot of 3000, 3010,
  3020… (starting port and step in *Settings › General*); the port stays editable and unique
  across projects. After each (re)start, SolarOps checks that the app answers on `/`.
- **Static sites** (frontend only) are built, then nginx serves their public folder (`dist` by
  default, configurable), with an optional single-page-app fallback. No process runs.
- A project can be **deactivated**: its process is stopped and nginx stops serving its domain;
  its files, database and settings are kept.
- The **Storage** panel of the overview measures, on demand, the disk space of the project
  folder (each entry, `node_modules` apart) and the size of its database. The database only counts
  in the total when PostgreSQL runs on this server.

## Deployments

*Deploy now* (or a webhook) pulls the branch, installs, builds and restarts the app:

- **Install** — with empty install commands, the package manager is detected: the
  `packageManager` field of `package.json` first (e.g. `pnpm@9.15.4`, the exact version is used
  through corepack), then the lockfile (`pnpm-lock.yaml`, `yarn.lock`, `bun.lock`,
  `package-lock.json`), npm otherwise. devDependencies are always installed (builds need them,
  while projects run with `NODE_ENV=production`). bun is used when installed on the server, it is
  not installed for you.
- **Build** — `npm run build` by default, run with that same package manager, and skipped without
  a `build` script. Install and build take one command per line, run in order from `repo/`,
  stopping at the first failure.
- **Liveness** — after the restart, SolarOps waits for the app to answer on
  `http://127.0.0.1:<port>/` (any status below 500) and fails the deployment otherwise, with the
  app's last error lines. How long it waits is the project's **startup time** (*Settings* tab,
  5 to 900 seconds; empty: `SOLAROPS_LIVENESS_TIMEOUT_SECONDS`, 30 by default): raise it for apps
  that take long to boot. An app that answers later is live again as soon as it does: the
  deployment stays failed in the history, but the project no longer needs attention. A manual
  start or restart waits 15 seconds at most, then reports a slower app as still starting.
- **Pull only** updates the sources of a stopped app only (stop it first, or use *Deploy now*).

Nothing local is lost: changes to tracked files go to a `git stash`, unpushed commits to a
`solarops/backup-<date>` branch, and the checkout refuses to overwrite untracked files.

## Webhooks

The **Deployment** tab gives the URL (`https://<solarops>/hooks/<uid>`), the secret and a setup
guide. Accepted authentications:

- GitHub / Gitea / Forgejo: HMAC signature header `X-Hub-Signature-256`,
- Bitbucket Cloud: HMAC signature header `X-Hub-Signature` (`sha256=…`),
- GitLab: `X-Gitlab-Token`,
- anything else: `Authorization: Bearer <secret>`, e.g. from GitHub Actions:

```bash
curl -fsS -X POST -H "Authorization: Bearer $SOLAROPS_SECRET" https://solarops.example.com/hooks/my-app
```

Only a **push on the deployed branch** deploys (its latest commit is pulled). Everything else is
acknowledged (`202`) and ignored, with the reason in the reply:

| Call | Result |
| --- | --- |
| Push on the deployed branch | Deploys |
| Push on another branch | Ignored |
| Tag push | Ignored: tags are not deployed |
| Deletion of the deployed branch | Ignored: nothing to deploy |
| Other events: releases, pull / merge requests, issues, pipelines... | Ignored: only pushes deploy |
| GitHub's `ping` | Answered `pong` |
| No event header (CI, `curl`) | Deploys, unless its JSON payload names another branch or a tag in `ref` |

Selecting only push events on the git host ("Just the push event" on GitHub) avoids useless calls.

## Databases

*Provision the database* creates one PostgreSQL database and role per project (isolated, with a
generated password) and gives the app its `DB_*` variables and `DATABASE_URL`. Then: dumps (into
`db/`, pg_dump custom format), restore, wipe, password rotation.

**Scheduled backups** (off by default) dump the database every day or every week at a chosen hour
(server time) into `db/`, keeping the last N automatic dumps (`<uid>-auto-….dump`); manual dumps
are never deleted.

An app that already has a database? See [existing databases](#existing-projects-and-databases).

## Mail

Mail relays are SMTP accounts shared by the projects (*Infrastructure › Mail relays*). Linking one
to a project gives it the `SMTP_*` variables. A relay's from address is the default `SMTP_FROM`: a
project can set its own in its Mail tab (e.g. `"Blog" <blog@example.com>`). SolarOps sends the
magic login links from the address of its own relay.

## Environment variables

Variables given to a project at startup (later sources win):

| Source | Variables |
| --- | --- |
| system | `NODE_ENV=production`, `SOLAROPS_PROJECT`, `PORT` (applications: the project port) |
| database | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DATABASE_URL` |
| mail | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` |
| custom | anything you define in the **Environment** tab, encrypted at rest |

The project overview shows the result under **On the server → Env vars**, as a `.env` file. Secrets
are redacted by the server before they reach the page: component passwords, custom variables whose
name looks secret (`*_KEY`, `*_TOKEN`, `*PASSWORD*`...) or that override a secret, and the password
of any `scheme://user:password@host` URL.

## Domains and HTTPS

The **Network** tab exposes a project on a domain, with aliases, WebSockets and an upload size
limit (100 MB by default). Applications are reverse proxied to their port; static sites serve
their public folder. The DNS check tells you whether the domain points to the server.

HTTPS certificates come from Let's Encrypt, auto-renewed 30 days before expiry:

- **HTTP-01** — validated through this server on port 80. The simplest.
- **DNS-01** — validated through your DNS provider (OVHcloud, Cloudflare, DigitalOcean). Needed
  for wildcards, or when port 80 is not reachable.
- **Shared certificate** — one certificate selected by several projects (below).

*Force HTTPS* redirects HTTP to HTTPS and sends HSTS. A staging mode (*Settings*) avoids Let's
Encrypt's rate limits while testing.

### Shared certificates (wildcards)

A shared certificate, created in **Domains & SSL**, is issued once and used by every project that
selects it (*Shared certificate* in its Network tab):

- it is always validated through DNS-01 (Let's Encrypt only validates wildcards that way), with
  one of your DNS accounts;
- a wildcard covers exactly one level: `*.example.com` covers `app.example.com`, but neither
  `example.com` nor `a.b.example.com`, so add every level you need (`example.com, *.example.com`);
- a project can only select a certificate covering its domain and all its aliases, and the
  Network tab suggests one when it does; nothing switches without your click;
- it is renewed once (auto-renew, `solarops certs:renew`), then every project using it is
  reloaded; names still used by a project cannot be removed, nor the certificate deleted;
- certbot keeps it in `/var/lib/solarops/certificates/` (outside any project).

### DNS records

The **DNS records** panel of a project's Network tab points its domain and aliases at the server
through the API of one of your DNS accounts (the same accounts as for DNS-01 certificates):

- an A record to the **server public IPv4**, and an AAAA record to the **public IPv6** if set
  (*Settings › General*; they are never detected: copy them from your host);
- missing records are created with a 5-minute TTL, records already pointing here are left alone;
- a record pointing elsewhere is only replaced after confirmation; a CNAME, or a name with several
  records, is never changed (fix those at your provider);
- the AAAA record only follows an A record pointing here, and without a public IPv6 an AAAA record
  pointing elsewhere is reported (Let's Encrypt tries IPv6 first);
- every run is in the audit journal; on OVHcloud, the zone is refreshed so changes go live.

## Dashboard

Online applications, server CPU / memory / storage, health checks, certificates, databases and
pipelines, over your projects drawn as a tilted, animated solar system: SolarOps in purple,
healthy projects in blue, those needing attention in red (not running, missing or expired
certificate, failed deployment), disabled ones in gray. Ringed planets are on the web; click one
to open it.

## Alerts

**System › Alerts** e-mails every administrator when the server or a project needs attention, through
SolarOps's own mail relay (*Projects › SolarOps › Mail*, the relay of the magic links). Alerts are
off until you turn them on; *Send a test e-mail* checks the delivery.

| Rule | An alert opens when |
| --- | --- |
| Storage | the disk holding the projects is 80% full or more |
| CPU | CPU usage is 99% or more on average, 3 checks in a row |
| Memory | memory is 99% used or more, 2 checks in a row |
| Server health | a check of *Projects › SolarOps* fails twice in a row (checked every 5 minutes) |
| Projects | an active application exposed on a domain does not answer on `/`, or is not running, 2 checks in a row (not while a task runs for it, nor during its startup time) |
| Unstable restarts | pm2 restarted a project 3 times or more within 15 minutes |

The rules are checked every minute (`SOLAROPS_ALERT_CHECK_SECONDS`). One e-mail is sent when alerts
open and one when they are resolved, grouping what changed in the same check. Every rule can be
turned off. The alert state, the history of sent alerts and the restart counts are kept in memory
only: after a restart of SolarOps, a problem still going on is reported again. Every e-mail sent (or
not) is also in the **Activity** journal.

## Admins and login

Several admins can share SolarOps. Login is by password, or by **magic link** (a single-use link
sent by e-mail, which needs SolarOps's HTTPS domain and mail relay). Every login, change,
deployment and secret reveal is in the **Activity** journal. Locked out? The
[CLI](security.md#emergency-recovery-cli) is the way back in.

## Existing projects and databases

SolarOps never erases or replaces what it did not create, so a server that already hosts
projects can be taken over progressively:

- **Folders** — creating a project whose folder already exists adopts it: the form warns
  first and lists what is there; only the missing `repo/`, `etc/`, `db/`, `logs/` are added,
  existing permissions are kept. SolarOps never moves files: if the application sits directly
  in the folder, move it into `repo/` yourself when ready. SolarOps never changes ownership
  either: give the `solarops` user write access to adopted folders.
- **Generated files** — `etc/nginx.conf`, `etc/pm2.json` and `etc/dns-credentials.ini` carry a
  SolarOps marker; a file without it is never overwritten nor deleted (the action is refused
  with an explanation). Note that nginx loads any `etc/nginx.conf` through the include: the
  install script lists those it did not generate.
- **Git** — deploying into an existing clone never discards anything: changes to tracked files
  go to a `git stash`, unpushed commits to a `solarops/backup-<date>` branch, and the checkout
  refuses to overwrite untracked files.
- **pm2** — a process with the project's name that SolarOps did not start is left running:
  *Start* / *Restart* are refused (and deleting the project leaves it alone) until you remove
  it yourself (`pm2 delete <name>`).
- **Databases** — *Create* refuses a name already used by a database or role. Use **Link an
  existing database** instead (paste the app's `DATABASE_URL` or pick it from the list):
  SolarOps verifies the credentials by connecting, and changes nothing. Linked databases get
  `DB_*` variables, dumps and restores like any other, but are never wiped or dropped by
  SolarOps (*Unlink* forgets them, deleting the project keeps them). If the password is
  unknown, SolarOps can set a new one, explicitly.

## SolarOps itself

SolarOps appears as a locked **system project** (sidebar › *SolarOps*), so its own domain gets
the same tooling as projects: nginx config validated with `nginx -t`, Let's Encrypt certificate,
auto-renewal, expiry in *Domains & SSL*. Its page also shows the server health checks (nginx,
pm2, certbot, PostgreSQL...). Only its **Network** and **Mail** tabs exist:

- it is always a reverse proxy to `SOLAROPS_PORT`, and always over HTTPS;
- a new domain is refused until it points to this server (SolarOps would become unreachable);
- it cannot be deleted, deactivated, started / stopped (systemd does that) or deployed
  (its sources are owned by root; it is updated with `npm run update`, see
  [Updating](installation.md#updating));
- its mail relay sends the magic login links; magic links require its HTTPS domain, and while
  they are enabled, neither the domain nor the relay can be removed;
- webhook URLs use its domain.

From the shell: `sudo solarops domain:set solarops.example.com --email you@example.com`.
Locked out after a domain change? `sudo solarops domain:reset` (also switches back to password
login), then reach SolarOps through an SSH tunnel.
