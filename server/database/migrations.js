/**
 * Database migrations: changes to the tables of an existing database.
 *
 * New databases get their tables from the models (sync() in init.js);
 * migrations bring older databases up to date. So that one code base works
 * for both, every migration checks before acting ("add this column if it
 * is missing").
 *
 * A migration is a file named NNNN-what-it-does.js in migrations/, run in
 * order, in a transaction, then recorded in the solarops_migrations table.
 * It exports:
 *
 *   export async function up({ queryInterface, sequelize, transaction }) { ... }
 *
 * Forward only: going back to an older SolarOps means restoring the backup
 * taken before the migrations (SQLite: <data folder>/backups/, see
 * deploy/update.sh). A database holding a migration this code does not know
 * comes from a newer SolarOps: it is refused rather than damaged.
 *
 * On SQLite, prefer addColumn / createTable: changeColumn and removeColumn
 * rebuild the table, and dropping it cascades to the rows referencing it.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DataTypes, QueryTypes } from 'sequelize';
import config from '../config.js';
import logger from '../lib/logger.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const MIGRATION_FILE = /^\d{4}-[a-z0-9-]+\.js$/;
const TABLE = 'solarops_migrations';

/** Backups taken before migrations, kept (SQLite). */
const BACKUPS_KEPT = 5;
const BACKUP_FILE = /^solarops-\d{8}-\d{6}-before-[a-z0-9-]+\.sqlite$/;

/** Where the backups go, and the record of the last migrations (read by deploy/update.sh). */
export const BACKUPS_DIR = path.join(config.dataDir, 'backups');
export const LAST_MIGRATION_RECORD = path.join(BACKUPS_DIR, 'last-migration.json');

/**
 * Migration files of this code, in order.
 */
export async function listMigrationFiles() {
  const names = await fs.readdir(MIGRATIONS_DIR).catch(() => []);

  return names.filter((name) => MIGRATION_FILE.test(name)).sort();
}

function timestamp(date) {
  return date
    .toISOString()
    .replace(/\.\d+Z$/, '')
    .replace(/[-:]/g, '')
    .replace('T', '-');
}

/**
 * Copy the SQLite database before migrating it (VACUUM INTO: a consistent
 * single-file copy, even in WAL mode), keeping the last BACKUPS_KEPT.
 *
 * @returns {Promise<string|null>} the backup file
 */
async function backupDatabase(sequelize, firstMigration) {
  if (sequelize.getDialect() !== 'sqlite') {
    logger.warn('No automatic backup before the migrations of a PostgreSQL database: dump it yourself first.');
    return null;
  }

  await fs.mkdir(BACKUPS_DIR, { recursive: true, mode: 0o700 });

  const file = path.join(
    BACKUPS_DIR,
    `solarops-${timestamp(new Date())}-before-${firstMigration.replace(/\.js$/, '')}.sqlite`,
  );

  try {
    await sequelize.query(`VACUUM INTO ${sequelize.escape(file)}`);
  } catch (error) {
    const reason = error.original?.message || error.message || error.name;

    throw new Error(
      `Could not back up the database to ${file} before migrating it (${reason}). Check that ${BACKUPS_DIR} belongs to the user running SolarOps, and that the disk has room.`,
      { cause: error },
    );
  }

  await fs.chmod(file, 0o600);

  const backups = (await fs.readdir(BACKUPS_DIR)).filter((name) => BACKUP_FILE.test(name)).sort();

  for (const old of backups.slice(0, Math.max(0, backups.length - BACKUPS_KEPT))) {
    await fs.rm(path.join(BACKUPS_DIR, old), { force: true });
  }

  return file;
}

async function tableExists(sequelize, table) {
  const tables = await sequelize.getQueryInterface().showAllTables();

  return tables.map((entry) => entry.tableName || entry).includes(table);
}

/**
 * Before sync(): refuse a database migrated by a newer SolarOps.
 *
 * @returns {Promise<{fresh: boolean, applied: Set<string>, files: string[]}>}
 *   fresh: the database has no table yet (nothing to back up)
 */
export async function checkMigrations(sequelize) {
  const fresh = !(await tableExists(sequelize, 'settings'));

  await sequelize.getQueryInterface().createTable(TABLE, {
    name: { type: DataTypes.STRING(200), primaryKey: true, allowNull: false },
    applied_at: { type: DataTypes.DATE, allowNull: false },
  });

  const rows = await sequelize.query(`SELECT name FROM ${TABLE}`, { type: QueryTypes.SELECT });
  const applied = new Set(rows.map((row) => row.name));
  const files = await listMigrationFiles();
  const unknown = [...applied].filter((name) => !files.includes(name)).sort();

  if (unknown.length > 0) {
    throw new Error(
      `This database was migrated by a newer SolarOps (${unknown.join(', ')}). Update SolarOps again, or restore the backup taken before that update (npm run rollback, or ${BACKUPS_DIR}).`,
    );
  }

  return { fresh, applied, files };
}

async function readRecord() {
  try {
    return JSON.parse(await fs.readFile(LAST_MIGRATION_RECORD, 'utf8'));
  } catch {
    return null;
  }
}

async function writeRecord(record) {
  await fs.writeFile(LAST_MIGRATION_RECORD, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
}

/**
 * The backup before the pending migrations. When a previous start failed
 * in the middle of them (systemd starts SolarOps again and again), its
 * backup is kept: a new one would already hold the migrations applied
 * before the failure.
 */
async function backupBeforeMigrations(sequelize, pending) {
  const record = await readRecord();

  if (record && record.status === 'started' && record.backup && (await fs.stat(record.backup).catch(() => null))) {
    logger.info(`Database backup of the previous attempt kept: ${record.backup}`);
    return record;
  }

  const backup = await backupDatabase(sequelize, pending[0]);
  const started = { at: new Date().toISOString(), status: 'started', applied: [], backup };

  logger.info(`Database backed up before ${pending.length} migration(s): ${backup}`);

  // Recorded at once: if a migration fails, deploy/update.sh restores this backup.
  if (backup !== null) {
    await writeRecord(started);
  }

  return started;
}

/**
 * After sync(): apply the pending migrations.
 *
 * @param {import('sequelize').Sequelize} sequelize
 * @param {Awaited<ReturnType<typeof checkMigrations>>} status
 * @returns {Promise<{applied: string[], backup: string|null}>}
 */
export async function runMigrations(sequelize, status) {
  const pending = status.files.filter((name) => !status.applied.has(name));

  if (pending.length === 0) {
    return { applied: [], backup: null };
  }

  let record = null;

  if (!status.fresh) {
    record = await backupBeforeMigrations(sequelize, pending);
  }

  const queryInterface = sequelize.getQueryInterface();

  for (const name of pending) {
    const migration = await import(pathToFileURL(path.join(MIGRATIONS_DIR, name)).href);

    await sequelize.transaction(async (transaction) => {
      await migration.up({ queryInterface, sequelize, transaction });
      await sequelize.query(`INSERT INTO ${TABLE} (name, applied_at) VALUES (?, ?)`, {
        replacements: [name, new Date().toISOString()],
        transaction,
      });
    });

    logger.info(`Database migration applied: ${name}`);

    if (record !== null && record.backup !== null) {
      record.applied.push(name);
      await writeRecord(record);
    }
  }

  if (record !== null && record.backup !== null) {
    record.status = 'done';
    await writeRecord(record);
  }

  let backup = null;

  if (record !== null) {
    backup = record.backup;
  }

  return { applied: pending, backup };
}
