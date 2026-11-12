/**
 * Audit journal helpers.
 */
import { AuditLog } from '../models/index.js';
import logger from '../lib/logger.js';

/**
 * Record a sensitive action. Never throws: failing to audit must not break
 * the action itself (the failure is logged instead).
 *
 * @param {object} entry
 * @param {import('express').Request} [entry.req] request (actor + ip)
 * @param {string} [entry.actor] explicit actor label (CLI, webhook, scheduler)
 * @param {string} entry.action e.g. "project.create"
 * @param {string} [entry.target] e.g. project uid
 * @param {object} [entry.details] extra JSON data, never secrets
 */
export async function recordAudit({ req, actor, action, target, details }) {
  let adminId = null;
  let actorLabel = actor || 'system';
  let ip = null;

  if (req) {
    ip = req.ip || null;

    if (req.admin) {
      adminId = req.admin.id;
      actorLabel = req.admin.email;
    }
  }

  try {
    await AuditLog.create({
      adminId,
      actor: actorLabel,
      action,
      target: target || null,
      details: details || null,
      ip,
    });
  } catch (error) {
    logger.error('Could not write audit log entry', { action, error: error.message });
  }
}

/**
 * Most recent audit entries.
 *
 * @param {number} [limit]
 */
export async function listAudit(limit = 50) {
  const entries = await AuditLog.findAll({
    order: [
      ['createdAt', 'DESC'],
      ['id', 'DESC'],
    ],
    limit,
  });

  return entries.map((entry) => entry.toPublic());
}
