/**
 * SMTP accounts (global component).
 */
import express from 'express';
import { Project, SmtpAccount } from '../models/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { Validator } from '../lib/validation.js';
import { recordAudit } from '../services/audit.js';
import { sendMail, verifySmtpAccount } from '../services/mailer.js';
import { getGeneralSettings } from '../services/settings.js';
import { parseId } from './helpers.js';

const router = express.Router();

async function findAccount(id) {
  const account = await SmtpAccount.findByPk(parseId(id));

  if (account === null) {
    throw notFound('SMTP account not found.');
  }

  return account;
}

/**
 * Where an account is used: projects, and SolarOps itself (magic links).
 */
async function usageOf(accountId) {
  const projects = await Project.findAll();
  const settings = await getGeneralSettings();
  const users = projects.filter((project) => project.smtp.enabled && project.smtp.accountId === accountId);
  const usedBySystem = users.some((project) => project.system);

  return {
    projects: users.filter((project) => !project.system).map((project) => ({ uid: project.uid, name: project.name })),
    system: usedBySystem,
    usedForLogin: usedBySystem && settings.authMethod === 'magic-link',
  };
}

/**
 * Validate the account form. An empty password keeps the saved one.
 */
function readAccount(body, { creating }) {
  const input = new Validator(body);
  const account = {
    name: input.string('name', { required: true, max: 80 }),
    host: input.string('host', { required: true, max: 253, lowercase: true }),
    port: input.integer('port', { required: true, min: 1, max: 65535 }),
    secure: input.boolean('secure', { defaultValue: false }),
    username: input.string('username', { max: 254, defaultValue: '' }),
    password: input.string('password', { max: 512, trim: false }),
    fromAddress: input.string('fromAddress', { required: true, max: 254 }),
  };
  input.assertValid();

  if (creating && account.password === undefined) {
    account.password = '';
  }

  return account;
}

router.get('/', async (req, res) => {
  const accounts = await SmtpAccount.findAll({ order: [['name', 'ASC']] });
  const result = [];

  for (const account of accounts) {
    result.push({ ...account.toPublic(), usage: await usageOf(account.id) });
  }

  res.json({ accounts: result });
});

router.post('/', async (req, res) => {
  const data = readAccount(req.body, { creating: true });
  const account = await SmtpAccount.create(data);

  await recordAudit({ req, action: 'smtp.create', target: account.name });

  res.status(201).json({ account: account.toPublic() });
});

router.put('/:id', async (req, res) => {
  const account = await findAccount(req.params.id);
  const data = readAccount(req.body, { creating: false });

  if (data.password === undefined) {
    delete data.password;
  }

  account.set(data);
  await account.save();
  await recordAudit({ req, action: 'smtp.update', target: account.name });

  res.json({ account: account.toPublic() });
});

router.delete('/:id', async (req, res) => {
  const account = await findAccount(req.params.id);
  const usage = await usageOf(account.id);

  if (usage.system) {
    throw badRequest('SolarOps itself uses this relay: choose another one in Projects › SolarOps › Mail first.');
  }

  if (usage.projects.length > 0) {
    const names = usage.projects.map((project) => project.name).join(', ');
    throw badRequest(`This account is used by: ${names}.`);
  }

  await account.destroy();
  await recordAudit({ req, action: 'smtp.delete', target: account.name });

  res.json({ ok: true });
});

/**
 * Check the connection, and send a test e-mail when `to` is given.
 */
router.post('/:id/test', async (req, res) => {
  const account = await findAccount(req.params.id);
  const to = String(req.body?.to || '').trim();

  try {
    await verifySmtpAccount(account);

    if (to) {
      await sendMail(account, {
        to,
        subject: 'SolarOps test e-mail',
        text: `This test e-mail was sent by SolarOps through the "${account.name}" SMTP account. It works.`,
      });
    }

    res.json({ ok: true, sent: Boolean(to) });
  } catch (error) {
    res.json({ ok: false, error: error.message });
  }
});

export default router;
