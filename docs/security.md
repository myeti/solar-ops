# Security

[README](../README.md) › [Docs](README.md) › Security

## Security model

SolarOps controls the whole server, so it is designed as a single point of failure that stays
safe and recoverable:

- **Least privilege** — runs as the unprivileged `solarops` user; root is only reachable through
  two exact sudo commands (`nginx -t`, `systemctl reload nginx`). Certbot runs unprivileged with
  per-project directories. The PostgreSQL role is not superuser. Sources are owned by root.
- **No shell injection** — commands are spawned with argument arrays, never through a shell,
  except scripts an admin explicitly typed (build / install commands). Every input is validated
  (uids, domains, paths, branch names, git URLs: `file://` and `ext::` are refused).
- **Secrets encrypted at rest** — AES-256-GCM with a master key in `/var/lib/solarops/master.key`
  (0600). Secrets are never returned by the API unless explicitly revealed (and audited), and are
  redacted from task logs. Git tokens go through `GIT_ASKPASS`, never into URLs or `.git/config`.
- **Authentication** — scrypt password hashing (N=2¹⁶), constant-time checks without user
  enumeration, rate limiting, sessions stored as SHA-256 hashes with idle and absolute expiry,
  `HttpOnly` + `SameSite=Strict` cookies. Magic links are single-use, expire in 15 minutes, and
  are always built from SolarOps's own HTTPS domain (never from the `Host` header).
- **CSRF** — state-changing API calls require a custom header (impossible cross-site without
  CORS, which is never enabled) and a matching `Origin`.
- **Headers** — strict Content Security Policy (everything self-hosted, fonts included),
  `frame-ancestors 'none'`, HSTS, no `X-Powered-By`.
- **nginx changes are transactional** — written, validated with `nginx -t`, rolled back on
  failure: a bad config never takes the other projects down.
- **Audit journal** — logins (and failures), configuration changes, deployments, secret reveals.

## Emergency recovery (CLI)

The CLI works directly on SolarOps's database: it is the way back in when the UI is not.

```bash
sudo solarops help
```

| Command | Purpose |
| --- | --- |
| `solarops admin:reset-password <email>` | New generated password, all sessions closed |
| `solarops admin:create <email>` | Create an admin |
| `solarops admin:list` / `admin:delete <email>` | Manage admins |
| `solarops auth:password` | Back to password login (e.g. broken SMTP with magic links) |
| `solarops sessions:revoke [email]` | Sign everybody (or one admin) out |
| `solarops setup:token` | New setup token (before the first admin exists) |
| `solarops domain:set <domain> --email <email>` | Serve SolarOps on a domain and obtain its certificate |
| `solarops domain:reset` | Stop serving SolarOps on its domain, back to password login |
| `solarops certs:renew` | Renew due certificates (run daily by `solarops-certs.timer`) |
| `solarops doctor` | Check binaries, nginx, PostgreSQL and folders |

If SolarOps is down, projects keep running (pm2 has its own service), and any project can be
started by hand: `sudo -u solarops pm2 start /var/www/<project>/etc/pm2.json`.

## Backups

Back up:

- `/var/lib/solarops`: the SQLite database **and** `master.key` (without the key, stored secrets
  cannot be decrypted), the shared certificates, and `backups/` (the database copies taken before
  each update's migrations, the last 5 kept);
- `/var/www`: the projects, their certificates and dumps, scheduled database backups included;
- `/var/solarops/.env`.
