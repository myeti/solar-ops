/**
 * Package manager of a repository (npm, pnpm, yarn or bun) and the commands
 * installing its dependencies or running one of its scripts, used when a
 * project leaves its install commands empty.
 *
 * Detection, first match wins:
 *   1. the "packageManager" field of package.json (e.g. "pnpm@9.15.4"),
 *   2. the lockfile: pnpm-lock.yaml, yarn.lock, bun.lock(b), package-lock.json,
 *   3. npm.
 *
 * Projects run with NODE_ENV=production, which makes npm, pnpm and Yarn 1
 * skip devDependencies; builds usually need them, so installs ask for them.
 * pnpm and yarn come from corepack (enabled by deploy/install.sh).
 */
import path from 'node:path';
import { findExecutable } from '../lib/exec.js';
import { pathExists, readFileOrNull } from '../lib/files.js';

const MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'];

/** Lockfiles, in the order they are looked for. */
const LOCKFILES = [
  { file: 'pnpm-lock.yaml', manager: 'pnpm' },
  { file: 'yarn.lock', manager: 'yarn' },
  { file: 'bun.lock', manager: 'bun' },
  { file: 'bun.lockb', manager: 'bun' },
  { file: 'package-lock.json', manager: 'npm' },
  { file: 'npm-shrinkwrap.json', manager: 'npm' },
];

/** Managers corepack can provide when they are not installed. */
const COREPACK_MANAGERS = ['pnpm', 'yarn'];

/**
 * "pnpm@9.15.4+sha512.abc" => { name: "pnpm", version: "9.15.4" }.
 *
 * @param {*} field
 */
function parsePackageManagerField(field) {
  const match = /^([a-z]+)@(\d[^+\s]*)/.exec(String(field || ''));

  if (match === null || !MANAGERS.includes(match[1])) {
    return null;
  }

  return { name: match[1], version: match[2] };
}

/**
 * The package manager of a repository.
 *
 * @param {string} repoDirectory
 * @returns {Promise<{name: string, version: string|null, source: string, lockfile: string|null, yarnBerry: boolean}|null>}
 *   null without package.json
 */
export async function detectPackageManager(repoDirectory) {
  const content = await readFileOrNull(path.join(repoDirectory, 'package.json'));

  if (content === null) {
    return null;
  }

  let manifest = {};

  try {
    manifest = JSON.parse(content);
  } catch {
    // An invalid package.json is reported by the install itself.
  }

  const lockfiles = [];

  for (const entry of LOCKFILES) {
    if (await pathExists(path.join(repoDirectory, entry.file))) {
      lockfiles.push(entry);
    }
  }

  const declared = parsePackageManagerField(manifest.packageManager);
  let name = 'npm';
  let version = null;
  let source = 'default';

  if (declared !== null) {
    name = declared.name;
    version = declared.version;
    source = `packageManager: ${manifest.packageManager.split('+')[0]}`;
  } else if (lockfiles.length > 0) {
    name = lockfiles[0].manager;
    source = lockfiles[0].file;
  }

  const lockfile = lockfiles.find((entry) => entry.manager === name);
  let yarnBerry = false;

  // Yarn 2+ ("berry") differs from Yarn 1 in flags and production handling.
  if (name === 'yarn') {
    const major = Number(String(version || '').split('.')[0]);
    yarnBerry = major >= 2 || (version === null && (await pathExists(path.join(repoDirectory, '.yarnrc.yml'))));
  }

  let lockfileName = null;

  if (lockfile) {
    lockfileName = lockfile.file;
  }

  return { name, version, source, lockfile: lockfileName, yarnBerry };
}

/**
 * Command running a package manager: its own binary, or through corepack
 * when only corepack is installed.
 *
 * @param {string} name
 * @returns {string|null} null when it cannot run on this server
 */
export function packageManagerBinary(name) {
  if (findExecutable(name) !== null) {
    return name;
  }

  if (COREPACK_MANAGERS.includes(name) && findExecutable('corepack') !== null) {
    return `corepack ${name}`;
  }

  return null;
}

/**
 * Command installing the dependencies, devDependencies included.
 *
 * @param {Awaited<ReturnType<typeof detectPackageManager>>} manager
 * @param {string} binary see packageManagerBinary
 */
export function installCommandFor(manager, binary) {
  const locked = manager.lockfile !== null;

  if (manager.name === 'pnpm') {
    if (locked) {
      return `${binary} install --frozen-lockfile --prod=false`;
    }

    return `${binary} install --prod=false`;
  }

  if (manager.name === 'yarn' && manager.yarnBerry) {
    // Yarn 2+ installs devDependencies whatever NODE_ENV says.
    if (locked) {
      return `${binary} install --immutable`;
    }

    return `${binary} install`;
  }

  if (manager.name === 'yarn') {
    if (locked) {
      return `${binary} install --frozen-lockfile --production=false`;
    }

    return `${binary} install --production=false`;
  }

  if (manager.name === 'bun') {
    if (locked) {
      return `${binary} install --frozen-lockfile`;
    }

    return `${binary} install`;
  }

  if (locked) {
    return `${binary} ci --include=dev`;
  }

  return `${binary} install --include=dev`;
}

/**
 * Command running a package.json script with the package manager.
 *
 * @param {string} binary see packageManagerBinary
 * @param {string} script
 */
export function runScriptCommand(binary, script) {
  return `${binary} run ${script}`;
}

/**
 * One line for the deploy log: "pnpm 9.15.4 (packageManager: pnpm@9.15.4)".
 *
 * @param {Awaited<ReturnType<typeof detectPackageManager>>} manager
 */
export function describePackageManager(manager) {
  let label = manager.name;

  if (manager.name === 'yarn' && manager.yarnBerry) {
    label = 'yarn (2+)';
  }

  if (manager.version) {
    label = `${label} ${manager.version}`;
  }

  if (manager.source === 'default') {
    return `${label} (no lockfile)`;
  }

  return `${label} (${manager.source})`;
}
