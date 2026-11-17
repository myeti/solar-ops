/**
 * Website analytics (Settings › Analytics): one connector to an analytics
 * service, Umami for now. When enabled, SolarOps shows the visits of the
 * projects (projects list, matched by their public URL) and of every website
 * (two dashboard cards), and gives projects the tracker script address as
 * ANALYTICS_URL.
 *
 * Umami (self-hosted v3, or Umami Cloud) is read with an API key, sent as
 * `Authorization: Bearer`. Its numbers are cached for CACHE_MS, so the
 * dashboard and the Analytics page never call it more than that (Umami
 * Cloud allows 50 calls every 15 seconds per key).
 */
import { encrypt, decrypt } from '../lib/crypto.js';
import { getSetting, setSetting } from './settings.js';

export const ANALYTICS_TYPES = ['umami'];

const DEFAULTS = {
  enabled: false,
  type: 'umami',
  /** Address of the Umami instance (https://umami.example.com, or https://cloud.umami.is). */
  url: '',
  apiKeyEncrypted: '',
};

const CACHE_MS = 30 * 1000;
const TIMEOUT_MS = 10000;

/** Calls to the analytics service running at once. */
const CONCURRENCY = 4;

/** Websites read at most (pages of PAGE_SIZE). */
const MAX_WEBSITES = 200;
const PAGE_SIZE = 100;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Umami Cloud: the API, the app and the script live on different hosts. */
const UMAMI_CLOUD_HOSTS = ['cloud.umami.is', 'api.umami.is'];

/** A failed call to the analytics service. */
export class AnalyticsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AnalyticsError';
  }
}

/** The summary cache: { fingerprint, at, promise }. */
let cache = null;

/**
 * The analytics connector, with defaults. The API key is never returned,
 * unless asked (to call the service).
 *
 * @param {object} [options]
 * @param {boolean} [options.withApiKey]
 */
export async function getAnalyticsSettings(options = {}) {
  const stored = { ...DEFAULTS, ...(await getSetting('analytics', {})) };
  const result = {
    enabled: stored.enabled,
    type: stored.type,
    url: stored.url,
    hasApiKey: Boolean(stored.apiKeyEncrypted),
  };

  if (options.withApiKey) {
    result.apiKey = '';

    if (stored.apiKeyEncrypted) {
      result.apiKey = decrypt(stored.apiKeyEncrypted);
    }
  }

  return result;
}

/**
 * Save the connector. An undefined `apiKey` keeps the saved one.
 */
export async function updateAnalyticsSettings({ enabled, type, url, apiKey }) {
  const stored = { ...DEFAULTS, ...(await getSetting('analytics', {})) };
  const next = { ...stored, enabled, type, url };

  if (apiKey !== undefined) {
    next.apiKeyEncrypted = encrypt(apiKey);
  }

  await setSetting('analytics', next);
  cache = null;

  return getAnalyticsSettings();
}

/**
 * Addresses of an Umami instance: its API, its app (website pages) and its
 * tracker script.
 *
 * @param {string} url the instance, as configured
 */
export function umamiEndpoints(url) {
  const base = url.replace(/\/+$/, '');

  if (UMAMI_CLOUD_HOSTS.includes(new URL(base).hostname)) {
    return {
      api: 'https://api.umami.is/v1',
      app: 'https://cloud.umami.is',
      script: 'https://cloud.umami.is/script.js',
    };
  }

  return { api: `${base}/api`, app: base, script: `${base}/script.js` };
}

/**
 * ANALYTICS_URL given to the projects: the tracker script, or null when
 * analytics are off.
 */
export async function analyticsScriptUrl() {
  const settings = await getAnalyticsSettings();

  if (!settings.enabled || !settings.url) {
    return null;
  }

  return umamiEndpoints(settings.url).script;
}

/**
 * One GET on the Umami API.
 *
 * @param {{url: string, apiKey: string}} settings
 * @param {string} path e.g. /websites
 * @param {Record<string, string|number>} [query]
 */
async function umamiGet(settings, path, query = {}) {
  const endpoint = new URL(`${umamiEndpoints(settings.url).api}${path}`);

  for (const [key, value] of Object.entries(query)) {
    endpoint.searchParams.set(key, String(value));
  }

  let response;

  try {
    response = await fetch(endpoint, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${settings.apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new AnalyticsError(`Could not reach ${endpoint.host}: ${error.message}`);
  }

  const text = await response.text();
  let data = null;

  try {
    data = JSON.parse(text);
  } catch {
    // Not JSON: an error page, or not an Umami server.
  }

  if (!response.ok) {
    let detail = response.statusText || 'request refused';

    if (data && data.error && data.error.message) {
      detail = data.error.message;
    } else if (data && typeof data.error === 'string') {
      detail = data.error;
    }

    if (response.status === 401) {
      detail = `${detail} Check the API key.`;
    }

    throw new AnalyticsError(`Umami: ${detail} (HTTP ${response.status})`);
  }

  if (data === null) {
    throw new AnalyticsError(`Umami: ${endpoint.host} did not answer JSON. Is it the address of an Umami instance?`);
  }

  return data;
}

/**
 * A count in a stats answer: a number (Umami v3), or { value } (v2).
 */
function countOf(entry) {
  if (typeof entry === 'number') {
    return entry;
  }

  if (entry && typeof entry.value === 'number') {
    return entry.value;
  }

  return 0;
}

/**
 * Every website of the account (with its teams' websites).
 */
async function listUmamiWebsites(settings) {
  const websites = [];

  for (let page = 1; websites.length < MAX_WEBSITES; page += 1) {
    const data = await umamiGet(settings, '/websites', { page, pageSize: PAGE_SIZE, includeTeams: 'true' });
    const items = data.data || [];

    websites.push(...items);

    if (items.length < PAGE_SIZE || websites.length >= (data.count || 0)) {
      break;
    }
  }

  return websites.slice(0, MAX_WEBSITES);
}

/**
 * Visitors now (last 5 minutes), and visits over the last 24 hours and the
 * last 7 days, rolling like Umami's own "Last 24 hours" view (no midnight,
 * no timezone).
 */
async function readUmamiWebsite(settings, website, now) {
  const [active, today, week] = await Promise.all([
    umamiGet(settings, `/websites/${website.id}/active`),
    umamiGet(settings, `/websites/${website.id}/stats`, { startAt: now - DAY_MS, endAt: now }),
    umamiGet(settings, `/websites/${website.id}/stats`, { startAt: now - 7 * DAY_MS, endAt: now }),
  ]);

  // { visitors } on Umami v3, { x } before.
  let activeVisitors = 0;

  if (typeof active.visitors === 'number') {
    activeVisitors = active.visitors;
  } else if (typeof active.x === 'number') {
    activeVisitors = active.x;
  }

  return { active: activeVisitors, today: countOf(today.visits), week: countOf(week.visits) };
}

/**
 * Run `work` on every item, CONCURRENCY at a time.
 */
async function mapLimited(items, work) {
  const results = new Array(items.length);
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await work(items[index]);
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));

  return results;
}

/**
 * Read the numbers of every website from Umami.
 */
async function collectSummary(settings) {
  const now = Date.now();
  const endpoints = umamiEndpoints(settings.url);
  const websites = await listUmamiWebsites(settings);

  const rows = await mapLimited(websites, async (website) => {
    const row = {
      id: website.id,
      name: website.name,
      domain: website.domain || '',
      link: `${endpoints.app}/websites/${website.id}`,
      active: null,
      today: null,
      week: null,
      error: null,
    };

    try {
      Object.assign(row, await readUmamiWebsite(settings, website, now));
    } catch (error) {
      row.error = error.message;
    }

    return row;
  });

  const totals = { active: 0, week: 0 };

  for (const row of rows) {
    totals.active += row.active || 0;
    totals.week += row.week || 0;
  }

  rows.sort((a, b) => (b.week || 0) - (a.week || 0) || a.name.localeCompare(b.name));

  return { websites: rows, totals, app: endpoints.app, fetchedAt: new Date(now).toISOString() };
}

/**
 * The numbers of every website, cached CACHE_MS. `enabled: false` when
 * analytics are off; `error` when the service could not be read.
 */
export async function getAnalyticsSummary() {
  const settings = await getAnalyticsSettings({ withApiKey: true });

  if (!settings.enabled || !settings.url || !settings.apiKey) {
    return { enabled: false };
  }

  const fingerprint = `${settings.type}|${settings.url}|${settings.apiKey}`;

  if (cache === null || cache.fingerprint !== fingerprint || Date.now() - cache.at >= CACHE_MS) {
    const promise = collectSummary(settings).then(
      (summary) => ({ ...summary, error: null }),
      (error) => ({ websites: [], totals: null, app: null, fetchedAt: new Date().toISOString(), error: error.message }),
    );

    cache = { fingerprint, at: Date.now(), promise };
  }

  return { enabled: true, type: settings.type, ...(await cache.promise) };
}

/**
 * Check a connector before saving it: list its websites.
 *
 * @param {{url: string, apiKey: string}} settings
 * @returns {Promise<{websites: number}>}
 */
export async function testAnalyticsConnector(settings) {
  const data = await umamiGet(settings, '/websites', { page: 1, pageSize: 1, includeTeams: 'true' });

  return { websites: data.count || 0 };
}
