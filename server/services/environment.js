/**
 * Environment variables given to a project at startup (pm2) and during
 * builds. Sources, applied in this order (later wins):
 *
 *   1. system    NODE_ENV, SOLAROPS_PROJECT, ROOT_DIR (the repo/ folder),
 *                DATA_DIR (the data/ folder, for runtime files),
 *                PORT (the project port), JWT_SECRET (generated once,
 *                services/projectSecrets.js)
 *   2. network   PUBLIC_URL (https://<domain>, http:// without certificate),
 *                when the project has a domain (not a wildcard);
 *                ANALYTICS_URL (the tracker script), when analytics are on
 *                (services/analytics.js)
 *   3. database  DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DATABASE_URL
 *   4. redis     REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_URL, when the
 *                project has its Redis instance (services/redis.js)
 *   5. smtp      SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD, SMTP_FROM
 *   6. provided  variables other projects provide (Environment tab), prefixed
 *                with their uid: umami's SCRIPT_URL is UMAMI_SCRIPT_URL; their
 *                values are resolved in the providing project (its own
 *                variables), which never passes on what it receives itself
 *   7. custom    variables defined by the admin (can override anything above)
 *
 * Custom values may reference other variables: ${NAME} is replaced by the
 * value NAME has for the process (API_URL=${PUBLIC_URL}/api), whatever its
 * source or position; inside NAME itself, ${NAME} is the value it overrides
 * (PUBLIC_URL=${PUBLIC_URL}/app). A bare $NAME is left as is, and $${NAME}
 * writes ${NAME} literally. An unknown NAME becomes empty, a loop is left
 * unexpanded: both are reported (`problems`). A value built from a secret
 * is a secret.
 */
import { Project, SmtpAccount } from '../models/index.js';
import { analyticsScriptUrl } from './analytics.js';
import { resolveProjectPaths } from './projectPaths.js';
import { ensureProjectSecrets } from './projectSecrets.js';
import { getPostgresSettings } from './settings.js';

/**
 * Host used by projects to reach PostgreSQL. When SolarOps talks to a
 * local server, projects do too.
 */
function projectDatabaseHost(postgresSettings) {
  return postgresSettings.host || '127.0.0.1';
}

/**
 * The prefix of the variables a project provides: "umami" => "UMAMI_",
 * "uptime-kuma" => "UPTIME_KUMA_" (a uid starting with a digit gets "_").
 *
 * @param {string} uid
 */
export function providedPrefix(uid) {
  let prefix = `${uid.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_`;

  if (/^[0-9]/.test(prefix)) {
    prefix = `_${prefix}`;
  }

  return prefix;
}

/**
 * The variables a project provides to the others, resolved in its own
 * context: `${NAME}` is the value NAME has for the providing project.
 *
 * @param {import('../models/Project.js').default} provider
 * @returns {Promise<Array<{key: string, name: string, value: string, display: string, secret: boolean, problems: string[]}>>}
 *   key: prefixed (what the others receive), name: as written by the provider
 */
export async function listProvidedVariables(provider) {
  const provided = provider.providedEnv;

  if (provider.system || provided.variables.length === 0) {
    return [];
  }

  // Its own variables are already expanded: they are references, not templates.
  const own = (await listProjectVariables(provider, { withProvided: false })).map((variable) => {
    let source = variable.source;

    if (source === 'custom') {
      source = 'own';
    }

    return { ...variable, source };
  });
  const entries = provided.variables.map((entry) => ({
    key: entry.key,
    value: entry.value,
    source: 'custom',
    secret: looksSecret(entry.key),
    overridden: false,
  }));

  expandCustomVariables([...own, ...entries]);

  const prefix = providedPrefix(provider.uid);

  return entries.map((entry) => ({
    key: `${prefix}${entry.key}`,
    name: entry.key,
    value: entry.value,
    display: entry.display,
    secret: entry.secret,
    problems: entry.problems,
  }));
}

/**
 * What the other enabled providers give a project.
 *
 * @param {import('../models/Project.js').default} consumer
 */
async function receivedVariables(consumer) {
  const providers = await Project.findAll({ where: { system: false }, order: [['uid', 'ASC']] });
  const received = [];

  for (const provider of providers) {
    if (provider.id === consumer.id || !provider.providedEnv.enabled) {
      continue;
    }

    for (const entry of await listProvidedVariables(provider)) {
      received.push({ ...entry, provider: { uid: provider.uid, name: provider.name } });
    }
  }

  return received;
}

/**
 * Build the list of variables for a project.
 *
 * @param {import('../models/Project.js').default} project
 * @param {object} [options]
 * @param {boolean} [options.withProvided] include what other projects provide (default true)
 * @returns {Promise<Array<{key: string, value: string, source: string, secret: boolean, overridden: boolean}>>}
 */
export async function listProjectVariables(project, options = {}) {
  const variables = [];

  const add = (key, value, source, secret, extra = {}) => {
    variables.push({ key, value: String(value), source, secret, overridden: false, ...extra });
  };

  add('NODE_ENV', 'production', 'system', false);
  add('SOLAROPS_PROJECT', project.uid, 'system', false);
  const paths = await resolveProjectPaths(project);
  add('ROOT_DIR', paths.repo, 'system', false);

  if (!project.system) {
    add('DATA_DIR', paths.data, 'system', false);
  }

  if (project.port) {
    add('PORT', project.port, 'system', false);
  }

  if (!project.system) {
    add('JWT_SECRET', (await ensureProjectSecrets(project)).jwtSecret, 'system', true);
  }

  // The address the project is meant to be reached at: HTTPS as soon as a
  // certificate method is chosen (the certificate may come later).
  const network = project.network;

  if (network.enabled && network.domain && !network.domain.includes('*')) {
    let scheme = 'http';

    if (network.certMethod !== 'none') {
      scheme = 'https';
    }

    add('PUBLIC_URL', `${scheme}://${network.domain}`, 'network', false);
  }

  const analyticsUrl = await analyticsScriptUrl();

  if (analyticsUrl !== null && !project.system) {
    add('ANALYTICS_URL', analyticsUrl, 'network', false);
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

  const redis = project.redis;
  if (redis.enabled && redis.port && redis.password) {
    add('REDIS_HOST', '127.0.0.1', 'redis', false);
    add('REDIS_PORT', redis.port, 'redis', false);
    add('REDIS_PASSWORD', redis.password, 'redis', true);
    add('REDIS_URL', `redis://:${encodeURIComponent(redis.password)}@127.0.0.1:${redis.port}/0`, 'redis', true);
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

  if (options.withProvided !== false && !project.system) {
    for (const entry of await receivedVariables(project)) {
      add(entry.key, entry.value, 'provided', entry.secret, { provider: entry.provider });
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

  expandCustomVariables(variables);

  return variables;
}

/** ${NAME}, or $${NAME} (kept literally). */
const REFERENCE = /\$(\$?)\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Expand the references of the custom variables (see the header). Each one
 * gets `template` (as written), `value` (expanded), `display` (expanded,
 * referenced secrets masked), `ownSecret` (secret by itself) and `problems`.
 *
 * @param {Array<object>} variables in order, generated ones first
 */
function expandCustomVariables(variables) {
  const final = new Map();

  for (const variable of variables) {
    final.set(variable.key, variable);
  }

  const results = new Map();
  const resolving = new Set();

  // The variable a reference points to: inside NAME, ${NAME} is the one it overrides.
  const targetOf = (variable, name) => {
    if (name !== variable.key) {
      return final.get(name) || null;
    }

    const index = variables.indexOf(variable);

    return variables.slice(0, index).findLast((candidate) => candidate.key === name) || null;
  };

  const resolve = (variable) => {
    if (variable.source !== 'custom') {
      let display = variable.value;

      if (variable.secret) {
        display = REDACTED;
      }

      return { value: variable.value, display, secret: variable.secret, problems: [], loop: false };
    }

    if (results.has(variable)) {
      return results.get(variable);
    }

    resolving.add(variable);

    const template = variable.value;
    const problems = [];
    let secret = variable.secret;
    let loop = false;
    let value = '';
    let display = '';
    let index = 0;

    for (const match of template.matchAll(REFERENCE)) {
      const [reference, escape, name] = match;
      const before = template.slice(index, match.index);

      value += before;
      display += before;
      index = match.index + reference.length;

      if (escape) {
        value += `\${${name}}`;
        display += `\${${name}}`;
        continue;
      }

      const target = targetOf(variable, name);

      if (target === null) {
        problems.push(`\${${name}} is empty: no variable ${name}.`);
        continue;
      }

      if (resolving.has(target)) {
        problems.push(`\${${name}} is left as is: ${name} refers back to ${variable.key}.`);
        loop = true;
        value += reference;
        display += reference;
        continue;
      }

      const resolved = resolve(target);

      if (resolved.loop) {
        problems.push(`\${${name}} is part of a loop of references.`);
        loop = true;
      }

      value += resolved.value;

      if (resolved.secret) {
        secret = true;
        display += REDACTED;
      } else {
        display += resolved.display;
      }
    }

    value += template.slice(index);
    display += template.slice(index);
    resolving.delete(variable);

    const result = { value, display, secret, problems, loop };
    results.set(variable, result);

    return result;
  };

  for (const variable of variables) {
    if (variable.source === 'custom') {
      const result = resolve(variable);

      variable.template = variable.value;
      variable.ownSecret = variable.secret;
      variable.value = result.value;
      variable.display = result.display;
      variable.secret = result.secret;
      variable.problems = result.problems;
    }
  }
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
  network: 'Network',
  database: 'Database (PostgreSQL)',
  redis: 'Redis',
  smtp: 'Mail (SMTP)',
  provided: 'Provided by other projects',
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
