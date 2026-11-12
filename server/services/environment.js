/**
 * Environment variables given to a project at startup (pm2) and during
 * builds. Sources, applied in this order (later wins):
 *
 *   1. system    NODE_ENV, SOLAROPS_PROJECT, PORT (the project port)
 *   2. database  DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DATABASE_URL
 *   3. smtp      SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD, SMTP_FROM
 *   4. custom    variables defined by the admin (can override anything above)
 */
import { SmtpAccount } from '../models/index.js';
import { getPostgresSettings } from './settings.js';

/**
 * Host used by projects to reach PostgreSQL. When SolarOps talks to a
 * local server, projects do too.
 */
function projectDatabaseHost(postgresSettings) {
  return postgresSettings.host || '127.0.0.1';
}

/**
 * Build the list of variables for a project.
 *
 * @param {import('../models/Project.js').default} project
 * @returns {Promise<Array<{key: string, value: string, source: string, secret: boolean, overridden: boolean}>>}
 */
export async function listProjectVariables(project) {
  const variables = [];

  const add = (key, value, source, secret) => {
    variables.push({ key, value: String(value), source, secret, overridden: false });
  };

  add('NODE_ENV', 'production', 'system', false);
  add('SOLAROPS_PROJECT', project.uid, 'system', false);

  if (project.port) {
    add('PORT', project.port, 'system', false);
  }

  const database = project.database;
  if (database.enabled && database.name) {
    const postgres = await getPostgresSettings();
    const host = projectDatabaseHost(postgres);
    const url = `postgres://${encodeURIComponent(database.user)}:${encodeURIComponent(database.password)}@${host}:${postgres.port}/${database.name}`;

    add('DB_HOST', host, 'database', false);
    add('DB_PORT', postgres.port, 'database', false);
    add('DB_NAME', database.name, 'database', false);
    add('DB_USER', database.user, 'database', false);
    add('DB_PASSWORD', database.password, 'database', true);
    add('DATABASE_URL', url, 'database', true);
  }

  const smtp = project.smtp;
  if (smtp.enabled && smtp.accountId) {
    const account = await SmtpAccount.findByPk(smtp.accountId);

    if (account !== null) {
      add('SMTP_HOST', account.host, 'smtp', false);
      add('SMTP_PORT', account.port, 'smtp', false);
      add('SMTP_SECURE', account.secure, 'smtp', false);
      add('SMTP_USER', account.username || '', 'smtp', false);
      add('SMTP_PASSWORD', account.password || '', 'smtp', true);
      add('SMTP_FROM', smtp.fromAddress || account.fromAddress, 'smtp', false);
    }
  }

  for (const entry of project.env) {
    const existing = variables.find((variable) => variable.key === entry.key);
    let secret = looksSecret(entry.key);

    if (existing) {
      existing.overridden = true;

      // Overriding DATABASE_URL or SMTP_PASSWORD keeps it a secret.
      if (existing.secret) {
        secret = true;
      }
    }

    add(entry.key, entry.value, 'custom', secret);
  }

  return variables;
}

/**
 * Heuristic: custom variables whose name suggests a secret are masked in
 * the UI preview and redacted from task logs.
 *
 * @param {string} key
 */
export function looksSecret(key) {
  return /(SECRET|TOKEN|PASSWORD|PASSWD|PASS|KEY|PRIVATE|CREDENTIAL|AUTH|DSN)/i.test(key);
}

const REDACTED = '••••••••';

/** Comment heading each group of variables in the .env rendering. */
const SOURCE_TITLES = {
  system: 'SolarOps',
  database: 'Database (PostgreSQL)',
  smtp: 'Mail (SMTP)',
  custom: 'Custom',
};

/** Characters that never need quotes in a .env value. */
const UNQUOTED_VALUE = /^[A-Za-z0-9_./:@%+,=\u2022-]*$/;

/** scheme://user:password@rest, the password being group 2. */
const URL_WITH_PASSWORD = /^([a-z][a-z0-9+.-]*:\/\/[^:/@\s]*:)([^@\s]*)(@.*)$/i;

/**
 * Hide what must stay hidden in a value. Connection URLs keep everything
 * but their password (postgres://app:••••••••@127.0.0.1:5432/app), even
 * when the variable name does not look secret (a custom REDIS_URL...).
 *
 * @param {string} value
 * @param {boolean} secret
 */
function redactValue(value, secret) {
  const url = URL_WITH_PASSWORD.exec(value);

  if (url !== null) {
    return `${url[1]}${REDACTED}${url[3]}`;
  }

  if (secret) {
    return REDACTED;
  }

  return value;
}

/**
 * Quote a value the way .env files expect, when needed.
 *
 * @param {string} value
 */
function formatDotenvValue(value) {
  if (UNQUOTED_VALUE.test(value)) {
    return value;
  }

  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

  return `"${escaped}"`;
}

/**
 * The environment of a project as a .env file, secrets redacted: what the
 * process receives (variables overridden by a custom one are left out),
 * grouped by source.
 *
 * @param {import('../models/Project.js').default} project
 * @returns {Promise<{content: string, count: number}>}
 */
export async function renderRedactedDotenv(project) {
  const variables = (await listProjectVariables(project)).filter((variable) => !variable.overridden);
  const lines = [];
  let currentSource = null;

  for (const variable of variables) {
    if (variable.source !== currentSource) {
      if (lines.length > 0) {
        lines.push('');
      }

      lines.push(`# ${SOURCE_TITLES[variable.source] || variable.source}`);
      currentSource = variable.source;
    }

    const value = redactValue(variable.value, variable.secret);

    lines.push(`${variable.key}=${formatDotenvValue(value)}`);
  }

  return { content: `${lines.join('\n')}\n`, count: variables.length };
}

/**
 * Variables as a plain object, ready to be passed to a process.
 *
 * @param {import('../models/Project.js').default} project
 * @returns {Promise<Record<string, string>>}
 */
export async function buildProjectEnv(project) {
  const variables = await listProjectVariables(project);
  const env = {};

  for (const variable of variables) {
    env[variable.key] = variable.value;
  }

  return env;
}

/**
 * The environment of SolarOps itself, minus its own secrets. Used as the
 * base for every command run on behalf of a project (git, npm, builds).
 *
 * @returns {Record<string, string>}
 */
export function baseProcessEnv() {
  const env = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('SOLAROPS_') || key === 'NODE_OPTIONS') {
      continue;
    }

    env[key] = value;
  }

  return env;
}

/**
 * Values that must never appear in task logs.
 *
 * @param {import('../models/Project.js').default} project
 * @returns {Promise<string[]>}
 */
export async function listProjectSecrets(project) {
  const variables = await listProjectVariables(project);

  return variables
    .filter((variable) => variable.secret && variable.value.length >= 6)
    .map((variable) => variable.value);
}
