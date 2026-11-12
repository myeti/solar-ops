/**
 * Database bootstrap: connection check, SQLite tuning and schema.
 *
 * The models define the schema of new databases (server/models): sync()
 * creates the tables and indexes that do not exist yet, in dependency order.
 * It never alters an existing table: changes to existing tables are
 * migrations (migrations.js), applied right after.
 */
import sequelize from './connection.js';
import { checkMigrations, runMigrations } from './migrations.js';
import '../models/index.js';

/**
 * Connect to the database, create the missing tables and apply the pending
 * migrations.
 */
export async function initDatabase() {
  await sequelize.authenticate();

  if (sequelize.getDialect() === 'sqlite') {
    // WAL lets the CLI and the server use the database at the same time.
    await sequelize.query('PRAGMA journal_mode = WAL;');
    await sequelize.query('PRAGMA busy_timeout = 5000;');
    await sequelize.query('PRAGMA foreign_keys = ON;');
  }

  // A database from a newer SolarOps is refused before anything is changed.
  const migrations = await checkMigrations(sequelize);

  // Never `alter: true`: on SQLite it rebuilds tables, and dropping the old
  // one cascades to sessions, tasks and audit entries.
  await sequelize.sync();
  await runMigrations(sequelize, migrations);
}

/**
 * Close the connection (used by the CLI and on shutdown).
 */
export async function closeDatabase() {
  await sequelize.close();
}
