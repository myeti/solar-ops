# Development

[README](../README.md) › [Docs](README.md) › Development

## Run locally

```bash
npm install
```

```bash
npm run dev
```

The API runs on `http://127.0.0.1:4100` (auto-restart) and the UI on `http://localhost:5173`
(Vite, proxied to the API). Data goes to `./data`. Without nginx / pm2 / certbot / PostgreSQL
installed, the related actions fail with explicit messages and the health checks show what is
missing. `npm run build` builds the UI into `client/dist`, served by Express in production.

## Lint and format

```bash
npm run lint
```

```bash
npm run format
```

ESLint (`eslint.config.js`) checks JavaScript and Vue files, including the house style: no
ternaries, braces around every block. Prettier (`.prettierrc.json`) formats the code;
`npm run lint:fix` and `npm run format:check` exist too.

## Test bench (Docker)

[`docker/`](../docker/README.md) runs a disposable Ubuntu "VPS" with systemd, a PostgreSQL server
that already hosts databases, and Pebble (Let's Encrypt's test server). `deploy/install.sh` runs on
it for real, and certificates are actually issued:

```bash
cd docker && docker compose up -d --build && docker compose exec vps install-solarops
```

## Code layout

```
bin/solarops.js           CLI
deploy/install.sh          server installation script
server/
  config.js                environment configuration
  app.js, index.js         Express app and entry point
  database/                Sequelize connection, schema created from the models
  models/                  Sequelize models (encrypted attributes)
  services/                business logic: projects, deploy, git, pm2, nginx, certbot, postgres...
  routes/                  REST API
  middleware/              session, CSRF, security headers, rate limits, errors
  lib/                     crypto, validation, safe command execution, files
client/src/
  views/                   pages (Options API)
  components/              UI kit and feature components (FeatherIcon, PlanetAvatar, BrandMark...)
  services/                API client, session, toasts / dialogs, formatting
  styles/                  design tokens and components
deploy/                    setup (install.sh), service commands, updates and rollback (update.sh)
docs/                      documentation and screenshots
```

## Database schema and migrations

The models define the tables of new databases: at startup, `server/database/init.js` creates the
missing ones (`sequelize.sync()`, never `alter`). **Changes to existing tables are migrations**:
files `server/database/migrations/NNNN-what-it-does.js`, applied in order at startup, each in a
transaction, and recorded in the `solarops_migrations` table
([how to write one](../server/database/migrations/README.md)).

- Every migration checks before acting ("add this column if it is missing"): it runs on old
  databases, and on new ones that `sync()` already created with the change.
- Before applying migrations to an existing SQLite database, SolarOps backs it up in
  `<data folder>/backups/`; `npm run update` restores that backup if the new version fails, and
  `npm run rollback` does on demand.
- Forward only (no `down`). A database holding a migration the code does not know (a newer
  version's) is refused at startup instead of being damaged.
- Storing a new setting in an existing JSON column (`deploymentConfig`, `settings`...) needs no
  migration: give it a default in the model.
