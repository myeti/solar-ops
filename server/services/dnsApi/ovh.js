/**
 * OVHcloud API client (DNS zones), for the credentials of a DNS account.
 *
 * Every request is signed: "$1$" + SHA-1 of
 * applicationSecret+consumerKey+METHOD+url+body+timestamp, the timestamp
 * coming from OVH's clock (/auth/time) to survive a drifting server clock.
 * Changes to a zone are only live after POST /domain/zone/{zone}/refresh.
 */
import crypto from 'node:crypto';
import { DnsApiError, longestZoneOf, relativeName, requestJson } from './http.js';

const ENDPOINTS = {
  'ovh-eu': 'https://eu.api.ovh.com/1.0',
  'ovh-ca': 'https://ca.api.ovh.com/1.0',
  'ovh-us': 'https://api.us.ovhcloud.com/1.0',
  'kimsufi-eu': 'https://eu.api.kimsufi.com/1.0',
  'kimsufi-ca': 'https://ca.api.kimsufi.com/1.0',
  'soyoustart-eu': 'https://eu.api.soyoustart.com/1.0',
  'soyoustart-ca': 'https://ca.api.soyoustart.com/1.0',
};

function describeError(data) {
  if (data && typeof data === 'object' && data.message) {
    return `OVHcloud: ${data.message}`;
  }

  return null;
}

/**
 * @param {{endpoint: string, applicationKey: string, applicationSecret: string, consumerKey: string}} credentials
 */
export function createOvhClient(credentials) {
  const base = ENDPOINTS[credentials.endpoint];
  let clockOffset = null;

  if (!base) {
    throw new DnsApiError(`Unknown OVHcloud endpoint "${credentials.endpoint}".`, 0);
  }

  /** Current time on OVH's clock, in seconds. */
  async function timestamp() {
    if (clockOffset === null) {
      const ovhTime = await requestJson(`${base}/auth/time`, { describeError });
      clockOffset = Number(ovhTime) - Math.floor(Date.now() / 1000);
    }

    return Math.floor(Date.now() / 1000) + clockOffset;
  }

  async function call(method, path, body) {
    const url = `${base}${path}`;
    let payload = '';

    if (body !== undefined) {
      payload = JSON.stringify(body);
    }

    const time = String(await timestamp());
    const signed = [credentials.applicationSecret, credentials.consumerKey, method, url, payload, time].join('+');
    const signature = `$1$${crypto.createHash('sha1').update(signed).digest('hex')}`;
    const headers = {
      'Content-Type': 'application/json',
      'X-Ovh-Application': credentials.applicationKey,
      'X-Ovh-Consumer': credentials.consumerKey,
      'X-Ovh-Timestamp': time,
      'X-Ovh-Signature': signature,
    };

    let requestBody;

    if (payload !== '') {
      requestBody = payload;
    }

    return requestJson(url, { method, headers, body: requestBody, describeError });
  }

  function zonePath(zone) {
    return `/domain/zone/${encodeURIComponent(zone.name)}`;
  }

  return {
    async findZone(host) {
      const zones = await call('GET', '/domain/zone');
      const name = longestZoneOf(host, zones);

      if (name === null) {
        return null;
      }

      return { id: name, name };
    },

    async listRecords(zone, host, type) {
      const subDomain = relativeName(host, zone.name);
      let query = `fieldType=${type}`;

      // An empty subDomain filter is ignored by OVH: the apex is filtered below.
      if (subDomain !== '') {
        query = `${query}&subDomain=${encodeURIComponent(subDomain)}`;
      }

      const ids = await call('GET', `${zonePath(zone)}/record?${query}`);
      const records = [];

      for (const id of ids) {
        const record = await call('GET', `${zonePath(zone)}/record/${id}`);

        if (record.subDomain === subDomain) {
          records.push({ id: record.id, type: record.fieldType, host, value: record.target, ttl: record.ttl });
        }
      }

      return records;
    },

    async createRecord(zone, host, type, value, ttl) {
      await call('POST', `${zonePath(zone)}/record`, {
        fieldType: type,
        subDomain: relativeName(host, zone.name),
        target: value,
        ttl,
      });
    },

    async updateRecord(zone, record, value, ttl) {
      await call('PUT', `${zonePath(zone)}/record/${record.id}`, { target: value, ttl });
    },

    /** Changes are applied to the zone (OVH only). */
    async publish(zone) {
      await call('POST', `${zonePath(zone)}/refresh`);
    },
  };
}
