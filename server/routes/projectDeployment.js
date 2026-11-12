/**
 * Deployment component of a project (mounted at /api/projects/:uid/deployment).
 */
import express from 'express';
import { GitCredential } from '../models/index.js';
import { randomToken } from '../lib/crypto.js';
import { badRequest, conflict } from '../lib/errors.js';
import { Validator } from '../lib/validation.js';
import { recordAudit } from '../services/audit.js';
import { normalizeCommandLines, queueDeployment } from '../services/deploy.js';
import { GIT_BRANCH_PATTERN, GIT_URL_PATTERN, readHeadCommit, testRepositoryAccess } from '../services/git.js';
import { getProjectProcess } from '../services/pm2.js';
import { resolveProjectPaths } from '../services/projectPaths.js';
import { presentProject } from '../services/projects.js';
import { actorOf, publicBaseUrl } from './helpers.js';

const router = express.Router({ mergeParams: true });

/**
 * Save the deployment configuration.
 */
router.put('/', async (req, res) => {
  const project = req.project;
  const input = new Validator(req.body);
  const enabled = input.boolean('enabled', { required: true });
  const url = input.string('url', {
    required: enabled === true,
    max: 500,
    pattern: GIT_URL_PATTERN,
    patternMessage: 'Use an https://, ssh:// or git@host:path URL.',
  });
  const branch = input.string('branch', {
    required: enabled === true,
    max: 100,
    pattern: GIT_BRANCH_PATTERN,
    patternMessage: 'Invalid branch name.',
    defaultValue: 'main',
  });
  const gitCredentialId = input.reference('gitCredentialId');
  // One command per line (see services/deploy.js).
  const installCommand = input.string('installCommand', { max: 2000, multiline: true, defaultValue: '' });
  const buildCommand = input.string('buildCommand', { max: 2000, multiline: true, defaultValue: '' });
  const restartAfterDeploy = input.boolean('restartAfterDeploy', { defaultValue: true });
  const webhookEnabled = input.boolean('webhookEnabled', { defaultValue: false });
  input.assertValid();

  if (gitCredentialId && (await GitCredential.findByPk(gitCredentialId)) === null) {
    throw badRequest('This git credential does not exist.', { fields: { gitCredentialId: 'Unknown credential.' } });
  }

  const current = project.deployment;
  let webhookSecret = current.webhookSecret;

  if (webhookEnabled && !webhookSecret) {
    webhookSecret = randomToken(32);
  }

  project.deploymentConfig = {
    ...current,
    enabled,
    url: url || '',
    branch: branch || 'main',
    gitCredentialId,
    installCommand: normalizeCommandLines(installCommand),
    buildCommand: normalizeCommandLines(buildCommand),
    restartAfterDeploy,
    webhookEnabled,
    webhookSecret,
  };
  await project.save();
  await recordAudit({
    req,
    action: 'project.deployment-update',
    target: project.uid,
    details: { enabled, url, branch, webhookEnabled },
  });

  res.json({ project: await presentProject(project) });
});

/**
 * Webhook URL and secret (revealed on demand, audited).
 */
router.get('/webhook', async (req, res) => {
  const project = req.project;
  const deployment = project.deployment;
  const baseUrl = await publicBaseUrl(req);

  await recordAudit({ req, action: 'project.webhook-reveal', target: project.uid });

  res.json({
    url: `${baseUrl}/hooks/${project.uid}`,
    secret: deployment.webhookSecret,
    enabled: deployment.webhookEnabled,
  });
});

/**
 * Generate a new webhook secret (the old one stops working immediately).
 */
router.post('/webhook/rotate', async (req, res) => {
  const project = req.project;

  project.deploymentConfig = { ...project.deployment, webhookSecret: randomToken(32) };
  await project.save();
  await recordAudit({ req, action: 'project.webhook-rotate', target: project.uid });

  res.json({ secret: project.deployment.webhookSecret });
});

/**
 * Check that the configured repository is reachable.
 */
router.post('/test', async (req, res) => {
  const deployment = req.project.deployment;

  if (!deployment.url) {
    throw badRequest('Configure a repository URL first.');
  }

  let credential = null;

  if (deployment.gitCredentialId) {
    credential = await GitCredential.findByPk(deployment.gitCredentialId);
  }

  try {
    const { branches } = await testRepositoryAccess({ url: deployment.url, credential });
    res.json({ ok: true, branches, branchExists: branches.includes(deployment.branch) });
  } catch (error) {
    res.json({ ok: false, error: error.message });
  }
});

/**
 * Commit currently checked out in the repo folder.
 */
router.get('/commit', async (req, res) => {
  const paths = await resolveProjectPaths(req.project);

  res.json({ commit: await readHeadCommit(paths.repo) });
});

/**
 * Queue a full deployment (pull + install + build + restart).
 */
router.post('/deploy', async (req, res) => {
  if (!req.project.deployment.enabled) {
    throw badRequest('Enable and configure the deployment first.');
  }

  const task = await queueDeployment(req.project, { trigger: 'manual', triggeredBy: actorOf(req) });
  await recordAudit({ req, action: 'project.deploy', target: req.project.uid, details: { taskId: task.id } });

  res.status(202).json({ task: task.toPublic() });
});

/**
 * Queue a pull only (sources updated, nothing rebuilt or restarted).
 */
router.post('/pull', async (req, res) => {
  if (!req.project.deployment.enabled) {
    throw badRequest('Enable and configure the deployment first.');
  }

  // The sources would change under the running process: stop it first.
  if (!req.project.isStatic) {
    const processInfo = await getProjectProcess(req.project);

    if (processInfo !== null && processInfo.running) {
      throw conflict(
        `${req.project.name} is running: stop it before pulling (Deploy now pulls, builds and restarts it).`,
      );
    }
  }

  const task = await queueDeployment(req.project, { pullOnly: true, trigger: 'manual', triggeredBy: actorOf(req) });
  await recordAudit({ req, action: 'project.pull', target: req.project.uid, details: { taskId: task.id } });

  res.status(202).json({ task: task.toPublic() });
});

export default router;
