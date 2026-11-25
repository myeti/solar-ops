/**
 * A dedicated Redis instance per project (Redis tab), on demand:
 *
 *   - one redis-server (or valkey-server) process per project, run by pm2 as
 *     <uid>__redis, started and stopped with the project;
 *   - listening on 127.0.0.1 only, on its own port (6400, 6401...), with a
 *     generated password;
 *   - its data in <project>/redis/, its configuration in etc/redis.conf
 *     (generated, mode 0600), its log in logs/redis.log;
 *   - given to the project as REDIS_HOST, REDIS_PORT, REDIS_PASSWORD and
 *     REDIS_URL (services/environment.js).
 *
 * The program is installed by the setup (deploy/install.sh); the system
 * redis-server service is not used.
 */
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import config from '../config.js';
import { Project } from '../models/index.js';
import { generatePassword } from '../lib/crypto.js';
import { badRequest, conflict } from '../lib/errors.js';
import { findExecutable, runCommand } from '../lib/exec.js';
import { ensureDirectory, isPathInside, pathExists, writeManagedFile } from '../lib/files.js';
import { parseInfo, redisCommands } from '../lib/redisClient.js';
import { deleteRedisProcess, getRedisProcess, startRedisProcess, stopRedisProcess } from './pm2.js';
import { NGINX_MARKER, resolveProjectPaths } from './projectPaths.js';

export const REDIS_POLICIES = ['noeviction', 'allkeys-lru'];
export const REDIS_PERSISTENCE = ['rdb', 'aof', 'none'];
export const MIN_REDIS_MEMORY_MB = 16;
export const MAX_REDIS_MEMORY_MB = 8192;

const FIRST_REDIS_PORT = config.redisFirstPort;
const PASSWORD_LENGTH = 32;
const START_TIMEOUT_MS = 10000;

/**
 * The Redis program of this server: redis-server, else valkey-server.
 *
 * @returns {Promise<{name: string, path: string, version: string}|null>}
 */
export async function findRedisProgram() {
  for (const name of ['redis-server', 'valkey-server']) {
    const found = findExecutable(name);

    if (found !== null) {
      const { stdout } = await runCommand(found, ['--version'], { timeoutMs: 5000, allowFailure: true });
      const match = /v=([0-9][^\s]*)/.exec(stdout);
      let version = null;

      if (match !== null) {
        version = match[1];
      }

      return { name, path: found, version };
    }
  }

  return null;
}

/** Whether nothing listens on a local port. */
function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

/**
 * The first free Redis port: not a project's, not another Redis's, and not
 * listened on by anything else.
 *
 * @param {number} projectId the project getting it
 */
async function allocatePort(projectId) {
  const projects = await Project.findAll();
  const taken = new Set([config.port]);

  for (const project of projects) {
    if (project.port) {
      taken.add(project.port);
    }

    if (project.id !== projectId && project.redis.port) {
      taken.add(project.redis.port);
    }
  }

  for (let port = FIRST_REDIS_PORT; port < FIRST_REDIS_PORT + 1000; port += 1) {
    if (!taken.has(port) && (await isPortFree(port))) {
      return port;
    }
  }

  throw conflict('No free port left for Redis.');
}

/**
 * etc/redis.conf of a project.
 */
function renderConfig(redis, paths) {
  const lines = [
    `${NGINX_MARKER} (Redis tab). Manual changes will be overwritten.`,
    'bind 127.0.0.1',
    'protected-mode yes',
    `port ${redis.port}`,
    `requirepass ${redis.password}`,
    'daemonize no',
    'supervised no',
    // Logged by pm2 into logs/redis.log.
    'logfile ""',
    `dir ${paths.redis}`,
    'dbfilename dump.rdb',
    `maxmemory ${redis.maxMemoryMb}mb`,
    `maxmemory-policy ${redis.policy}`,
  ];

  if (redis.persistence === 'none') {
    lines.push('save ""', 'appendonly no');
  } else if (redis.persistence === 'aof') {
    lines.push(`save ${savePointsOf('aof')}`, 'appendonly yes');
  } else {
    lines.push(`save ${savePointsOf('rdb')}`, 'appendonly no');
  }

  return `${lines.join('\n')}\n`;
}

/** Ask Redis for PING until it answers, START_TIMEOUT_MS at most. */
async function waitUntilReady(redis) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const [pong] = await redisCommands(redis.port, redis.password, [['PING']]);

      if (pong === 'PONG') {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 300);
    });
  }

  let reason = 'no answer';

  if (lastError !== null) {
    reason = lastError.message;
  }

  throw new Error(`Redis did not start: ${reason} (see logs/redis.log).`);
}

/**
 * Write the configuration and (re)start the instance under pm2.
 *
 * @param {import('../models/Project.js').default} project
 */
async function launch(project) {
  const program = await findRedisProgram();

  if (program === null) {
    throw badRequest('Redis is not installed on this server: run npm run setup again (in the SolarOps folder).');
  }

  const redis = project.redis;
  const paths = await resolveProjectPaths(project);

  await ensureDirectory(paths.redis, 0o700);
  await ensureDirectory(paths.logs, 0o750);
  await writeManagedFile(paths.redisConfig, renderConfig(redis, paths), { marker: NGINX_MARKER, mode: 0o600 });
  await startRedisProcess(project, {
    cwd: paths.redis,
    script: program.path,
    args: [paths.redisConfig],
    interpreter: 'none',
    // SOLAROPS_PROJECT marks the process as SolarOps's (services/pm2.js).
    env: { SOLAROPS_PROJECT: project.uid, SOLAROPS_COMPONENT: 'redis' },
    out_file: paths.redisLog,
    error_file: paths.redisLog,
    merge_logs: true,
    time: true,
    autorestart: true,
    max_restarts: 15,
    min_uptime: '10s',
    restart_delay: 2000,
    // Redis saves its data before exiting.
    kill_timeout: 30000,
  });
  await waitUntilReady(redis);
}

/**
 * Turn Redis on for a project: port, password, configuration, process.
 * Data already in redis/ is kept (and served again).
 *
 * @param {import('../models/Project.js').default} project
 */
export async function enableRedis(project) {
  const current = project.redis;

  project.redisConfig = {
    ...current,
    enabled: true,
    port: await allocatePort(project.id),
    password: current.password || generatePassword(PASSWORD_LENGTH),
    provisionedAt: current.provisionedAt || new Date().toISOString(),
  };
  await project.save();

  if (project.active) {
    await launch(project);
  }
}

/**
 * Turn Redis off: the process is removed, the data and the password kept
 * (enabling it again serves them).
 *
 * @param {import('../models/Project.js').default} project
 */
export async function disableRedis(project) {
  await deleteRedisProcess(project);
  project.redisConfig = { ...project.redis, enabled: false, port: null };
  await project.save();
}

/**
 * Delete the data of a disabled instance (redis/ emptied).
 *
 * @param {import('../models/Project.js').default} project
 */
export async function deleteRedisData(project) {
  if (project.redis.enabled) {
    throw badRequest('Turn Redis off before deleting its data.');
  }

  const paths = await resolveProjectPaths(project);

  if (!isPathInside(paths.redis, paths.root) || !(await pathExists(paths.redis))) {
    return;
  }

  for (const entry of await fs.readdir(paths.redis)) {
    await fs.rm(path.join(paths.redis, entry), { recursive: true, force: true });
  }

  project.redisConfig = { ...project.redis, password: '', provisionedAt: null };
  await project.save();
}

/** The `save` setting of each persistence (snapshot points). */
function savePointsOf(persistence) {
  if (persistence === 'none') {
    return '';
  }

  return '3600 1 300 100 60 10000';
}

/** Wait until Redis has written its whole dataset into the new AOF. */
async function waitForAofRewrite(redis) {
  const deadline = Date.now() + 60000;

  while (Date.now() < deadline) {
    const [text] = await redisCommands(redis.port, redis.password, [['INFO', 'persistence']]);
    const info = parseInfo(text);

    if (info.aof_enabled === '1' && info.aof_rewrite_in_progress === '0' && info.aof_rewrite_scheduled === '0') {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 300);
    });
  }

  throw new Error('Redis is still writing its append-only file: try again in a moment.');
}

/**
 * Change the memory limit, the eviction policy or the persistence. A running
 * instance gets them live (CONFIG SET), without a restart: turning AOF on
 * first writes the current data into it. A stopped one would start with an
 * empty AOF: switching to AOF is refused until it runs.
 *
 * @param {import('../models/Project.js').default} project
 * @param {{maxMemoryMb: number, policy: string, persistence: string}} settings
 */
export async function updateRedisSettings(project, settings) {
  const current = project.redis;
  const next = { ...current, ...settings };
  const running = current.enabled && (await isRedisRunning(project));

  if (running) {
    await redisCommands(current.port, current.password, [
      ['CONFIG', 'SET', 'maxmemory', `${next.maxMemoryMb}mb`],
      ['CONFIG', 'SET', 'maxmemory-policy', next.policy],
      ['CONFIG', 'SET', 'save', savePointsOf(next.persistence)],
    ]);

    let appendonly = 'no';

    if (next.persistence === 'aof') {
      appendonly = 'yes';
    }

    await redisCommands(current.port, current.password, [['CONFIG', 'SET', 'appendonly', appendonly]]);

    if (appendonly === 'yes' && current.persistence !== 'aof') {
      await waitForAofRewrite(current);
    }
  } else if (current.enabled && next.persistence === 'aof' && current.persistence !== 'aof') {
    throw badRequest('Redis is stopped: start the project before switching to AOF (Redis would start empty).', {
      fields: { persistence: 'Start the project first.' },
    });
  }

  project.redisConfig = next;
  await project.save();

  const paths = await resolveProjectPaths(project);
  await writeManagedFile(paths.redisConfig, renderConfig(project.redis, paths), { marker: NGINX_MARKER, mode: 0o600 });
}

/**
 * A new password: written to the configuration, set live on a running
 * instance. The project needs a restart to receive it.
 *
 * @param {import('../models/Project.js').default} project
 */
export async function rotateRedisPassword(project) {
  const redis = project.redis;
  const password = generatePassword(PASSWORD_LENGTH);
  const running = await isRedisRunning(project);

  if (running) {
    await redisCommands(redis.port, redis.password, [['CONFIG', 'SET', 'requirepass', password]]);
  }

  project.redisConfig = { ...redis, password };
  await project.save();

  const paths = await resolveProjectPaths(project);
  await writeManagedFile(paths.redisConfig, renderConfig(project.redis, paths), { marker: NGINX_MARKER, mode: 0o600 });
}

/**
 * Empty the instance (FLUSHALL).
 *
 * @param {import('../models/Project.js').default} project
 */
export async function flushRedis(project) {
  const redis = project.redis;
  await redisCommands(redis.port, redis.password, [['FLUSHALL']]);
}

/**
 * Restart the instance (configuration written again).
 *
 * @param {import('../models/Project.js').default} project
 */
export async function restartRedis(project) {
  if (!project.redis.enabled) {
    throw badRequest('Redis is off for this project.');
  }

  await launch(project);
}

async function isRedisRunning(project) {
  const processInfo = await getRedisProcess(project);

  return Boolean(processInfo && processInfo.status === 'online');
}

/**
 * With the project: start Redis when it is enabled and not running (an
 * application restart leaves a running Redis alone).
 *
 * @param {import('../models/Project.js').default} project
 */
export async function startRedisWithProject(project) {
  if (project.redis.enabled && !(await isRedisRunning(project))) {
    await launch(project);
  }
}

/**
 * With the project: stop Redis (its data saved).
 *
 * @param {import('../models/Project.js').default} project
 */
export async function stopRedisWithProject(project) {
  if (project.redis.enabled) {
    await stopRedisProcess(project);
  }
}

/**
 * With the project: remove its Redis process (project deleted).
 *
 * @param {import('../models/Project.js').default} project
 */
export async function removeRedisWithProject(project) {
  await deleteRedisProcess(project);
}

/**
 * The state of a project's Redis: process, memory, keys, persistence.
 *
 * @param {import('../models/Project.js').default} project
 */
export async function redisStatus(project) {
  const redis = project.redis;
  const processInfo = await getRedisProcess(project);
  const status = {
    enabled: redis.enabled,
    port: redis.port,
    maxMemoryMb: redis.maxMemoryMb,
    policy: redis.policy,
    persistence: redis.persistence,
    provisionedAt: redis.provisionedAt,
    hasData: redis.password !== '',
    process: processInfo,
    info: null,
    error: null,
  };

  if (!redis.enabled || !processInfo || processInfo.status !== 'online') {
    return status;
  }

  try {
    const [infoText, keys] = await redisCommands(redis.port, redis.password, [['INFO'], ['DBSIZE']]);
    const info = parseInfo(infoText);
    let lastSaveAt = null;

    if (info.rdb_last_save_time) {
      lastSaveAt = new Date(Number(info.rdb_last_save_time) * 1000).toISOString();
    }

    status.info = {
      version: info.redis_version || info.valkey_version || null,
      uptimeSeconds: Number(info.uptime_in_seconds || 0),
      usedMemory: Number(info.used_memory || 0),
      maxMemory: Number(info.maxmemory || 0),
      keys,
      clients: Number(info.connected_clients || 0),
      lastSaveAt,
      lastSaveOk: info.rdb_last_bgsave_status !== 'err',
    };
  } catch (error) {
    status.error = error.message;
  }

  return status;
}

/**
 * The connection the project receives (REDIS_*), or null when off.
 *
 * @param {import('../models/Project.js').default} project
 */
export function redisConnection(project) {
  const redis = project.redis;

  if (!redis.enabled || !redis.port || !redis.password) {
    return null;
  }

  return {
    host: '127.0.0.1',
    port: redis.port,
    password: redis.password,
    url: `redis://:${encodeURIComponent(redis.password)}@127.0.0.1:${redis.port}/0`,
  };
}
