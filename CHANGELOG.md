# Changelog

Notable changes of SolarOps, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow
[Semantic Versioning](https://semver.org/).

Every change adds a line under **Unreleased**; a release renames that section to its version and
date, and the version in `package.json` follows.

## [Unreleased]

### Fixed

- The setup and `npm run update` left an idle pm2 daemon running as root (`/root/.pm2`, about
  70 MB): checking pm2's version started one. The version is now read without starting pm2, and
  nothing else runs pm2 as root but `pm2 startup`; the projects only use the `solarops` daemon.

## [0.3.3] - 2026-11-22

### Added

- **`DATA_DIR`**: every project gets a `data/` folder for the files it writes at runtime (uploads,
  caches, SQLite...), next to `repo/` and kept across deployments, and its path as `DATA_DIR`.
  Existing projects get theirs when SolarOps starts. It shows in the overview (On the server) and
  in the Storage measure.

## [0.3.2] - 2026-11-22

### Added

- **Favicons in the projects list**: a live website shows its favicon instead of its planet,
  found on the server itself (the app on its port, or the static site's files), never on the
  internet. Without one, the planet stays.
- **Project versions**: the `version` of a project's `package.json` (SolarOps's own for SolarOps)
  shows under its planet on the dashboard, beside its type in the projects list, and in its page
  header.
- **Run a script** (Deployment tab): pick a script of the project's `package.json`, add arguments,
  and run it (`npm run create:admin -- test@email.com`) from `repo/` with all the project's
  variables. The output shows live and stays in the History; arguments can be hidden (passwords).

### Changed

- A project's page header reads status · version · public URL: the identifier and the port are
  gone from it (they stay in its Settings tab).
- The Deployment tab's history is now **History**: deployments and script runs.

## [0.3.1] - 2026-11-17

### Added

- **Monitoring** (System › Monitoring): CPU and memory side by side, each with its value right
  now, 24 hours of usage (one point a minute, kept in memory and lost when SolarOps restarts) and
  the processes using the most, with their project, refreshed every 3 seconds.

### Fixed

- The daily visits of the projects list are the last 24 hours, as in Umami ("Last 24 hours"): they
  counted from midnight on the server's clock (often UTC), so they dropped to 0 every night.

## [0.3.0] - 2026-11-16

### Added

- A **Projects** section in the left menu, between Workspace and Infrastructure: every project,
  with an icon for its type (application or static site), in amber when it needs attention and
  dimmed when disabled (the reasons in its tooltip).
- **Access protection** of a website (Network › Access): a password asked by nginx (users stored
  as hashes), allowed IP addresses or ranges, or both (allowed addresses skip the password).
  Let's Encrypt renewals keep working; the Overview says when access is restricted.
- **Analytics** (Settings › Analytics): connect Umami, self-hosted or Cloud, with its address and
  an API key. The projects list shows each project's visitors now, and its visits today and over
  7 days (the Umami website matching its public URL, linked); the dashboard adds two cards (visitors now, visits over
  7 days); every project gets `ANALYTICS_URL`, the tracker script.
- **Counts in the left menu**: Projects, Git credentials, Domains & SSL (exposed domains),
  PostgreSQL (databases on the server) and Mail relays show how many items they list; Alerts shows
  the open alerts, in amber.

### Changed

- The projects list is a table, one project per row, sorted by name and sortable by every column:
  status, services, public URL, CPU / memory / uptime, and analytics. A Refresh button reloads it.
- The projects list checks that every project is live when it loads (an application answers on its
  port, a static site is built): **Online** when it is served on its domain, **Live** and
  **Unreachable** without a domain, **Down** when it does not answer (even with a domain),
  **Stopped** when stopped in pm2, and **Unstable** while pm2 counts unstable restarts.
- Workspace › Projects is highlighted on the projects list and the creation page only: a project's
  page highlights its own entry in the Projects section.
- The dashboard keeps five cards, in this order: Online, Health, CPU, Memory, Storage. The
  Certificates, Databases and Pipelines cards are gone.

### Fixed

- The dashboard's Online card counts static sites too (served when active and exposed on a
  domain), not only the running applications.

## [0.2.2] - 2026-11-12

### Added

- **New variables for every project**:
  - `PUBLIC_URL`: `https://<domain>` once a certificate method is chosen, `http://<domain>`
    otherwise; not set without a domain or with a wildcard one.
  - `ROOT_DIR`: the project's `repo/` folder, where it runs and builds.
  - `JWT_SECRET`: 32 random characters generated once per project (at creation; existing projects
    get theirs when SolarOps starts), stored encrypted, masked like every secret.
- **References in custom variables**: `${NAME}` is replaced by the value of any variable
  (`API_URL=${PUBLIC_URL}/api`); inside `NAME`, `${NAME}` is the value it overrides. `$${NAME}`
  writes `${NAME}` literally, a bare `$NAME` is left as is. Unknown names and loops are reported
  in the Environment tab; a value built from a secret is a secret.
- **Generate a random value** (32 characters) from a button inside the field, for custom variables
  whose name contains `SECRET` or `PASSWORD`.
- First database migration (`0001-project-secrets`): SolarOps backs up its database before
  applying it, at startup.
- This changelog, linked from the README and the docs.

### Changed

- The custom variables form shows values in clear, except for names containing `SECRET` or
  `PASSWORD` (masked, revealed on demand).
- The Network tab says the domain is given to the app as `PUBLIC_URL`.

### Fixed

- An update could fail when SolarOps backed up its database before a migration: a previous update
  had created the backups folder as root. The setup now gives that folder back to SolarOps, and a
  failed backup says why (startup errors now log their message).

## [0.2.1] - 2026-11-12

### Fixed

- The setup stopped at "Configuring pm2 startup" with no message when pm2 had been restarted by
  hand (`pm2 update`...): systemd refuses to adopt such a daemon. The setup now leaves it running,
  explains it and gives the command handing it back to its service; a real start failure shows the
  service status.

## [0.2.0] - 2026-11-12

First version: everything SolarOps does when the history starts.

- **Projects**: applications run with pm2 on their own port (first free slot of a configurable
  starting port and step), with start, stop, restart, live logs rotated by pm2-logrotate, and a
  liveness probe on `/` after each (re)start, waiting a startup time set per project; static sites
  are served by nginx from a public folder. Activation toggle; existing folders adopted without
  changes. The projects list opens a project from its card, and its website from its domain.
- **Deployments** from git: pull a branch, install, build, restart. npm, pnpm, yarn and bun are
  detected from `package.json` and the lockfile, devDependencies always installed; install and
  build take one command per line. *Pull only* is refused while the app runs. Webhooks for GitHub,
  Gitea, Forgejo, GitLab, Bitbucket Cloud and any CI: only pushes on the deployed branch deploy.
- **Databases**: one isolated PostgreSQL database and role per project, or a linked existing one;
  dumps, restore, wipe, password rotation, optional scheduled backups (daily or weekly, retention).
- **Mail**: shared SMTP relays given to projects as `SMTP_*` variables, with a from address per
  project.
- **Network**: nginx reverse proxy or static site, aliases, single-page-app fallback, WebSockets,
  upload size (100 MB by default), DNS check, and A / AAAA records created through a DNS account
  (OVHcloud, Cloudflare, DigitalOcean) for the server's public IPv4 / IPv6.
- **Certificates**: Let's Encrypt over HTTP-01 or DNS-01, auto-renewal, staging mode, and shared
  certificates (wildcards) selected by several projects.
- **Environment**: `PORT`, `DB_*`, `SMTP_*` and custom variables, encrypted at rest, secrets
  redacted in the UI and the logs.
- **Dashboard**: online projects, server CPU, memory and storage, health checks, certificates,
  databases and pipelines, over the projects drawn as a tilted, animated solar system.
- **Overview** of a project: process metrics, components, recent operations, where everything lives
  on the server, and its disk space measured on demand.
- **Alerts** (System › Alerts): e-mails to every administrator when the disk is 80% full, CPU or
  memory reach 99%, a server health check fails, an active exposed application is down, or pm2
  keeps restarting a project.
- **Admins**: several admins, password or magic-link login, audit journal, recovery CLI.
- **SolarOps itself**: a locked system project with its own domain, certificate and mail relay, and
  the server health checks.
- **Setup and updates**: `npm run setup` (Node.js 24 installed beforehand; asks for the domain and
  e-mail, keeps what is already installed, remembers its options), `npm run start`, `stop`,
  `restart`, `serve`, and `npm run update` (`--check`, `--force`) with an automatic way back,
  `npm run rollback`, and database migrations applied after a backup.
- Docker test bench, ESLint and Prettier, documentation in `docs/`.

[0.3.3]: https://github.com/myeti/solar-ops/compare/0.3.2...0.3.3
[0.3.2]: https://github.com/myeti/solar-ops/compare/0.3.1...0.3.2
[0.3.1]: https://github.com/myeti/solar-ops/compare/0.3.0...0.3.1
[0.3.0]: https://github.com/myeti/solar-ops/compare/0.2.2...0.3.0
[0.2.2]: https://github.com/myeti/solar-ops/compare/0.2.1...0.2.2
[0.2.1]: https://github.com/myeti/solar-ops/compare/0.2.0...0.2.1
[0.2.0]: https://github.com/myeti/solar-ops/releases/tag/0.2.0
