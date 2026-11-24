/**
 * OS packages a project needs (ffmpeg, pandoc...), set in Deployment ›
 * Source and installed with apt before the install commands.
 *
 * Checking needs no privilege (apt-cache, dpkg-query). Installing does: the
 * setup installs a root-owned helper (deploy/install.sh) that sudo lets
 * SolarOps run, and that only runs `apt-get install` on valid package names:
 * SOLAROPS_APT_INSTALL_CMD. Without it, a deployment stops and says what to
 * install by hand.
 */
import config from '../config.js';
import { findExecutable, runCommand } from '../lib/exec.js';

/** A Debian / Ubuntu package name (what the root helper accepts too). */
export const OS_PACKAGE_PATTERN = /^[a-z0-9][a-z0-9+.-]{1,99}$/;

export const MAX_OS_PACKAGES = 40;

/**
 * The package names of the field: separated by spaces, commas or lines.
 *
 * @param {string} text
 * @returns {{names: string[], invalid: string[]}}
 */
export function parseOsPackages(text) {
  const names = [];
  const invalid = [];

  for (const token of String(text || '').split(/[\s,]+/)) {
    const name = token.trim().toLowerCase();

    if (name === '' || names.includes(name)) {
      continue;
    }

    if (OS_PACKAGE_PATTERN.test(name)) {
      names.push(name);
    } else {
      invalid.push(token);
    }
  }

  return { names, invalid };
}

/**
 * Which packages apt does not know (no installable version).
 *
 * @param {string[]} names
 * @returns {Promise<{checked: boolean, unknown: string[]}>} checked: false without apt (not Ubuntu / Debian)
 */
export async function findUnknownPackages(names) {
  if (names.length === 0) {
    return { checked: true, unknown: [] };
  }

  if (findExecutable('apt-cache') === null) {
    return { checked: false, unknown: [] };
  }

  const unknown = [];

  for (const name of names) {
    const { stdout } = await runCommand('apt-cache', ['policy', name], { timeoutMs: 15000, allowFailure: true });
    const candidate = /Candidate:\s*(\S+)/.exec(stdout);

    if (candidate === null || candidate[1] === '(none)') {
      unknown.push(name);
    }
  }

  return { checked: true, unknown };
}

/**
 * Which packages are not installed yet.
 *
 * @param {string[]} names
 */
export async function findMissingPackages(names) {
  const missing = [];

  for (const name of names) {
    const { stdout } = await runCommand('dpkg-query', ['-W', '-f=${db:Status-Abbrev}', name], {
      timeoutMs: 15000,
      allowFailure: true,
    });

    if (!stdout.startsWith('ii')) {
      missing.push(name);
    }
  }

  return missing;
}

/**
 * Deployment step: install the missing packages (task context).
 *
 * @param {import('./taskRunner.js').TaskContext} context
 * @param {string} text the project's field
 */
export async function installOsPackages(context, text) {
  const { names } = parseOsPackages(text);

  context.step('OS packages');

  if (names.length === 0) {
    context.info('None required.');
    return;
  }

  if (findExecutable('dpkg-query') === null) {
    context.info(`Not an apt system: ${names.join(', ')} not checked.`);
    return;
  }

  const missing = await findMissingPackages(names);

  if (missing.length === 0) {
    context.info(`Already installed: ${names.join(', ')}.`);
    return;
  }

  if (!config.commands.aptInstall) {
    throw new Error(
      `Missing OS packages: ${missing.join(', ')}. Install them (sudo apt install ${missing.join(' ')}), or run npm run setup again (in the SolarOps folder) so SolarOps can install them itself.`,
    );
  }

  context.info(`Installing ${missing.join(', ')} (apt, as root through the SolarOps helper).`);
  const [file, ...args] = config.commands.aptInstall.split(' ').filter(Boolean);
  await context.run(file, [...args, ...missing], {
    timeoutMs: config.taskTimeoutMinutes * 60 * 1000,
    display: `apt-get install ${missing.join(' ')}`,
  });
}
