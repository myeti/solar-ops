/**
 * Periodic jobs:
 *   - every minute (SOLAROPS_ALERT_CHECK_SECONDS): check the alert rules,
 *   - every hour: purge expired sessions / magic links,
 *   - every 12 hours (and shortly after startup): renew certificates that
 *     expire within 30 days (project and shared certificates with
 *     auto-renew enabled),
 *   - every 10 minutes: queue the scheduled database backups that are due,
 *   - every day: delete tasks older than 90 days.
 */
import config from '../config.js';
import logger from '../lib/logger.js';
import { runAlertCheck } from './alerts.js';
import { purgeExpiredAuthData } from './auth.js';
import { runDueBackups } from './backups.js';
import {
  findCertificatesToRenew,
  findSharedCertificatesToRenew,
  queueCertificate,
  queueSharedCertificate,
} from './certbot.js';
import { pruneOldTasks } from './taskRunner.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const TASK_RETENTION_DAYS = 90;

const timers = [];

/**
 * Queue a renewal for every certificate that needs it.
 *
 * @returns {Promise<{tasks: import('../models/Task.js').default[], finished: Promise<PromiseSettledResult[]>}>}
 *   the queued tasks, and a promise settled when they are all done
 *   (check each task status afterwards: failures do not reject)
 */
export async function renewDueCertificates({ trigger = 'schedule', triggeredBy = 'scheduler' } = {}) {
  const projects = await findCertificatesToRenew();
  const tasks = [];
  const finished = [];

  for (const project of projects) {
    logger.info(`Queuing certificate renewal for ${project.uid}`);
    const result = await queueCertificate(project, { trigger, triggeredBy });
    tasks.push(result.task);
    finished.push(result.finished);
  }

  for (const shared of await findSharedCertificatesToRenew()) {
    logger.info(`Queuing renewal of the shared certificate ${shared.name}`);
    const result = await queueSharedCertificate(shared, { trigger, triggeredBy });
    tasks.push(result.task);
    finished.push(result.finished);
  }

  return { tasks, finished: Promise.allSettled(finished) };
}

/**
 * Wrap a job so an error is logged instead of crashing the process.
 */
function safely(name, job) {
  return async () => {
    try {
      await job();
    } catch (error) {
      logger.error(`Scheduled job "${name}" failed`, { error: error.message });
    }
  };
}

/**
 * Start every periodic job.
 */
export function startScheduler() {
  const purgeAuth = safely('purge-auth', purgeExpiredAuthData);
  const renewCertificates = safely('renew-certificates', () => renewDueCertificates());
  const pruneTasks = safely('prune-tasks', () => pruneOldTasks(TASK_RETENTION_DAYS));
  const backups = safely('database-backups', runDueBackups);
  const alerts = safely('alerts', () => runAlertCheck());

  timers.push(setInterval(purgeAuth, HOUR));
  timers.push(setInterval(renewCertificates, 12 * HOUR));
  timers.push(setInterval(pruneTasks, 24 * HOUR));
  timers.push(setInterval(backups, 10 * MINUTE));
  timers.push(setInterval(alerts, Math.max(10, config.alertCheckSeconds) * 1000));
  timers.push(setTimeout(renewCertificates, 2 * MINUTE));
  timers.push(setTimeout(pruneTasks, 5 * MINUTE));
  timers.push(setTimeout(backups, MINUTE));

  for (const timer of timers) {
    timer.unref();
  }
}

/**
 * Stop every periodic job (graceful shutdown).
 */
export function stopScheduler() {
  for (const timer of timers) {
    clearInterval(timer);
    clearTimeout(timer);
  }

  timers.length = 0;
}
