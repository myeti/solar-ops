/**
 * Incoming deployment webhooks: POST /hooks/:uid
 *
 * Accepted authentication (the project's webhook secret):
 *   - GitHub / Gitea / Forgejo:   `X-Hub-Signature-256: sha256=<HMAC of the body>`
 *   - Bitbucket Cloud:            `X-Hub-Signature: sha256=<HMAC of the body>`
 *   - GitLab:                     `X-Gitlab-Token: <secret>`
 *   - Anything else (CI, curl):   `Authorization: Bearer <secret>`
 *
 * Only pushes on the deployed branch deploy (services/webhookEvents.js):
 * other events, other branches, tags and deleted branches are acknowledged
 * and ignored.
 *
 * Example from a GitHub Actions step:
 *   curl -fsS -X POST -H "Authorization: Bearer $SOLAROPS_SECRET" https://ops.example.com/hooks/my-app
 */
import express from 'express';
import { Project } from '../models/index.js';
import { hmacSha256, safeEqual } from '../lib/crypto.js';
import logger from '../lib/logger.js';
import { webhookLimiter } from '../middleware/security.js';
import { recordAudit } from '../services/audit.js';
import { queueDeployment } from '../services/deploy.js';
import { decideWebhook } from '../services/webhookEvents.js';

const router = express.Router();

/** Headers naming the sender, most specific first (Gitea also sends X-GitHub-Event). */
const SENDER_HEADERS = [
  ['x-forgejo-event', 'forgejo'],
  ['x-gitea-event', 'gitea'],
  ['x-github-event', 'github'],
  ['x-gitlab-event', 'gitlab'],
  ['x-event-key', 'bitbucket'],
];

/**
 * The HMAC-SHA256 signature of the body: `X-Hub-Signature-256` (GitHub,
 * Gitea, Forgejo), else `X-Hub-Signature` when it is SHA-256 (Bitbucket
 * Cloud; GitHub's own X-Hub-Signature is SHA-1, not accepted).
 *
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function signatureOf(req) {
  const sha256 = req.get('x-hub-signature-256');

  if (sha256) {
    return sha256;
  }

  const signature = req.get('x-hub-signature');

  if (signature && signature.toLowerCase().startsWith('sha256=')) {
    return signature;
  }

  return null;
}

/**
 * Check the request against the secret.
 *
 * @param {import('express').Request} req
 * @param {string} secret
 * @returns {string|null} how it authenticated, or null when it did not
 */
function authenticate(req, secret) {
  const signature = signatureOf(req);

  if (signature !== null) {
    const expected = `sha256=${hmacSha256(secret, req.body)}`;

    if (safeEqual(signature.toLowerCase(), expected)) {
      return 'signed webhook';
    }

    return null;
  }

  const gitlabToken = req.get('x-gitlab-token');

  if (gitlabToken) {
    if (safeEqual(gitlabToken, secret)) {
      return 'gitlab';
    }
    return null;
  }

  const authorization = req.get('authorization') || '';

  if (authorization.startsWith('Bearer ')) {
    if (safeEqual(authorization.slice(7).trim(), secret)) {
      return 'token';
    }
  }

  return null;
}

/**
 * Sender shown in the journal: the git host when its headers tell it,
 * else how the call authenticated.
 *
 * @param {import('express').Request} req
 * @param {string} method see authenticate
 */
function senderOf(req, method) {
  for (const [header, sender] of SENDER_HEADERS) {
    if (req.get(header)) {
      return sender;
    }
  }

  return method;
}

router.post('/:uid', webhookLimiter, express.raw({ type: () => true, limit: '2mb' }), async (req, res) => {
  const project = await Project.findOne({ where: { uid: String(req.params.uid) } });
  let body = req.body;

  if (!Buffer.isBuffer(body)) {
    body = Buffer.alloc(0);
  }
  req.body = body;

  // Same answer for unknown projects, disabled webhooks and bad secrets.
  if (project === null || !project.deployment.webhookEnabled || !project.deployment.webhookSecret) {
    res.status(401).json({ error: 'Invalid webhook.' });
    return;
  }

  const deployment = project.deployment;
  const method = authenticate(req, deployment.webhookSecret);

  if (method === null) {
    logger.warn(`Rejected webhook for ${project.uid} from ${req.ip}`);
    res.status(401).json({ error: 'Invalid webhook.' });
    return;
  }

  const sender = senderOf(req, method);
  const decision = decideWebhook((name) => req.get(name), body, deployment.branch);

  if (decision.action === 'pong') {
    res.json({ ok: true, message: 'pong' });
    return;
  }

  if (!project.active || !deployment.enabled) {
    res.status(202).json({ ok: true, ignored: 'The project or its deployment is disabled.' });
    return;
  }

  if (decision.action === 'ignore') {
    logger.info(`Webhook for ${project.uid} (${sender}) ignored: ${decision.reason}`);
    res.status(202).json({ ok: true, ignored: decision.reason });
    return;
  }

  const task = await queueDeployment(project, { trigger: 'webhook', triggeredBy: `webhook (${sender})` });
  await recordAudit({
    req,
    actor: `webhook:${sender}`,
    action: 'project.deploy',
    target: project.uid,
    details: { taskId: task.id },
  });

  res.status(202).json({ ok: true, taskId: task.id });
});

export default router;
