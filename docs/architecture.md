# How it works

[README](../README.md) › [Docs](README.md) › How it works

## Overview

```
                      ┌──────────────────────── your VPS ────────────────────────┐
  browser ──HTTPS──▶  │ nginx ──▶ SolarOps (127.0.0.1:4100, user "solarops")     │
                      │   │          │ writes          │ drives                  │
                      │   │          ▼                 ▼                         │
                      │   ├──▶ /var/www/<project>/etc/nginx.conf             pm2 │
                      │   │                                              certbot │
  visitors ──HTTPS──▶ │   └──▶ project apps (proxy :port, or static files)  git  │
                      │                                              PostgreSQL  │
                      └──────────────────────────────────────────────────────────┘
```

SolarOps is a Node.js service (Express 5 API + Vue 3 UI) running as the unprivileged `solarops`
user. It does not replace the usual tools, it drives them:

- **nginx** serves every project, through one include of the generated configurations; each
  change is validated with `nginx -t` and rolled back on failure;
- **pm2** runs the applications, under its own systemd service: they keep running when SolarOps
  is down, and come back after a reboot;
- **certbot** obtains and renews the Let's Encrypt certificates;
- **git** fetches the sources; **npm, pnpm, yarn or bun** install and build them;
- **PostgreSQL** hosts one database and role per project.

## Project folders

Every project lives in its own folder, so it can be inspected, backed up, or even started by
hand when SolarOps itself is unavailable:

```
/var/www/<project>/
├── repo/                  the application (git clone)
├── etc/
│   ├── nginx.conf         generated server blocks (loaded by nginx through one include)
│   ├── pm2.json           generated pm2 declaration, mode 0600 (emergency: pm2 start etc/pm2.json)
│   ├── acme/              webroot for Let's Encrypt HTTP-01 challenges
│   ├── letsencrypt/       certbot configuration and certificates of this project
│   └── dns-credentials.ini  DNS provider credentials, mode 0600 (DNS-01 only)
├── db/                    database dumps, mode 0700
└── logs/                  stdout / stderr
```

SolarOps itself uses `<base folder>/solarops/etc/` the same way (nginx config and certificate).

## SolarOps's own data

`/var/lib/solarops` holds SolarOps's database (SQLite by default, so it keeps working even if
PostgreSQL is down), the master key encrypting the stored secrets, and the shared certificates.
See [backups](security.md#backups).
