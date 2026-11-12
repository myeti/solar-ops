/**
 * Sequelize connection to SolarOps's own database.
 *
 * Default: a SQLite file in the data directory. It has no moving parts, so
 * SolarOps (and its CLI recovery commands) keep working even when the
 * PostgreSQL server hosting the projects' databases is down.
 *
 * Alternative: set SOLAROPS_DB_URL to a PostgreSQL connection string.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Sequelize } from 'sequelize';
import config from '../config.js';
import logger from '../lib/logger.js';

/**
 * Sequelize SQL logger (only enabled with SOLAROPS_DB_LOGGING=true).
 */
function sqlLogger(sql) {
  logger.debug(sql);
}

function createSequelize() {
  let logging = false;

  if (config.database.logging) {
    logging = sqlLogger;
  }

  if (config.database.url) {
    return new Sequelize(config.database.url, {
      dialect: 'postgres',
      logging,
      pool: { max: 5, min: 0, idle: 10000 },
    });
  }

  fs.mkdirSync(path.dirname(config.database.sqliteFile), { recursive: true, mode: 0o700 });

  return new Sequelize({
    dialect: 'sqlite',
    storage: config.database.sqliteFile,
    logging,
    retry: {
      match: [/SQLITE_BUSY/],
      max: 5,
    },
  });
}

const sequelize = createSequelize();

export default sequelize;
