/**
 * Scheduled backups of project databases (optional, off by default).
 *
 * A project can dump its database every day, or every week, at a given
 * hour (server time). Automatic dumps are named <uid>-auto-<timestamp>.dump
 * in the project `db/` folder, next to the manual ones; only the last
 * `keep` automatic dumps are kept, manual dumps are never deleted.
 *
 * The scheduler checks every few minutes: a backup runs once per slot,
 * including a missed slot (server down at that time), but never for slots
 * before the backups were enabled.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { Project } from '../models/index.js';
import logger from '../lib/logger.js';
import { dumpDatabase, isAutomaticDump, listDumps } from './postgres.js';
import { resolveProjectPaths } from './projectPaths.js';
import { enqueueTask } from './taskRunner.js';

export const BACKUP_FREQUENCIES = ['daily', 'weekly'];

/** Automatic dumps kept at most. */
export const MAX_BACKUPS_KEPT = 90;

/**
 * Days between two slots.
 *
 * @param {object} backups
 */
function periodDays(backups) {
  if (backups.frequency === 'weekly') {
    return 7;
  }

  return 1;
}

/**
 * The most recent slot at or before `now` (server local time).
 *
 * @param {object} backups project backups config
 * @param {Date} now
 * @returns {Date}
 */
export function lastSlot(backups, now) {
  const slot = new Date(now);
  slot.setHours(backups.hour, 0, 0, 0);

  if (backups.frequency === 'weekly') {
    const daysSinceWeekday = (slot.getDay() - backups.weekday + 7) % 7;
    slot.setDate(slot.getDate() - daysSinceWeekday);
  }

  if (slot > now) {
    slot.setDate(slot.getDate() - periodDays(backups));
  }

  return slot;
}

/**
 * The next slot after `now`.
 *
 * @param {object} backups
 * @param {Date} now
 * @returns {Date}
 */
export function nextSlot(backups, now) {
  const slot = lastSlot(backups, now);
  slot.setDate(slot.getDate() + periodDays(backups));

  return slot;
}

/**
 * Whether a slot passed since the last backup (and since enabling).
 *
 * @param {object} backups
 * @param {Date} now
 */
export function isBackupDue(backups, now) {
  if (!backups.enabled) {
    return false;
  }

  const slot = lastSlot(backups, now);
  const after = [backups.enabledAt, backups.lastRunAt].filter(Boolean).map((value) => new Date(value).getTime());

  return after.every((time) => slot.getTime() > time);
}

/**
 * When the next backup runs, and in which time zone hours are expressed.
 *
 * @param {Project} project
 */
export function presentBackupSchedule(project) {
  const backups = project.database.backups;
  let nextRunAt = null;

  if (backups.enabled) {
    nextRunAt = nextSlot(backups, new Date());

    // A missed slot (server down) is caught up within minutes.
    if (isBackupDue(backups, new Date())) {
      nextRunAt = new Date();
    }
  }

  return {
    backups,
    nextRunAt,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/**
 * Delete the oldest automatic dumps beyond `keep`.
 *
 * @param {string} directory
 * @param {string} uid
 * @param {number} keep
 * @returns {Promise<string[]>} removed file names
 */
export async function pruneAutomaticDumps(directory, uid, keep) {
  const dumps = await listDumps(directory, uid);
  const automatic = dumps.filter((dump) => isAutomaticDump(uid, dump.name));
  const removed = [];

  // Most recent first: everything after the first `keep` goes.
  for (const dump of automatic.slice(keep)) {
    await fs.rm(path.join(directory, dump.name), { force: true });
    removed.push(dump.name);
  }

  return removed;
}

/**
 * Queue a scheduled backup: an automatic dump, then the retention.
 *
 * @param {Project} project
 * @param {object} options
 * @param {string} options.trigger
 * @param {string} options.triggeredBy
 */
export function queueBackup(project, { trigger, triggeredBy }) {
  return enqueueTask(
    {
      projectId: project.id,
      type: 'db-backup',
      title: `Backup of ${project.database.name}`,
      trigger,
      triggeredBy,
    },
    async (context) => {
      // Reload: the configuration may have changed while queued.
      const current = await Project.findByPk(project.id);

      if (current === null) {
        throw new Error('The project no longer exists.');
      }

      const database = current.database;

      if (!database.enabled || !database.name) {
        throw new Error('The database is not enabled for this project anymore.');
      }

      const paths = await resolveProjectPaths(current);
      const result = await dumpDatabase(context, { uid: current.uid, database, directory: paths.db, automatic: true });
      context.setMeta(result);

      context.step(`Keeping the last ${database.backups.keep} automatic dump(s)`);
      const removed = await pruneAutomaticDumps(paths.db, current.uid, database.backups.keep);

      if (removed.length === 0) {
        context.info('Nothing to remove. Manual dumps are never removed.');
      } else {
        context.info(`Removed ${removed.join(', ')}. Manual dumps are never removed.`);
      }
    },
  );
}

/**
 * Queue the backups that are due (called by the scheduler).
 *
 * @returns {Promise<number>} how many were queued
 */
export async function runDueBackups() {
  const projects = await Project.findAll();
  const now = new Date();
  let queued = 0;

  for (const project of projects) {
    const database = project.database;

    if (!database.enabled || !database.name || !isBackupDue(database.backups, now)) {
      continue;
    }

    // Recorded before running: a failing dump waits for the next slot
    // instead of being retried every few minutes.
    project.databaseConfig = { ...database, backups: { ...database.backups, lastRunAt: now.toISOString() } };
    await project.save();

    logger.info(`Queuing the scheduled backup of ${project.uid}`);
    await queueBackup(project, { trigger: 'schedule', triggeredBy: 'scheduler' });
    queued += 1;
  }

  return queued;
}
