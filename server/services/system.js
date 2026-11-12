/**
 * System health checks displayed on the dashboard and in Settings:
 * required binaries, PostgreSQL, base folder and nginx integration.
 */
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import config from '../config.js';
import { findExecutable, runCommand, runConfiguredCommand, splitCommandLine } from '../lib/exec.js';
import { readFileOrNull } from '../lib/files.js';
import { nginxIncludeDirective } from './nginx.js';
import { testPostgresConnection } from './postgres.js';
import { getGeneralSettings } from './settings.js';

/** Extra locations searched for binaries (sbin is often not in PATH). */
const EXTRA_BIN_DIRECTORIES = ['/usr/sbin', '/usr/local/sbin', '/sbin', '/snap/bin'];

/**
 * Locate a binary in the PATH or the usual sbin folders.
 */
function locate(binary) {
  const found = findExecutable(binary);

  if (found !== null) {
    return found;
  }

  for (const directory of EXTRA_BIN_DIRECTORIES) {
    const candidate = findExecutable(path.join(directory, binary));
    if (candidate !== null) {
      return candidate;
    }
  }

  return null;
}

/**
 * Check one binary and read its version.
 *
 * @param {object} check
 * @param {string} check.id
 * @param {string} check.label
 * @param {string} check.command configured command line
 * @param {string[]} check.versionArgs
 * @param {string} check.purpose shown in the UI
 */
async function checkBinary({ id, label, command, versionArgs, purpose }) {
  const [file] = splitCommandLine(command);
  const location = locate(file);

  if (location === null) {
    return { id, label, purpose, ok: false, message: `"${file}" not found.` };
  }

  try {
    const { stdout, stderr } = await runCommand(location, versionArgs, { timeoutMs: 15000, allowFailure: true });
    const version = `${stdout}\n${stderr}`.trim().split('\n')[0];

    return { id, label, purpose, ok: true, message: version || location };
  } catch (error) {
    return { id, label, purpose, ok: false, message: error.message };
  }
}

/**
 * Look for the SolarOps include directive in the nginx configuration.
 */
async function checkNginxInclude(baseFolder) {
  const directive = nginxIncludeDirective(baseFolder);
  const candidates = ['/etc/nginx/nginx.conf', '/etc/nginx/conf.d/solarops.conf'];

  for (const file of candidates) {
    const content = await readFileOrNull(file).catch(() => null);

    if (content !== null && content.includes(`${baseFolder.replace(/\/+$/, '')}/*/etc/nginx.conf`)) {
      return {
        id: 'nginx-include',
        label: 'nginx include',
        ok: true,
        message: `Found in ${file}`,
        purpose: 'Loads project configs',
      };
    }
  }

  return {
    id: 'nginx-include',
    label: 'nginx include',
    ok: false,
    purpose: 'Loads project configs',
    message: `Add "${directive}" to the http block of nginx (e.g. /etc/nginx/conf.d/solarops.conf).`,
  };
}

/**
 * Check that SolarOps may test and reload nginx.
 */
async function checkNginxPermissions() {
  try {
    await runConfiguredCommand(config.commands.nginxTest, [], { timeoutMs: 15000 });
    return {
      id: 'nginx-test',
      label: 'nginx -t',
      ok: true,
      purpose: 'Validate configs',
      message: 'Configuration is valid and SolarOps may test it.',
    };
  } catch (error) {
    return {
      id: 'nginx-test',
      label: 'nginx -t',
      ok: false,
      purpose: 'Validate configs',
      message: error.message.split('\n').slice(0, 4).join(' '),
    };
  }
}

/**
 * Check the base folder exists and is writable.
 */
async function checkBaseFolder(baseFolder) {
  try {
    await fs.access(baseFolder, fsConstants.W_OK);
    return {
      id: 'base-folder',
      label: 'Base folder',
      ok: true,
      purpose: 'Projects location',
      message: `${baseFolder} is writable.`,
    };
  } catch {
    return {
      id: 'base-folder',
      label: 'Base folder',
      ok: false,
      purpose: 'Projects location',
      message: `${baseFolder} does not exist or is not writable.`,
    };
  }
}

/**
 * Check the PostgreSQL admin connection.
 */
async function checkPostgres() {
  try {
    const info = await testPostgresConnection();
    let message = `PostgreSQL ${info.version}`;

    if (!info.canCreateDatabases || !info.canCreateRoles) {
      return {
        id: 'postgres',
        label: 'PostgreSQL',
        ok: false,
        purpose: 'Project databases',
        message: `${message} — the admin role needs CREATEDB and CREATEROLE.`,
      };
    }

    if (info.superuser) {
      message += ' (superuser)';
    }

    return { id: 'postgres', label: 'PostgreSQL', ok: true, purpose: 'Project databases', message };
  } catch (error) {
    return { id: 'postgres', label: 'PostgreSQL', ok: false, purpose: 'Project databases', message: error.message };
  }
}

/**
 * Run every health check.
 */
export async function runHealthChecks() {
  const settings = await getGeneralSettings();

  const binaries = await Promise.all([
    checkBinary({
      id: 'git',
      label: 'git',
      command: config.commands.git,
      versionArgs: ['--version'],
      purpose: 'Deployments',
    }),
    checkBinary({
      id: 'npm',
      label: 'npm',
      command: config.commands.npm,
      versionArgs: ['--version'],
      purpose: 'Install & build',
    }),
    checkBinary({
      id: 'pm2',
      label: 'pm2',
      command: config.commands.pm2,
      versionArgs: ['--version'],
      purpose: 'Process manager',
    }),
    checkBinary({ id: 'nginx', label: 'nginx', command: 'nginx', versionArgs: ['-v'], purpose: 'Reverse proxy' }),
    checkBinary({
      id: 'certbot',
      label: 'certbot',
      command: config.commands.certbot,
      versionArgs: ['--version'],
      purpose: 'SSL certificates',
    }),
    checkBinary({
      id: 'pg_dump',
      label: 'pg_dump',
      command: config.commands.pgDump,
      versionArgs: ['--version'],
      purpose: 'Database dumps',
    }),
  ]);

  const checks = [
    {
      id: 'node',
      label: 'Node.js',
      ok: Number(process.versions.node.split('.')[0]) >= 24,
      purpose: 'Runtime',
      message: `Node ${process.versions.node}`,
    },
    ...binaries,
    await checkBaseFolder(settings.baseFolder),
    await checkNginxInclude(settings.baseFolder),
    await checkNginxPermissions(),
    await checkPostgres(),
  ];

  return {
    checks,
    host: {
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()}`,
      uptimeSeconds: os.uptime(),
      loadAverage: os.loadavg(),
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      cpus: os.cpus().length,
      user: os.userInfo().username,
    },
  };
}
