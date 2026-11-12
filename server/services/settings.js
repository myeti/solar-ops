/**
 * SolarOps functional settings (editable from the UI), stored as JSON in
 * the `settings` table. This module is the single place that knows default
 * values and which settings are secret.
 *
 * No in-memory cache on purpose: the CLI may change settings while the
 * server is running (e.g. `solarops auth:password`).
 */
import config from '../config.js';
import { Setting } from '../models/index.js';
import { encrypt, decrypt } from '../lib/crypto.js';

export const AUTH_METHODS = ['password', 'magic-link'];

/**
 * Settings visible and editable in the UI, with their defaults.
 * SolarOps's own domain and mail relay are not settings: they are the
 * network and mail components of the system project.
 */
const GENERAL_DEFAULTS = {
  /** Folder in which every project folder is created. */
  baseFolder: config.defaultBaseFolder,
  /** "password" or "magic-link". */
  authMethod: 'password',
  /** E-mail registered with Let's Encrypt (expiry notices). */
  acmeEmail: '',
  /** Use the Let's Encrypt staging environment (testing, no rate limits). */
  acmeStaging: false,
  /** Public IPv4 of the server: DNS check, and A records created through a DNS account. */
  serverIp: '',
  /** Public IPv6 of the server, if any: DNS check, and AAAA records. Never detected. */
  serverIpv6: '',
  /** New applications get the first free port of firstPort + n × portStep (see services/ports.js). */
  firstPort: 3000,
  portStep: 10,
};

/** Until saved from the UI, the connection comes from the environment (.env). */
const POSTGRES_DEFAULTS = {
  host: config.postgres.host,
  port: config.postgres.port,
  user: config.postgres.user,
  database: config.postgres.database,
  ssl: false,
  passwordEncrypted: '',
};

/**
 * Read one raw setting.
 *
 * @param {string} key
 * @param {*} fallback
 */
export async function getSetting(key, fallback = null) {
  const row = await Setting.findByPk(key);

  if (row === null) {
    return fallback;
  }

  return JSON.parse(row.value);
}

/**
 * Write one raw setting.
 *
 * @param {string} key
 * @param {*} value any JSON serialisable value
 */
export async function setSetting(key, value) {
  await Setting.upsert({ key, value: JSON.stringify(value) });
}

/**
 * Delete one raw setting.
 *
 * @param {string} key
 */
export async function deleteSetting(key) {
  await Setting.destroy({ where: { key } });
}

/**
 * All general settings merged with defaults.
 *
 * @returns {Promise<typeof GENERAL_DEFAULTS>}
 */
export async function getGeneralSettings() {
  const result = { ...GENERAL_DEFAULTS };
  const rows = await Setting.findAll({ where: { key: Object.keys(GENERAL_DEFAULTS) } });

  for (const row of rows) {
    result[row.key] = JSON.parse(row.value);
  }

  return result;
}

/**
 * Update some general settings. Unknown keys are ignored.
 *
 * @param {Partial<typeof GENERAL_DEFAULTS>} patch
 */
export async function updateGeneralSettings(patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (key in GENERAL_DEFAULTS && value !== undefined) {
      await setSetting(key, value);
    }
  }

  return getGeneralSettings();
}

/**
 * Connection used to administrate the PostgreSQL server (create roles and
 * databases for projects).
 *
 * @param {object} [options]
 * @param {boolean} [options.withPassword] include the decrypted password
 */
export async function getPostgresSettings(options = {}) {
  const stored = await getSetting('postgres', {});
  const merged = { ...POSTGRES_DEFAULTS, ...stored };

  const result = {
    host: merged.host,
    port: merged.port,
    user: merged.user,
    database: merged.database,
    ssl: merged.ssl,
    hasPassword: Boolean(merged.passwordEncrypted || config.postgres.password),
  };

  if (options.withPassword) {
    if (merged.passwordEncrypted) {
      result.password = decrypt(merged.passwordEncrypted);
    } else {
      result.password = config.postgres.password;
    }
  }

  return result;
}

/**
 * Save the PostgreSQL admin connection. When `password` is undefined the
 * current password is kept.
 */
export async function updatePostgresSettings({ host, port, user, database, ssl, password }) {
  const stored = await getSetting('postgres', {});
  const next = { ...POSTGRES_DEFAULTS, ...stored, host, port, user, database, ssl };

  if (password !== undefined) {
    if (password === '') {
      next.passwordEncrypted = '';
    } else {
      next.passwordEncrypted = encrypt(password);
    }
  }

  await setSetting('postgres', next);

  return getPostgresSettings();
}
