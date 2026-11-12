# Changelog

Notable changes of SolarOps, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow
[Semantic Versioning](https://semver.org/).

Every change adds a line under **Unreleased**; a release renames that section to its version and
date, and the version in `package.json` follows.

## [Unreleased]

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

[Unreleased]: https://github.com/myeti/solar-ops/compare/0.2.1...develop
[0.2.1]: https://github.com/myeti/solar-ops/compare/0.2.0...0.2.1
[0.2.0]: https://github.com/myeti/solar-ops/releases/tag/0.2.0
