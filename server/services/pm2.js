/**
 * Process management with pm2 (through its CLI, so SolarOps always talks
 * to the pm2 version installed on the server).
 *
 * Each project gets an app declaration in `etc/pm2.json` (mode 0600, it
 * contains the environment). In an emergency, a project can be started by
 * hand with: pm2 start <project folder>/etc/pm2.json
 */
import fs from 'node:fs/promises';
import config from '../config.js';
import { runConfiguredCommand, splitCommandLine } from '../lib/exec.js';
import { tailFile, writeManagedFile } from '../lib/files.js';
import { badRequest, conflict } from '../lib/errors.js';
import { buildProjectEnv } from './environment.js';
import { PM2_MARKER, resolveProjectPaths } from './projectPaths.js';

const PM2_TIMEOUT_MS = 60 * 1000;

// Every generated pm2.json contains PM2_MARKER (pm2 ignores unknown top-level keys).

/**
 * Run a pm2 sub-command.
 *
 * @param {string[]} args
 * @param {object} [options]
 */
function pm2(args, options = {}) {
  return runConfiguredCommand(config.commands.pm2, args, { timeoutMs: PM2_TIMEOUT_MS, ...options });
}

/**
 * `pm2 jlist` may print daemon start messages before the JSON document:
 * keep only the JSON line.
 *
 * @param {string} output
 */
function parseJsonList(output) {
  const lines = output.split('\n').map((line) => line.trim());
  const jsonLine = lines.find((line) => line.startsWith('['));

  if (!jsonLine) {
    return [];
  }

  return JSON.parse(jsonLine);
}

/**
 * pm2 states of a process that is (or is about to be) running. "errored"
 * and "stopped" processes are not running.
 */
const RUNNING_STATES = ['online', 'launching', 'waiting restart', 'one-launch-status', 'stopping'];

/**
 * Normalise a pm2 process description.
 */
function toProcessStatus(entry) {
  const env = entry.pm2_env || {};
  const monit = entry.monit || {};
  let uptimeMs = null;

  if (env.status === 'online' && env.pm_uptime) {
    uptimeMs = Date.now() - env.pm_uptime;
  }

  // SolarOps always injects SOLAROPS_PROJECT: a process without it was
  // started by someone else and is never replaced or deleted.
  const variables = env.env || env;

  return {
    name: entry.name,
    managed: Boolean(variables.SOLAROPS_PROJECT || env.SOLAROPS_PROJECT),
    pmId: entry.pm_id,
    pid: entry.pid || null,
    status: env.status || 'unknown',
    running: RUNNING_STATES.includes(env.status),
    cpu: monit.cpu ?? 0,
    memory: monit.memory ?? 0,
    uptimeMs,
    restarts: env.restart_time ?? 0,
    unstableRestarts: env.unstable_restarts ?? 0,
  };
}

/**
 * Every process known by pm2.
 *
 * @returns {Promise<ReturnType<typeof toProcessStatus>[]>}
 */
export async function listProcesses() {
  const { stdout } = await pm2(['jlist'], { timeoutMs: 20000 });

  return parseJsonList(stdout).map(toProcessStatus);
}

/**
 * Status of every process, indexed by name. Never throws: when pm2 is not
 * available an empty map is returned along with the error.
 *
 * @returns {Promise<{processes: Map<string, object>, error: string|null}>}
 */
export async function getProcessMap() {
  try {
    const processes = await listProcesses();
    const map = new Map();

    for (const entry of processes) {
      map.set(entry.name, entry);
    }

    return { processes: map, error: null };
  } catch (error) {
    return { processes: new Map(), error: error.message };
  }
}

/**
 * Status of one project process, or null when pm2 does not know it.
 *
 * @param {import('../models/Project.js').default} project
 */
export async function getProjectProcess(project) {
  const processes = await listProcesses();

  return processes.find((entry) => entry.name === project.uid) || null;
}

/**
 * Generate the pm2 app declaration of a project.
 *
 * @param {import('../models/Project.js').default} project
 */
export async function writePm2Config(project) {
  const paths = await resolveProjectPaths(project);
  const env = await buildProjectEnv(project);
  const [script, ...args] = splitCommandLine(project.startCommand);

  const declaration = {
    managedBy: 'SolarOps',
    apps: [
      {
        name: project.uid,
        cwd: paths.repo,
        script,
        args,
        interpreter: 'none',
        env,
        out_file: paths.stdoutLog,
        error_file: paths.stderrLog,
        merge_logs: true,
        time: true,
        autorestart: true,
        max_restarts: 15,
        min_uptime: '10s',
        restart_delay: 2000,
        kill_timeout: 8000,
      },
    ],
  };

  await writeManagedFile(paths.pm2Config, `${JSON.stringify(declaration, null, 2)}\n`, {
    marker: PM2_MARKER,
    mode: 0o600,
  });

  return paths.pm2Config;
}

/**
 * (Re)start a project with a freshly generated configuration. The process is
 * deleted first so that environment changes are always applied.
 *
 * @param {import('../models/Project.js').default} project
 */
export async function startProjectProcess(project) {
  await assertNotForeignProcess(project);

  const paths = await resolveProjectPaths(project);
  const entries = await fs.readdir(paths.repo).catch(() => []);

  if (entries.length === 0) {
    throw badRequest('The repo folder is empty: deploy the project (or copy its files) before starting it.');
  }

  const configFile = await writePm2Config(project);

  await pm2(['delete', project.uid], { allowFailure: true });
  await pm2(['start', configFile]);
  await saveProcessList();
}

/**
 * Stop a project (the process stays known by pm2, in "stopped" state).
 *
 * @param {import('../models/Project.js').default} project
 */
export async function stopProjectProcess(project) {
  await pm2(['stop', project.uid], { allowFailure: true });
  await saveProcessList();
}

/**
 * Remove a project from pm2 entirely. A process SolarOps did not start is
 * left running.
 *
 * @param {import('../models/Project.js').default} project
 * @returns {Promise<boolean>} whether a process was removed
 */
export async function deleteProjectProcess(project) {
  const current = await getProjectProcess(project);

  if (current === null || !current.managed) {
    return false;
  }

  await pm2(['delete', project.uid], { allowFailure: true });
  await saveProcessList();

  return true;
}

/**
 * Refuse to replace a pm2 process with the same name that SolarOps did not
 * start (e.g. an application started by hand before SolarOps).
 *
 * @param {import('../models/Project.js').default} project
 */
async function assertNotForeignProcess(project) {
  const current = await getProjectProcess(project);

  if (current !== null && !current.managed) {
    throw conflict(
      `A pm2 process named "${project.uid}" already exists and was not started by SolarOps: it was left running. When ready, remove it (pm2 delete ${project.uid}) to let SolarOps manage it.`,
    );
  }
}

/**
 * Persist the process list so `pm2 resurrect` (pm2 startup) restores it at boot.
 */
async function saveProcessList() {
  await pm2(['save', '--force'], { allowFailure: true });
}

/**
 * Last lines of the project stdout / stderr logs.
 *
 * @param {import('../models/Project.js').default} project
 * @param {number} lines
 */
export async function readProjectLogs(project, lines) {
  const paths = await resolveProjectPaths(project);

  return {
    stdout: await tailFile(paths.stdoutLog, lines),
    stderr: await tailFile(paths.stderrLog, lines),
  };
}

/**
 * Empty the log files of a project.
 *
 * @param {import('../models/Project.js').default} project
 */
export async function clearProjectLogs(project) {
  const paths = await resolveProjectPaths(project);

  for (const file of [paths.stdoutLog, paths.stderrLog]) {
    await fs.truncate(file, 0).catch(() => {});
  }
}
