/**
 * Shared helpers of the DNS provider API clients: JSON over HTTPS with a
 * timeout and readable errors, and domain name helpers.
 */

const TIMEOUT_MS = 15000;

/** An API call that failed: `status` is the HTTP status (0 when unreachable). */
export class DnsApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'DnsApiError';
    this.status = status;
  }
}

/**
 * Call a JSON API.
 *
 * @param {string} url
 * @param {object} options
 * @param {string} [options.method]
 * @param {object} [options.headers]
 * @param {string} [options.body] already serialized
 * @param {(data: any) => string|null} options.describeError message of an error response
 * @returns {Promise<any>} parsed JSON (null for an empty body)
 */
export async function requestJson(url, { method = 'GET', headers = {}, body, describeError }) {
  let response;

  try {
    response = await fetch(url, {
      method,
      headers: { Accept: 'application/json', ...headers },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new DnsApiError(`Could not reach ${new URL(url).host}: ${error.message}`, 0);
  }

  const text = await response.text();
  let data = null;

  if (text !== '') {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const detail = describeError(data) || response.statusText || 'request refused';

    throw new DnsApiError(`${detail} (HTTP ${response.status})`, response.status);
  }

  return data;
}

/**
 * Zones that could hold a host, most specific first:
 * a.b.example.com => a.b.example.com, b.example.com, example.com.
 *
 * @param {string} host
 */
export function zoneCandidates(host) {
  const labels = host.replace(/^\*\./, '').split('.');
  const candidates = [];

  for (let index = 0; index < labels.length - 1; index += 1) {
    candidates.push(labels.slice(index).join('.'));
  }

  return candidates;
}

/**
 * The zone holding a host among a list of zone names (the longest match).
 *
 * @param {string} host
 * @param {string[]} zoneNames
 * @returns {string|null}
 */
export function longestZoneOf(host, zoneNames) {
  const names = zoneNames.map((name) => name.toLowerCase());

  for (const candidate of zoneCandidates(host)) {
    if (names.includes(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Name of a host relative to its zone: "" for the apex, "app", "*"...
 *
 * @param {string} host
 * @param {string} zone
 */
export function relativeName(host, zone) {
  if (host === zone) {
    return '';
  }

  return host.slice(0, -(zone.length + 1));
}
