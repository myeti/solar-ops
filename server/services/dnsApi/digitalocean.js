/**
 * DigitalOcean API client (domains), for the access token of a DNS account
 * (write scope). Record names are relative to the domain ("@" for the
 * apex). Changes are live right away.
 */
import { requestJson, relativeName, zoneCandidates } from './http.js';

const BASE = 'https://api.digitalocean.com/v2';

function describeError(data) {
  if (data && typeof data === 'object' && data.message) {
    return `DigitalOcean: ${data.message}`;
  }

  return null;
}

/**
 * @param {{token: string}} credentials
 */
export function createDigitalOceanClient(credentials) {
  async function call(method, path, body) {
    let payload;

    if (body !== undefined) {
      payload = JSON.stringify(body);
    }

    return requestJson(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${credentials.token}`, 'Content-Type': 'application/json' },
      body: payload,
      describeError,
    });
  }

  /** DigitalOcean name of a host: "@" for the apex. */
  function recordName(host, zone) {
    const name = relativeName(host, zone.name);

    if (name === '') {
      return '@';
    }

    return name;
  }

  return {
    async findZone(host) {
      for (const candidate of zoneCandidates(host)) {
        try {
          const data = await call('GET', `/domains/${encodeURIComponent(candidate)}`);

          return { id: data.domain.name, name: data.domain.name };
        } catch (error) {
          if (error.status !== 404) {
            throw error;
          }
        }
      }

      return null;
    },

    async listRecords(zone, host, type) {
      const path = `/domains/${encodeURIComponent(zone.name)}/records?type=${type}&name=${encodeURIComponent(host)}&per_page=200`;
      const data = await call('GET', path);
      const expected = recordName(host, zone);

      return data.domain_records
        .filter((record) => record.name === expected)
        .map((record) => ({ id: record.id, type: record.type, host, value: record.data, ttl: record.ttl }));
    },

    async createRecord(zone, host, type, value, ttl) {
      await call('POST', `/domains/${encodeURIComponent(zone.name)}/records`, {
        type,
        name: recordName(host, zone),
        data: value,
        ttl,
      });
    },

    async updateRecord(zone, record, value, ttl) {
      await call('PATCH', `/domains/${encodeURIComponent(zone.name)}/records/${record.id}`, {
        type: record.type,
        data: value,
        ttl,
      });
    },

    async publish() {},
  };
}
