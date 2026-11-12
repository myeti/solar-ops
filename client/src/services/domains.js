/**
 * Domain helpers shared by the Network tab and Domains & SSL. Mirrors
 * server/services/certificates.js (the server has the final word).
 */

/**
 * Whether a certificate name covers a host name. A wildcard covers exactly
 * one label: *.example.com covers app.example.com, but neither example.com
 * nor a.b.example.com. A wildcard host needs the very same wildcard.
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
 */
export function uncoveredDomains(certificateDomains, domains) {
  return domains.filter((domain) => !coversDomain(certificateDomains, domain));
}

/**
 * Names typed in a field: comma or space separated, lower case, no
 * duplicates.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function parseDomainList(text) {
  const names = [];

  for (const entry of String(text || '').split(/[\s,]+/)) {
    const name = entry.trim().toLowerCase();

    if (name !== '' && !names.includes(name)) {
      names.push(name);
    }
  }

  return names;
}
