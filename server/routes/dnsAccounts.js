/**
 * DNS provider accounts (used for DNS-01 certificate challenges) and the
 * overview of every certificate.
 */
import express from 'express';
import { DnsAccount, Project, SharedCertificate } from '../models/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { Validator } from '../lib/validation.js';
import { recordAudit } from '../services/audit.js';
import { readProjectCertificate } from '../services/certificates.js';
import { DNS_PROVIDERS, listDnsProviders } from '../services/dnsProviders.js';
import { resolveProjectPaths } from '../services/projectPaths.js';
import { parseId } from './helpers.js';

const router = express.Router();

async function findAccount(id) {
  const account = await DnsAccount.findByPk(parseId(id));

  if (account === null) {
    throw notFound('DNS account not found.');
  }

  return account;
}

async function projectsUsing(accountId) {
  const projects = await Project.findAll();

  return projects
    .filter((project) => project.network.certMethod === 'dns' && project.network.dnsAccountId === accountId)
    .map((project) => ({ uid: project.uid, name: project.name }));
}

async function sharedCertificatesUsing(accountId) {
  const certificates = await SharedCertificate.findAll({
    where: { dnsAccountId: accountId },
    order: [['name', 'ASC']],
  });

  return certificates.map((shared) => ({ id: shared.id, domains: shared.domains }));
}

/**
 * Validate the form. Secret fields left empty keep their saved value.
 *
 * @param {object} body
 * @param {DnsAccount|null} existing account being edited
 */
function readAccount(body, existing) {
  const input = new Validator(body);
  const name = input.string('name', { required: true, max: 80 });
  const provider = input.oneOf('provider', Object.keys(DNS_PROVIDERS), { required: true });
  const propagationSeconds = input.integer('propagationSeconds', { min: 10, max: 3600, defaultValue: 60 });
  input.assertValid();

  const definition = DNS_PROVIDERS[provider];
  const submitted = body.credentials || {};
  const previous = existing?.credentials || {};
  const credentials = {};
  const fieldErrors = {};

  for (const field of definition.fields) {
    let value = String(submitted[field.key] ?? '').trim();

    if (value === '' && existing && existing.provider === provider) {
      value = previous[field.key] || '';
    }

    if (value === '' && field.defaultValue) {
      value = field.defaultValue;
    }

    if (value === '') {
      fieldErrors[field.key] = 'This field is required.';
    }

    if (field.options && value !== '' && !field.options.includes(value)) {
      fieldErrors[field.key] = 'Invalid choice.';
    }

    credentials[field.key] = value;
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw badRequest('Some credentials are missing.', { fields: fieldErrors });
  }

  return { name, provider, propagationSeconds, credentials };
}

/**
 * Public view of an account: non-secret credential values are visible.
 */
function presentAccount(account) {
  const definition = DNS_PROVIDERS[account.provider];
  const visible = {};

  if (definition) {
    for (const field of definition.fields) {
      if (!field.secret) {
        visible[field.key] = account.credentials?.[field.key] || '';
      }
    }
  }

  return { ...account.toPublic(), visibleCredentials: visible };
}

router.get('/providers', (req, res) => {
  res.json({ providers: listDnsProviders() });
});

router.get('/', async (req, res) => {
  const accounts = await DnsAccount.findAll({ order: [['name', 'ASC']] });
  const result = [];

  for (const account of accounts) {
    result.push({
      ...presentAccount(account),
      projects: await projectsUsing(account.id),
      sharedCertificates: await sharedCertificatesUsing(account.id),
    });
  }

  res.json({ accounts: result });
});

router.post('/', async (req, res) => {
  const account = await DnsAccount.create(readAccount(req.body, null));

  await recordAudit({ req, action: 'dns-account.create', target: account.name });

  res.status(201).json({ account: presentAccount(account) });
});

router.put('/:id', async (req, res) => {
  const account = await findAccount(req.params.id);

  account.set(readAccount(req.body, account));
  await account.save();
  await recordAudit({ req, action: 'dns-account.update', target: account.name });

  res.json({ account: presentAccount(account) });
});

router.delete('/:id', async (req, res) => {
  const account = await findAccount(req.params.id);
  const projects = await projectsUsing(account.id);
  const sharedCertificates = await sharedCertificatesUsing(account.id);
  const users = [
    ...projects.map((project) => project.name),
    ...sharedCertificates.map((shared) => `the shared certificate ${shared.domains[0]}`),
  ];

  if (users.length > 0) {
    throw badRequest(`This account is used by: ${users.join(', ')}.`);
  }

  await account.destroy();
  await recordAudit({ req, action: 'dns-account.delete', target: account.name });

  res.json({ ok: true });
});

/**
 * Every project exposing a domain, with its certificate status.
 * Mounted separately at /api/certificates.
 */
export async function listCertificates(req, res) {
  const projects = await Project.findAll({
    order: [
      ['system', 'DESC'],
      ['name', 'ASC'],
    ],
  });
  const result = [];

  for (const project of projects) {
    const network = project.network;

    if (!network.enabled || !network.domain) {
      continue;
    }

    const paths = await resolveProjectPaths(project);
    let certificate = { exists: false };

    if (network.certMethod !== 'none') {
      certificate = await readProjectCertificate(project, paths).catch((error) => ({
        exists: false,
        error: error.message,
      }));
    }

    result.push({
      project: { uid: project.uid, name: project.name, active: project.active, system: project.system },
      sharedCertificateId: network.sharedCertificateId,
      domain: network.domain,
      aliases: network.aliases,
      certMethod: network.certMethod,
      autoRenew: network.autoRenew,
      certificate,
    });
  }

  res.json({ certificates: result });
}

export default router;
