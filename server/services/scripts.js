/**
 * Run a script of a project's package.json from the Deployment tab, with
 * arguments: `npm run create:admin -- test@email.com`. It runs as a task
 * (output followed live, kept in the history), from repo/, with the
 * project's whole environment (services/environment.js), like its builds.
 *
 * The script must be one of package.json's; the arguments are split like a
 * command line (quotes kept together) and passed as they are, never through
 * a shell. The package manager is the repository's (npm, pnpm, yarn, bun).
 */
import path from 'node:path';
import config from '../config.js';
import { splitCommandLine } from '../lib/exec.js';
import { readFileOrNull } from '../lib/files.js';
import { baseProcessEnv, buildProjectEnv, listProjectSecrets } from './environment.js';
import { describePackageManager, detectPackageManager, packageManagerBinary } from './packageManagers.js';
import { resolveProjectPaths } from './projectPaths.js';
import { enqueueTask } from './taskRunner.js';

export const MAX_SCRIPT_ARGUMENTS_LENGTH = 1000;

/** Shown in place of hidden arguments (history, audit journal). */
const HIDDEN_ARGUMENTS = '•••••';

/** Arguments shown as they are; others are quoted (history, log). */
const PLAIN_ARGUMENT = /^[A-Za-z0-9_@%+=:,./-]+$/;

/**
 * An argument as the command line shows it: `Jane Doe` => `"Jane Doe"`.
 *
 * @param {string} arg
 */
function quoteArgument(arg) {
  if (PLAIN_ARGUMENT.test(arg)) {
    return arg;
  }

  return `"${arg.replace(/(["\\$`])/g, '\\$1')}"`;
}

/**
 * The scripts of package.json, in its order.
 *
 * @param {string} repo
 * @returns {Promise<Array<{name: string, command: string}>|null>} null without a readable package.json
 */
async function readScripts(repo) {
  const content = await readFileOrNull(path.join(repo, 'package.json'));

  if (content === null) {
    return null;
  }

  try {
    const scripts = JSON.parse(content).scripts || {};

    return Object.entries(scripts)
      .filter(([, command]) => typeof command === 'string')
      .map(([name, command]) => ({ name, command }));
  } catch {
    return null;
  }
}

/**
 * How the package manager runs a script with arguments: npm and pnpm need
 * "--" before them, yarn and bun pass them on as they are.
 *
 * @param {string} managerName
 */
function needsSeparator(managerName) {
  return managerName === 'npm' || managerName === 'pnpm';
}

/**
 * The arguments of a script run (the command line after the script name).
 *
 * @param {string} managerName
 * @param {string} script
 * @param {string[]} args
 */
function runArguments(managerName, script, args) {
  if (args.length === 0) {
    return ['run', script];
  }

  if (needsSeparator(managerName)) {
    return ['run', script, '--', ...args];
  }

  return ['run', script, ...args];
}

/**
 * The scripts a project can run, and how they are run.
 *
 * @param {import('../models/Project.js').default} project
 */
export async function listProjectScripts(project) {
  const paths = await resolveProjectPaths(project);
  const scripts = await readScripts(paths.repo);

  if (scripts === null) {
    return { scripts: null, manager: null };
  }

  const manager = await detectPackageManager(paths.repo);
  const binary = packageManagerBinary(manager.name);

  return {
    scripts,
    manager: {
      name: manager.name,
      description: describePackageManager(manager),
      // What the preview shows: "<binary> run <script> [--] <arguments>".
      binary: binary || manager.name,
      separator: needsSeparator(manager.name),
      available: binary !== null,
    },
  };
}

/**
 * Split the arguments field, refusing what cannot be passed safely.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function parseScriptArguments(text) {
  const value = String(text || '');

  if (value.length > MAX_SCRIPT_ARGUMENTS_LENGTH) {
    throw new Error(`The arguments are limited to ${MAX_SCRIPT_ARGUMENTS_LENGTH} characters.`);
  }

  if (/[\r\n\0]/.test(value)) {
    throw new Error('The arguments must fit on one line.');
  }

  return splitCommandLine(value.trim());
}

/**
 * Queue a script run.
 *
 * @param {import('../models/Project.js').default} project
 * @param {object} options
 * @param {string} options.script a script of package.json
 * @param {string[]} options.args
 * @param {boolean} options.hideArgs keep the arguments out of the log and the history (passwords...)
 * @param {string} options.triggeredBy
 */
export async function queueScriptRun(project, { script, args, hideArgs, triggeredBy }) {
  if (project.system) {
    throw new Error('SolarOps has no scripts to run from its own UI.');
  }

  const { scripts, manager } = await listProjectScripts(project);

  if (scripts === null) {
    throw new Error('No package.json in repo/: deploy the project (or copy its files) first.');
  }

  if (!scripts.some((entry) => entry.name === script)) {
    throw new Error(`package.json has no "${script}" script.`);
  }

  if (!manager.available) {
    throw new Error(`${manager.name} is needed but not installed on this server: run npm run setup again.`);
  }

  let shownArgs = args.map(quoteArgument).join(' ');

  if (hideArgs && args.length > 0) {
    shownArgs = HIDDEN_ARGUMENTS;
  }

  const { task } = await enqueueTask(
    {
      projectId: project.id,
      type: 'script',
      title: `Run ${script} on ${project.name}`,
      trigger: 'manual',
      triggeredBy,
      meta: { script, args: shownArgs },
    },
    (context) => runScript(context, project, { script, args, hideArgs, manager }),
  );

  return { task, shownArgs };
}

/**
 * The task: the script, from repo/, with the project's environment.
 */
async function runScript(context, project, { script, args, hideArgs, manager }) {
  const paths = await resolveProjectPaths(project);

  context.addSecrets(await listProjectSecrets(project));

  // Hidden arguments never reach the log, even in the script's own output.
  if (hideArgs) {
    context.addSecrets(args);
  }

  // Corepack (pnpm, yarn) must never wait for an answer to its download prompt.
  const env = { ...baseProcessEnv(), ...(await buildProjectEnv(project)), COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' };
  const [file, ...prefix] = manager.binary.split(' ');
  const argv = [...prefix, ...runArguments(manager.name, script, args)];

  let shownArgs = args.map(quoteArgument);

  if (hideArgs && args.length > 0) {
    shownArgs = [HIDDEN_ARGUMENTS];
  }

  context.step(`Running the "${script}" script`);
  context.info(`Package manager: ${manager.description}. From repo/, with the environment of ${project.name}.`);
  await context.run(file, argv, {
    cwd: paths.repo,
    env,
    timeoutMs: config.taskTimeoutMinutes * 60 * 1000,
    display: [manager.binary, ...runArguments(manager.name, script, shownArgs)].join(' '),
  });
  context.info('\nThe script finished.');
}
