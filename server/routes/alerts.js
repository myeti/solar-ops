/**
 * Alerts (System › Alerts): settings, current state and a test e-mail.
 * See services/alerts.js.
 */
import express from 'express';
import { Admin } from '../models/index.js';
import { badRequest } from '../lib/errors.js';
import { Validator } from '../lib/validation.js';
import {
  ALERT_RULES,
  getAlertSettings,
  presentAlertState,
  sendTestAlert,
  updateAlertSettings,
} from '../services/alerts.js';
import { recordAudit } from '../services/audit.js';
import { getSystemMailRelay } from '../services/systemProject.js';

const router = express.Router();

async function alertsResponse() {
  const relay = await getSystemMailRelay();
  const admins = await Admin.findAll({ attributes: ['email'], order: [['email', 'ASC']] });
  let relaySummary = null;

  if (relay !== null) {
    relaySummary = { id: relay.id, name: relay.name, fromAddress: relay.fromAddress };
  }

  return {
    settings: await getAlertSettings(),
    rules: ALERT_RULES.map(({ id, label, description }) => ({ id, label, description })),
    relay: relaySummary,
    recipients: admins.map((admin) => admin.email),
    state: presentAlertState(),
  };
}

router.get('/', async (req, res) => {
  res.json(await alertsResponse());
});

/**
 * Body: { enabled, rules: { <rule id>: boolean } }
 */
router.put('/', async (req, res) => {
  const input = new Validator(req.body);
  const enabled = input.boolean('enabled', { required: true });
  input.assertValid();

  const rules = {};
  const given = req.body.rules || {};

  for (const rule of ALERT_RULES) {
    if (given[rule.id] !== undefined && typeof given[rule.id] !== 'boolean') {
      throw badRequest(`The rule "${rule.id}" must be on or off.`, { fields: { rules: 'Invalid rule value.' } });
    }

    if (typeof given[rule.id] === 'boolean') {
      rules[rule.id] = given[rule.id];
    }
  }

  const settings = await updateAlertSettings({ enabled, rules });
  await recordAudit({ req, action: 'alerts.update', details: settings });

  res.json(await alertsResponse());
});

/**
 * Send a test e-mail to every administrator.
 */
router.post('/test', async (req, res) => {
  const result = await sendTestAlert();
  await recordAudit({ req, action: 'alerts.test', details: { sent: result.sent, error: result.error } });

  res.json(result);
});

export default router;
