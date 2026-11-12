/**
 * Project ports.
 *
 * Every project has its own port, given to the application as PORT at
 * startup and used by the nginx reverse proxy. New projects get the first
 * free slot of firstPort, firstPort + portStep... (Settings › General, 3000,
 * 3010, 3020... by default; the gap leaves room for side processes: a
 * worker, a websocket server...). Changing them never moves existing projects.
 *
 * Ports are only checked against the other projects (a unique index
 * guarantees it): SolarOps does not probe the ports of the machine.
 */
import { Op } from 'sequelize';
import config from '../config.js';
import { Project } from '../models/index.js';
import { badRequest, conflict } from '../lib/errors.js';
import { getGeneralSettings } from './settings.js';

/** Projects run as an unprivileged user: ports below 1024 cannot be bound. */
export const MIN_PORT = 1024;
export const MAX_PORT = 65535;

/** Largest gap between two suggested ports (Settings › General). */
export const MAX_PORT_STEP = 1000;

/**
 * Ports already taken, by project (SolarOps's own port included).
 *
 * @param {number|null} [exceptProjectId] project being edited
 * @returns {Promise<Map<number, string>>} port => project name
 */
async function takenPorts(exceptProjectId = null) {
  const where = { port: { [Op.ne]: null } };

  if (exceptProjectId !== null) {
    where.id = { [Op.ne]: exceptProjectId };
  }

  const projects = await Project.findAll({ where, attributes: ['id', 'name', 'port'] });
  const taken = new Map();

  for (const project of projects) {
    taken.set(project.port, project.name);
  }

  taken.set(config.port, 'SolarOps');

  return taken;
}

/**
 * First free slot: firstPort, firstPort + portStep... (3000, 3010... by default).
 *
 * @returns {Promise<number>}
 */
export async function nextFreePort() {
  const { firstPort, portStep } = await getGeneralSettings();
  const taken = await takenPorts();
  let candidate = firstPort;

  while (taken.has(candidate)) {
    candidate += portStep;
  }

  if (candidate > MAX_PORT) {
    throw conflict('No free port left: free one by changing the port of a project.');
  }

  return candidate;
}

/**
 * Throw a 400 / 409 error if a port cannot be used by a project.
 *
 * @param {number} port
 * @param {number|null} [projectId] project being edited (its own port is fine)
 */
export async function assertPortAvailable(port, projectId = null) {
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw badRequest(`The port must be between ${MIN_PORT} and ${MAX_PORT}.`, {
      fields: { port: `Between ${MIN_PORT} and ${MAX_PORT}.` },
    });
  }

  const taken = await takenPorts(projectId);

  if (taken.has(port)) {
    let message = `Port ${port} is already used by ${taken.get(port)}.`;

    if (port === config.port) {
      message = `Port ${port} is SolarOps's own port.`;
    }

    throw conflict(message, { fields: { port: 'Already used.' } });
  }
}
