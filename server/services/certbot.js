/**
 * Let's Encrypt certificates with certbot.
 *
 * Certbot runs as the SolarOps user (no root needed). Two kinds of
 * certificates:
 *
 *   - project certificates, with a configuration directory inside each
 *     project (`etc/letsencrypt`), validated through either
 *       - http: HTTP-01 through the webroot served by the project nginx config,
 *       - dns:  DNS-01 with a certbot DNS plugin and a DNS account (OVH...);
 *   - shared certificates (e.g. *.example.com, see models/SharedCertificate),
 *     always validated through DNS-01 (the only challenge accepted for
 *     wildcards), issued once and selected by any number of projects.
 *
 * nginx only reads certificate files when it (re)loads: after certbot, the
 * configurations are rewritten or nginx is reloaded.
 *
 * SolarOps's scheduler renews certificates automatically (auto-renew), and
 * `solarops certs:renew` can be put in a cron job as a safety net.
 */
import path from 'node:path';
import config from '../config.js';
import { DnsAccount, Project, SharedCertificate } from '../models/index.js';
import { badRequest } from '../lib/errors.js';
import { splitCommandLine } from '../lib/exec.js';
import { ensureDirectory, writeManagedFile } from '../lib/files.js';
import { getSharedCertificatePaths, readCertificate, readCertificateFiles, sameDomains } from './certificates.js';
import { DNS_PROVIDERS, renderCredentialsIni } from './dnsProviders.js';
import { applyProjectNginx, reloadNginx } from './nginx.js';
import { DNS_CREDENTIALS_MARKER, resolveProjectPaths } from './projectPaths.js';
import { findProjectsUsingSharedCertificate, sharedCertificateLabel } from './sharedCertificates.js';
import { getGeneralSettings } from './settings.js';
import { enqueueTask } from './taskRunner.js';

const CERTBOT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Arguments of the DNS-01 challenge. The DNS account credentials are
 * written to a file only the SolarOps user can read, rewritten before each
 * run so updated credentials are always used.
 *
 * @param {import('./taskRunner.js').TaskContext} context
 * @param {number} accountId
 * @param {string} credentialsFile
 */
async function dnsChallengeArguments(context, accountId, credentialsFile) {
  const account = await DnsAccount.findByPk(accountId);

  if (account === null) {
    throw new Error('The selected DNS account no longer exists.');
  }

  const provider = DNS_PROVIDERS[account.provider];

  if (!provider) {
    throw new Error(`Unsupported DNS provider "${account.provider}".`);
  }

  for (const value of Object.values(account.credentials || {})) {
    context.addSecret(String(value));
  }

  await ensureDirectory(path.dirname(credentialsFile), 0o700);
  await writeManagedFile(credentialsFile, renderCredentialsIni(account), {
    marker: DNS_CREDENTIALS_MARKER,
    mode: 0o600,
  });
  context.info(`Using ${provider.label} DNS account "${account.name}" (${provider.plugin}).`);

  return [
    '--authenticator',
    provider.plugin,
    `--${provider.plugin}-credentials`,
    credentialsFile,
    `--${provider.plugin}-propagation-seconds`,
    String(account.propagationSeconds),
  ];
}

/**
 * Arguments selecting the challenge of a project certificate.
 *
 * @param {import('./taskRunner.js').TaskContext} context
 * @param {import('../models/Project.js').default} project
 * @param {object} paths
 */
async function projectChallengeArguments(context, project, paths) {
  const network = project.network;

  if (network.certMethod === 'http') {
    await ensureDirectory(paths.acme, 0o755);
    return ['--authenticator', 'webroot', '--webroot-path', paths.acme];
  }

  if (network.certMethod === 'dns') {
    return dnsChallengeArguments(context, network.dnsAccountId, paths.dnsCredentials);
  }

  throw new Error('Certificates are disabled for this project (method "none").');
}

/**
 * Run `certbot certonly` for one lineage.
 *
 * @param {import('./taskRunner.js').TaskContext} context
 * @param {object} options
 * @param {string} options.certName lineage name
 * @param {string} options.configDir certbot --config-dir
 * @param {string} options.workDir
 * @param {string} options.logsDir
 * @param {string[]} options.domains names on the certificate
 * @param {string[]} options.challenge challenge arguments
 * @param {boolean} options.force renew even if the certificate is still valid
 * @param {object} options.settings general settings (ACME e-mail, staging)
 */
async function runCertbot(context, options) {
  const { certName, configDir, workDir, logsDir, domains, challenge, force, settings } = options;
  const [file, ...baseArgs] = splitCommandLine(config.commands.certbot);
  const args = [
    ...baseArgs,
    'certonly',
    '--non-interactive',
    '--agree-tos',
    '--cert-name',
    certName,
    '--config-dir',
    configDir,
    '--work-dir',
    workDir,
    '--logs-dir',
    logsDir,
  ];

  if (settings.acmeEmail) {
    args.push('--email', settings.acmeEmail);
  } else {
    args.push('--register-unsafely-without-email');
  }

  if (settings.acmeStaging) {
    args.push('--test-cert');
  }

  if (force) {
    args.push('--force-renewal');
  } else {
    args.push('--keep-until-expiring');
  }

  args.push(...challenge);

  for (const domain of domains) {
    args.push('-d', domain);
  }

  await ensureDirectory(configDir, 0o755);
  await context.run(file, args, { timeoutMs: CERTBOT_TIMEOUT_MS });
}

/**
 * Switching between Let's Encrypt staging and production needs a new
 * certificate, even if the current one is still valid.
 */
function mustForceForStaging(context, current, settings) {
  if (current.exists && current.staging !== settings.acmeStaging) {
    context.info("Switching between Let's Encrypt staging and production: forcing a new certificate.");
    return true;
  }

  return false;
}

/**
 * Serve a project with its new certificate. The HTTPS configuration is
 * written (and nginx reloaded) the first time; afterwards only the files
 * change, and nginx must be reloaded to read them.
 *
 * @param {import('./taskRunner.js').TaskContext} context
 * @param {import('../models/Project.js').default} project
 * @returns {Promise<boolean>} whether nginx still has to be reloaded
 */
async function applyWithNewCertificate(context, project) {
  const result = await applyProjectNginx(project);

  if (!result.served) {
    context.info(`${project.name}: not served by nginx (inactive or network disabled).`);
    return false;
  }

  if (!result.changed) {
    context.info(`${project.name}: configuration unchanged, the new files are read on reload.`);
    return true;
  }

  context.info(`${project.name}: nginx now serves it over HTTPS.`);
  return false;
}

/**
 * Obtain or renew the certificate of a project, then switch nginx to HTTPS.
 *
 * @param {import('./taskRunner.js').TaskContext} context
 * @param {number} projectId
 * @param {object} options
 * @param {boolean} options.force renew even if the certificate is still valid
 */
async function runCertificateTask(context, projectId, { force }) {
  const project = await Project.findByPk(projectId);

  if (project === null) {
    throw new Error('The project no longer exists.');
  }

  const network = project.network;

  if (!network.enabled || !network.domain) {
    throw new Error('Configure a domain in the Network tab first.');
  }

  const settings = await getGeneralSettings();
  const paths = await resolveProjectPaths(project);
  const domains = [network.domain, ...network.aliases];
  const current = await readCertificate(paths, project.uid);
  const forceRenewal = force || mustForceForStaging(context, current, settings);

  if (network.certMethod === 'http') {
    context.step('Making sure nginx serves the ACME challenge folder');
    await applyProjectNginx(project);
    context.info(`Challenges served from ${paths.acme}`);
  }

  context.step(`Requesting a certificate for ${domains.join(', ')}`);

  await runCertbot(context, {
    certName: project.uid,
    configDir: paths.letsencrypt,
    workDir: path.join(paths.letsencrypt, 'work'),
    logsDir: path.join(paths.letsencrypt, 'logs'),
    domains,
    challenge: await projectChallengeArguments(context, project, paths),
    force: forceRenewal,
    settings,
  });

  const certificate = await readCertificate(paths, project.uid);

  if (!certificate.exists) {
    throw new Error('certbot finished but no certificate was found.');
  }

  context.info(`Certificate valid until ${certificate.validTo.toISOString()} (${certificate.daysLeft} days).`);
  context.setMeta({ validTo: certificate.validTo, domains: certificate.domains });

  context.step('Applying the HTTPS nginx configuration');

  if (await applyWithNewCertificate(context, project)) {
    await reloadNginx();
    context.info('nginx reloaded with the renewed certificate.');
  }
}

/**
 * Obtain or renew a shared certificate, then serve every project using it
 * with the new files.
 *
 * @param {import('./taskRunner.js').TaskContext} context
 * @param {number} certificateId
 * @param {object} options
 * @param {boolean} options.force renew even if the certificate is still valid
 */
async function runSharedCertificateTask(context, certificateId, { force }) {
  const shared = await SharedCertificate.findByPk(certificateId);

  if (shared === null) {
    throw new Error('The shared certificate no longer exists.');
  }

  const settings = await getGeneralSettings();
  const paths = getSharedCertificatePaths(shared.name);
  const current = await readCertificateFiles(paths.files);
  let forceRenewal = force || mustForceForStaging(context, current, settings);

  if (current.exists && !sameDomains(current.domains, shared.domains)) {
    context.info(`The names changed (issued for ${current.domains.join(', ')}): requesting a new certificate.`);
    forceRenewal = true;
  }

  await ensureDirectory(paths.root, 0o700);
  context.step(`Requesting a certificate for ${shared.domains.join(', ')}`);

  await runCertbot(context, {
    certName: shared.name,
    configDir: paths.configDir,
    workDir: paths.workDir,
    logsDir: paths.logsDir,
    domains: shared.domains,
    challenge: await dnsChallengeArguments(context, shared.dnsAccountId, paths.dnsCredentials),
    force: forceRenewal,
    settings,
  });

  const certificate = await readCertificateFiles(paths.files);

  if (!certificate.exists) {
    throw new Error('certbot finished but no certificate was found.');
  }

  context.info(`Certificate valid until ${certificate.validTo.toISOString()} (${certificate.daysLeft} days).`);
  context.setMeta({ validTo: certificate.validTo, domains: certificate.domains });

  const projects = await findProjectsUsingSharedCertificate(shared.id);
  context.step('Serving the projects using it');

  if (projects.length === 0) {
    context.info('No project uses this certificate yet: select it in the Network tab of a project.');
    return;
  }

  // One project refused by nginx must not keep the others on the old files.
  const failures = [];
  let needsReload = false;

  for (const project of projects) {
    try {
      if (await applyWithNewCertificate(context, project)) {
        needsReload = true;
      }
    } catch (error) {
      failures.push(project.name);
      context.info(`${project.name}: nginx refused the configuration: ${error.message}`);
    }
  }

  // A single reload for every project whose configuration did not change.
  if (needsReload) {
    await reloadNginx();
    context.info('nginx reloaded with the renewed certificate.');
  }

  if (failures.length > 0) {
    throw new Error(`The certificate was issued, but ${failures.join(', ')} could not be updated (see above).`);
  }
}

/**
 * Queue a request / renewal of a shared certificate. Shared certificates
 * share one certbot configuration directory, so their tasks run one at a
 * time (global queue).
 *
 * @param {SharedCertificate} shared
 * @param {object} options
 * @param {boolean} [options.force]
 * @param {string} options.trigger
 * @param {string} options.triggeredBy
 */
export async function queueSharedCertificate(shared, { force = false, trigger, triggeredBy }) {
  const label = sharedCertificateLabel(shared);
  let title = `Shared certificate ${label}`;

  if (force) {
    title = `Force renewal for ${label} (shared)`;
  }

  return enqueueTask(
    {
      projectId: null,
      type: 'certificate',
      title,
      trigger,
      triggeredBy,
      meta: { domain: shared.domains[0], sharedCertificateId: shared.id },
    },
    (context) => runSharedCertificateTask(context, shared.id, { force }),
  );
}

/**
 * Queue a certificate request / renewal for a project. A project using a
 * shared certificate requests that certificate (for every project using it).
 *
 * @param {import('../models/Project.js').default} project
 * @param {object} options
 * @param {boolean} [options.force]
 * @param {string} options.trigger
 * @param {string} options.triggeredBy
 */
export async function queueCertificate(project, { force = false, trigger, triggeredBy }) {
  const network = project.network;

  if (network.certMethod === 'shared') {
    const shared = await SharedCertificate.findByPk(network.sharedCertificateId);

    if (shared === null) {
      throw badRequest('The shared certificate selected for this project no longer exists.');
    }

    return queueSharedCertificate(shared, { force, trigger, triggeredBy });
  }

  let title = `Certificate for ${network.domain}`;

  if (force) {
    title = `Force renewal for ${network.domain}`;
  }

  const result = await enqueueTask(
    {
      projectId: project.id,
      type: 'certificate',
      title,
      trigger,
      triggeredBy,
      meta: { domain: network.domain },
    },
    (context) => runCertificateTask(context, project.id, { force }),
  );

  return result;
}

/**
 * Projects whose own certificate should be renewed now (projects using a
 * shared certificate are renewed with it).
 *
 * @returns {Promise<import('../models/Project.js').default[]>}
 */
export async function findCertificatesToRenew() {
  const projects = await Project.findAll({ where: { active: true } });
  const due = [];

  for (const project of projects) {
    const network = project.network;
    const ownCertificate = network.certMethod === 'http' || network.certMethod === 'dns';

    if (!network.enabled || !ownCertificate || !network.autoRenew) {
      continue;
    }

    const paths = await resolveProjectPaths(project);
    const certificate = await readCertificate(paths, project.uid);

    if (certificate.exists && certificate.needsRenewal) {
      due.push(project);
    }
  }

  return due;
}

/**
 * Shared certificates that should be renewed now.
 *
 * @returns {Promise<SharedCertificate[]>}
 */
export async function findSharedCertificatesToRenew() {
  const certificates = await SharedCertificate.findAll({ where: { autoRenew: true } });
  const due = [];

  for (const shared of certificates) {
    const certificate = await readCertificateFiles(getSharedCertificatePaths(shared.name).files);

    if (certificate.exists && certificate.needsRenewal) {
      due.push(shared);
    }
  }

  return due;
}
