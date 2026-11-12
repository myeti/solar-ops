/**
 * Projects: CRUD, lifecycle (start / stop), environment, logs, SMTP link.
 * Component specific routes live in projectDeployment.js,
 * projectDatabase.js and projectNetwork.js.
 */
import express from 'express';
import { Project, SmtpAccount, Task } from '../models/index.js';
import { DEFAULT_START_COMMAND, PROJECT_TYPES } from '../models/Project.js';
import { badRequest } from '../lib/errors.js';
import { splitCommandLine } from '../lib/exec.js';
import { UID_MAX_LENGTH, UID_PATTERN, slugify } from '../lib/slug.js';
import { FOLDER_NAME_PATTERN, Validator } from '../lib/validation.js';
import { recordAudit } from '../services/audit.js';
import { listProjectVariables, renderRedactedDotenv } from '../services/environment.js';
import { getGeneralSettings } from '../services/settings.js';
import { measureProjectStorage } from '../services/storage.js';
import { guardSystemProject } from '../services/systemProject.js';
import {
  MAX_STARTUP_SECONDS,
  MIN_STARTUP_SECONDS,
  describeLiveness,
  probeLiveness,
  startupSecondsOf,
} from '../services/health.js';
import { clearProjectLogs, getProcessMap, readProjectLogs } from '../services/pm2.js';
import { MAX_PORT, MIN_PORT, nextFreePort } from '../services/ports.js';
import {
  changeProjectPort,
  changeProjectType,
  createProject,
  deleteProject,
  inspectProjectFolder,
  presentProject,
  setProjectActive,
  startProject,
  stopProject,
} from '../services/projects.js';
import deploymentRouter from './projectDeployment.js';
import databaseRouter from './projectDatabase.js';
import networkRouter from './projectNetwork.js';
import { loadProject, requireUidConfirmation } from './helpers.js';

const router = express.Router();

/**
 * Validate a start command: it must be parseable into arguments.
 */
function validateStartCommand(input, value) {
  if (value === undefined) {
    return;
  }

  try {
    if (splitCommandLine(value).length === 0) {
      input.fail('startCommand', 'This field is required.');
    }
  } catch (error) {
    input.fail('startCommand', error.message);
  }
}

router.get('/', async (req, res) => {
  // SolarOps itself first, then projects by name.
  const projects = await Project.findAll({
    order: [
      ['system', 'DESC'],
      ['name', 'ASC'],
    ],
  });
  const { processes, error } = await getProcessMap();
  const result = [];

  for (const project of projects) {
    result.push(await presentProject(project, { processes, processError: error }));
  }

  res.json({ projects: result, processError: error });
});

/**
 * Suggest a uid for a name (used live by the creation form).
 */
router.get('/suggest-uid', (req, res) => {
  res.json({ uid: slugify(String(req.query.name || '')) });
});

/**
 * Default port of a new application (first free slot of the first port + n × step, see Settings).
 */
router.get('/next-port', async (req, res) => {
  res.json({ port: await nextFreePort() });
});

/**
 * What already exists in a folder, with warnings (used live by the
 * creation form). Read-only.
 */
router.get('/folder-check', async (req, res) => {
  const input = new Validator(req.query);
  const folder = input.string('folder', {
    required: true,
    max: 64,
    pattern: FOLDER_NAME_PATTERN,
    patternMessage: 'Letters, digits, ".", "_" and "-" only.',
  });
  input.assertValid();

  res.json(await inspectProjectFolder(folder));
});

router.post('/', async (req, res) => {
  const input = new Validator(req.body);
  const name = input.string('name', { required: true, max: 80 });
  let uid = input.string('uid', {
    max: UID_MAX_LENGTH,
    lowercase: true,
    pattern: UID_PATTERN,
    patternMessage: 'Lowercase letters, digits and dashes only (e.g. my-app).',
  });
  let folder = input.string('folder', {
    max: 64,
    pattern: FOLDER_NAME_PATTERN,
    patternMessage: 'Letters, digits, ".", "_" and "-" only.',
  });
  const type = input.oneOf('type', PROJECT_TYPES, { defaultValue: 'app' });
  const startCommand = input.string('startCommand', { max: 500, defaultValue: DEFAULT_START_COMMAND });
  // Applications only; empty = next free slot (first port + n × step, see Settings).
  const port = input.integer('port', { min: MIN_PORT, max: MAX_PORT });
  // Static sites only: the folder of repo/ nginx serves (where the build lands).
  const publicFolder = input.relativePath('publicFolder', { defaultValue: 'dist' });
  validateStartCommand(input, startCommand);
  input.assertValid();

  if (!uid) {
    uid = slugify(name);
  }

  if (!uid) {
    throw badRequest('Could not derive an identifier from this name.', { fields: { uid: 'Please provide one.' } });
  }

  if (!folder) {
    folder = uid;
  }

  const { project, warnings } = await createProject({ name, uid, folder, startCommand, type, port, publicFolder });
  await recordAudit({ req, action: 'project.create', target: uid, details: { folderExisted: project.folderExisted } });

  res.status(201).json({ project: await presentProject(project), warnings });
});

// Everything below works on one project. SolarOps itself (the system
// project) only accepts the routes listed in services/systemProject.js.
router.use('/:uid', loadProject, guardSystemProject);
router.use('/:uid/deployment', deploymentRouter);
router.use('/:uid/database', databaseRouter);
router.use('/:uid/network', networkRouter);

router.get('/:uid', async (req, res) => {
  res.json({ project: await presentProject(req.project) });
});

/**
 * Update the main settings: name, type, port, start command, active flag.
 */
router.patch('/:uid', async (req, res) => {
  const project = req.project;
  const input = new Validator(req.body);
  const name = input.string('name', { max: 80 });
  const type = input.oneOf('type', PROJECT_TYPES);
  const port = input.integer('port', { min: MIN_PORT, max: MAX_PORT });
  const startCommand = input.string('startCommand', { max: 500 });
  const active = input.boolean('active');
  // Startup time: null or empty goes back to the server default.
  const startupGiven = Object.hasOwn(req.body || {}, 'livenessTimeoutSeconds');
  const livenessTimeoutSeconds = input.integer('livenessTimeoutSeconds', {
    min: MIN_STARTUP_SECONDS,
    max: MAX_STARTUP_SECONDS,
  });
  validateStartCommand(input, startCommand);
  input.assertValid();

  if (name !== undefined && name !== '') {
    project.name = name;
  }

  if (startCommand !== undefined && startCommand !== '') {
    project.startCommand = startCommand;
  }

  if (startupGiven) {
    project.deploymentConfig = { ...project.deployment, livenessTimeoutSeconds: livenessTimeoutSeconds ?? null };
  }

  await project.save();

  const warnings = [];
  const previousPort = project.port;

  if (type !== undefined) {
    const result = await changeProjectType(project, type);
    warnings.push(...result.warnings);
  }

  // The port only makes sense for applications (static sites have none).
  if (port !== undefined && !project.isStatic) {
    const result = await changeProjectPort(project, port);
    warnings.push(...result.warnings);
  }

  if (active !== undefined && active !== project.active) {
    const result = await setProjectActive(project, active);
    warnings.push(...result.warnings);
  }

  await recordAudit({
    req,
    action: 'project.update',
    target: project.uid,
    details: { active: project.active, type: project.type, port: project.port },
  });

  const restartRequired = !project.isStatic && project.port !== previousPort;

  res.json({ project: await presentProject(project), warnings, restartRequired });
});

/**
 * Delete a project. Body: { confirm: uid, removeFiles, dropDatabase }
 */
router.delete('/:uid', async (req, res) => {
  requireUidConfirmation(req);

  const removeFiles = req.body?.removeFiles === true;
  const dropDatabase = req.body?.dropDatabase === true;
  const { warnings } = await deleteProject(req.project, { removeFiles, dropDatabase });

  await recordAudit({ req, action: 'project.delete', target: req.project.uid, details: { removeFiles, dropDatabase } });

  res.json({ ok: true, warnings });
});

/** A manual (re)start waits at most this long for the app to answer (the request is pending meanwhile). */
const MANUAL_LIVENESS_TIMEOUT_MS = 15 * 1000;

/**
 * (Re)start a project, then probe it on / (liveness). A failing probe does
 * not fail the request: the result is reported, the process keeps running.
 * An app with a longer startup time that is not answering yet is reported
 * as starting (`starting`), not as failing.
 */
async function startAndProbe(req, res, action) {
  await startProject(req.project);
  await recordAudit({ req, action, target: req.project.uid });

  const startupMs = startupSecondsOf(req.project) * 1000;
  const timeoutMs = Math.min(MANUAL_LIVENESS_TIMEOUT_MS, startupMs);
  const liveness = await probeLiveness(req.project, { timeoutMs });
  const starting = !liveness.alive && !liveness.crashed && startupMs > timeoutMs;
  let message = describeLiveness(liveness);

  if (starting) {
    const waited = Math.round(liveness.elapsedMs / 1000);
    message = `${liveness.url} does not answer yet after ${waited}s; its startup time is ${startupMs / 1000}s.`;
  }

  res.json({
    project: await presentProject(req.project),
    liveness: { ...liveness, starting, message },
  });
}

router.post('/:uid/start', async (req, res) => {
  await startAndProbe(req, res, 'project.start');
});

router.post('/:uid/restart', async (req, res) => {
  await startAndProbe(req, res, 'project.restart');
});

router.post('/:uid/stop', async (req, res) => {
  await stopProject(req.project);
  await recordAudit({ req, action: 'project.stop', target: req.project.uid });

  res.json({ project: await presentProject(req.project) });
});

/**
 * Disk space used by the project (folder and database), computed on demand.
 */
router.get('/:uid/storage', async (req, res) => {
  res.json({ storage: await measureProjectStorage(req.project) });
});

router.get('/:uid/logs', async (req, res) => {
  const lines = Math.min(Math.max(Number(req.query.lines) || 200, 10), 2000);

  res.json(await readProjectLogs(req.project, lines));
});

router.delete('/:uid/logs', async (req, res) => {
  await clearProjectLogs(req.project);
  await recordAudit({ req, action: 'project.logs-clear', target: req.project.uid });

  res.json({ ok: true });
});

/**
 * The environment as a .env file, every secret redacted server side (the
 * project overview never receives a secret value).
 */
router.get('/:uid/environment/dotenv', async (req, res) => {
  res.json(await renderRedactedDotenv(req.project));
});

/**
 * Environment: custom variables (editable) and the computed list given to
 * the process (secret values of components are masked).
 */
router.get('/:uid/environment', async (req, res) => {
  const variables = await listProjectVariables(req.project);
  const preview = variables.map((variable) => {
    let value = variable.value;

    if (variable.secret && variable.source !== 'custom') {
      value = '••••••••';
    }

    return { ...variable, value };
  });

  res.json({ custom: req.project.env, variables: preview });
});

router.put('/:uid/environment', async (req, res) => {
  const input = new Validator(req.body);
  const variables = input.envList('variables');
  input.assertValid();

  req.project.env = variables || [];
  await req.project.save();
  await recordAudit({
    req,
    action: 'project.environment-update',
    target: req.project.uid,
    details: { count: req.project.env.length },
  });

  res.json({ custom: req.project.env, restartRequired: true });
});

/**
 * Link (or unlink) an SMTP account. `fromAddress` overrides the relay's
 * from address in SMTP_FROM (empty: the relay's). SolarOps itself sends
 * the magic links from the relay's address.
 */
router.put('/:uid/smtp', async (req, res) => {
  const input = new Validator(req.body);
  const enabled = input.boolean('enabled', { required: true });
  const accountId = input.reference('accountId', { required: enabled === true });
  let fromAddress = input.string('fromAddress', { max: 254, defaultValue: '' });
  input.assertValid();

  if (req.project.system) {
    fromAddress = '';
  }

  if (accountId && (await SmtpAccount.findByPk(accountId)) === null) {
    throw badRequest('This SMTP account does not exist.', { fields: { accountId: 'Unknown account.' } });
  }

  // SolarOps's relay sends the magic links: removing it would lock admins out.
  if (req.project.system && !enabled) {
    const settings = await getGeneralSettings();

    if (settings.authMethod === 'magic-link') {
      throw badRequest(
        'Magic link login uses this mail relay. Switch the sign-in method to password first (Settings › Access).',
      );
    }
  }

  req.project.smtpConfig = { enabled, accountId, fromAddress };
  await req.project.save();
  await recordAudit({
    req,
    action: 'project.smtp-update',
    target: req.project.uid,
    details: { enabled, accountId, fromAddress },
  });

  res.json({ project: await presentProject(req.project), restartRequired: true });
});

/**
 * Recent tasks of the project.
 */
router.get('/:uid/tasks', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const where = { projectId: req.project.id };

  if (req.query.type) {
    where.type = String(req.query.type).split(',');
  }

  const tasks = await Task.findAll({
    where,
    order: [
      ['createdAt', 'DESC'],
      ['id', 'DESC'],
    ],
    limit,
  });

  res.json({ tasks: tasks.map((task) => task.toPublic()) });
});

export default router;
