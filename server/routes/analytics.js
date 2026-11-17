/**
 * Website analytics: the connector (Settings › Analytics) and the visits of
 * every website (dashboard) and project (projects list).
 */
import express from 'express';
import { Project } from '../models/index.js';
import { badRequest } from '../lib/errors.js';
import { Validator } from '../lib/validation.js';
import {
  ANALYTICS_TYPES,
  getAnalyticsSettings,
  getAnalyticsSummary,
  testAnalyticsConnector,
  updateAnalyticsSettings,
} from '../services/analytics.js';
import { recordAudit } from '../services/audit.js';

const router = express.Router();

const URL_PATTERN = /^https?:\/\/[^\s/?#]+(?:\/[^\s?#]*)?$/i;

/**
 * Validate the connector form. An empty API key keeps the saved one.
 */
function readConnector(body) {
  const input = new Validator(body);
  const connector = {
    type: input.oneOf('type', ANALYTICS_TYPES, { required: true }),
    url: input.string('url', {
      required: true,
      max: 253,
      pattern: URL_PATTERN,
      patternMessage: 'An address like https://umami.example.com.',
    }),
    apiKey: input.string('apiKey', { max: 512 }),
  };
  input.assertValid();

  connector.url = connector.url.replace(/\/+$/, '');

  return connector;
}

router.get('/settings', async (req, res) => {
  res.json({ settings: await getAnalyticsSettings(), types: ANALYTICS_TYPES });
});

/**
 * Body: { enabled, type, url, apiKey }
 */
router.put('/settings', async (req, res) => {
  const input = new Validator(req.body);
  const enabled = input.boolean('enabled', { required: true });
  input.assertValid();

  const connector = readConnector(req.body);
  const saved = await getAnalyticsSettings();

  if (enabled && connector.apiKey === undefined && !saved.hasApiKey) {
    throw badRequest('An API key is needed to read the statistics.', { fields: { apiKey: 'Required.' } });
  }

  const settings = await updateAnalyticsSettings({ enabled, ...connector });
  await recordAudit({
    req,
    action: 'analytics.update',
    details: { enabled, type: connector.type, url: connector.url, apiKeyChanged: connector.apiKey !== undefined },
  });

  res.json({ settings, types: ANALYTICS_TYPES });
});

/**
 * Check a connector before saving it (an empty API key uses the saved one).
 */
router.post('/test', async (req, res) => {
  const connector = readConnector(req.body);

  if (connector.apiKey === undefined) {
    connector.apiKey = (await getAnalyticsSettings({ withApiKey: true })).apiKey;
  }

  if (!connector.apiKey) {
    throw badRequest('An API key is needed to read the statistics.', { fields: { apiKey: 'Required.' } });
  }

  try {
    res.json({ ok: true, ...(await testAnalyticsConnector(connector)) });
  } catch (error) {
    res.json({ ok: false, error: error.message });
  }
});

/**
 * The host of a website's domain as Umami keeps it ("example.com", or at
 * times "https://example.com/"), lower-cased.
 */
function hostOf(domain) {
  return String(domain || '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.$/, '');
}

/**
 * The host of a project's PUBLIC_URL (see services/environment.js), or null.
 */
function publicHostOf(project) {
  const network = project.network;

  if (!network.enabled || !network.domain || network.domain.includes('*')) {
    return null;
  }

  return network.domain.toLowerCase();
}

/**
 * The numbers of every website, and of every project whose public URL is
 * the domain of a website: `projects` by uid.
 */
router.get('/', async (req, res) => {
  const summary = await getAnalyticsSummary();

  if (!summary.enabled || summary.error) {
    res.json(summary);
    return;
  }

  const byHost = new Map();

  for (const website of summary.websites) {
    const host = hostOf(website.domain);

    if (host && !byHost.has(host)) {
      byHost.set(host, website);
    }
  }

  const projects = {};

  for (const project of await Project.findAll()) {
    const website = byHost.get(publicHostOf(project));

    if (website) {
      projects[project.uid] = {
        websiteId: website.id,
        name: website.name,
        link: website.link,
        active: website.active,
        today: website.today,
        week: website.week,
        error: website.error,
      };
    }
  }

  res.json({ ...summary, projects });
});

export default router;
