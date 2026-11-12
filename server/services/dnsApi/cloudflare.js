/**
 * Cloudflare API client (DNS zones), for the API token of a DNS account
 * ("Zone › DNS › Edit"). Changes are live right away.
 */
import { requestJson, zoneCandidates } from './http.js';

const BASE = 'https://api.cloudflare.com/client/v4';

function describeError(data) {
  if (data && Array.isArray(data.errors) && data.errors.length > 0) {
    return `Cloudflare: ${data.errors.map((error) => error.message).join(', ')}`;
  }

  return null;
}

/**
 * @param {{apiToken: string}} credentials
 */
export function createCloudflareClient(credentials) {
  async function call(method, path, body) {
    let payload;

    if (body !== undefined) {
      payload = JSON.stringify(body);
    }

    const data = await requestJson(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${credentials.apiToken}`, 'Content-Type': 'application/json' },
      body: payload,
      describeError,
    });

    return data.result;
  }

  return {
    async findZone(host) {
      for (const candidate of zoneCandidates(host)) {
        const zones = await call('GET', `/zones?name=${encodeURIComponent(candidate)}`);

        if (zones.length > 0) {
          return { id: zones[0].id, name: zones[0].name };
        }
      }

      return null;
    },

    async listRecords(zone, host, type) {
      const records = await call('GET', `/zones/${zone.id}/dns_records?type=${type}&name=${encodeURIComponent(host)}`);

      return records.map((record) => ({
        id: record.id,
        type: record.type,
        host,
        value: record.content,
        ttl: record.ttl,
      }));
    },

    /** Created "DNS only" (not proxied by Cloudflare). */
    async createRecord(zone, host, type, value, ttl) {
      await call('POST', `/zones/${zone.id}/dns_records`, { type, name: host, content: value, ttl, proxied: false });
    },

    /** Only the address changes: TTL and proxy status are kept as set at Cloudflare. */
    async updateRecord(zone, record, value) {
      await call('PATCH', `/zones/${zone.id}/dns_records/${record.id}`, { content: value });
    },

    async publish() {},
  };
}
