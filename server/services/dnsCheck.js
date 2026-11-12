/**
 * Check where domains point, to catch DNS mistakes before asking
 * Let's Encrypt for a certificate.
 */
import dns from 'node:dns/promises';
import { canonicalAddress } from './dnsRecords.js';

/**
 * Resolve the A / AAAA records of each domain.
 *
 * @param {string[]} domains
 * @param {string} serverIp expected IPv4 (optional)
 * @param {string} [serverIpv6] expected IPv6 (optional)
 * @returns {Promise<Array<{domain: string, ipv4: string[], ipv6: string[], pointsToServer: boolean|null, error: string|null}>>}
 */
export async function checkDomains(domains, serverIp, serverIpv6 = '') {
  const results = [];

  for (const domain of domains) {
    if (domain.startsWith('*.')) {
      results.push({ domain, ipv4: [], ipv6: [], pointsToServer: null, error: 'Wildcard: not resolvable directly.' });
      continue;
    }

    const ipv4 = await dns.resolve4(domain).catch(() => []);
    const ipv6 = await dns.resolve6(domain).catch(() => []);
    let pointsToServer = null;
    let error = null;

    if (ipv4.length === 0 && ipv6.length === 0) {
      error = 'No A / AAAA record found.';
    }

    if (serverIp || serverIpv6) {
      const ipv6Matches = Boolean(serverIpv6) && ipv6.map(canonicalAddress).includes(canonicalAddress(serverIpv6));

      pointsToServer = (Boolean(serverIp) && ipv4.includes(serverIp)) || ipv6Matches;
    }

    results.push({ domain, ipv4, ipv6, pointsToServer, error });
  }

  return results;
}
