/**
 * Database component of a project (mounted at /api/projects/:uid/database).
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import express from 'express';
import { Project } from '../models/index.js';
import { generatePassword } from '../lib/crypto.js';
import { badRequest, notFound } from '../lib/errors.js';
import { isPathInside, pathExists } from '../lib/files.js';
import { uidToSqlIdentifier } from '../lib/slug.js';
import { Validator } from '../lib/validation.js';
import { recordAudit } from '../services/audit.js';
import { BACKUP_FREQUENCIES, MAX_BACKUPS_KEPT, presentBackupSchedule } from '../services/backups.js';
import {
  DUMP_FILE_PATTERN,
  PG_IDENTIFIER_PATTERN,
  dropDatabaseAndRole,
  dumpDatabase,
  inspectNames,
  listDumps,
  listLinkCandidates,
  restoreDatabase,
  setRolePassword,
  wipeDatabase,
} from '../services/postgres.js';
import { resolveProjectPaths } from '../services/projectPaths.js';
import { enableProjectDatabase, linkExistingDatabase, presentProject, unlinkDatabase } from '../services/projects.js';
import { getPostgresSettings } from '../services/settings.js';
import { enqueueTask } from '../services/taskRunner.js';
import { actorOf, requireUidConfirmation } from './helpers.js';

const router = express.Router({ mergeParams: true });

/**
 * Make sure the project has a provisioned database.
 */
function requireDatabase(project) {
  const database = project.database;

  if (!database.enabled || !database.name) {
    throw badRequest('The database is not enabled for this project.');
  }

  return database;
}

/**
 * Resolve a dump file name to a path, refusing anything suspicious.
 */
async function resolveDump(project, fileName) {
  if (!DUMP_FILE_PATTERN.test(fileName)) {
    throw notFound('Dump not found.');
  }

  const paths = await resolveProjectPaths(project);
  const filePath = path.join(paths.db, fileName);

  if (!isPathInside(filePath, paths.db) || !(await pathExists(filePath))) {
    throw notFound('Dump not found.');
  }

  return filePath;
}

/**
 * Refuse destructive operations on a database SolarOps did not create.
 */
function refuseIfAdopted(database, action) {
  if (database.adopted) {
    throw badRequest(
      `${database.name} was linked, not created by SolarOps: SolarOps does not ${action} it. Unlink it, or use your own tools.`,
    );
  }
}

/**
 * Before choosing between "create" and "link": does the default name already
 * exist, and which existing databases could be linked?
 */
router.get('/candidates', async (req, res) => {
  const defaultName = uidToSqlIdentifier(req.project.uid);
  const projects = await Project.findAll();
  const usedNames = projects
    .filter((project) => project.id !== req.project.id && project.database.name)
    .map((project) => project.database.name);

  try {
    const defaultNameStatus = await inspectNames(defaultName, defaultName);
    const candidates = await listLinkCandidates(usedNames);

    res.json({ defaultName, defaultNameStatus, candidates, error: null });
  } catch (error) {
    res.json({ defaultName, defaultNameStatus: null, candidates: [], error: error.message });
  }
});

/**
 * Link a database that already exists. Body: { name, user, password, resetPassword }
 */
router.post('/link', async (req, res) => {
  const input = new Validator(req.body);
  const name = input.string('name', {
    required: true,
    max: 63,
    pattern: PG_IDENTIFIER_PATTERN,
    patternMessage: 'Letters, digits, "_", "$" and "-" only (63 characters max).',
  });
  const user = input.string('user', {
    required: true,
    max: 63,
    pattern: PG_IDENTIFIER_PATTERN,
    patternMessage: 'Letters, digits, "_", "$" and "-" only (63 characters max).',
  });
  const resetPassword = input.boolean('resetPassword', { defaultValue: false });
  const password = input.string('password', { required: !resetPassword, max: 1024, trim: false });
  input.assertValid();

  const info = await linkExistingDatabase(req.project, { name, user, password, resetPassword });
  await recordAudit({
    req,
    action: 'project.database-link',
    target: req.project.uid,
    details: { name, user, resetPassword },
  });

  res.json({ project: await presentProject(req.project), info, restartRequired: true });
});

/**
 * Forget a linked database: it stays on the server, untouched.
 */
router.post('/unlink', async (req, res) => {
  await unlinkDatabase(req.project);
  await recordAudit({ req, action: 'project.database-unlink', target: req.project.uid });

  res.json({ project: await presentProject(req.project), restartRequired: true });
});

/**
 * Create the role and database, or re-enable an existing one.
 */
router.post('/enable', async (req, res) => {
  await enableProjectDatabase(req.project);
  await recordAudit({ req, action: 'project.database-enable', target: req.project.uid });

  res.json({ project: await presentProject(req.project), restartRequired: true });
});

/**
 * Stop providing DB_* variables. The database itself is kept.
 */
router.post('/disable', async (req, res) => {
  req.project.databaseConfig = { ...req.project.database, enabled: false };
  await req.project.save();
  await recordAudit({ req, action: 'project.database-disable', target: req.project.uid });

  res.json({ project: await presentProject(req.project), restartRequired: true });
});

/**
 * Reveal the connection details (audited).
 */
router.get('/credentials', async (req, res) => {
  const database = requireDatabase(req.project);
  const postgres = await getPostgresSettings();

  await recordAudit({ req, action: 'project.database-reveal', target: req.project.uid });

  res.json({
    host: postgres.host,
    port: postgres.port,
    name: database.name,
    user: database.user,
    password: database.password,
    url: `postgres://${encodeURIComponent(database.user)}:${encodeURIComponent(database.password)}@${postgres.host}:${postgres.port}/${database.name}`,
  });
});

/**
 * Generate a new password for the project role.
 */
router.post('/rotate-password', async (req, res) => {
  const database = requireDatabase(req.project);
  const password = generatePassword(32);

  await setRolePassword(database.user, password);
  req.project.databaseConfig = { ...database, password };
  await req.project.save();
  await recordAudit({ req, action: 'project.database-rotate-password', target: req.project.uid });

  res.json({ ok: true, restartRequired: true });
});

router.get('/dumps', async (req, res) => {
  const paths = await resolveProjectPaths(req.project);

  res.json({ dumps: await listDumps(paths.db, req.project.uid) });
});

/**
 * Scheduled backups: configuration, next run, server time zone.
 */
router.get('/backups', (req, res) => {
  res.json(presentBackupSchedule(req.project));
});

/**
 * Configure the scheduled backups. Body: { enabled, frequency, hour,
 * weekday, keep }. A changed schedule starts from now: no backup is run
 * for slots that passed before the change.
 */
router.put('/backups', async (req, res) => {
  const project = req.project;
  const database = project.database;
  const input = new Validator(req.body);
  const enabled = input.boolean('enabled', { required: true });
  const frequency = input.oneOf('frequency', BACKUP_FREQUENCIES, { defaultValue: 'daily' });
  const hour = input.integer('hour', { min: 0, max: 23, defaultValue: 3 });
  const weekday = input.integer('weekday', { min: 0, max: 6, defaultValue: 0 });
  const keep = input.integer('keep', { min: 1, max: MAX_BACKUPS_KEPT, defaultValue: 7 });
  input.assertValid();

  if (enabled && !database.name) {
    throw badRequest('Create or link a database first.');
  }

  const current = database.backups;
  const scheduleChanged =
    enabled !== current.enabled ||
    frequency !== current.frequency ||
    hour !== current.hour ||
    weekday !== current.weekday;
  let enabledAt = current.enabledAt;

  if (enabled && scheduleChanged) {
    enabledAt = new Date().toISOString();
  }

  project.databaseConfig = {
    ...database,
    backups: { ...current, enabled, frequency, hour, weekday, keep, enabledAt },
  };
  await project.save();
  await recordAudit({
    req,
    action: 'project.database-backups',
    target: project.uid,
    details: { enabled, frequency, hour, weekday, keep },
  });

  res.json(presentBackupSchedule(project));
});

/**
 * Queue a dump.
 */
router.post('/dumps', async (req, res) => {
  const project = req.project;
  const database = requireDatabase(project);
  const paths = await resolveProjectPaths(project);

  const { task } = await enqueueTask(
    {
      projectId: project.id,
      type: 'db-dump',
      title: `Dump database ${database.name}`,
      triggeredBy: actorOf(req),
    },
    async (context) => {
      const result = await dumpDatabase(context, { uid: project.uid, database, directory: paths.db });
      context.setMeta(result);
    },
  );

  await recordAudit({ req, action: 'project.database-dump', target: project.uid });

  res.status(202).json({ task: task.toPublic() });
});

/**
 * Download a dump.
 */
router.get('/dumps/:file', async (req, res) => {
  const filePath = await resolveDump(req.project, req.params.file);

  await recordAudit({
    req,
    action: 'project.database-download',
    target: req.project.uid,
    details: { file: req.params.file },
  });

  res.download(filePath, req.params.file);
});

router.delete('/dumps/:file', async (req, res) => {
  const filePath = await resolveDump(req.project, req.params.file);

  await fs.rm(filePath);
  await recordAudit({
    req,
    action: 'project.database-dump-delete',
    target: req.project.uid,
    details: { file: req.params.file },
  });

  res.json({ ok: true });
});

/**
 * Queue a restore of a dump. Body: { confirm: uid }
 */
router.post('/dumps/:file/restore', async (req, res) => {
  requireUidConfirmation(req);

  const project = req.project;
  const database = requireDatabase(project);
  const filePath = await resolveDump(project, req.params.file);

  const { task } = await enqueueTask(
    {
      projectId: project.id,
      type: 'db-restore',
      title: `Restore ${req.params.file}`,
      triggeredBy: actorOf(req),
    },
    (context) => restoreDatabase(context, { database, filePath }),
  );

  await recordAudit({
    req,
    action: 'project.database-restore',
    target: project.uid,
    details: { file: req.params.file },
  });

  res.status(202).json({ task: task.toPublic() });
});

/**
 * Queue a wipe: drop and re-create the database, empty. Body: { confirm: uid }
 */
router.post('/wipe', async (req, res) => {
  requireUidConfirmation(req);

  const project = req.project;
  const database = requireDatabase(project);
  refuseIfAdopted(database, 'wipe');

  const { task } = await enqueueTask(
    {
      projectId: project.id,
      type: 'db-wipe',
      title: `Wipe database ${database.name}`,
      triggeredBy: actorOf(req),
    },
    async (context) => {
      context.step(`Dropping and re-creating ${database.name}`);
      await wipeDatabase(database);
      context.info('The database is now empty.');
    },
  );

  await recordAudit({ req, action: 'project.database-wipe', target: project.uid });

  res.status(202).json({ task: task.toPublic() });
});

/**
 * Drop the database and its role, forget the credentials. Body: { confirm: uid }
 */
router.post('/drop', async (req, res) => {
  requireUidConfirmation(req);

  const project = req.project;
  const database = project.database;
  refuseIfAdopted(database, 'drop');

  if (database.name) {
    await dropDatabaseAndRole(database);
  }

  project.databaseConfig = null;
  await project.save();
  await recordAudit({ req, action: 'project.database-drop', target: project.uid });

  res.json({ project: await presentProject(project), restartRequired: true });
});

export default router;
