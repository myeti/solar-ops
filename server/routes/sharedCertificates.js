/**
 * Shared certificates (mounted at /api/shared-certificates): wildcard or
 * multi-domain certificates issued once through DNS-01, then selected
 * explicitly by projects in their Network tab.
 */
import express from 'express';
import { DnsAccount, SharedCertificate } from '../models/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { DOMAIN_OR_WILDCARD_PATTERN, Validator } from '../lib/validation.js';
import { recordAudit } from '../services/audit.js';
import { queueSharedCertificate } from '../services/certbot.js';
import { sameDomains } from '../services/certificates.js';
import {
  MAX_SHARED_DOMAINS,
  findProjectsLosingCoverage,
  findProjectsUsingSharedCertificate,
  pickSharedCertificateName,
  presentSharedCertificate,
  removeSharedCertificateFiles,
} from '../services/sharedCertificates.js';
import { actorOf, parseId } from './helpers.js';

const router = express.Router();

async function findCertificate(id) {
  const shared = await SharedCertificate.findByPk(parseId(id));

  if (shared === null) {
    throw notFound('Shared certificate not found.');
  }

  return shared;
}

/**
 * Parse the names: array or comma / space separated string.
 *
 * @param {Validator} input
 * @param {*} value
 * @returns {string[]}
 */
function parseDomains(input, value) {
  let list = [];

  if (Array.isArray(value)) {
    list = value;
  } else if (typeof value === 'string') {
    list = value.split(/[\s,]+/);
  }

  const domains = [];

  for (const entry of list) {
    const domain = String(entry).trim().toLowerCase();

    if (domain === '') {
      continue;
    }

    if (!DOMAIN_OR_WILDCARD_PATTERN.test(domain)) {
      input.fail('domains', `"${domain}" is not a valid domain.`);
      continue;
    }

    if (!domains.includes(domain)) {
      domains.push(domain);
    }
  }

  if (domains.length === 0) {
    input.fail('domains', 'Add at least one domain, e.g. *.example.com');
  }

  if (domains.length > MAX_SHARED_DOMAINS) {
    input.fail('domains', `At most ${MAX_SHARED_DOMAINS} names.`);
  }

  return domains;
}

/**
 * Validate the form.
 *
 * @param {object} body
 */
async function readForm(body) {
  const input = new Validator(body);
  const domains = parseDomains(input, body?.domains);
  const dnsAccountId = input.reference('dnsAccountId', { required: true });
  const autoRenew = input.boolean('autoRenew', { defaultValue: true });
  input.assertValid();

  if ((await DnsAccount.findByPk(dnsAccountId)) === null) {
    throw badRequest('This DNS account does not exist.', { fields: { dnsAccountId: 'Unknown account.' } });
  }

  return { domains, dnsAccountId, autoRenew };
}

router.get('/', async (req, res) => {
  const certificates = await SharedCertificate.findAll({ order: [['name', 'ASC']] });
  const result = [];

  for (const shared of certificates) {
    result.push(await presentSharedCertificate(shared));
  }

  res.json({ certificates: result });
});

/**
 * Create a shared certificate and request it right away (creating one has
 * no other purpose).
 */
router.post('/', async (req, res) => {
  const form = await readForm(req.body);
  const shared = await SharedCertificate.create({ ...form, name: await pickSharedCertificateName(form.domains) });

  await recordAudit({
    req,
    action: 'shared-certificate.create',
    target: shared.name,
    details: { domains: shared.domains },
  });

  const { task } = await queueSharedCertificate(shared, { trigger: 'manual', triggeredBy: actorOf(req) });

  res.status(201).json({ certificate: await presentSharedCertificate(shared), task: task.toPublic() });
});

/**
 * Update a shared certificate. Names still needed by a project using it
 * cannot be removed. New names are requested right away.
 */
router.put('/:id', async (req, res) => {
  const shared = await findCertificate(req.params.id);
  const form = await readForm(req.body);
  const losing = await findProjectsLosingCoverage(shared.id, form.domains);

  if (losing.length > 0) {
    const details = losing.map((entry) => `${entry.project.name} needs ${entry.uncovered.join(', ')}`).join('; ');

    throw badRequest(`Still in use: ${details}.`, { fields: { domains: 'Names used by projects cannot be removed.' } });
  }

  const domainsChanged = !sameDomains(shared.domains, form.domains);

  shared.set(form);
  await shared.save();
  await recordAudit({
    req,
    action: 'shared-certificate.update',
    target: shared.name,
    details: { domains: shared.domains },
  });

  let task = null;

  if (domainsChanged) {
    const queued = await queueSharedCertificate(shared, { trigger: 'manual', triggeredBy: actorOf(req) });
    task = queued.task.toPublic();
  }

  res.json({ certificate: await presentSharedCertificate(shared), task });
});

/**
 * Queue a request / renewal. Body: { force }
 */
router.post('/:id/request', async (req, res) => {
  const shared = await findCertificate(req.params.id);
  const force = req.body?.force === true;
  const { task } = await queueSharedCertificate(shared, { force, trigger: 'manual', triggeredBy: actorOf(req) });

  await recordAudit({ req, action: 'shared-certificate.request', target: shared.name, details: { force } });

  res.status(202).json({ task: task.toPublic() });
});

/**
 * Delete a shared certificate no project uses, and its files.
 */
router.delete('/:id', async (req, res) => {
  const shared = await findCertificate(req.params.id);
  const projects = await findProjectsUsingSharedCertificate(shared.id);

  if (projects.length > 0) {
    throw badRequest(
      `This certificate is used by: ${projects.map((project) => project.name).join(', ')}. Choose another certificate in their Network tab first.`,
    );
  }

  await removeSharedCertificateFiles(shared);
  await shared.destroy();
  await recordAudit({
    req,
    action: 'shared-certificate.delete',
    target: shared.name,
    details: { domains: shared.domains },
  });

  res.json({ ok: true });
});

export default router;
