/**
 * Shared certificates: names, usage by projects and presentation.
 * Issuance and renewal are handled by certbot.js.
 */
import fs from 'node:fs/promises';
import { Project, SharedCertificate } from '../models/index.js';
import { getSharedCertificatePaths, readCertificateFiles, uncoveredDomains } from './certificates.js';

/** Names on one shared certificate (Let's Encrypt accepts up to 100). */
export const MAX_SHARED_DOMAINS = 20;

const NAME_MAX_LENGTH = 32;

/**
 * Short label of a certificate: its first name, and how many others.
 *
 * @param {SharedCertificate} shared
 */
export function sharedCertificateLabel(shared) {
  const [first, ...others] = shared.domains;

  if (others.length === 0) {
    return first;
  }

  return `${first} +${others.length}`;
}

/**
 * Free lineage name derived from the first domain:
 * *.example.com => wildcard-example-com (then -2, -3... when taken).
 * Only [a-z0-9-]: the name ends up in file paths.
 *
 * @param {string[]} domains
 * @returns {Promise<string>}
 */
export async function pickSharedCertificateName(domains) {
  let base = domains[0]
    .replace(/^\*\./, 'wildcard.')
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, NAME_MAX_LENGTH)
    .replace(/^-+|-+$/g, '');

  if (base === '') {
    base = 'certificate';
  }

  let name = base;
  let suffix = 2;

  while ((await SharedCertificate.findOne({ where: { name } })) !== null) {
    name = `${base}-${suffix}`;
    suffix += 1;
  }

  return name;
}

/**
 * Projects served with a shared certificate.
 *
 * @param {number} certificateId
 * @returns {Promise<Project[]>}
 */
export async function findProjectsUsingSharedCertificate(certificateId) {
  const projects = await Project.findAll({
    order: [
      ['system', 'DESC'],
      ['name', 'ASC'],
    ],
  });

  return projects.filter((project) => {
    const network = project.network;

    return network.certMethod === 'shared' && network.sharedCertificateId === certificateId;
  });
}

/**
 * Projects that would lose a name if the certificate only had `domains`.
 *
 * @param {number} certificateId
 * @param {string[]} domains
 * @returns {Promise<Array<{project: Project, uncovered: string[]}>>}
 */
export async function findProjectsLosingCoverage(certificateId, domains) {
  const projects = await findProjectsUsingSharedCertificate(certificateId);
  const losing = [];

  for (const project of projects) {
    const network = project.network;
    const uncovered = uncoveredDomains(domains, [network.domain, ...network.aliases]);

    if (uncovered.length > 0) {
      losing.push({ project, uncovered });
    }
  }

  return losing;
}

/**
 * API view of a shared certificate: configuration, issued certificate,
 * names not issued yet (`pendingDomains`, until it is requested again) and
 * the projects using it.
 *
 * @param {SharedCertificate} shared
 */
export async function presentSharedCertificate(shared) {
  const paths = getSharedCertificatePaths(shared.name);
  const projects = await findProjectsUsingSharedCertificate(shared.id);
  const dnsAccount = await shared.getDnsAccount();
  let certificate;

  try {
    certificate = await readCertificateFiles(paths.files);
  } catch (error) {
    certificate = { exists: false, error: error.message };
  }

  let pendingDomains = [];

  if (certificate.exists) {
    pendingDomains = uncoveredDomains(certificate.domains, shared.domains);
  }

  let account = null;

  if (dnsAccount !== null) {
    account = { id: dnsAccount.id, name: dnsAccount.name, provider: dnsAccount.provider };
  }

  return {
    ...shared.toPublic(),
    dnsAccount: account,
    certificate,
    pendingDomains,
    projects: projects.map((project) => ({
      uid: project.uid,
      name: project.name,
      system: project.system,
      active: project.active,
    })),
  };
}

/**
 * Remove what certbot keeps for a shared certificate, and its DNS
 * credentials file. Paths derive from the generated name ([a-z0-9-] only).
 *
 * @param {SharedCertificate} shared
 */
export async function removeSharedCertificateFiles(shared) {
  const paths = getSharedCertificatePaths(shared.name);

  for (const target of [...paths.lineage, paths.dnsCredentials]) {
    await fs.rm(target, { recursive: true, force: true });
  }
}
