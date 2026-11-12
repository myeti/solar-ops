/**
 * Dashboard overview, health checks, tasks and audit journal.
 */
import express from 'express';
import { Project, SharedCertificate, Task } from '../models/index.js';
import { notFound } from '../lib/errors.js';
import { listAudit } from '../services/audit.js';
import { getSharedCertificatePaths, readCertificate, readCertificateFiles } from '../services/certificates.js';
import { getProcessMap } from '../services/pm2.js';
import { resolveProjectPaths } from '../services/projectPaths.js';
import { collectServerMetrics } from '../services/serverMetrics.js';
import { runHealthChecks } from '../services/system.js';
import { findTaskWithLiveLog } from '../services/taskRunner.js';
import { parseId } from './helpers.js';

const router = express.Router();

/**
 * Add the own certificate of a project (SolarOps included) to the stats.
 */
async function countCertificate(stats, project) {
  const network = project.network;
  const ownCertificate = network.certMethod === 'http' || network.certMethod === 'dns';

  // Shared certificates are counted once each (countSharedCertificates).
  if (!network.enabled || !ownCertificate) {
    return;
  }

  const paths = await resolveProjectPaths(project);
  const certificate = await readCertificate(paths, project.uid).catch(() => ({ exists: false }));

  countStatus(stats, certificate);
}

/**
 * Add every shared certificate to the stats.
 */
async function countSharedCertificates(stats) {
  const certificates = await SharedCertificate.findAll();

  for (const shared of certificates) {
    const files = getSharedCertificatePaths(shared.name).files;
    const certificate = await readCertificateFiles(files).catch(() => ({ exists: false }));

    countStatus(stats, certificate);
  }
}

/**
 * Count one certificate in its status bucket.
 */
function countStatus(stats, certificate) {
  stats.certificates.total += 1;

  if (!certificate.exists) {
    stats.certificates.missing += 1;
  } else if (certificate.needsRenewal) {
    stats.certificates.expiringSoon += 1;
  } else {
    stats.certificates.valid += 1;
  }
}

/**
 * Numbers displayed on the dashboard. SolarOps itself is not counted as a
 * project, but its certificate is.
 */
router.get('/overview', async (req, res) => {
  const projects = await Project.findAll();
  const { processes, error } = await getProcessMap();

  const stats = {
    projects: { total: 0, active: 0, apps: 0, staticSites: 0, online: 0, errored: 0 },
    certificates: { total: 0, valid: 0, expiringSoon: 0, missing: 0 },
    databases: 0,
    deployments: 0,
  };

  await countSharedCertificates(stats);

  for (const project of projects) {
    await countCertificate(stats, project);

    if (project.system) {
      continue;
    }

    if (project.active) {
      stats.projects.active += 1;
    }

    if (project.isStatic) {
      stats.projects.staticSites += 1;
    } else {
      stats.projects.apps += 1;
    }

    const processInfo = processes.get(project.uid);

    if (processInfo && processInfo.status === 'online') {
      stats.projects.online += 1;
    }

    if (processInfo && processInfo.status === 'errored') {
      stats.projects.errored += 1;
    }

    if (project.database.enabled) {
      stats.databases += 1;
    }

    if (project.deployment.enabled) {
      stats.deployments += 1;
    }
  }

  stats.projects.total = projects.filter((project) => !project.system).length;

  const recentTasks = await Task.findAll({
    include: ['project'],
    order: [
      ['createdAt', 'DESC'],
      ['id', 'DESC'],
    ],
    limit: 8,
  });

  res.json({
    stats,
    server: await collectServerMetrics(),
    processError: error,
    recentTasks: recentTasks.map((task) => task.toPublic()),
    recentAudit: await listAudit(8),
  });
});

router.get('/health', async (req, res) => {
  res.json(await runHealthChecks());
});

router.get('/audit', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);

  res.json({ entries: await listAudit(limit) });
});

router.get('/tasks', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 200);
  const tasks = await Task.findAll({
    include: ['project'],
    order: [
      ['createdAt', 'DESC'],
      ['id', 'DESC'],
    ],
    limit,
  });

  res.json({ tasks: tasks.map((task) => task.toPublic()) });
});

/**
 * One task with its (live) log.
 */
router.get('/tasks/:id', async (req, res) => {
  const task = await findTaskWithLiveLog(parseId(req.params.id));

  if (task === null) {
    throw notFound('Task not found.');
  }

  res.json({ task: task.toPublic({ withLog: true }) });
});

export default router;
