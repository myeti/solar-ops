/**
 * Dashboard overview, health checks, tasks and audit journal.
 */
import express from 'express';
import { GitCredential, Project, SmtpAccount, Task } from '../models/index.js';
import { notFound } from '../lib/errors.js';
import { presentAlertState } from '../services/alerts.js';
import { listAudit } from '../services/audit.js';
import { getProcessMap } from '../services/pm2.js';
import { topProcesses, usageHistory } from '../services/monitoring.js';
import { listDatabases } from '../services/postgres.js';
import { collectServerMetrics } from '../services/serverMetrics.js';
import { runHealthChecks } from '../services/system.js';
import { findTaskWithLiveLog } from '../services/taskRunner.js';
import { parseId } from './helpers.js';

const router = express.Router();

/**
 * Whether nginx serves a static site: active, exposed on a domain.
 */
function isServed(project) {
  return project.active && project.network.enabled && Boolean(project.network.domain);
}

/**
 * Numbers displayed on the dashboard (SolarOps itself is not counted).
 * Online: applications running in pm2, and static sites served by nginx.
 */
router.get('/overview', async (req, res) => {
  const projects = (await Project.findAll()).filter((project) => !project.system);
  const { processes, error } = await getProcessMap();

  const stats = {
    projects: {
      total: projects.length,
      active: 0,
      apps: 0,
      staticSites: 0,
      online: 0,
      appsOnline: 0,
      staticOnline: 0,
      errored: 0,
    },
  };

  for (const project of projects) {
    if (project.active) {
      stats.projects.active += 1;
    }

    if (project.isStatic) {
      stats.projects.staticSites += 1;

      if (isServed(project)) {
        stats.projects.staticOnline += 1;
      }

      continue;
    }

    stats.projects.apps += 1;

    const processInfo = processes.get(project.uid);

    if (processInfo && processInfo.status === 'online') {
      stats.projects.appsOnline += 1;
    }

    if (processInfo && processInfo.status === 'errored') {
      stats.projects.errored += 1;
    }
  }

  stats.projects.online = stats.projects.appsOnline + stats.projects.staticOnline;

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

/**
 * Badges of the menu: how many items each page lists. PostgreSQL is null
 * when the server cannot be reached; alerts are the open ones.
 */
router.get('/counts', async (req, res) => {
  const projects = await Project.findAll();
  const databases = await listDatabases().catch(() => null);
  let postgres = null;

  if (databases !== null) {
    postgres = databases.length;
  }

  res.json({
    projects: projects.filter((project) => !project.system).length,
    gitCredentials: await GitCredential.count(),
    domains: projects.filter((project) => project.network.enabled && project.network.domain).length,
    postgres,
    mailRelays: await SmtpAccount.count(),
    redis: projects.filter((project) => project.redis.enabled).length,
    alerts: presentAlertState().open.length,
  });
});

/**
 * System › Monitoring: the top processes right now (polled by the page),
 * and the last 24 hours of CPU and memory (kept in memory).
 */
router.get('/monitoring/processes', async (req, res) => {
  res.json(await topProcesses());
});

router.get('/monitoring/history', (req, res) => {
  res.json(usageHistory());
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
