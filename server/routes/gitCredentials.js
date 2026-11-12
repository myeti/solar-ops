/**
 * Git credentials (global component).
 */
import express from 'express';
import { GitCredential, Project } from '../models/index.js';
import { GIT_PROVIDERS } from '../models/GitCredential.js';
import { badRequest, notFound } from '../lib/errors.js';
import { Validator } from '../lib/validation.js';
import { recordAudit } from '../services/audit.js';
import { GIT_URL_PATTERN, testRepositoryAccess } from '../services/git.js';
import { parseId } from './helpers.js';

const router = express.Router();

async function findCredential(id) {
  const credential = await GitCredential.findByPk(parseId(id));

  if (credential === null) {
    throw notFound('Git credential not found.');
  }

  return credential;
}

async function projectsUsing(credentialId) {
  const projects = await Project.findAll();

  return projects
    .filter((project) => project.deployment.gitCredentialId === credentialId)
    .map((project) => ({ uid: project.uid, name: project.name }));
}

/**
 * Validate the form. An empty token keeps the saved one (on update).
 */
function readCredential(body, { creating }) {
  const input = new Validator(body);
  const credential = {
    name: input.string('name', { required: true, max: 80 }),
    provider: input.oneOf('provider', GIT_PROVIDERS, { required: true }),
    username: input.string('username', { required: true, max: 120 }),
    token: input.string('token', { required: creating, max: 1024 }),
  };
  input.assertValid();

  return credential;
}

router.get('/', async (req, res) => {
  const credentials = await GitCredential.findAll({ order: [['name', 'ASC']] });
  const result = [];

  for (const credential of credentials) {
    result.push({ ...credential.toPublic(), projects: await projectsUsing(credential.id) });
  }

  res.json({ credentials: result });
});

router.post('/', async (req, res) => {
  const credential = await GitCredential.create(readCredential(req.body, { creating: true }));

  await recordAudit({ req, action: 'git-credential.create', target: credential.name });

  res.status(201).json({ credential: credential.toPublic() });
});

router.put('/:id', async (req, res) => {
  const credential = await findCredential(req.params.id);
  const data = readCredential(req.body, { creating: false });

  if (data.token === undefined) {
    delete data.token;
  }

  credential.set(data);
  await credential.save();
  await recordAudit({ req, action: 'git-credential.update', target: credential.name });

  res.json({ credential: credential.toPublic() });
});

router.delete('/:id', async (req, res) => {
  const credential = await findCredential(req.params.id);
  const projects = await projectsUsing(credential.id);

  if (projects.length > 0) {
    throw badRequest(`This credential is used by: ${projects.map((project) => project.name).join(', ')}.`);
  }

  await credential.destroy();
  await recordAudit({ req, action: 'git-credential.delete', target: credential.name });

  res.json({ ok: true });
});

/**
 * Check that a repository is reachable (git ls-remote).
 * Body: { url, credentialId? }
 */
router.post('/test', async (req, res) => {
  const input = new Validator(req.body);
  const url = input.string('url', {
    required: true,
    max: 500,
    pattern: GIT_URL_PATTERN,
    patternMessage: 'Use an https://, ssh:// or git@host:path URL.',
  });
  const credentialId = input.reference('credentialId');
  input.assertValid();

  let credential = null;

  if (credentialId) {
    credential = await findCredential(credentialId);
  }

  try {
    const { branches } = await testRepositoryAccess({ url, credential });
    res.json({ ok: true, branches });
  } catch (error) {
    res.json({ ok: false, error: error.message });
  }
});

export default router;
