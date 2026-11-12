/**
 * Point domains at this server through the API of a DNS provider account
 * (the same accounts certbot uses for DNS-01): an A record to the public
 * IPv4 and, when it is set, an AAAA record to the public IPv6.
 *
 * Nothing is overwritten without consent:
 *   - a missing record is created (TTL 5 minutes),
 *   - a record already pointing here is left as is,
 *   - a single record pointing elsewhere is only replaced with `replace`,
 *   - names with several records, or a CNAME, are never changed.
 * AAAA records are only handled once the A record points here (a name is
 * never split between servers). Without a public IPv6, an AAAA record
 * pointing elsewhere is reported: Let's Encrypt tries IPv6 first.
 */
import { createCloudflareClient } from './dnsApi/cloudflare.js';
import { createDigitalOceanClient } from './dnsApi/digitalocean.js';
import { createOvhClient } from './dnsApi/ovh.js';

export const RECORD_TTL = 300;

/** Statuses after which a record points at this server. */
const POINTING_HERE = ['created', 'updated', 'ok'];

const CLIENTS = {
  ovh: createOvhClient,
  cloudflare: createCloudflareClient,
  digitalocean: createDigitalOceanClient,
};

/**
 * API client of a DNS account.
 *
 * @param {import('../models/DnsAccount.js').default} account
 */
export function createDnsClient(account) {
  const create = CLIENTS[account.provider];

  if (!create) {
    throw new Error(`DNS records cannot be managed for the provider "${account.provider}".`);
  }

  return create(account.credentials || {});
}

/**
 * Comparable form of an address (IPv6 has many spellings: 2001:DB8:0::1).
 *
 * @param {string} address
 */
export function canonicalAddress(address) {
  const value = String(address).trim().toLowerCase();

  if (!value.includes(':')) {
    return value;
  }

  try {
    return new URL(`http://[${value}]/`).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return value;
  }
}

function result(host, type, status, message, extra = {}) {
  return { host, type, status, message, ...extra };
}

/**
 * Make one record of a host point to an address.
 *
 * @returns {Promise<object>} the result, see pointHostsAtServer
 */
async function pointRecord(client, zone, host, type, address, { replace, changedZones }) {
  try {
    const existing = await client.listRecords(zone, host, type);
    const current = existing.map((record) => record.value);

    if (existing.length === 0) {
      await client.createRecord(zone, host, type, address, RECORD_TTL);
      changedZones.set(zone.name, zone);

      return result(host, type, 'created', `Created: ${host} → ${address}.`, { value: address });
    }

    if (existing.length > 1) {
      return result(
        host,
        type,
        'conflict',
        `${existing.length} ${type} records (${current.join(', ')}): change them at your provider.`,
        { current },
      );
    }

    if (canonicalAddress(existing[0].value) === canonicalAddress(address)) {
      return result(host, type, 'ok', `Already points to ${address}.`, { value: address });
    }

    if (!replace) {
      return result(host, type, 'exists', `Points to ${existing[0].value}, not to this server.`, { current });
    }

    await client.updateRecord(zone, existing[0], address, RECORD_TTL);
    changedZones.set(zone.name, zone);

    return result(host, type, 'updated', `Replaced: ${existing[0].value} → ${address}.`, { value: address, current });
  } catch (error) {
    return result(host, type, 'error', error.message);
  }
}

/**
 * Point every host at the server.
 *
 * @param {import('../models/DnsAccount.js').default} account
 * @param {string[]} hosts domain and aliases (wildcards included)
 * @param {object} options
 * @param {string} options.ipv4 public IPv4 of the server
 * @param {string} [options.ipv6] public IPv6 of the server, if any
 * @param {boolean} [options.replace] replace a single record pointing elsewhere
 * @returns {Promise<Array<{host: string, type: string, status: 'created'|'updated'|'ok'|'exists'|'conflict'|'warning'|'no-zone'|'error', message: string, value?: string, current?: string[]}>>}
 */
export async function pointHostsAtServer(account, hosts, { ipv4, ipv6 = '', replace = false }) {
  const client = createDnsClient(account);
  const changedZones = new Map();
  const results = [];

  for (const host of hosts) {
    let zone;

    try {
      zone = await client.findZone(host);
    } catch (error) {
      results.push(result(host, 'A', 'error', error.message));
      continue;
    }

    if (zone === null) {
      results.push(result(host, 'A', 'no-zone', `No zone of the DNS account "${account.name}" holds ${host}.`));
      continue;
    }

    try {
      // A CNAME forbids any other record on the same name: left to the admin.
      const cnames = await client.listRecords(zone, host, 'CNAME');

      if (cnames.length > 0) {
        const targets = cnames.map((record) => record.value);

        results.push(
          result(host, 'CNAME', 'conflict', `Is a CNAME to ${targets.join(', ')}: remove it at your provider first.`, {
            current: targets,
          }),
        );
        continue;
      }
    } catch (error) {
      results.push(result(host, 'CNAME', 'error', error.message));
      continue;
    }

    const a = await pointRecord(client, zone, host, 'A', ipv4, { replace, changedZones });
    results.push(a);

    // The name must not be split between servers: AAAA only follows an A pointing here.
    if (!POINTING_HERE.includes(a.status)) {
      continue;
    }

    if (ipv6) {
      results.push(await pointRecord(client, zone, host, 'AAAA', ipv6, { replace, changedZones }));
      continue;
    }

    try {
      const aaaa = await client.listRecords(zone, host, 'AAAA');

      if (aaaa.length > 0) {
        const current = aaaa.map((record) => record.value);

        results.push(
          result(
            host,
            'AAAA',
            'warning',
            `Points to ${current.join(', ')}: Let's Encrypt tries IPv6 first. Set the server public IPv6 or remove it.`,
            { current },
          ),
        );
      }
    } catch (error) {
      results.push(result(host, 'AAAA', 'error', error.message));
    }
  }

  for (const zone of changedZones.values()) {
    try {
      await client.publish(zone);
    } catch (error) {
      results.push(
        result(zone.name, 'zone', 'error', `Records saved, but the zone could not be refreshed: ${error.message}`),
      );
    }
  }

  return results;
}
