/**
 * High level project operations, orchestrating the lower level services
 * (folders, pm2, nginx, PostgreSQL...). Routes should call these rather
 * than the individual services.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import config from '../config.js';
import { Project, Task } from '../models/index.js';
import { generatePassword } from '../lib/crypto.js';
import { conflict, badRequest } from '../lib/errors.js';
import { isPathInside, pathExists } from '../lib/files.js';
import logger from '../lib/logger.js';
import { RESERVED_UIDS, uidToSqlIdentifier } from '../lib/slug.js';
import { readProjectCertificate } from './certificates.js';
import { answersNow } from './health.js';
import { applyProjectNginx, removeProjectNginx } from './nginx.js';
import { deleteProjectProcess, getProcessMap, startProjectProcess, stopProjectProcess } from './pm2.js';
import { dropDatabaseAndRole, provisionDatabase, setRolePassword, verifyCredentials } from './postgres.js';
import {
  describeExistingFolder,
  getProjectPaths,
  resolveProjectPaths,
  scaffoldProjectFolders,
} from './projectPaths.js';
import { assertPortAvailable, nextFreePort } from './ports.js';
import { getGeneralSettings } from './settings.js';
import { newProjectSecrets } from './projectSecrets.js';
import { selfProcessStatus } from './systemProject.js';

/**
 * Validate a folder name and describe what is already there (used by the
 * creation form to warn before anything happens).
 *
 * @param {string} folder
 */
export async function inspectProjectFolder(folder) {
  const settings = await getGeneralSettings();
  const paths = getProjectPaths({ folder }, settings.baseFolder);

  if (!isPathInside(paths.root, settings.baseFolder)) {
    throw badRequest('The project folder must be inside the base folder.', { fields: { folder: 'Invalid folder.' } });
  }

  const usedBy = await Project.findOne({ where: { folder } });
  const description = await describeExistingFolder(paths);

  if (usedBy !== null) {
    description.warnings.unshift(`This folder is already used by the project "${usedBy.name}".`);
  }

  return { ...description, usedBy: usedBy?.uid || null };
}

/**
 * Create a project and add the missing folders. An existing folder is
 * adopted as is: nothing in it is erased or replaced.
 *
 * @param {object} input
 * @param {string} input.name
 * @param {string} input.uid
 * @param {string} input.folder
 * @param {string} input.startCommand applications only
 * @param {'app'|'static'} [input.type]
 * @param {number} [input.port] applications only; defaults to the next free slot (see services/ports.js)
 * @param {string} [input.publicFolder] static sites only: folder of repo/ served by nginx (dist)
 * @returns {Promise<{project: Project, warnings: string[]}>}
 */
export async function createProject({ name, uid, folder, startCommand, type = 'app', port, publicFolder }) {
  if (RESERVED_UIDS.includes(uid)) {
    throw badRequest(`"${uid}" is reserved, please choose another name.`, { fields: { uid: 'Reserved name.' } });
  }

  if (await Project.findOne({ where: { uid } })) {
    throw conflict(`A project with the uid "${uid}" already exists.`, { fields: { uid: 'Already used.' } });
  }

  if (await Project.findOne({ where: { folder } })) {
    throw conflict(`The folder "${folder}" is already used by another project.`, {
      fields: { folder: 'Already used.' },
    });
  }

  const settings = await getGeneralSettings();

  if (!settings.baseFolder || !path.isAbsolute(settings.baseFolder)) {
    throw badRequest('Configure an absolute base folder in Settings first.');
  }

  const paths = getProjectPaths({ folder }, settings.baseFolder);

  if (!isPathInside(paths.root, settings.baseFolder)) {
    throw badRequest('The project folder must be inside the base folder.', { fields: { folder: 'Invalid folder.' } });
  }

  const isStatic = type === 'static';

  if (!isStatic && port !== undefined) {
    await assertPortAvailable(port);
  }

  const existing = await describeExistingFolder(paths);

  try {
    await scaffoldProjectFolders(paths);
  } catch (error) {
    throw badRequest(`Could not create the missing folders in ${paths.root}: ${error.message}`);
  }

  const attributes = {
    name,
    uid,
    type,
    folder,
    folderExisted: existing.exists,
    startCommand,
    active: true,
    env: [],
    secrets: newProjectSecrets(),
  };
  let project;

  // A static site has no process, hence no port.
  if (isStatic) {
    const networkConfig = {
      ...Project.defaultNetwork(),
      publicFolder: publicFolder || Project.defaultNetwork().publicFolder,
    };

    project = await Project.create({ ...attributes, port: null, networkConfig });
  } else {
    project = await createWithPort(attributes, port);
  }

  return { project, warnings: existing.warnings };
}

/**
 * Insert a project with its port. When the port is allocated automatically,
 * a concurrent creation may take the same slot first (the unique index
 * refuses it): pick the next free one and retry.
 *
 * @param {object} attributes
 * @param {number} [requestedPort]
 */
async function createWithPort(attributes, requestedPort) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let port = requestedPort;

    if (port === undefined) {
      port = await nextFreePort();
    }

    try {
      return await Project.create({ ...attributes, port });
    } catch (error) {
      const portTaken =
        error.name === 'SequelizeUniqueConstraintError' && error.errors.some((item) => item.path === 'port');

      if (!portTaken || requestedPort !== undefined || attempt === maxAttempts) {
        throw error;
      }
    }
  }

  throw new Error('Unreachable');
}

/**
 * Change the port of a project. nginx follows immediately; the application
 * gets the new PORT at its next restart.
 *
 * @param {Project} project
 * @param {number} port
 * @returns {Promise<{warnings: string[]}>}
 */
export async function changeProjectPort(project, port) {
  assertNotSystem(project);
  assertHasProcess(project);

  if (port === project.port) {
    return { warnings: [] };
  }

  await assertPortAvailable(port, project.id);

  project.port = port;
  await project.save();

  const warnings = [];

  if (project.network.enabled && project.network.mode === 'proxy') {
    await applyProjectNginx(project).catch((error) => warnings.push(`nginx: ${error.message}`));
  }

  return { warnings };
}

/**
 * A deployment that only failed because the app did not answer within its
 * startup time: once its process is online and it answers, remember when
 * (`meta.answeredAt`). The deployment stays failed in the history, but the
 * project no longer needs attention (client/src/services/projectHealth.js).
 *
 * @param {Project} project
 * @param {import('../models/Task.js').default} task the last deployment
 * @param {object|null} processStatus
 */
async function noteLateAnswer(project, task, processStatus) {
  const meta = task.meta || {};

  if (task.status !== 'failed' || meta.failedStep !== 'liveness' || meta.answeredAt) {
    return;
  }

  if (project.isStatic || processStatus === null || processStatus.status !== 'online') {
    return;
  }

  if (!(await answersNow(project))) {
    return;
  }

  task.meta = { ...meta, answeredAt: new Date().toISOString() };
  task.changed('meta', true);
  await task.save({ fields: ['meta'] });
}

/**
 * Full representation of a project for the API, including runtime state.
 *
 * @param {Project} project
 * @param {object} [options]
 * @param {Map<string, object>} [options.processes] pm2 processes (avoids one pm2 call per project)
 * @param {string|null} [options.processError]
 */
export async function presentProject(project, options = {}) {
  let processes = options.processes;
  let processError = options.processError ?? null;

  if (!processes) {
    const result = await getProcessMap();
    processes = result.processes;
    processError = result.error;
  }

  const paths = await resolveProjectPaths(project);
  const network = project.network;
  let certificate = { exists: false };
  let processStatus = processes.get(project.uid) || null;

  // SolarOps runs under systemd, not pm2: report this very process.
  if (project.system) {
    processStatus = selfProcessStatus();
    processError = null;
  }

  // A static site has no process (a pm2 process with the same name is not its).
  if (project.isStatic) {
    processStatus = null;
    processError = null;
  }

  if (network.enabled && network.certMethod !== 'none') {
    try {
      certificate = await readProjectCertificate(project, paths);
    } catch (error) {
      certificate = { exists: false, error: error.message };
    }
  }

  const lastDeployment = await Task.findOne({
    where: { projectId: project.id, type: ['deploy', 'pull'] },
    order: [['createdAt', 'DESC']],
  });

  let lastDeploymentPublic = null;
  if (lastDeployment !== null) {
    await noteLateAnswer(project, lastDeployment, processStatus);
    lastDeploymentPublic = lastDeployment.toPublic();
  }

  return {
    ...project.toPublic(),
    path: paths.root,
    process: processStatus,
    processError,
    certificate,
    lastDeployment: lastDeploymentPublic,
    // Startup time of projects that set none (SOLAROPS_LIVENESS_TIMEOUT_SECONDS).
    livenessDefaultSeconds: config.livenessTimeoutSeconds,
  };
}

/**
 * Refuse lifecycle operations on SolarOps itself (it runs under systemd).
 *
 * @param {Project} project
 */
function assertNotSystem(project) {
  if (project.system) {
    throw badRequest('SolarOps itself is managed by systemd (sudo systemctl restart solarops).');
  }
}

/**
 * Refuse process operations on a static site (nginx serves its files).
 *
 * @param {Project} project
 */
function assertHasProcess(project) {
  if (project.isStatic) {
    throw badRequest('This is a static site: there is no process to run, nginx serves its files directly.');
  }
}

/**
 * Start (or restart) a project.
 *
 * @param {Project} project
 */
export async function startProject(project) {
  assertNotSystem(project);
  assertHasProcess(project);

  if (!project.active) {
    throw badRequest('Activate the project before starting it.');
  }

  await startProjectProcess(project);
}

/**
 * Stop a project process.
 *
 * @param {Project} project
 */
export async function stopProject(project) {
  assertNotSystem(project);
  assertHasProcess(project);
  await stopProjectProcess(project);
}

/**
 * Activate / deactivate a project. An inactive project is stopped, is not
 * served by nginx, and ignores webhooks and automatic renewals.
 *
 * @param {Project} project
 * @param {boolean} active
 * @returns {Promise<{warnings: string[]}>}
 */
export async function setProjectActive(project, active) {
  assertNotSystem(project);
  project.active = active;
  await project.save();

  const warnings = [];

  if (!active && !project.isStatic) {
    await stopProjectProcess(project).catch((error) => warnings.push(`pm2: ${error.message}`));
  }

  if (project.network.enabled) {
    await applyProjectNginx(project).catch((error) => warnings.push(`nginx: ${error.message}`));
  }

  return { warnings };
}

/**
 * Switch between application and static site.
 *
 * - app → static: the pm2 process SolarOps started is removed (a process it
 *   did not start is left alone) and the port is freed;
 * - static → app: the next free port is allocated (start it afterwards).
 *
 * nginx follows immediately.
 *
 * @param {Project} project
 * @param {'app'|'static'} type
 * @returns {Promise<{warnings: string[]}>}
 */
export async function changeProjectType(project, type) {
  assertNotSystem(project);

  if (type === project.type) {
    return { warnings: [] };
  }

  const warnings = [];

  if (type === 'static') {
    if (!project.isStatic) {
      await deleteProjectProcess(project).catch((error) => warnings.push(`pm2: ${error.message}`));
    }

    project.type = 'static';
    project.port = null;
    await project.save();
  } else {
    project.type = 'app';
    project.port = await nextFreePort();
    await project.save();
  }

  if (project.network.enabled) {
    await applyProjectNginx(project).catch((error) => warnings.push(`nginx: ${error.message}`));
  }

  return { warnings };
}

/**
 * Enable the database component: generate credentials, create role + db.
 *
 * @param {Project} project
 */
export async function enableProjectDatabase(project) {
  assertNotSystem(project);
  const current = project.database;

  // A linked database is only checked, never modified.
  if (current.adopted) {
    await verifyCredentials(current);
    project.databaseConfig = { ...current, enabled: true };
    await project.save();
    return;
  }

  const identifier = uidToSqlIdentifier(project.uid);
  let password = current.password;

  if (!password) {
    password = generatePassword(32);
  }

  const database = {
    ...current,
    enabled: true,
    name: current.name || identifier,
    user: current.user || identifier,
    password,
  };

  // Existing names are only accepted when repairing a database SolarOps created.
  await provisionDatabase(database, { allowExisting: Boolean(current.provisionedAt) });

  database.provisionedAt = current.provisionedAt || new Date().toISOString();
  project.databaseConfig = database;
  await project.save();
}

/**
 * Link a database that already exists on the server. Its credentials are
 * verified by connecting with them; nothing is modified, unless the admin
 * explicitly asks for a new password (`resetPassword`).
 *
 * @param {Project} project
 * @param {object} input
 * @param {string} input.name database name
 * @param {string} input.user role used by the application
 * @param {string} [input.password] current password of the role
 * @param {boolean} [input.resetPassword] generate and set a new password
 * @returns {Promise<object>} what was found in the database
 */
export async function linkExistingDatabase(project, { name, user, password, resetPassword }) {
  assertNotSystem(project);

  const others = await Project.findAll();
  const usedBy = others.find((other) => other.id !== project.id && other.database.name === name);

  if (usedBy) {
    throw conflict(`The database "${name}" is already linked to the project "${usedBy.name}".`, {
      fields: { name: 'Already linked to another project.' },
    });
  }

  let finalPassword = password;

  if (resetPassword) {
    finalPassword = generatePassword(32);
    await setRolePassword(user, finalPassword);
  }

  const info = await verifyCredentials({ name, user, password: finalPassword });

  project.databaseConfig = {
    ...Project.defaultDatabase(),
    enabled: true,
    name,
    user,
    password: finalPassword,
    adopted: true,
    linkedAt: new Date().toISOString(),
  };
  await project.save();

  return { ...info, passwordReset: Boolean(resetPassword) };
}

/**
 * Forget a linked database (the database, its role and data are kept).
 *
 * @param {Project} project
 */
export async function unlinkDatabase(project) {
  if (!project.database.adopted) {
    throw badRequest('Only linked databases can be unlinked. Disable or drop databases created by SolarOps.');
  }

  project.databaseConfig = null;
  await project.save();
}

/**
 * Delete a project: process, nginx config and optionally its database and
 * folder. Each step is best effort; problems are returned as warnings.
 *
 * @param {Project} project
 * @param {object} options
 * @param {boolean} options.removeFiles delete the project folder
 * @param {boolean} options.dropDatabase drop the database and role
 * @returns {Promise<{warnings: string[]}>}
 */
export async function deleteProject(project, { removeFiles, dropDatabase }) {
  assertNotSystem(project);
  const warnings = [];
  const settings = await getGeneralSettings();
  const paths = getProjectPaths(project, settings.baseFolder);

  if (!project.isStatic) {
    await deleteProjectProcess(project).catch((error) => warnings.push(`pm2: ${error.message}`));
  }

  await removeProjectNginx(project).catch((error) => warnings.push(`nginx: ${error.message}`));

  const database = project.database;

  if (dropDatabase && database.name && database.adopted) {
    warnings.push(`PostgreSQL: ${database.name} was linked, not created by SolarOps: it was kept.`);
  } else if (dropDatabase && database.name) {
    await dropDatabaseAndRole(database).catch((error) => warnings.push(`PostgreSQL: ${error.message}`));
  }

  if (removeFiles) {
    // Defensive: only ever delete a folder strictly inside the base folder.
    if (isPathInside(paths.root, settings.baseFolder) && (await pathExists(paths.root))) {
      await fs
        .rm(paths.root, { recursive: true, force: true })
        .catch((error) => warnings.push(`files: ${error.message}`));
    }
  }

  await project.destroy();

  for (const warning of warnings) {
    logger.warn(`Project ${project.uid} deletion: ${warning}`);
  }

  return { warnings };
}
