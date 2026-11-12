/**
 * SolarOps runtime configuration.
 *
 * System-level configuration (network binding, data directory, database,
 * commands used to drive nginx / certbot / pm2...) is read from environment
 * variables, optionally loaded from a `.env` file at the project root.
 *
 * This is intentionally NOT editable from the web UI: changing how SolarOps
 * talks to the operating system must require shell access to the server.
 * Functional settings (base folder, auth method, ...) live in the database
 * and are editable from the UI.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

loadEnvFile();

/**
 * Load the `.env` file if present. Variables already defined in the real
 * environment always win over the file.
 */
function loadEnvFile() {
  const envPath = process.env.SOLAROPS_ENV_FILE || path.join(ROOT_DIR, '.env');

  if (fs.existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

/**
 * Read a string environment variable.
 *
 * @param {string} name
 * @param {string} fallback
 * @returns {string}
 */
function readString(name, fallback) {
  const value = process.env[name];

  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  return value.trim();
}

/**
 * Read an integer environment variable.
 *
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
function readInteger(name, fallback) {
  const value = Number.parseInt(readString(name, ''), 10);

  if (Number.isNaN(value)) {
    return fallback;
  }

  return value;
}

/**
 * Read a boolean environment variable ("true", "1", "yes" are truthy).
 *
 * @param {string} name
 * @param {boolean} fallback
 * @returns {boolean}
 */
function readBoolean(name, fallback) {
  const value = readString(name, '').toLowerCase();

  if (value === '') {
    return fallback;
  }

  return ['true', '1', 'yes', 'on'].includes(value);
}

const dataDir = path.resolve(ROOT_DIR, readString('SOLAROPS_DATA_DIR', 'data'));

const config = {
  rootDir: ROOT_DIR,
  isDevelopment: readString('NODE_ENV', 'production') === 'development',

  /** HTTP binding. Keep 127.0.0.1 and expose SolarOps through nginx + TLS. */
  host: readString('SOLAROPS_HOST', '127.0.0.1'),
  port: readInteger('SOLAROPS_PORT', 4100),

  /** Express "trust proxy" setting (SolarOps usually sits behind nginx). */
  trustProxy: readString('SOLAROPS_TRUST_PROXY', 'loopback'),

  /** Secure cookies: "auto" (when the request is HTTPS), "true" or "false". */
  cookieSecure: readString('SOLAROPS_COOKIE_SECURE', 'auto'),

  /** Where SolarOps keeps its own state (database, master key...). */
  dataDir,

  /**
   * Default projects base folder (written by deploy/install.sh so it matches
   * the nginx include). Can be changed in Settings while no project exists.
   */
  defaultBaseFolder: readString('SOLAROPS_BASE_FOLDER', '/var/www').replace(/\/+$/, ''),

  /**
   * SolarOps's own database. Defaults to a SQLite file so SolarOps keeps
   * working (and stays recoverable) even if PostgreSQL is down.
   * Set SOLAROPS_DB_URL=postgres://user:pass@host:5432/db to use PostgreSQL.
   */
  database: {
    url: readString('SOLAROPS_DB_URL', ''),
    sqliteFile: path.resolve(ROOT_DIR, readString('SOLAROPS_DB_FILE', path.join(dataDir, 'solarops.sqlite'))),
    logging: readBoolean('SOLAROPS_DB_LOGGING', false),
  },

  /**
   * Initial PostgreSQL admin connection (written by deploy/install.sh).
   * Used until the connection is saved from the UI, which then takes over.
   */
  postgres: {
    host: readString('SOLAROPS_PG_HOST', '127.0.0.1'),
    port: readInteger('SOLAROPS_PG_PORT', 5432),
    user: readString('SOLAROPS_PG_USER', 'solarops_admin'),
    password: readString('SOLAROPS_PG_PASSWORD', ''),
    database: readString('SOLAROPS_PG_DATABASE', 'postgres'),
  },

  /**
   * 32-byte key (hex or base64) used to encrypt secrets at rest. When empty,
   * a key is generated once in `<dataDir>/master.key` (mode 0600).
   */
  masterKey: readString('SOLAROPS_MASTER_KEY', ''),

  session: {
    /** A session expires after this many hours without activity. */
    idleHours: readInteger('SOLAROPS_SESSION_IDLE_HOURS', 24),
    /** A session never lives longer than this many days. */
    maxDays: readInteger('SOLAROPS_SESSION_MAX_DAYS', 7),
  },

  /**
   * External commands. Each value is a command line split on spaces
   * (no shell is involved), e.g. "sudo -n systemctl reload nginx".
   */
  commands: {
    git: readString('SOLAROPS_GIT_BIN', 'git'),
    npm: readString('SOLAROPS_NPM_BIN', 'npm'),
    pm2: readString('SOLAROPS_PM2_BIN', 'pm2'),
    certbot: readString('SOLAROPS_CERTBOT_BIN', 'certbot'),
    pgDump: readString('SOLAROPS_PG_DUMP_BIN', 'pg_dump'),
    pgRestore: readString('SOLAROPS_PG_RESTORE_BIN', 'pg_restore'),
    nginxTest: readString('SOLAROPS_NGINX_TEST_CMD', 'sudo -n nginx -t'),
    nginxReload: readString('SOLAROPS_NGINX_RELOAD_CMD', 'sudo -n systemctl reload nginx'),
  },

  nginx: {
    /** Also listen on IPv6 in generated server blocks. */
    ipv6: readBoolean('SOLAROPS_NGINX_IPV6', true),
  },

  /** Maximum duration of a single deployment / build step. */
  taskTimeoutMinutes: readInteger('SOLAROPS_TASK_TIMEOUT_MINUTES', 20),

  /** How long an application has to answer on / after a (re)start. */
  livenessTimeoutSeconds: readInteger('SOLAROPS_LIVENESS_TIMEOUT_SECONDS', 30),

  /** How often the alert rules are checked (services/alerts.js). */
  alertCheckSeconds: readInteger('SOLAROPS_ALERT_CHECK_SECONDS', 60),

  /** Built Vue application served by Express in production. */
  clientDist: path.join(ROOT_DIR, 'client', 'dist'),
};

export default config;
