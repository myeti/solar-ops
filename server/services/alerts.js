/**
 * Alerts: e-mails to every administrator when the server or a project needs
 * attention, sent through SolarOps's own mail relay (Projects › SolarOps ›
 * Mail, the relay of the magic links).
 *
 * The scheduler runs a check every SOLAROPS_ALERT_CHECK_SECONDS (60). Each
 * enabled rule reports conditions (a key, a title, a message); a condition
 * holding for its rule's number of checks in a row opens an alert, an open
 * alert whose condition is gone is resolved. What opened or resolved during
 * one check is sent in one e-mail.
 *
 * Alert state, history and restart samples live in memory only: after a
 * restart of SolarOps, an ongoing problem is reported again.
 */
import os from 'node:os';
import config from '../config.js';
import logger from '../lib/logger.js';
import { Admin, Project, Task } from '../models/index.js';
import { recordAudit } from './audit.js';
import { answersNow, startupSecondsOf } from './health.js';
import { escapeHtml, sendMail } from './mailer.js';
import { getProcessMap } from './pm2.js';
import { memoryUsage, sampleCpu, storageUsage } from './serverMetrics.js';
import { getSetting, setSetting } from './settings.js';
import { runHealthChecks } from './system.js';
import { getPublicUrl, getSystemMailRelay } from './systemProject.js';

const SETTINGS_KEY = 'alerts';

const STORAGE_PERCENT = 80;
/** A measured average hardly reads exactly 100%. */
const CPU_PERCENT = 99;
const MEMORY_PERCENT = 99;

/** The health checks start processes (and nginx -t): not every minute. */
const HEALTH_INTERVAL_MS = 5 * 60 * 1000;

/** pm2 restarting a project this many times within the window: it keeps crashing. */
const RESTART_COUNT = 3;
const RESTART_WINDOW_MS = 15 * 60 * 1000;

const HISTORY_SIZE = 50;

/**
 * The rules. `checks`: checks in a row a condition must hold before its
 * alert opens.
 */
export const ALERT_RULES = [
  {
    id: 'storage',
    label: 'Storage',
    description: `The disk holding the projects is ${STORAGE_PERCENT}% full or more.`,
    checks: 1,
  },
  {
    id: 'cpu',
    label: 'CPU',
    description: `CPU usage at ${CPU_PERCENT}% or more on average over a check, 3 checks in a row.`,
    checks: 3,
  },
  {
    id: 'memory',
    label: 'Memory',
    description: `Memory ${MEMORY_PERCENT}% used or more, 2 checks in a row.`,
    checks: 2,
  },
  {
    id: 'health',
    label: 'Server health',
    description:
      'A check of Projects › SolarOps fails (nginx, pm2, certbot, PostgreSQL…), twice in a row. Checked every 5 minutes.',
    checks: 2,
  },
  {
    id: 'projects',
    label: 'Projects',
    description:
      'An active application exposed on a domain does not answer on /, or is not running, 2 checks in a row (not while a task runs for it, nor during its startup time).',
    checks: 2,
  },
  {
    id: 'restarts',
    label: 'Unstable restarts',
    description: `pm2 restarted a project ${RESTART_COUNT} times or more within ${RESTART_WINDOW_MS / 60000} minutes: it keeps crashing.`,
    checks: 1,
  },
];

const RULES_BY_ID = new Map(ALERT_RULES.map((rule) => [rule.id, rule]));

const state = {
  /** Open alerts, by key. */
  open: new Map(),
  /** Conditions not open yet: checks in a row they held, by key. */
  pending: new Map(),
  /** Last sends, newest first. */
  history: [],
  /** pm2 restart counters of each project, within the window: uid => [{at, restarts}]. */
  restartSamples: new Map(),
  cpuSample: null,
  lastCheckAt: null,
  lastHealthAt: 0,
  running: false,
};

function isoDate(time) {
  return new Date(time).toISOString();
}

function formatBytes(value) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 0;

  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }

  return `${size.toFixed(1)} ${units[unit]}`;
}

function formatDuration(milliseconds) {
  const minutes = Math.round(milliseconds / 60000);

  if (minutes < 1) {
    return 'less than a minute';
  }

  if (minutes < 120) {
    return `${minutes} min`;
  }

  return `${Math.round(minutes / 60)} h`;
}

// ─────────────────────────────── Settings ───────────────────────────────

function defaultRules() {
  return Object.fromEntries(ALERT_RULES.map((rule) => [rule.id, true]));
}

/**
 * Whether alerts are sent, and which rules are on (all by default).
 *
 * @returns {Promise<{enabled: boolean, rules: Record<string, boolean>}>}
 */
export async function getAlertSettings() {
  const stored = (await getSetting(SETTINGS_KEY, null)) || {};
  const rules = defaultRules();

  for (const rule of ALERT_RULES) {
    if (stored.rules && typeof stored.rules[rule.id] === 'boolean') {
      rules[rule.id] = stored.rules[rule.id];
    }
  }

  return { enabled: stored.enabled === true, rules };
}

/**
 * @param {{enabled: boolean, rules: Record<string, boolean>}} settings
 */
export async function updateAlertSettings({ enabled, rules }) {
  const current = await getAlertSettings();
  const next = { enabled, rules: { ...current.rules } };

  for (const rule of ALERT_RULES) {
    if (typeof rules[rule.id] === 'boolean') {
      next.rules[rule.id] = rules[rule.id];
    }
  }

  await setSetting(SETTINGS_KEY, next);

  if (!enabled) {
    state.open.clear();
    state.pending.clear();
  }

  return next;
}

// ─────────────────────────────── Conditions ─────────────────────────────

/**
 * CPU usage since the previous check, in percent (null on the first one).
 */
function cpuPercentSinceLastCheck() {
  const current = sampleCpu();
  const previous = state.cpuSample;
  state.cpuSample = current;

  if (previous === null || current.total <= previous.total) {
    return null;
  }

  const total = current.total - previous.total;
  const busy = total - (current.idle - previous.idle);

  return Math.round((busy / total) * 1000) / 10;
}

/**
 * Storage, CPU and memory conditions.
 *
 * @param {{storage: number|null, cpu: number|null, memory: {used: number, total: number}|null, disk: object|null}} metrics
 * @param {Set<string>} rules enabled rules
 */
export function resourceConditions(metrics, rules) {
  const conditions = [];
  const disk = metrics.disk;

  if (rules.has('storage') && disk && disk.total > 0) {
    const percent = Math.round((disk.used / disk.total) * 100);

    if (percent >= STORAGE_PERCENT) {
      conditions.push({
        key: 'storage',
        rule: 'storage',
        title: `Storage ${percent}% full`,
        message: `${disk.path}: ${formatBytes(disk.used)} used of ${formatBytes(disk.total)}.`,
      });
    }
  }

  if (rules.has('cpu') && metrics.cpu !== null && metrics.cpu >= CPU_PERCENT) {
    conditions.push({
      key: 'cpu',
      rule: 'cpu',
      title: `CPU at ${Math.round(metrics.cpu)}%`,
      message: `Average since the previous check, ${os.cpus().length} cores, load average ${os.loadavg()[0].toFixed(2)}.`,
    });
  }

  const memory = metrics.memory;

  if (rules.has('memory') && memory && memory.total > 0) {
    const percent = Math.round((memory.used / memory.total) * 100);

    if (percent >= MEMORY_PERCENT) {
      conditions.push({
        key: 'memory',
        rule: 'memory',
        title: `Memory ${percent}% used`,
        message: `${formatBytes(memory.used)} used of ${formatBytes(memory.total)}.`,
      });
    }
  }

  return conditions;
}

async function healthConditions() {
  const { checks } = await runHealthChecks();

  return checks
    .filter((check) => !check.ok)
    .map((check) => ({
      key: `health:${check.id}`,
      rule: 'health',
      title: `${check.label} check fails`,
      message: `${check.purpose}: ${check.message}`,
    }));
}

/**
 * Active applications exposed on a domain that are not running or do not
 * answer. Projects that cannot be judged now (a task runs, still starting)
 * are returned as unknown: their state is kept as is.
 *
 * @param {Map<string, object>} processes pm2 processes, by name
 */
async function projectConditions(processes) {
  const projects = await Project.findAll({ where: { active: true, system: false } });
  const tasks = await Task.findAll({ where: { status: ['queued', 'running'] }, attributes: ['projectId'] });
  const busy = new Set(tasks.map((task) => task.projectId));
  const conditions = [];
  const unknown = [];

  await Promise.all(
    projects.map(async (project) => {
      const network = project.network;
      const key = `project:${project.uid}`;

      if (project.isStatic || !network.enabled || !network.domain) {
        return;
      }

      if (busy.has(project.id)) {
        unknown.push(key);
        return;
      }

      const processInfo = processes.get(project.uid) || null;

      if (processInfo === null || processInfo.status !== 'online') {
        let status = 'not running';

        if (processInfo !== null) {
          status = processInfo.status;
        }

        conditions.push({
          key,
          rule: 'projects',
          title: `${project.name} is down`,
          message: `${network.domain}: the process is ${status}.`,
        });
        return;
      }

      if (processInfo.uptimeMs !== null && processInfo.uptimeMs < startupSecondsOf(project) * 1000) {
        unknown.push(key);
        return;
      }

      if (!(await answersNow(project))) {
        conditions.push({
          key,
          rule: 'projects',
          title: `${project.name} does not answer`,
          message: `${network.domain}: nothing answers on http://127.0.0.1:${project.port}/ (or an HTTP 5xx).`,
        });
      }
    }),
  );

  return { conditions, unknown };
}

/**
 * Projects pm2 restarted too often lately. SolarOps (re)starts a project by
 * recreating its pm2 process, which resets the counter: what increases it
 * is pm2 restarting an app that exited.
 *
 * @param {Map<string, object>} processes pm2 processes, by name
 * @param {number} now
 */
async function restartConditions(processes, now) {
  const projects = await Project.findAll({ where: { system: false } });
  const conditions = [];
  const seen = new Set();

  for (const project of projects) {
    const processInfo = processes.get(project.uid);

    if (!processInfo) {
      continue;
    }

    seen.add(project.uid);

    let samples = state.restartSamples.get(project.uid) || [];
    const last = samples[samples.length - 1];

    if (last && processInfo.restarts < last.restarts) {
      samples = [];
    }

    samples.push({ at: now, restarts: processInfo.restarts });
    samples = samples.filter((sample) => sample.at >= now - RESTART_WINDOW_MS);
    state.restartSamples.set(project.uid, samples);

    const restarts = samples[samples.length - 1].restarts - samples[0].restarts;

    if (restarts >= RESTART_COUNT) {
      conditions.push({
        key: `restarts:${project.uid}`,
        rule: 'restarts',
        title: `${project.name} keeps restarting`,
        message: `pm2 restarted it ${restarts} times in the last ${RESTART_WINDOW_MS / 60000} minutes: it keeps exiting. Check its logs.`,
      });
    }
  }

  for (const uid of state.restartSamples.keys()) {
    if (!seen.has(uid)) {
      state.restartSamples.delete(uid);
    }
  }

  return conditions;
}

/**
 * Evaluate every enabled rule. A rule that could not be evaluated (pm2
 * unreachable, health checks not due yet...) keeps its alerts as they are.
 *
 * @param {Set<string>} rules enabled rules
 * @param {number} now
 */
async function collect(rules, now) {
  const conditions = [];
  const unknown = [];
  const evaluated = new Set();
  const cpu = cpuPercentSinceLastCheck();
  const [memory, disk] = await Promise.all([memoryUsage(), storageUsage()]);

  conditions.push(...resourceConditions({ cpu, memory, disk }, rules));
  evaluated.add('memory');

  // Unreadable disk, or no CPU baseline yet: their alerts are kept as is.
  if (disk !== null) {
    evaluated.add('storage');
  }

  if (cpu !== null) {
    evaluated.add('cpu');
  }

  if (rules.has('health') && now - state.lastHealthAt >= HEALTH_INTERVAL_MS - 5000) {
    try {
      conditions.push(...(await healthConditions()));
      evaluated.add('health');
      state.lastHealthAt = now;
    } catch (error) {
      logger.warn('Alerts: the health checks failed', { error: error.message });
    }
  }

  if (rules.has('projects') || rules.has('restarts')) {
    const { processes, error } = await getProcessMap();

    if (error) {
      logger.warn('Alerts: pm2 is unreachable, projects not checked', { error });
    } else {
      if (rules.has('projects')) {
        const result = await projectConditions(processes);
        conditions.push(...result.conditions);
        unknown.push(...result.unknown);
        evaluated.add('projects');
      }

      if (rules.has('restarts')) {
        conditions.push(...(await restartConditions(processes, now)));
        evaluated.add('restarts');
      }
    }
  }

  return { conditions, evaluated, unknown: new Set(unknown) };
}

// ─────────────────────────────── State ──────────────────────────────────

/**
 * Move the alert state one check forward.
 *
 * @param {{conditions: object[], evaluated: Set<string>, unknown: Set<string>}} evaluation
 * @param {number} now
 * @returns {{opened: object[], resolved: object[]}}
 */
export function advanceAlerts({ conditions, evaluated, unknown }, now) {
  const opened = [];
  const resolved = [];
  const holding = new Map(conditions.map((condition) => [condition.key, condition]));

  for (const condition of conditions) {
    const open = state.open.get(condition.key);

    if (open) {
      open.title = condition.title;
      open.message = condition.message;
      continue;
    }

    const count = (state.pending.get(condition.key)?.count || 0) + 1;
    const rule = RULES_BY_ID.get(condition.rule);

    if (count >= rule.checks) {
      const alert = { ...condition, since: isoDate(now) };

      state.pending.delete(condition.key);
      state.open.set(condition.key, alert);
      opened.push(alert);
    } else {
      state.pending.set(condition.key, { rule: condition.rule, count });
    }
  }

  for (const [key, pending] of state.pending) {
    if (!holding.has(key) && !unknown.has(key) && evaluated.has(pending.rule)) {
      state.pending.delete(key);
    }
  }

  for (const [key, alert] of state.open) {
    if (holding.has(key) || unknown.has(key) || !evaluated.has(alert.rule)) {
      continue;
    }

    state.open.delete(key);
    resolved.push({ ...alert, resolvedAt: isoDate(now) });
  }

  return { opened, resolved };
}

/** Forget the alerts of rules turned off (without e-mail). */
function dropDisabledRules(rules) {
  for (const [key, alert] of state.open) {
    if (!rules.has(alert.rule)) {
      state.open.delete(key);
    }
  }

  for (const [key, pending] of state.pending) {
    if (!rules.has(pending.rule)) {
      state.pending.delete(key);
    }
  }
}

// ─────────────────────────────── E-mails ────────────────────────────────

async function serverLabel() {
  const publicUrl = await getPublicUrl().catch(() => null);

  if (publicUrl) {
    return { name: new URL(publicUrl).hostname, alertsUrl: `${publicUrl.replace(/\/+$/, '')}/alerts` };
  }

  return { name: os.hostname(), alertsUrl: null };
}

function subjectOf({ opened, resolved, test }, server) {
  if (test) {
    return `[SolarOps] Test alert from ${server.name}`;
  }

  let first = `Resolved: ${resolved[0]?.title}`;
  let count = opened.length + resolved.length;

  if (opened.length > 0) {
    first = opened[0].title;
    count = opened.length;
  }

  let more = '';

  if (count > 1) {
    more = ` (+${count - 1} more)`;
  }

  return `[SolarOps] ${first}${more} on ${server.name}`;
}

/**
 * Text and HTML of an alert e-mail.
 */
function composeMessage({ opened, resolved, test }, server) {
  const sections = [];

  if (test) {
    sections.push({
      heading: 'Test',
      items: [{ title: 'Alerts work', message: 'This test e-mail was sent from System › Alerts.' }],
    });
  }

  if (opened.length > 0) {
    sections.push({ heading: 'New alerts', items: opened });
  }

  if (resolved.length > 0) {
    sections.push({
      heading: 'Resolved',
      items: resolved.map((alert) => ({
        title: alert.title,
        message: `Back to normal after ${formatDuration(Date.parse(alert.resolvedAt) - Date.parse(alert.since))}.`,
      })),
    });
  }

  const text = [`SolarOps on ${server.name}`, ''];
  const html = [
    '<div style="font-family:Inter,system-ui,sans-serif;background:#0c0c10;color:#f4f4f5;padding:32px;border-radius:12px">',
    `<h2 style="margin-top:0;font-weight:600">SolarOps · ${escapeHtml(server.name)}</h2>`,
  ];

  for (const section of sections) {
    text.push(`${section.heading}:`);
    html.push(`<h3 style="margin:24px 0 8px;font-size:14px;color:#a1a1aa">${escapeHtml(section.heading)}</h3>`);

    for (const item of section.items) {
      text.push(`- ${item.title}: ${item.message}`);
      html.push(
        `<p style="margin:0 0 10px"><strong>${escapeHtml(item.title)}</strong><br>`,
        `<span style="color:#d4d4d8">${escapeHtml(item.message)}</span></p>`,
      );
    }

    text.push('');
  }

  if (server.alertsUrl) {
    text.push(`Alerts: ${server.alertsUrl}`);
    html.push(
      `<p style="margin-top:24px"><a href="${escapeHtml(server.alertsUrl)}" style="color:#a5b4fc">Open System › Alerts</a></p>`,
    );
  }

  html.push(
    '<p style="color:#71717a;font-size:12px;margin-top:24px">Sent to every SolarOps administrator. Turn alerts off in System › Alerts.</p>',
    '</div>',
  );

  return { text: text.join('\n'), html: html.join('') };
}

/**
 * Send an alert e-mail to every administrator.
 *
 * @returns {Promise<{sent: number, failures: Array<{email: string, error: string}>, error: string|null}>}
 */
async function deliver(changes) {
  const relay = await getSystemMailRelay();

  if (relay === null) {
    return { sent: 0, failures: [], error: 'No mail relay: choose one in Projects › SolarOps › Mail.' };
  }

  const admins = await Admin.findAll({ attributes: ['email'], order: [['email', 'ASC']] });
  const server = await serverLabel();
  const subject = subjectOf(changes, server);
  const { text, html } = composeMessage(changes, server);
  const failures = [];
  let sent = 0;

  for (const admin of admins) {
    try {
      await sendMail(relay, { to: admin.email, subject, text, html });
      sent += 1;
    } catch (error) {
      failures.push({ email: admin.email, error: error.message });
    }
  }

  let error = null;

  if (failures.length > 0) {
    error = `${failures.length} of ${admins.length} e-mail(s) failed: ${failures[0].error}`;
  }

  return { sent, failures, error };
}

function summary(alert) {
  return { key: alert.key, rule: alert.rule, title: alert.title, message: alert.message };
}

async function notify(changes, now) {
  const delivery = await deliver(changes);
  const event = {
    at: isoDate(now),
    opened: changes.opened.map(summary),
    resolved: changes.resolved.map(summary),
    sent: delivery.sent,
    error: delivery.error,
  };

  state.history.unshift(event);
  state.history.length = Math.min(state.history.length, HISTORY_SIZE);

  let action = 'alerts.sent';

  if (delivery.sent === 0) {
    action = 'alerts.failed';
  }

  await recordAudit({
    actor: 'alerts',
    action,
    target: changes.opened.concat(changes.resolved)[0]?.title,
    details: {
      opened: event.opened.map((alert) => alert.title),
      resolved: event.resolved.map((alert) => alert.title),
      sent: delivery.sent,
      error: delivery.error,
    },
  });

  if (delivery.error) {
    logger.warn(`Alerts: ${delivery.error}`);
  }
}

/**
 * Send a test e-mail to every administrator.
 */
export async function sendTestAlert() {
  return deliver({ opened: [], resolved: [], test: true });
}

// ─────────────────────────────── Check ──────────────────────────────────

/**
 * One check (run by the scheduler).
 *
 * @param {number} [now]
 */
export async function runAlertCheck(now = Date.now()) {
  if (state.running) {
    return;
  }

  state.running = true;

  try {
    const settings = await getAlertSettings();

    if (!settings.enabled) {
      // Keep the CPU baseline fresh for when alerts are turned on.
      cpuPercentSinceLastCheck();
      return;
    }

    const rules = new Set(ALERT_RULES.filter((rule) => settings.rules[rule.id]).map((rule) => rule.id));

    dropDisabledRules(rules);

    const evaluation = await collect(rules, now);
    const changes = advanceAlerts(evaluation, now);

    state.lastCheckAt = isoDate(now);

    if (changes.opened.length > 0 || changes.resolved.length > 0) {
      await notify(changes, now);
    }
  } finally {
    state.running = false;
  }
}

/**
 * What the Alerts page shows.
 */
export function presentAlertState() {
  return {
    intervalSeconds: config.alertCheckSeconds,
    lastCheckAt: state.lastCheckAt,
    open: [...state.open.values()].sort((a, b) => a.since.localeCompare(b.since)),
    history: state.history,
  };
}
