/**
 * Admin accounts management.
 */
import express from 'express';
import { Admin } from '../models/index.js';
import { generatePassword, hashPassword } from '../lib/crypto.js';
import { badRequest, notFound } from '../lib/errors.js';
import { Validator } from '../lib/validation.js';
import { recordAudit } from '../services/audit.js';
import { assertPasswordStrength, revokeAdminSessions, setAdminPassword } from '../services/auth.js';
import { parseId } from './helpers.js';

const router = express.Router();

async function findAdmin(id) {
  const admin = await Admin.findByPk(parseId(id));

  if (admin === null) {
    throw notFound('Admin not found.');
  }

  return admin;
}

router.get('/', async (req, res) => {
  const admins = await Admin.findAll({ order: [['createdAt', 'ASC']] });

  res.json({ admins: admins.map((admin) => admin.toPublic()) });
});

/**
 * Create an admin. Without a password, a strong one is generated and
 * returned ONCE in the response.
 */
router.post('/', async (req, res) => {
  const input = new Validator(req.body);
  const email = input.email('email', { required: true });
  let password = input.string('password', { max: 256, trim: false });
  input.assertValid();

  let generatedPassword = null;

  if (!password) {
    password = generatePassword(20);
    generatedPassword = password;
  } else {
    assertPasswordStrength(password);
  }

  const admin = await Admin.create({ email, passwordHash: await hashPassword(password) });
  await recordAudit({ req, action: 'admin.create', target: email });

  res.status(201).json({ admin: admin.toPublic(), generatedPassword });
});

router.patch('/:id', async (req, res) => {
  const admin = await findAdmin(req.params.id);
  const input = new Validator(req.body);
  const email = input.email('email');
  input.assertValid();

  if (email !== undefined) {
    admin.email = email;
  }

  await admin.save();
  await recordAudit({ req, action: 'admin.update', target: admin.email });

  res.json({ admin: admin.toPublic() });
});

/**
 * Generate a new password for another admin (returned once) and revoke
 * their sessions.
 */
router.post('/:id/reset-password', async (req, res) => {
  const admin = await findAdmin(req.params.id);
  const password = generatePassword(20);

  await setAdminPassword(admin, password);
  await recordAudit({ req, action: 'admin.reset-password', target: admin.email });

  res.json({ generatedPassword: password });
});

router.delete('/:id', async (req, res) => {
  const admin = await findAdmin(req.params.id);

  if (admin.id === req.admin.id) {
    throw badRequest('You cannot delete your own account.');
  }

  if ((await Admin.count()) <= 1) {
    throw badRequest('SolarOps needs at least one admin.');
  }

  await revokeAdminSessions(admin.id);
  await admin.destroy();
  await recordAudit({ req, action: 'admin.delete', target: admin.email });

  res.json({ ok: true });
});

export default router;
