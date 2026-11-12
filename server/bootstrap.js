/**
 * Initialisation shared by the server and the CLI: data directory, master
 * key, database (schema from the models) and the system project.
 */
import fs from 'node:fs';
import config from './config.js';
import { initMasterKey } from './lib/crypto.js';
import { initDatabase } from './database/init.js';
import { ensureSystemProject } from './services/systemProject.js';

/**
 * Name of a user id, from /etc/passwd (the id itself when unknown).
 */
function userName(uid) {
  try {
    const line = fs
      .readFileSync('/etc/passwd', 'utf8')
      .split('\n')
      .find((entry) => entry.split(':')[2] === String(uid));

    if (line) {
      return line.split(':')[0];
    }
  } catch {
    // Not a Unix system: the id is enough.
  }

  return `uid ${uid}`;
}

/**
 * On an installed server, the data folder belongs to the service user:
 * running SolarOps as root there (npm run serve or node with sudo) would
 * create root-owned files the service can no longer use.
 */
function refuseRootOnServer() {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) {
    return;
  }

  let stats;

  try {
    stats = fs.statSync(config.dataDir);
  } catch {
    return;
  }

  if (stats.uid !== 0) {
    throw new Error(
      `${config.dataDir} belongs to ${userName(stats.uid)}: do not run SolarOps as root. Start the service with npm run start, and use the CLI with sudo solarops <command>.`,
    );
  }
}

export async function bootstrap() {
  refuseRootOnServer();
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(config.dataDir, 0o700);

  initMasterKey({ dataDir: config.dataDir, fromEnvironment: config.masterKey });

  await initDatabase();

  // The database holds password hashes and encrypted secrets: owner only.
  if (!config.database.url && fs.existsSync(config.database.sqliteFile)) {
    fs.chmodSync(config.database.sqliteFile, 0o600);
  }

  return { systemProject: await ensureSystemProject() };
}
