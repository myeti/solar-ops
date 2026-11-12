/**
 * Access protection of a project's website (Network › Access), enforced by
 * nginx in front of the project:
 *
 *   - users: a password is asked (HTTP basic auth), checked against
 *     <project>/etc/htpasswd (SHA-512 crypt hashes, never the passwords);
 *   - allowed IPs: only these addresses or ranges get in, others get 403;
 *   - both: the allowed addresses skip the password, everyone else must
 *     sign in (nginx `satisfy any`).
 *
 * Let's Encrypt challenges always stay open (renewals keep working), and
 * SolarOps's own checks reach the application on its port, not through
 * nginx.
 */
import fs from 'node:fs/promises';
import net from 'node:net';
import { runCommand } from '../lib/exec.js';
import { isManagedFile, writeManagedFile } from '../lib/files.js';

export const ACCESS_MARKER = '# Managed by SolarOps';

/** Characters htpasswd user names may hold (no ":", no spaces). */
export const ACCESS_USERNAME_PATTERN = /^[A-Za-z0-9._@-]{1,64}$/;

export const MAX_ACCESS_USERS = 50;
export const MAX_ALLOWED_IPS = 100;

/**
 * Access settings of a project, with defaults.
 *
 * @param {object} network project.network
 * @returns {{enabled: boolean, users: Array<{username: string, hash: string}>, allowedIps: string[]}}
 */
export function accessOf(network) {
  const access = network.access || {};
  let users = [];
  let allowedIps = [];

  if (Array.isArray(access.users)) {
    users = access.users;
  }

  if (Array.isArray(access.allowedIps)) {
    allowedIps = access.allowedIps;
  }

  return { enabled: access.enabled === true, users, allowedIps };
}

/**
 * What the UI may see: user names, never the hashes.
 */
export function publicAccess(network) {
  const access = accessOf(network);

  return {
    enabled: access.enabled,
    users: access.users.map((user) => ({ username: user.username })),
    allowedIps: access.allowedIps,
  };
}

/**
 * Whether nginx restricts the website.
 */
export function isRestricted(network) {
  const access = accessOf(network);

  return access.enabled && (access.users.length > 0 || access.allowedIps.length > 0);
}

/**
 * SHA-512 crypt hash of a password ($6$...), as nginx reads them. The
 * password goes through stdin, never the command line.
 *
 * @param {string} password
 */
export async function hashAccessPassword(password) {
  const { stdout } = await runCommand('openssl', ['passwd', '-6', '-stdin'], {
    input: `${password}\n`,
    timeoutMs: 10000,
  });
  const hash = stdout.trim();

  if (!hash.startsWith('$6$')) {
    throw new Error('openssl could not hash the password (OpenSSL 1.1.1 or later is needed for SHA-512 crypt).');
  }

  return hash;
}

/**
 * An IPv4 / IPv6 address or range (CIDR) in canonical form, or null.
 *
 * @param {string} value
 */
export function normalizeAllowedIp(value) {
  const [address, prefix, extra] = String(value).trim().split('/');

  if (extra !== undefined) {
    return null;
  }

  const family = net.isIP(address);

  if (family === 0) {
    return null;
  }

  let canonical = address.toLowerCase();

  if (family === 6) {
    canonical = new URL(`http://[${canonical}]/`).hostname.replace(/^\[|\]$/g, '');
  }

  if (prefix === undefined) {
    return canonical;
  }

  const bits = Number(prefix);
  let maximum = 32;

  if (family === 6) {
    maximum = 128;
  }

  if (!/^\d{1,3}$/.test(prefix) || bits > maximum) {
    return null;
  }

  return `${canonical}/${bits}`;
}

/**
 * nginx directives restricting a server block (empty when not restricted).
 *
 * @param {object} network project.network
 * @param {string} htpasswdPath
 */
export function accessDirectives(network, htpasswdPath) {
  if (!isRestricted(network)) {
    return [];
  }

  const access = accessOf(network);
  const lines = ['# Access restricted (SolarOps › Network › Access)'];

  if (access.users.length > 0 && access.allowedIps.length > 0) {
    // Allowed addresses get in directly, others need the password.
    lines.push('satisfy any;');
  }

  for (const ip of access.allowedIps) {
    lines.push(`allow ${ip};`);
  }

  if (access.allowedIps.length > 0) {
    lines.push('deny all;');
  }

  if (access.users.length > 0) {
    lines.push('auth_basic "Restricted";', `auth_basic_user_file ${htpasswdPath};`);
  }

  lines.push('');

  return lines;
}

/**
 * Write <project>/etc/htpasswd for the users, or remove it when none (a file
 * SolarOps did not write is never touched).
 *
 * @param {object} network project.network
 * @param {string} htpasswdPath
 */
export async function writeAccessFile(network, htpasswdPath) {
  const access = accessOf(network);

  if (!isRestricted(network) || access.users.length === 0) {
    if (await isManagedFile(htpasswdPath, ACCESS_MARKER)) {
      await fs.rm(htpasswdPath, { force: true });
    }

    return;
  }

  const lines = [
    `${ACCESS_MARKER}: users of Network › Access (SHA-512 crypt). Manual changes will be overwritten.`,
    ...access.users.map((user) => `${user.username}:${user.hash}`),
  ];

  // Read by the nginx workers: only hashes are stored.
  await writeManagedFile(htpasswdPath, `${lines.join('\n')}\n`, { marker: ACCESS_MARKER, mode: 0o644 });
}
