/**
 * Secrets generated for each project, given to it as variables
 * (services/environment.js): JWT_SECRET, 32 random characters.
 *
 * Generated once: when the project is created, else the first time it is
 * needed (projects created before; SolarOps fills them in at startup), and
 * never changed afterwards. A custom variable with the same name overrides
 * it. Stored encrypted (Project.secrets).
 */
import { generatePassword } from '../lib/crypto.js';
import logger from '../lib/logger.js';
import { Project } from '../models/index.js';

const JWT_SECRET_LENGTH = 32;

/**
 * Secrets of a new project.
 */
export function newProjectSecrets() {
  return { jwtSecret: generatePassword(JWT_SECRET_LENGTH) };
}

/**
 * The secrets of a project, generating (and saving) the missing ones.
 *
 * @param {import('../models/Project.js').default} project
 * @returns {Promise<{jwtSecret: string}>}
 */
export async function ensureProjectSecrets(project) {
  const secrets = project.secrets;

  if (secrets.jwtSecret) {
    return secrets;
  }

  const completed = { ...newProjectSecrets(), ...secrets };

  project.secrets = completed;
  await project.save({ fields: ['secrets'] });

  return completed;
}

/**
 * At startup: give their secrets to the projects created before them.
 */
export async function fillMissingProjectSecrets() {
  const projects = await Project.findAll({ where: { system: false } });
  let filled = 0;

  for (const project of projects) {
    if (!project.secrets.jwtSecret) {
      await ensureProjectSecrets(project);
      filled += 1;
    }
  }

  if (filled > 0) {
    logger.info(`JWT_SECRET generated for ${filled} project(s)`);
  }
}
