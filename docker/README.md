# 🧪 SolarOps test bench

A disposable "VPS" to test SolarOps end to end, installer included, without a real server:

| Service | What it is |
| --- | --- |
| `vps` | Ubuntu 24.04 with **systemd** as PID 1, like a provider image. Nothing pre-installed: `install-solarops` installs Node.js 24 as an admin would, then `npm run setup` installs nginx, certbot, pm2 and SolarOps for real. |
| `postgres` | PostgreSQL 16 that **already hosts databases** (`legacy_shop`, `blog`), plus the `solarops_admin` role. |
| `pebble` | [Pebble](https://github.com/letsencrypt/pebble), Let's Encrypt's test ACME server: certificates are requested and validated over HTTP against the VPS, offline. |

> Test values only: the passwords in this folder are public, never reuse them.

## Start

From this `docker/` folder:

```bash
docker compose up -d --build
```

```bash
docker compose exec vps install-solarops
```

The second command copies the repository (mounted read-only at `/src`) to `/var/solarops` and runs
`deploy/install.sh` against the `postgres` container. It takes a few minutes the first time, and
prints a **setup token**. Then open <http://localhost:4100/setup>.

Changed the code? Run `install-solarops` again: it re-syncs the sources and re-runs the
(idempotent) setup, which keeps its previous options. `--domain` and `--email` are given to the
setup as answers to its questions; other arguments go to `install.sh` as options, e.g.
`install-solarops --domain solarops.test --email admin@solarops.test`.

`install-solarops` itself is copied into the image when it is built: after changing
`vps/install-solarops.sh`, rebuild it with `docker compose build vps` (the VPS is recreated, its
state lost). `npm run update` needs a git clone: the bench copies the sources without `.git`.

## Scenarios to try

**Link an existing database** — create a project, *Database › Link an existing database*, paste:

```
postgres://legacy_shop:legacy-shop-test@postgres:5432/legacy_shop
```

**Adopt an existing project** — the installer seeds `/var/www/blog`, a project that "ran
before SolarOps": app at the folder root, owned by another user (`deploy`), with a hand-written
`etc/nginx.conf`. Create a project named **Blog**: the form warns about all of it, and nothing is
erased or replaced. The `blog` database already exists too: *Create* is refused, link it with
`postgres://blog:blog-test@postgres:5432/blog`. To let SolarOps write in the folder:

```bash
docker compose exec vps chown -R solarops: /var/www/blog
```

**Deploy, serve and certify an application** — create an *application* with a git deployment of
a Node app that listens on `PORT` (e.g. `https://github.com/heroku/node-js-getting-started.git`,
branch `main`), domain `app.solarops.test`, certificate *Let's Encrypt · HTTP*. Deploy, start,
obtain the certificate (issued by Pebble), then check from the VPS:

```bash
docker compose exec vps curl -sk https://app.solarops.test
```

**A static site** — create a *static site*, put files in its `repo/dist` (deploy a frontend repo, or
`docker compose exec vps sudo -u solarops sh -c 'echo "<h1>Hi</h1>" > /var/www/<uid>/repo/dist/index.html'`
after `mkdir -p`), domain `shop.solarops.test`, then:

```bash
docker compose exec vps curl -sk https://shop.solarops.test
```

**SolarOps's own domain**:

```bash
docker compose exec vps solarops domain:set solarops.test --email admin@solarops.test
```

Test domains Pebble can validate (Docker network aliases of the VPS, see `compose.yml`):
`solarops.test`, `app.solarops.test`, `www.app.solarops.test`, `shop.solarops.test`,
`blog.solarops.test`.

## Handy commands

| Command | Purpose |
| --- | --- |
| `docker compose exec vps bash` | Shell on the VPS (as root) |
| `docker compose exec vps journalctl -u solarops -f` | SolarOps logs |
| `docker compose exec vps solarops doctor` | Health checks from the CLI |
| `docker compose exec vps sudo -iu solarops pm2 ls` | pm2 processes |
| `docker compose exec vps nginx -T` | Full nginx configuration |
| `docker compose exec postgres psql -U postgres` | PostgreSQL superuser shell |
| `docker compose down` | Stop; the next `up` starts from a **fresh VPS** (database kept) |
| `docker compose down -v` | Also reset PostgreSQL to the fixtures |

## Ports and browsers

The host ports (bound to `127.0.0.1` only) can be changed with environment variables:
`BENCH_UI_PORT` (4100, SolarOps), `BENCH_HTTP_PORT` (8080 → 80), `BENCH_HTTPS_PORT` (8443 → 443),
`BENCH_PG_PORT` (55432 → PostgreSQL).

To open the test domains in a browser, add them to `/etc/hosts` (`127.0.0.1 app.solarops.test …`)
and start the bench with `BENCH_HTTP_PORT=80 BENCH_HTTPS_PORT=443` (HTTPS redirects target port 443).
Pebble's certificates are not trusted by browsers: prefer `curl -k` from the VPS, or disable
*Force HTTPS* for browser tests (HSTS would prevent bypassing the warning).

## Differences with a real server

- Sources come from `/src` instead of `git clone`; PostgreSQL is a separate container
  (`install.sh --pg-host`) and SolarOps listens on `0.0.0.0` inside the container
  (`--host`) so the UI is reachable through the port mapping.
- certbot uses Pebble (`SOLAROPS_CERTBOT_BIN` in `/var/solarops/.env`): don't enable
  *Let's Encrypt staging* in Settings here (it conflicts with the custom ACME server).
- DNS-01 certificates (OVH, Cloudflare...) cannot be tested: they need a real DNS provider.
