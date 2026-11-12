/**
 * PostgreSQL administration: one role + one database per project.
 *
 * SolarOps connects with an admin role (CREATEDB + CREATEROLE is enough,
 * see deploy/install.sh). A project database is either:
 *
 *   - created by SolarOps: a LOGIN role named after the uid (my-app =>
 *     my_app), a database with the same name owned by that role, and CONNECT
 *     revoked from PUBLIC so projects cannot see each other;
 *   - linked ("adopted"): a database that already existed. SolarOps only
 *     verifies the credentials and never changes its roles, permissions or
 *     data on its own.
 *
 * SolarOps never takes over an existing role or database by accident:
 * creating one whose name is already used fails.
 *
 * Dumps and restores run with the project's own credentials (least privilege).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import config from '../config.js';
import { splitCommandLine } from '../lib/exec.js';
import { HttpError, badRequest, conflict } from '../lib/errors.js';
import { baseProcessEnv } from './environment.js';
import { getPostgresSettings } from './settings.js';

/**
 * Dump file names produced by SolarOps: <uid>-YYYYMMDD-HHMMSS.dump, and
 * <uid>-auto-YYYYMMDD-HHMMSS.dump for scheduled backups (see isAutomaticDump).
 */
export const DUMP_FILE_PATTERN = /^[a-z0-9-]+-\d{8}-\d{6}\.dump$/;

/**
 * Whether a dump of a project was made by its scheduled backups (only those
 * are deleted by the retention).
 *
 * @param {string} uid
 * @param {string} fileName
 */
export function isAutomaticDump(uid, fileName) {
  const prefix = `${uid}-auto-`;

  return fileName.startsWith(prefix) && /^\d{8}-\d{6}\.dump$/.test(fileName.slice(prefix.length));
}

/** Names accepted for existing databases and roles (max 63 bytes in PostgreSQL). */
export const PG_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/;

/** Databases that are never offered for linking. */
const SYSTEM_DATABASES = ['postgres', 'template0', 'template1'];

/**
 * node-postgres SSL option for the configured server.
 */
function sslOption(settings) {
  if (settings.ssl) {
    return { rejectUnauthorized: false };
  }

  return false;
}

/**
 * Open a client with the admin connection, run `work`, always close.
 *
 * @template T
 * @param {(client: pg.Client) => Promise<T>} work
 * @param {object} [options]
 * @param {string} [options.database] database to connect to
 * @param {object} [options.settings] connection settings to test (defaults to saved ones)
 * @returns {Promise<T>}
 */
async function withAdminClient(work, options = {}) {
  let settings = options.settings;

  if (!settings) {
    settings = await getPostgresSettings({ withPassword: true });
  }

  if (!settings.host || !settings.user) {
    throw badRequest('The PostgreSQL server is not configured yet (Infrastructure › Database).');
  }

  const client = new pg.Client({
    host: settings.host,
    port: settings.port,
    user: settings.user,
    password: settings.password || undefined,
    database: options.database || settings.database || 'postgres',
    ssl: sslOption(settings),
    connectionTimeoutMillis: 8000,
    statement_timeout: 60000,
    application_name: 'solarops',
  });

  try {
    await client.connect();
  } catch (error) {
    throw new HttpError(
      502,
      `Could not connect to PostgreSQL at ${settings.host}:${settings.port} as ${settings.user}: ${error.message}`,
    );
  }

  try {
    return await work(client);
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    // Driver errors (permission denied, ...) are operational: show them.
    throw new HttpError(502, `PostgreSQL: ${error.message}`);
  } finally {
    await client.end();
  }
}

/**
 * Check the admin connection and report the server version.
 *
 * @param {object} [settings] unsaved settings to test
 */
export async function testPostgresConnection(settings) {
  return withAdminClient(
    async (client) => {
      const version = await client.query('SHOW server_version');
      const role = await client.query(
        'SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user',
      );
      const privileges = role.rows[0] || {};

      return {
        version: version.rows[0].server_version,
        superuser: privileges.rolsuper === true,
        canCreateDatabases: privileges.rolsuper === true || privileges.rolcreatedb === true,
        canCreateRoles: privileges.rolsuper === true || privileges.rolcreaterole === true,
      };
    },
    { settings },
  );
}

/**
 * Every non-template database with its owner and size.
 */
export async function listDatabases() {
  return withAdminClient(async (client) => {
    const result = await client.query(`
      SELECT d.datname AS name,
             pg_catalog.pg_get_userbyid(d.datdba) AS owner,
             CASE WHEN has_database_privilege(d.datname, 'CONNECT')
                  THEN pg_database_size(d.datname)
                  ELSE NULL END AS size
      FROM pg_database d
      WHERE NOT d.datistemplate
      ORDER BY d.datname
    `);

    return result.rows.map((row) => {
      let sizeBytes = null;
      if (row.size !== null) {
        sizeBytes = Number(row.size);
      }

      return { name: row.name, owner: row.owner, sizeBytes };
    });
  });
}

/**
 * Whether a database and a role exist on the server, and who owns the database.
 *
 * @param {string} name database name
 * @param {string} user role name
 * @returns {Promise<{databaseExists: boolean, roleExists: boolean, owner: string|null}>}
 */
export async function inspectNames(name, user) {
  return withAdminClient(async (client) => {
    const database = await client.query(
      'SELECT pg_catalog.pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = $1',
      [name],
    );
    const role = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [user]);
    let owner = null;

    if (database.rowCount > 0) {
      owner = database.rows[0].owner;
    }

    return { databaseExists: database.rowCount > 0, roleExists: role.rowCount > 0, owner };
  });
}

/**
 * Create the role and database of a project.
 *
 * Without `allowExisting`, an existing role or database with the same name
 * is never touched: the call fails, so a running application never loses its
 * password or data. `allowExisting` is only used to repair a database that
 * SolarOps itself created earlier.
 *
 * @param {object} database
 * @param {string} database.name
 * @param {string} database.user
 * @param {string} database.password
 * @param {object} [options]
 * @param {boolean} [options.allowExisting]
 */
export async function provisionDatabase({ name, user, password }, options = {}) {
  await withAdminClient(async (client) => {
    const role = client.escapeIdentifier(user);
    const db = client.escapeIdentifier(name);
    const literalPassword = client.escapeLiteral(password);

    const existingRole = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [user]);
    const existingDatabaseCheck = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);

    if (!options.allowExisting && (existingRole.rowCount > 0 || existingDatabaseCheck.rowCount > 0)) {
      throw conflict(
        `A database or role named "${name}" already exists on the server. SolarOps will not modify it: link it as an existing database instead.`,
      );
    }

    if (existingRole.rowCount === 0) {
      await client.query(`CREATE ROLE ${role} LOGIN PASSWORD ${literalPassword}`);
    } else {
      await client.query(`ALTER ROLE ${role} LOGIN PASSWORD ${literalPassword}`);
    }

    // Membership lets the admin role manage (dump, drop) the project database
    // without being superuser. Harmless if the admin is superuser.
    await client.query(`GRANT ${role} TO CURRENT_USER`);

    if (existingDatabaseCheck.rowCount === 0) {
      await client.query(`CREATE DATABASE ${db} OWNER ${role} ENCODING 'UTF8'`);
    }

    await client.query(`REVOKE ALL ON DATABASE ${db} FROM PUBLIC`);
    await client.query(`GRANT ALL ON DATABASE ${db} TO ${role}`);
  });
}

/**
 * Connect with a project's own credentials to check they work, and describe
 * what is inside. Read-only.
 *
 * @param {object} database
 * @param {string} database.name
 * @param {string} database.user
 * @param {string} database.password
 * @returns {Promise<{owner: string, ownedByUser: boolean, tableCount: number, sizeBytes: number, canCreate: boolean}>}
 */
export async function verifyCredentials({ name, user, password }) {
  const settings = await getPostgresSettings();
  const client = new pg.Client({
    host: settings.host,
    port: settings.port,
    user,
    password,
    database: name,
    ssl: sslOption(settings),
    connectionTimeoutMillis: 8000,
    statement_timeout: 30000,
    application_name: 'solarops',
  });

  try {
    await client.connect();
  } catch (error) {
    throw badRequest(`Could not connect to "${name}" as "${user}": ${error.message}`, {
      fields: { password: 'Connection refused with these credentials.' },
    });
  }

  try {
    const result = await client.query(`
      SELECT pg_catalog.pg_get_userbyid(d.datdba) AS owner,
             pg_database_size(current_database()) AS size,
             has_database_privilege(current_database(), 'CREATE') AS can_create,
             (SELECT count(*) FROM information_schema.tables
              WHERE table_schema NOT IN ('pg_catalog', 'information_schema')) AS table_count
      FROM pg_database d
      WHERE d.datname = current_database()
    `);
    const row = result.rows[0];

    return {
      owner: row.owner,
      ownedByUser: row.owner === user,
      tableCount: Number(row.table_count),
      sizeBytes: Number(row.size),
      canCreate: row.can_create === true,
    };
  } catch (error) {
    throw badRequest(`Connected, but could not inspect "${name}": ${error.message}`);
  } finally {
    await client.end();
  }
}

/**
 * Databases on the server that could be linked to a project: not a system
 * database and not already used by a project.
 *
 * @param {string[]} usedNames databases already linked to projects
 */
export async function listLinkCandidates(usedNames) {
  const databases = await listDatabases();

  return databases.filter((database) => {
    return !SYSTEM_DATABASES.includes(database.name) && !usedNames.includes(database.name);
  });
}

/** PostgreSQL error code for "insufficient privilege". */
const INSUFFICIENT_PRIVILEGE = '42501';

/**
 * Change the password of a project role.
 *
 * Since PostgreSQL 16, a CREATEROLE admin may only alter the roles it
 * created: roles that predate SolarOps need a superuser (or the current
 * password, when linking).
 */
export async function setRolePassword(user, password) {
  await withAdminClient(async (client) => {
    try {
      await client.query(`ALTER ROLE ${client.escapeIdentifier(user)} PASSWORD ${client.escapeLiteral(password)}`);
    } catch (error) {
      if (error.code === INSUFFICIENT_PRIVILEGE) {
        throw badRequest(
          `SolarOps's admin role may not change the password of "${user}" (a role it did not create). Enter its current password, or set a new one yourself as a superuser: ALTER ROLE "${user}" PASSWORD '…';`,
        );
      }

      throw error;
    }
  });
}

/**
 * Terminate the connections to a database, then drop it.
 */
async function dropDatabaseWithClient(client, name) {
  await client.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
    [name],
  );
  await client.query(`DROP DATABASE IF EXISTS ${client.escapeIdentifier(name)}`);
}

/**
 * Wipe a project database: drop it and create it again, empty.
 */
export async function wipeDatabase({ name, user }) {
  await withAdminClient(async (client) => {
    const role = client.escapeIdentifier(user);
    const db = client.escapeIdentifier(name);

    await dropDatabaseWithClient(client, name);
    await client.query(`CREATE DATABASE ${db} OWNER ${role} ENCODING 'UTF8'`);
    await client.query(`REVOKE ALL ON DATABASE ${db} FROM PUBLIC`);
    await client.query(`GRANT ALL ON DATABASE ${db} TO ${role}`);
  });
}

/**
 * Drop the database AND the role of a project (irreversible).
 */
export async function dropDatabaseAndRole({ name, user }) {
  await withAdminClient(async (client) => {
    await dropDatabaseWithClient(client, name);
    await client.query(`DROP ROLE IF EXISTS ${client.escapeIdentifier(user)}`);
  });
}

/**
 * Environment for pg_dump / pg_restore using the project credentials.
 */
async function projectClientEnv(database) {
  const settings = await getPostgresSettings();
  let sslMode = 'prefer';

  if (settings.ssl) {
    sslMode = 'require';
  }

  return {
    ...baseProcessEnv(),
    PGHOST: settings.host,
    PGPORT: String(settings.port),
    PGUSER: database.user,
    PGPASSWORD: database.password,
    PGDATABASE: database.name,
    PGSSLMODE: sslMode,
  };
}

/**
 * Timestamp used in dump file names (UTC): 20260131-235959.
 */
function dumpTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

/**
 * Dump a project database to `<project>/db/<uid>-<timestamp>.dump`
 * (pg_dump custom format, restorable with pg_restore).
 *
 * @param {import('./taskRunner.js').TaskContext} context
 * @param {object} options
 * @param {string} options.uid
 * @param {object} options.database project database config
 * @param {string} options.directory dumps folder
 * @param {boolean} [options.automatic] scheduled backup: <uid>-auto-<timestamp>.dump
 */
export async function dumpDatabase(context, { uid, database, directory, automatic = false }) {
  let fileName = `${uid}-${dumpTimestamp()}.dump`;

  if (automatic) {
    fileName = `${uid}-auto-${dumpTimestamp()}.dump`;
  }

  const filePath = path.join(directory, fileName);
  const [file, ...args] = splitCommandLine(config.commands.pgDump);

  context.addSecret(database.password);
  context.step(`Dumping ${database.name}`);

  await context.run(file, [...args, '--format=custom', '--no-owner', '--no-privileges', `--file=${filePath}`], {
    env: await projectClientEnv(database),
    timeoutMs: 60 * 60 * 1000,
  });

  await fs.chmod(filePath, 0o600);
  const stats = await fs.stat(filePath);
  context.info(`Saved ${fileName} (${Math.round(stats.size / 1024)} KiB)`);

  return { fileName, size: stats.size };
}

/**
 * Restore a dump into the project database (objects are dropped first).
 *
 * @param {import('./taskRunner.js').TaskContext} context
 * @param {object} options
 * @param {object} options.database project database config
 * @param {string} options.filePath dump to restore
 */
export async function restoreDatabase(context, { database, filePath }) {
  const [file, ...args] = splitCommandLine(config.commands.pgRestore);

  context.addSecret(database.password);
  context.step(`Restoring ${path.basename(filePath)} into ${database.name}`);

  await context.run(
    file,
    [
      ...args,
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-privileges',
      '--single-transaction',
      `--dbname=${database.name}`,
      filePath,
    ],
    {
      env: await projectClientEnv(database),
      timeoutMs: 60 * 60 * 1000,
    },
  );
}

/**
 * List the dumps of a project, most recent first.
 *
 * @param {string} directory
 * @param {string} uid project uid (flags the automatic dumps)
 */
export async function listDumps(directory, uid) {
  const entries = await fs.readdir(directory).catch(() => []);
  const dumps = [];

  for (const entry of entries) {
    if (!DUMP_FILE_PATTERN.test(entry)) {
      continue;
    }

    const stats = await fs.stat(path.join(directory, entry));
    dumps.push({ name: entry, size: stats.size, createdAt: stats.mtime, automatic: isAutomaticDump(uid, entry) });
  }

  dumps.sort((a, b) => b.createdAt - a.createdAt);

  return dumps;
}
