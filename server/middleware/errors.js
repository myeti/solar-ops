/**
 * Error handling: every error becomes a JSON response `{ error, details }`.
 */
import { HttpError } from '../lib/errors.js';
import { CommandError } from '../lib/exec.js';
import logger from '../lib/logger.js';

/**
 * 404 for unknown API routes.
 */
export function apiNotFound(req, res) {
  res.status(404).json({ error: `Unknown API route: ${req.method} ${req.originalUrl}` });
}

/**
 * Final error handler (Express recognises it by its 4 arguments).
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(error, req, res, next) {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, details: error.details });
    return;
  }

  if (error instanceof CommandError) {
    // Command failures are operational errors: show them to the admin.
    logger.warn(`Command failed during ${req.method} ${req.originalUrl}`, { command: error.command });
    res.status(502).json({ error: error.message });
    return;
  }

  if (error.name === 'SequelizeUniqueConstraintError') {
    res.status(409).json({ error: 'This value is already used.', details: { fields: uniqueFields(error) } });
    return;
  }

  if (error.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid JSON body.' });
    return;
  }

  if (error.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request body too large.' });
    return;
  }

  logger.error(`Unhandled error during ${req.method} ${req.originalUrl}`, { error: error.stack || error.message });
  res.status(500).json({ error: 'Internal error. Check the SolarOps logs for details.' });
}

/**
 * Map a unique constraint violation to field errors.
 */
function uniqueFields(error) {
  const fields = {};

  for (const item of error.errors || []) {
    if (item.path) {
      fields[item.path] = 'Already used.';
    }
  }

  return fields;
}
