/**
 * A project's Redis instance (Redis tab): turn on / off, settings, restart,
 * password rotation, flush, data deletion. See services/redis.js.
 */
import express from 'express';
import { badRequest } from '../lib/errors.js';
import { Validator } from '../lib/validation.js';
import { recordAudit } from '../services/audit.js';
import { presentProject } from '../services/projects.js';
import {
  MAX_REDIS_MEMORY_MB,
  MIN_REDIS_MEMORY_MB,
  REDIS_PERSISTENCE,
  REDIS_POLICIES,
  deleteRedisData,
  disableRedis,
  enableRedis,
  findRedisProgram,
  flushRedis,
  redisStatus,
  restartRedis,
  rotateRedisPassword,
  updateRedisSettings,
} from '../services/redis.js';
import { requireUidConfirmation } from './helpers.js';

const router = express.Router({ mergeParams: true });

async function respond(req, res) {
  res.json({
    redis: await redisStatus(req.project),
    program: await findRedisProgram(),
    project: await presentProject(req.project),
  });
}

/** An action, audited, then the new state. */
function action(name, handler) {
  return async (req, res) => {
    await handler(req);
    await recordAudit({ req, action: `project.redis-${name}`, target: req.project.uid });
    await respond(req, res);
  };
}

router.get('/', async (req, res) => {
  await respond(req, res);
});

/** The connection, password included (revealed on demand, like the database's). */
router.get('/credentials', async (req, res) => {
  const redis = req.project.redis;

  if (!redis.enabled) {
    throw badRequest('Redis is off for this project.');
  }

  await recordAudit({ req, action: 'project.redis-reveal', target: req.project.uid });
  res.json({
    host: '127.0.0.1',
    port: redis.port,
    password: redis.password,
    url: `redis://:${encodeURIComponent(redis.password)}@127.0.0.1:${redis.port}/0`,
  });
});

router.post(
  '/enable',
  action('enable', (req) => enableRedis(req.project)),
);

router.post(
  '/disable',
  action('disable', (req) => disableRedis(req.project)),
);

router.post(
  '/restart',
  action('restart', (req) => restartRedis(req.project)),
);

router.post(
  '/rotate-password',
  action('rotate', (req) => rotateRedisPassword(req.project)),
);

router.post(
  '/flush',
  action('flush', (req) => {
    requireUidConfirmation(req);
    return flushRedis(req.project);
  }),
);

router.post(
  '/delete-data',
  action('delete-data', (req) => {
    requireUidConfirmation(req);
    return deleteRedisData(req.project);
  }),
);

/**
 * Body: { maxMemoryMb, policy, persistence }
 */
router.put(
  '/',
  action('update', (req) => {
    const input = new Validator(req.body);
    const settings = {
      maxMemoryMb: input.integer('maxMemoryMb', { required: true, min: MIN_REDIS_MEMORY_MB, max: MAX_REDIS_MEMORY_MB }),
      policy: input.oneOf('policy', REDIS_POLICIES, { required: true }),
      persistence: input.oneOf('persistence', REDIS_PERSISTENCE, { required: true }),
    };
    input.assertValid();

    return updateRedisSettings(req.project, settings);
  }),
);

export default router;
