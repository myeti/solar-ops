/**
 * Network component of a project (mounted at /api/projects/:uid/network):
 * domain, reverse proxy / static hosting, certificates.
 */
import express from 'express';
import { DnsAccount, Project, SharedCertificate } from '../models/index.js';
import { DEFAULT_MAX_UPLOAD_MB } from '../models/Project.js';
import { badRequest } from '../lib/errors.js';
import { DOMAIN_OR_WILDCARD_PATTERN, Validator } from '../lib/validation.js';
import { recordAudit } from '../services/audit.js';
import { queueCertificate } from '../services/certbot.js';
import { uncoveredDomains } from '../services/certificates.js';
import { checkDomains } from '../services/dnsCheck.js';
import { pointHostsAtServer } from '../services/dnsRecords.js';
import { applyProjectNginx, nginxIncludeDirective, previewProjectNginx } from '../services/nginx.js';
import { presentProject } from '../services/projects.js';
import { getGeneralSettings } from '../services/settings.js';
import { lockSystemNetwork } from '../services/systemProject.js';
import { actorOf } from './helpers.js';

const router = express.Router({ mergeParams: true });

// shared: a certificate of Domains & SSL (see models/SharedCertificate.js).
const CERT_METHODS = ['none', 'http', 'dns', 'shared'];

/**
 * Parse the aliases field: array or comma / space separated string.
 */
function parseAliases(input, value) {
  let list = [];

  if (Array.isArray(value)) {
    list = value;
  } else if (typeof value === 'string') {
    list = value.split(/[\s,]+/);
  }

  const aliases = [];

  for (const entry of list) {
    const alias = String(entry).trim().toLowerCase();

    if (alias === '') {
      continue;
    }

    if (!DOMAIN_OR_WILDCARD_PATTERN.test(alias)) {
      input.fail('aliases', `"${alias}" is not a valid domain.`);
      continue;
    }

    if (!aliases.includes(alias)) {
      aliases.push(alias);
    }
  }

  if (aliases.length > 20) {
    input.fail('aliases', 'At most 20 aliases.');
  }

  return aliases;
}

/**
 * Make sure the domains are not already used by another project (ports are
 * unique per project, see services/ports.js).
 */
async function assertNoConflict(project, network) {
  const others = await Project.findAll();
  const ownDomains = [network.domain, ...network.aliases];

  for (const other of others) {
    if (other.id === project.id) {
      continue;
    }

    const otherNetwork = other.network;

    if (!otherNetwork.enabled) {
      continue;
    }

    const otherDomains = [otherNetwork.domain, ...otherNetwork.aliases];
    const shared = ownDomains.find((domain) => otherDomains.includes(domain));

    if (shared) {
      throw badRequest(`${shared} is already used by ${other.name}.`, {
        fields: { domain: 'Already used by another project.' },
      });
    }
  }
}

/**
 * A project can only select a shared certificate whose names cover its
 * domain and every alias (*.example.com covers app.example.com only).
 *
 * @param {number} certificateId
 * @param {string[]} domains
 */
async function assertSharedCertificateCovers(certificateId, domains) {
  const shared = await SharedCertificate.findByPk(certificateId);

  if (shared === null) {
    throw badRequest('This shared certificate does not exist.', {
      fields: { sharedCertificateId: 'Unknown certificate.' },
    });
  }

  const uncovered = uncoveredDomains(shared.domains, domains.filter(Boolean));

  if (uncovered.length > 0) {
    throw badRequest(`The shared certificate ${shared.domains.join(', ')} does not cover ${uncovered.join(', ')}.`, {
      fields: { sharedCertificateId: `Does not cover ${uncovered.join(', ')}.` },
    });
  }
}

/**
 * SolarOps's own domain must already point to this server: nginx would
 * otherwise happily serve a domain nobody can reach, and admins would lose
 * the UI. (From the shell, `solarops domain:set` skips this check.)
 *
 * @param {object} network submitted network config
 * @param {object} previous current network config
 */
async function assertSystemDomainReachable(network, previous) {
  const domains = [network.domain, ...network.aliases];
  const previousDomains = [previous.domain, ...previous.aliases];
  const unchanged = previous.enabled && domains.join(',') === previousDomains.join(',');

  if (!network.enabled || unchanged) {
    return;
  }

  const settings = await getGeneralSettings();
  const results = await checkDomains(domains, settings.serverIp, settings.serverIpv6);
  const problems = [];

  for (const result of results) {
    if (result.error) {
      problems.push(`${result.domain}: ${result.error.replace(/\.$/, '')}`);
    } else if (result.pointsToServer === false) {
      problems.push(`${result.domain} points to ${result.ipv4.join(', ')}, not to ${settings.serverIp}`);
    }
  }

  if (problems.length > 0) {
    throw badRequest(`SolarOps would become unreachable — fix the DNS first. ${problems.join('. ')}.`, {
      fields: { domain: 'Does not point to this server yet.' },
    });
  }
}

/**
 * Save the network configuration and apply it to nginx. A failed apply
 * keeps the saved configuration and reports the nginx error.
 */
router.put('/', async (req, res) => {
  const project = req.project;
  const input = new Validator(req.body);
  const enabled = input.boolean('enabled', { required: true });
  const domain = input.domain('domain', { required: enabled === true });
  const aliases = parseAliases(input, req.body?.aliases);
  // How nginx serves the project follows its type: reverse proxy to the
  // project port for applications, files of publicFolder for static sites.
  const publicFolder = input.relativePath('publicFolder', {
    required: enabled === true && project.isStatic,
    defaultValue: 'dist',
  });
  const spaFallback = input.boolean('spaFallback', { defaultValue: true });
  const certMethod = input.oneOf('certMethod', CERT_METHODS, { defaultValue: 'none' });
  const dnsAccountId = input.reference('dnsAccountId', { required: certMethod === 'dns' });
  const sharedCertificateId = input.reference('sharedCertificateId', { required: certMethod === 'shared' });
  const autoRenew = input.boolean('autoRenew', { defaultValue: true });
  const forceHttps = input.boolean('forceHttps', { defaultValue: true });
  const clientMaxBodySize = input.integer('clientMaxBodySize', {
    min: 1,
    max: 10240,
    defaultValue: DEFAULT_MAX_UPLOAD_MB,
  });
  input.assertValid();

  const wildcardCapable = certMethod === 'dns' || certMethod === 'shared';

  if (!wildcardCapable && aliases.some((alias) => alias.startsWith('*.'))) {
    throw badRequest('Wildcard domains need the DNS or shared certificate method.', {
      fields: { aliases: 'Wildcards need DNS validation.' },
    });
  }

  if (project.system && enabled && certMethod === 'none') {
    throw badRequest('SolarOps must be served over HTTPS: choose a certificate method.', {
      fields: { certMethod: 'HTTPS is required.' },
    });
  }

  if (project.system && aliases.some((alias) => alias.startsWith('*.'))) {
    throw badRequest('SolarOps cannot use wildcard aliases.', { fields: { aliases: 'No wildcard for SolarOps.' } });
  }

  if (project.system && (!enabled || !domain)) {
    const settings = await getGeneralSettings();

    if (settings.authMethod === 'magic-link') {
      throw badRequest(
        'Magic links are built from this domain. Switch the sign-in method to password first (Settings › Access).',
      );
    }
  }

  if (certMethod === 'dns' && (await DnsAccount.findByPk(dnsAccountId)) === null) {
    throw badRequest('This DNS account does not exist.', { fields: { dnsAccountId: 'Unknown account.' } });
  }

  if (certMethod === 'shared' && enabled) {
    await assertSharedCertificateCovers(sharedCertificateId, [domain, ...aliases]);
  }

  let network = {
    ...project.network,
    enabled,
    domain: domain || '',
    aliases: aliases.filter((alias) => alias !== domain),
    publicFolder: publicFolder || 'dist',
    spaFallback,
    certMethod,
    dnsAccountId,
    sharedCertificateId,
    autoRenew,
    forceHttps,
    clientMaxBodySize,
  };

  // SolarOps is always a reverse proxy to its own port.
  if (project.system) {
    network = lockSystemNetwork(network);
    await assertSystemDomainReachable(network, project.network);
  }

  if (enabled) {
    await assertNoConflict(project, network);
  }

  project.networkConfig = network;
  await project.save();
  await recordAudit({
    req,
    action: 'project.network-update',
    target: project.uid,
    details: { enabled, domain, type: project.type, certMethod },
  });

  let applied = null;
  let applyError = null;

  try {
    applied = await applyProjectNginx(project);
  } catch (error) {
    applyError = error.message;
  }

  res.json({ project: await presentProject(project), applied, applyError });
});

/**
 * Re-apply the nginx configuration (e.g. after fixing nginx by hand).
 */
router.post('/apply', async (req, res) => {
  const applied = await applyProjectNginx(req.project);
  await recordAudit({ req, action: 'project.network-apply', target: req.project.uid });

  res.json({ applied });
});

/**
 * Generated nginx configuration and the include directive nginx needs.
 */
router.get('/preview', async (req, res) => {
  const settings = await getGeneralSettings();

  res.json({
    config: await previewProjectNginx(req.project),
    includeDirective: nginxIncludeDirective(settings.baseFolder),
  });
});

/**
 * Where the project domains currently point.
 */
router.get('/dns-check', async (req, res) => {
  const network = req.project.network;

  if (!network.domain) {
    throw badRequest('No domain configured.');
  }

  const settings = await getGeneralSettings();
  const results = await checkDomains([network.domain, ...network.aliases], settings.serverIp, settings.serverIpv6);

  res.json({ serverIp: settings.serverIp, serverIpv6: settings.serverIpv6, results });
});

/**
 * Point the domain and every alias at this server through a DNS account:
 * A records to the public IPv4, AAAA to the public IPv6 when it is set
 * (see services/dnsRecords.js). Body: { dnsAccountId, replace }; records
 * pointing elsewhere are only replaced with replace: true.
 */
router.post('/dns-records', async (req, res) => {
  const project = req.project;
  const network = project.network;
  const input = new Validator(req.body);
  const dnsAccountId = input.reference('dnsAccountId', { required: true });
  const replace = input.boolean('replace', { defaultValue: false });
  input.assertValid();

  if (!network.enabled || !network.domain) {
    throw badRequest('Enable the network component and set a domain first.');
  }

  const account = await DnsAccount.findByPk(dnsAccountId);

  if (account === null) {
    throw badRequest('This DNS account does not exist.', { fields: { dnsAccountId: 'Unknown account.' } });
  }

  const settings = await getGeneralSettings();

  if (!settings.serverIp) {
    throw badRequest('Set the server public IPv4 in Settings › General first.');
  }

  // Remembered for next time.
  project.networkConfig = { ...network, recordsAccountId: account.id };
  await project.save();

  const results = await pointHostsAtServer(account, [network.domain, ...network.aliases], {
    ipv4: settings.serverIp,
    ipv6: settings.serverIpv6,
    replace,
  });

  await recordAudit({
    req,
    action: 'project.dns-records',
    target: project.uid,
    details: {
      account: account.name,
      replace,
      results: results.map((entry) => `${entry.type} ${entry.host}: ${entry.status}`),
    },
  });

  res.json({ ipv4: settings.serverIp, ipv6: settings.serverIpv6, results });
});

/**
 * Queue a certificate request / renewal. Body: { force }
 */
router.post('/certificate', async (req, res) => {
  const project = req.project;
  const network = project.network;

  if (!network.enabled || !network.domain) {
    throw badRequest('Enable the network component and set a domain first.');
  }

  if (network.certMethod === 'none') {
    throw badRequest('Choose a certificate method (HTTP or DNS) first.');
  }

  const force = req.body?.force === true;
  const { task } = await queueCertificate(project, { force, trigger: 'manual', triggeredBy: actorOf(req) });

  await recordAudit({ req, action: 'project.certificate', target: project.uid, details: { force } });

  res.status(202).json({ task: task.toPublic() });
});

export default router;
