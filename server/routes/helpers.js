/**
 * Helpers shared by the route modules.
 */
import { Project } from '../models/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { getPublicUrl } from '../services/systemProject.js';

/**
 * Label of the admin behind a request (tasks "triggered by").
 *
 * @param {import('express').Request} req
 */
export function actorOf(req) {
  if (req.admin) {
    return req.admin.email;
  }

  return 'system';
}

/**
 * Middleware loading `req.project` from the `:uid` route parameter.
 */
export async function loadProject(req, res, next) {
  const project = await Project.findOne({ where: { uid: String(req.params.uid) } });

  if (project === null) {
    throw notFound('Project not found.');
  }

  req.project = project;
  next();
}

/**
 * Parse a numeric route parameter.
 *
 * @param {string} value
 */
export function parseId(value) {
  const id = Number(value);

  if (!Number.isInteger(id) || id < 1) {
    throw notFound();
  }

  return id;
}

/**
 * Require the user to type the project uid to confirm a destructive action.
 *
 * @param {import('express').Request} req
 */
export function requireUidConfirmation(req) {
  if (req.body?.confirm !== req.project.uid) {
    throw badRequest(`Type "${req.project.uid}" to confirm.`, { fields: { confirm: 'Confirmation does not match.' } });
  }
}

/**
 * Public base URL of SolarOps, used to display webhook URLs: its own
 * domain when configured, otherwise the address the admin is using.
 *
 * @param {import('express').Request} req
 * @returns {Promise<string>}
 */
export async function publicBaseUrl(req) {
  const publicUrl = await getPublicUrl();

  if (publicUrl) {
    return publicUrl;
  }

  return `${req.protocol}://${req.get('host')}`;
}
