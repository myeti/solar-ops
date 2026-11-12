/**
 * Disk space used by a project, computed on demand: `du` can take a few
 * seconds on large folders (node_modules...).
 *
 *   - every top-level entry of the project folder (repo/, db/, logs/, etc/
 *     and whatever an adopted folder holds), measured with `du -sk`: actual
 *     disk usage, symlinks not followed, hard links counted once,
 *   - the dependencies (repo/node_modules), measured on their own: a single
 *     `du` run counts files it already saw as 0,
 *   - the database, with pg_database_size() through the project's own
 *     credentials (so linked databases work too).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { runCommand } from '../lib/exec.js';
import { pathExists } from '../lib/files.js';
import { verifyCredentials } from './postgres.js';
import { resolveProjectPaths } from './projectPaths.js';
import { getPostgresSettings } from './settings.js';

const DU_TIMEOUT_MS = 120 * 1000;

/** What the usual entries of a project folder hold. */
const ENTRY_KINDS = {
  repo: 'Sources and build',
  db: 'Database dumps',
  logs: 'Process logs',
  etc: 'nginx, pm2 and certificates',
};

/** PostgreSQL hosts on this very server (their data uses this disk). */
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1'];

/** Computations in progress, by project id: a second request waits for the first. */
const inFlight = new Map();

/**
 * Disk usage of paths, in bytes.
 *
 * @param {string[]} paths
 * @returns {Promise<{sizes: Map<string, number>, incomplete: boolean}>}
 *   incomplete: some files could not be read (they are not counted)
 */
async function diskUsage(paths) {
  const sizes = new Map();

  if (paths.length === 0) {
    return { sizes, incomplete: false };
  }

  const { exitCode, stdout } = await runCommand('du', ['-sk', '--', ...paths], {
    timeoutMs: DU_TIMEOUT_MS,
    allowFailure: true,
  });

  for (const line of stdout.split('\n')) {
    const match = /^(\d+)\t(.+)$/.exec(line);

    if (match) {
      sizes.set(match[2], Number(match[1]) * 1024);
    }
  }

  if (exitCode !== 0 && sizes.size === 0) {
    throw new Error('du could not measure the project folder.');
  }

  return { sizes, incomplete: exitCode !== 0 };
}

/**
 * Size of the project database, or why it is unknown.
 *
 * @param {import('../models/Project.js').default} project
 */
async function databaseUsage(project) {
  const database = project.database;

  if (!database.enabled || !database.name) {
    return null;
  }

  const postgres = await getPostgresSettings();
  const local = LOCAL_HOSTS.includes(postgres.host) || postgres.host.startsWith('/');

  try {
    const info = await verifyCredentials(database);

    return { name: database.name, bytes: info.sizeBytes, local, host: postgres.host, error: null };
  } catch (error) {
    return { name: database.name, bytes: null, local, host: postgres.host, error: error.message };
  }
}

async function computeProjectStorage(project) {
  const startedAt = Date.now();
  const paths = await resolveProjectPaths(project);
  const result = {
    path: paths.root,
    folderBytes: 0,
    entries: [],
    dependencies: null,
    database: null,
    incomplete: false,
    computedAt: null,
    elapsedMs: 0,
  };

  if (await pathExists(paths.root)) {
    const names = (await fs.readdir(paths.root)).sort();
    const entryPaths = names.map((name) => path.join(paths.root, name));
    const usage = await diskUsage(entryPaths);

    result.incomplete = usage.incomplete;

    for (const name of names) {
      const bytes = usage.sizes.get(path.join(paths.root, name)) ?? 0;

      result.folderBytes += bytes;
      result.entries.push({ name, bytes, kind: ENTRY_KINDS[name] || null });
    }

    result.entries.sort((a, b) => b.bytes - a.bytes);

    const modules = path.join(paths.repo, 'node_modules');

    if (await pathExists(modules)) {
      const dependencies = await diskUsage([modules]);

      result.incomplete = result.incomplete || dependencies.incomplete;
      result.dependencies = { path: 'repo/node_modules', bytes: dependencies.sizes.get(modules) ?? 0 };
    }
  }

  result.database = await databaseUsage(project);
  result.computedAt = new Date().toISOString();
  result.elapsedMs = Date.now() - startedAt;

  return result;
}

/**
 * Disk space used by a project (folder and database).
 *
 * @param {import('../models/Project.js').default} project
 */
export async function measureProjectStorage(project) {
  if (inFlight.has(project.id)) {
    return inFlight.get(project.id);
  }

  const computation = computeProjectStorage(project).finally(() => {
    inFlight.delete(project.id);
  });

  inFlight.set(project.id, computation);

  return computation;
}
