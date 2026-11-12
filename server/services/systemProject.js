/**
 * The system project: SolarOps itself, managed like a project so its
 * domain, certificate and mail relay benefit from the same tooling
 * (nginx config, Let's Encrypt, auto-renewal, expiry overview).
 *
 * It is deliberately restricted, because a mistake must never lock the
 * admins out of SolarOps:
 *   - it cannot be deleted, deactivated or renamed,
 *   - it has no pm2 process (systemd runs SolarOps) and no deployment
 *     (sources are owned by root; updates go through npm run update),
 *   - its network is always a reverse proxy to SolarOps's own port,
 *   - only its network and mail components can be configured.
 *
 * Its folder (<base folder>/solarops) only holds etc/: the nginx config
 * and the certificates, picked up by the same nginx include as projects.
 */
import config from '../config.js';
import { Project, SmtpAccount } from '../models/index.js';
import logger from '../lib/logger.js';
import { findServableCertificateFiles } from './certificates.js';
import { resolveProjectPaths } from './projectPaths.js';

export const SYSTEM_UID = 'solarops';

/**
 * Routes of /api/projects/:uid that the system project accepts. Anything
 * else is refused (new routes are denied by default).
 */
const ALLOWED_ROUTES = [
  { method: 'GET', path: /^\/?$/ },
  { method: 'GET', path: /^\/tasks\/?$/ },
  { method: 'PUT', path: /^\/smtp\/?$/ },
  { method: 'PUT', path: /^\/network\/?$/ },
  { method: 'POST', path: /^\/network\/(apply|certificate|dns-records)\/?$/ },
  { method: 'GET', path: /^\/network\/(preview|dns-check)\/?$/ },
];

/**
 * Network settings that always apply to the system project (its port is
 * SolarOps's own port, see ensureSystemProject).
 */
function lockedNetwork(network) {
  return {
    ...network,
    mode: 'proxy',
  };
}

/**
 * Create the system project if needed and enforce its invariants (the port
 * follows SOLAROPS_PORT). Safe to call concurrently (server + CLI).
 *
 * @returns {Promise<Project>}
 */
export async function ensureSystemProject() {
  // Look for the flag first: a database created under a previous name keeps
  // its system project (and its folder) instead of getting a second one.
  let project = await Project.findOne({ where: { system: true } });

  if (project === null) {
    project = await Project.findOne({ where: { uid: SYSTEM_UID } });
  }

  if (project === null) {
    try {
      project = await Project.create({
        uid: SYSTEM_UID,
        name: 'SolarOps',
        folder: SYSTEM_UID,
        system: true,
        active: true,
        port: config.port,
        startCommand: 'systemd',
        env: [],
        networkConfig: lockedNetwork({ ...Project.defaultNetwork(), certMethod: 'http' }),
      });
      logger.info('System project "solarops" created');
    } catch (error) {
      if (error.name !== 'SequelizeUniqueConstraintError') {
        throw error;
      }

      // Created at the same time by another process (server / CLI).
      project = await Project.findOne({ where: { uid: SYSTEM_UID } });
    }
  }

  const network = project.network;
  const needsFix = !project.system || !project.active || network.mode !== 'proxy' || project.port !== config.port;

  if (needsFix) {
    project.system = true;
    project.active = true;
    project.port = config.port;
    project.networkConfig = lockedNetwork(network);

    try {
      await project.save();
    } catch (error) {
      // SOLAROPS_PORT changed to the port of a project: keep running, but say so.
      logger.error(`SolarOps's port ${config.port} is already used by a project: change that project's port.`, {
        error: error.message,
      });
    }
  }

  return project;
}

/**
 * @returns {Promise<Project|null>}
 */
export function getSystemProject() {
  return Project.findOne({ where: { system: true } });
}

/**
 * Express middleware (after loadProject): refuse every route the system
 * project does not support.
 */
export function guardSystemProject(req, res, next) {
  if (!req.project.system) {
    next();
    return;
  }

  const allowed = ALLOWED_ROUTES.some((route) => {
    return route.method === req.method && route.path.test(req.path);
  });

  if (!allowed) {
    res.status(403).json({
      error:
        'SolarOps itself only exposes its domain, certificate and mail relay. Everything else is managed by the server (systemd, npm run update / setup).',
    });
    return;
  }

  next();
}

/**
 * Apply the locked network settings to a network form submitted for the
 * system project.
 *
 * @param {object} network
 */
export function lockSystemNetwork(network) {
  return lockedNetwork(network);
}

/**
 * Public URL of SolarOps, from the system project domain.
 *
 * @returns {Promise<string|null>} e.g. https://solarops.example.com, or null without domain
 */
export async function getPublicUrl() {
  const project = await getSystemProject();

  if (project === null) {
    return null;
  }

  const network = project.network;

  if (!network.enabled || !network.domain) {
    return null;
  }

  const paths = await resolveProjectPaths(project);

  if ((await findServableCertificateFiles(project, paths)) !== null) {
    return `https://${network.domain}`;
  }

  return `http://${network.domain}`;
}

/**
 * What magic link login needs: a domain served over HTTPS (links must not
 * travel in clear text, nor be built from the request Host header) and a
 * mail relay.
 *
 * @returns {Promise<{ready: boolean, domain: string|null, https: boolean, publicUrl: string|null, mailRelay: {id: number, name: string}|null}>}
 */
export async function getMagicLinkReadiness() {
  const project = await getSystemProject();
  const result = { ready: false, domain: null, https: false, publicUrl: null, mailRelay: null };

  if (project === null) {
    return result;
  }

  const network = project.network;
  const smtp = project.smtp;

  if (network.enabled && network.domain) {
    result.domain = network.domain;
    result.publicUrl = await getPublicUrl();
    result.https = result.publicUrl !== null && result.publicUrl.startsWith('https://');
  }

  if (smtp.enabled && smtp.accountId) {
    const account = await SmtpAccount.findByPk(smtp.accountId);

    if (account !== null) {
      result.mailRelay = { id: account.id, name: account.name };
    }
  }

  result.ready = result.https && result.mailRelay !== null;

  return result;
}

/**
 * The mail relay of SolarOps (magic links), or null.
 *
 * @returns {Promise<import('../models/SmtpAccount.js').default|null>}
 */
export async function getSystemMailRelay() {
  const project = await getSystemProject();

  if (project === null || !project.smtp.enabled || !project.smtp.accountId) {
    return null;
  }

  return SmtpAccount.findByPk(project.smtp.accountId);
}

/**
 * Runtime status of SolarOps itself, shaped like a pm2 process status.
 * CPU is the average since start (systemd does not expose an instant value).
 */
export function selfProcessStatus() {
  const uptimeSeconds = process.uptime();
  const usage = process.cpuUsage();
  const cpuMilliseconds = (usage.user + usage.system) / 1000;
  const averageCpu = Math.round((cpuMilliseconds / (uptimeSeconds * 1000)) * 1000) / 10;

  return {
    name: SYSTEM_UID,
    pmId: null,
    pid: process.pid,
    status: 'online',
    cpu: averageCpu,
    memory: process.memoryUsage().rss,
    uptimeMs: Math.round(uptimeSeconds * 1000),
    restarts: 0,
    unstableRestarts: 0,
    managedBy: 'systemd',
  };
}
