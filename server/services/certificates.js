/**
 * Read-only access to the certificates managed by certbot.
 *
 * Two kinds of certbot lineages:
 *
 *   - project certificates: a configuration directory per project
 *     (`<project>/etc/letsencrypt`), lineage named after the project uid:
 *     `<project>/etc/letsencrypt/live/<uid>/`;
 *   - shared certificates (wildcards...): one configuration directory in the
 *     data directory, a lineage per certificate:
 *     `<data dir>/certificates/letsencrypt/live/<name>/`.
 *
 * A project uses its own lineage, or the shared certificate it selected
 * (network.certMethod "shared"): see resolveProjectCertificateFiles().
 */
import crypto from 'node:crypto';
import path from 'node:path';
import config from '../config.js';
import { SharedCertificate } from '../models/index.js';
import { pathExists, readFileOrNull } from '../lib/files.js';

/** Certificates are renewed when they expire in less than this many days. */
export const RENEWAL_THRESHOLD_DAYS = 30;

/** Where shared certificates and their certbot state live. */
const SHARED_CERTIFICATES_DIR = path.join(config.dataDir, 'certificates');

/**
 * Files of a certbot lineage.
 *
 * @param {string} configDir certbot --config-dir
 * @param {string} name certbot --cert-name
 */
function lineageFiles(configDir, name) {
  const live = path.join(configDir, 'live', name);

  return {
    live,
    certificate: path.join(live, 'cert.pem'),
    fullchain: path.join(live, 'fullchain.pem'),
    privateKey: path.join(live, 'privkey.pem'),
  };
}

/**
 * Files of the certificate owned by a project.
 *
 * @param {ReturnType<import('./projectPaths.js').getProjectPaths>} paths
 * @param {string} uid
 */
export function getCertificateFiles(paths, uid) {
  return lineageFiles(paths.letsencrypt, uid);
}

/**
 * certbot directories and files of a shared certificate. The DNS
 * credentials file is rewritten before each certbot run.
 *
 * @param {string} name shared certificate name (lineage)
 */
export function getSharedCertificatePaths(name) {
  const configDir = path.join(SHARED_CERTIFICATES_DIR, 'letsencrypt');

  return {
    root: SHARED_CERTIFICATES_DIR,
    configDir,
    workDir: path.join(SHARED_CERTIFICATES_DIR, 'work'),
    logsDir: path.join(SHARED_CERTIFICATES_DIR, 'logs'),
    dnsCredentials: path.join(SHARED_CERTIFICATES_DIR, 'dns', `${name}.ini`),
    files: lineageFiles(configDir, name),
    // What certbot keeps for a lineage (removed when the certificate is deleted).
    lineage: [
      path.join(configDir, 'live', name),
      path.join(configDir, 'archive', name),
      path.join(configDir, 'renewal', `${name}.conf`),
    ],
  };
}

/**
 * Whether the files nginx needs are present.
 *
 * @param {ReturnType<typeof lineageFiles>} files
 */
async function hasFiles(files) {
  return (await pathExists(files.fullchain)) && (await pathExists(files.privateKey));
}

/**
 * Whether the files nginx needs are present for a project certificate.
 */
export async function hasCertificateFiles(paths, uid) {
  return hasFiles(getCertificateFiles(paths, uid));
}

/**
 * Parse the certificate of a lineage.
 *
 * @param {ReturnType<typeof lineageFiles>} files
 * @returns {Promise<{exists: false} | {exists: true, domains: string[], validFrom: Date, validTo: Date, daysLeft: number, issuer: string, staging: boolean, needsRenewal: boolean}>}
 */
export async function readCertificateFiles(files) {
  let pem;

  try {
    pem = await readFileOrNull(files.certificate);
  } catch {
    return { exists: false };
  }

  if (pem === null) {
    return { exists: false };
  }

  const certificate = new crypto.X509Certificate(pem);
  const validTo = new Date(certificate.validTo);
  const validFrom = new Date(certificate.validFrom);
  const daysLeft = Math.floor((validTo.getTime() - Date.now()) / (24 * 3600 * 1000));

  const domains = String(certificate.subjectAltName || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith('DNS:'))
    .map((entry) => entry.slice(4));

  const issuer = certificate.issuer.replace(/\n/g, ', ');

  return {
    exists: true,
    domains,
    validFrom,
    validTo,
    daysLeft,
    issuer,
    staging: /STAGING|Fake|\(STAGING\)/i.test(issuer),
    needsRenewal: daysLeft < RENEWAL_THRESHOLD_DAYS,
  };
}

/**
 * Parse the certificate owned by a project.
 *
 * @param {ReturnType<import('./projectPaths.js').getProjectPaths>} paths
 * @param {string} uid
 */
export async function readCertificate(paths, uid) {
  return readCertificateFiles(getCertificateFiles(paths, uid));
}

/**
 * Whether a certificate name covers a host name. A wildcard covers exactly
 * one label: *.example.com covers app.example.com, but neither example.com
 * nor a.b.example.com. A wildcard host (an nginx alias) needs the very same
 * wildcard on the certificate.
 *
 * @param {string[]} certificateDomains
 * @param {string} domain
 */
export function coversDomain(certificateDomains, domain) {
  const host = domain.toLowerCase();

  for (const entry of certificateDomains) {
    const name = entry.toLowerCase();

    if (name === host) {
      return true;
    }

    if (!name.startsWith('*.') || host.startsWith('*.')) {
      continue;
    }

    const firstDot = host.indexOf('.');

    if (firstDot > 0 && host.slice(firstDot + 1) === name.slice(2)) {
      return true;
    }
  }

  return false;
}

/**
 * Host names a certificate does not cover.
 *
 * @param {string[]} certificateDomains
 * @param {string[]} domains
 * @returns {string[]}
 */
export function uncoveredDomains(certificateDomains, domains) {
  return domains.filter((domain) => !coversDomain(certificateDomains, domain));
}

/**
 * Whether two lists hold the same names, in any order.
 *
 * @param {string[]} first
 * @param {string[]} second
 */
export function sameDomains(first, second) {
  const normalize = (list) => [...new Set(list.map((domain) => domain.toLowerCase()))].sort().join(',');

  return normalize(first) === normalize(second);
}

/**
 * Certificate files used by a project: its own lineage, or the shared
 * certificate it selected.
 *
 * @param {import('../models/Project.js').default} project
 * @param {ReturnType<import('./projectPaths.js').getProjectPaths>} paths
 * @returns {Promise<{files: ReturnType<typeof lineageFiles>|null, shared: SharedCertificate|null}>}
 *   files is null when the selected shared certificate no longer exists
 */
export async function resolveProjectCertificateFiles(project, paths) {
  const network = project.network;

  if (network.certMethod !== 'shared') {
    return { files: getCertificateFiles(paths, project.uid), shared: null };
  }

  const shared = await SharedCertificate.findByPk(network.sharedCertificateId);

  if (shared === null) {
    return { files: null, shared: null };
  }

  return { files: getSharedCertificatePaths(shared.name).files, shared };
}

/**
 * Certificate files nginx should use for a project, or null when there is
 * none yet (the project is then served over HTTP only).
 *
 * @param {import('../models/Project.js').default} project
 * @param {ReturnType<import('./projectPaths.js').getProjectPaths>} paths
 */
export async function findServableCertificateFiles(project, paths) {
  const { files } = await resolveProjectCertificateFiles(project, paths);

  if (files === null || !(await hasFiles(files))) {
    return null;
  }

  return files;
}

/**
 * The certificate a project is served with. For a shared certificate, also
 * which one (`shared`) and the project names the issued certificate does
 * not cover yet (`uncovered`: the shared certificate must be requested
 * again after its names changed).
 *
 * @param {import('../models/Project.js').default} project
 * @param {ReturnType<import('./projectPaths.js').getProjectPaths>} paths
 */
export async function readProjectCertificate(project, paths) {
  const { files, shared } = await resolveProjectCertificateFiles(project, paths);

  if (project.network.certMethod !== 'shared') {
    return readCertificateFiles(files);
  }

  if (shared === null) {
    return { exists: false, error: 'The shared certificate selected for this project no longer exists.' };
  }

  const certificate = await readCertificateFiles(files);
  const presented = { ...certificate, shared: { id: shared.id, name: shared.name, domains: shared.domains } };

  if (certificate.exists) {
    const network = project.network;
    presented.uncovered = uncoveredDomains(certificate.domains, [network.domain, ...network.aliases]);
  }

  return presented;
}
