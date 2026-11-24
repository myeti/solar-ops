/**
 * Deployment pipeline of a project:
 *
 *   1. pull      clone or fetch + reset the configured branch
 *   2. packages  OS packages the project needs, installed with apt when
 *                missing (services/osPackages.js)
 *   3. install   dependencies; when not configured, with the package manager
 *                of the repository (npm, pnpm, yarn or bun, see
 *                services/packageManagers.js)
 *   4. build     build script (default `npm run build`, run with that same
 *                package manager, skipped when there is no "build" script)
 *   5. restart   restart the pm2 process if the project is active, then
 *                wait until it answers on / (liveness probe)
 *
 * Install and build commands are typed one per line: each line runs in its
 * own shell from repo/, in order, and the first failure stops the deployment.
 */
import path from 'node:path';
import config from '../config.js';
import { GitCredential, Project } from '../models/index.js';
import { DEFAULT_BUILD_COMMAND } from '../models/Project.js';
import { pathExists, readFileOrNull } from '../lib/files.js';
import { baseProcessEnv, buildProjectEnv, listProjectSecrets } from './environment.js';
import { syncRepository } from './git.js';
import { describeLiveness, probeLiveness, startupSecondsOf } from './health.js';
import {
  describePackageManager,
  detectPackageManager,
  installCommandFor,
  packageManagerBinary,
  runScriptCommand,
} from './packageManagers.js';
import { installOsPackages } from './osPackages.js';
import { readProjectLogs, startProjectProcess } from './pm2.js';
import { resolveProjectPaths } from './projectPaths.js';
import { startRedisWithProject } from './redis.js';
import { enqueueTask } from './taskRunner.js';

/**
 * Commands of an install / build field: one per line, blank lines and
 * "# comments" ignored.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function splitCommandLines(text) {
  const lines = String(text || '').split(/\r?\n/);

  return lines.map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('#'));
}

/**
 * Clean an install / build field before saving it: Unix line breaks, no
 * trailing spaces, no blank lines around (comments and inner blank lines
 * are kept, they help reading).
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeCommandLines(text) {
  const lines = String(text || '').split(/\r?\n/);

  return lines
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

/**
 * Run commands one after the other (a failing one throws, which stops the
 * deployment).
 *
 * @param {import('./taskRunner.js').TaskContext} context
 * @param {string[]} commands
 * @param {object} options see lib/exec.js runCommand()
 */
async function runCommandLines(context, commands, options) {
  for (const command of commands) {
    await context.shell(command, options);
  }
}

/**
 * Whether package.json declares a "build" script.
 *
 * @param {string} repoDirectory
 */
async function hasBuildScript(repoDirectory) {
  const content = await readFileOrNull(path.join(repoDirectory, 'package.json'));

  if (content === null) {
    return false;
  }

  try {
    const manifest = JSON.parse(content);
    return Boolean(manifest.scripts && manifest.scripts.build);
  } catch {
    return false;
  }
}

/**
 * The deployment itself, executed inside a task. Modes:
 *   - deploy   pull, OS packages, install, build, restart
 *   - pull     pull only
 *   - install  OS packages and install only (sources as they are)
 *   - build    build only (sources and dependencies as they are)
 * Only a full deploy restarts the application.
 *
 * @param {import('./taskRunner.js').TaskContext} context
 * @param {number} projectId
 * @param {object} options
 * @param {'deploy'|'pull'|'install'|'build'} options.mode
 */
async function runDeployment(context, projectId, { mode }) {
  // Reload the project: its configuration may have changed while queued.
  const project = await Project.findByPk(projectId);

  if (project === null) {
    throw new Error('The project no longer exists.');
  }

  const deployment = project.deployment;
  const paths = await resolveProjectPaths(project);

  context.addSecrets(await listProjectSecrets(project));

  if (mode === 'deploy' || mode === 'pull') {
    await pullSources(context, project, paths);
  } else if (
    !(await pathExists(path.join(paths.repo, '.git'))) &&
    !(await pathExists(path.join(paths.repo, 'package.json')))
  ) {
    throw new Error('Nothing deployed yet: use Deploy now first.');
  }

  if (mode === 'pull') {
    return;
  }

  // Corepack (pnpm, yarn) must never wait for an answer to its download prompt.
  const env = { ...baseProcessEnv(), ...(await buildProjectEnv(project)), COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' };
  const timeoutMs = config.taskTimeoutMinutes * 60 * 1000;

  const commandOptions = { cwd: paths.repo, env, timeoutMs };
  const manager = await detectPackageManager(paths.repo);
  let binary = null;

  if (manager !== null) {
    binary = packageManagerBinary(manager.name);
  }

  if (mode === 'deploy' || mode === 'install') {
    await installOsPackages(context, deployment.osPackages);
    await installDependencies(context, deployment, { manager, binary, commandOptions });
  }

  if (mode === 'deploy' || mode === 'build') {
    await buildProject(context, deployment, { paths, manager, binary, commandOptions });
  }

  if (mode !== 'deploy') {
    context.step('Restart');
    context.info('Not restarted: only a full deployment restarts the application.');
    return;
  }

  await publishOrRestart(context, project, deployment);
}

/**
 * Clone or fetch the configured branch into repo/.
 */
async function pullSources(context, project, paths) {
  const deployment = project.deployment;

  if (!deployment.url) {
    throw new Error('No git repository is configured for this project.');
  }

  let credential = null;

  if (deployment.gitCredentialId) {
    credential = await GitCredential.findByPk(deployment.gitCredentialId);

    if (credential === null) {
      throw new Error('The git credential selected for this project no longer exists.');
    }
  }

  const commit = await syncRepository(context, {
    directory: paths.repo,
    url: deployment.url,
    branch: deployment.branch,
    credential,
  });

  if (commit !== null) {
    context.setMeta({ commit });
    context.info(`Now at ${commit.shortHash} — ${commit.subject} (${commit.author})`);
  }
}

/**
 * The install commands, or the package manager's install.
 */
async function installDependencies(context, deployment, { manager, binary, commandOptions }) {
  let installCommands = splitCommandLines(deployment.installCommand);
  context.step('Installing dependencies');

  if (installCommands.length === 0 && manager !== null) {
    context.info(`Package manager: ${describePackageManager(manager)}.`);

    if (binary === null) {
      throw new Error(
        `${manager.name} is needed but not installed on this server: run npm run setup again (in the SolarOps folder), or set the install commands of the project.`,
      );
    }

    installCommands = [installCommandFor(manager, binary)];
  }

  if (installCommands.length === 0) {
    context.info('No package.json found and no install command configured: skipped.');
  } else {
    await runCommandLines(context, installCommands, commandOptions);
  }
}

/**
 * The build commands (the default build runs with the repository's package manager).
 */
async function buildProject(context, deployment, { paths, manager, binary, commandOptions }) {
  const buildCommands = splitCommandLines(deployment.buildCommand);
  const isDefaultBuild = buildCommands.length === 1 && buildCommands[0] === DEFAULT_BUILD_COMMAND;
  context.step('Building');

  if (buildCommands.length === 0) {
    context.info('No build command configured: skipped.');
  } else if (isDefaultBuild && !(await hasBuildScript(paths.repo))) {
    context.info('package.json has no "build" script: skipped.');
  } else if (isDefaultBuild && manager !== null && manager.name !== 'npm' && binary !== null) {
    await runCommandLines(context, [runScriptCommand(binary, 'build')], commandOptions);
  } else {
    await runCommandLines(context, buildCommands, commandOptions);
  }
}

/**
 * The end of a full deployment: a static site is live, an application is
 * restarted and probed.
 */
async function publishOrRestart(context, project, deployment) {
  if (project.isStatic) {
    context.step('Publishing');
    context.info(`Static site: nginx serves repo/${project.network.publicFolder} directly, the new build is live.`);
    return;
  }

  if (!deployment.restartAfterDeploy) {
    context.step('Restart');
    context.info('Automatic restart is disabled for this project.');
    return;
  }

  if (!project.active) {
    context.step('Restart');
    context.info('The project is inactive: not started.');
    return;
  }

  context.step(`Restarting ${project.uid} with pm2`);
  await startRedisWithProject(project);
  await startProjectProcess(project);
  context.info('Process restarted.');

  context.step('Checking that it answers (liveness probe)');
  context.info(`Waiting up to ${startupSecondsOf(project)}s (startup time, project Settings).`);
  const liveness = await probeLiveness(project);

  if (!liveness.alive) {
    await logRecentErrors(context, project);
    // Only the probe failed: the project counts as live once it answers (services/projects.js).
    context.setMeta({ failedStep: 'liveness' });
    throw new Error(`The application was restarted, but ${describeLiveness(liveness)}`);
  }

  context.info(describeLiveness(liveness));
}

/**
 * Last lines of the error log, to explain a failed liveness probe.
 *
 * @param {import('./taskRunner.js').TaskContext} context
 * @param {import('../models/Project.js').default} project
 */
async function logRecentErrors(context, project) {
  const { stderr } = await readProjectLogs(project, 15).catch(() => ({ stderr: '' }));

  if (stderr.trim() !== '') {
    context.info(`Last lines of logs/error.log:\n${stderr.trimEnd()}`);
  }
}

/**
 * Queue a deployment.
 *
 * @param {import('../models/Project.js').default} project
 * @param {object} options
 * @param {'deploy'|'pull'|'install'|'build'} [options.mode]
 * @param {string} options.trigger manual | webhook
 * @param {string} options.triggeredBy
 */
export async function queueDeployment(project, { mode = 'deploy', trigger, triggeredBy }) {
  if (project.system) {
    throw new Error('SolarOps is updated with npm run update (in its folder), not deployed from its own UI.');
  }

  const titles = {
    deploy: `Deploy ${project.name}`,
    pull: `Pull ${project.name}`,
    install: `Install ${project.name}`,
    build: `Build ${project.name}`,
  };

  const { task } = await enqueueTask(
    {
      projectId: project.id,
      type: mode,
      title: titles[mode],
      trigger,
      triggeredBy,
      meta: { branch: project.deployment.branch },
    },
    (context) => runDeployment(context, project.id, { mode }),
  );

  return task;
}
