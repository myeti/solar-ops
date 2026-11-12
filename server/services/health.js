/**
 * Liveness probe of an application after a (re)start: `GET /` on its port
 * until it answers. Any HTTP response below 500 means the app is alive
 * (an API answering 404 on / is fine); a 5xx keeps being retried until the
 * delay is over, in case the app is still warming up.
 *
 * The delay is the project's startup time (`deployment.livenessTimeoutSeconds`),
 * else SOLAROPS_LIVENESS_TIMEOUT_SECONDS.
 */
import http from 'node:http';
import config from '../config.js';
import { getProjectProcess } from './pm2.js';

const ATTEMPT_TIMEOUT_MS = 3000;
const RETRY_DELAY_MS = 1000;

/** Single check of an app that may have come up since its probe failed. */
const QUICK_CHECK_TIMEOUT_MS = 1500;

/** Bounds of a project's startup time, in seconds. */
export const MIN_STARTUP_SECONDS = 5;
export const MAX_STARTUP_SECONDS = 900;

/** pm2 states meaning the process gave up: no need to wait any longer. */
const DEAD_STATES = ['errored', 'stopped'];

/**
 * Restarts during the probe meaning the app keeps exiting (pm2 waits
 * between restarts and only gives up after many). One is tolerated: an app
 * may exit once while a dependency comes up.
 */
const CRASH_RESTARTS = 2;

/**
 * Seconds a project is given to answer after a (re)start.
 *
 * @param {import('../models/Project.js').default} project
 */
export function startupSecondsOf(project) {
  return project.deployment.livenessTimeoutSeconds ?? config.livenessTimeoutSeconds;
}

/**
 * One request to http://127.0.0.1:<port>/.
 *
 * @param {number} port
 * @param {number} [timeoutMs]
 * @returns {Promise<number>} the HTTP status (rejects when nothing answers)
 */
function requestRoot(port, timeoutMs = ATTEMPT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        host: '127.0.0.1',
        port,
        path: '/',
        timeout: timeoutMs,
        headers: { 'User-Agent': 'SolarOps liveness probe' },
      },
      (response) => {
        // The body is not needed: drain it so the socket is released.
        response.resume();
        resolve(response.statusCode);
      },
    );

    request.on('timeout', () => {
      request.destroy(new Error(`no answer within ${timeoutMs / 1000}s`));
    });
    request.on('error', reject);
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * Probe a project until it answers on / or the delay is over.
 *
 * @param {import('../models/Project.js').default} project
 * @param {object} [options]
 * @param {number} [options.timeoutMs] defaults to the project's startup time
 * @returns {Promise<{alive: boolean, crashed: boolean, url: string, status: number|null, elapsedMs: number, reason: string|null}>}
 *   crashed: the process gave up, or keeps exiting
 */
export async function probeLiveness(project, options = {}) {
  const timeoutMs = options.timeoutMs ?? startupSecondsOf(project) * 1000;
  const url = `http://127.0.0.1:${project.port}/`;
  const startedAt = Date.now();
  let status = null;
  let reason = null;
  let initialRestarts = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      status = await requestRoot(project.port);

      if (status < 500) {
        return { alive: true, crashed: false, url, status, elapsedMs: Date.now() - startedAt, reason: null };
      }

      reason = `it answers with HTTP ${status}`;
    } catch (error) {
      reason = error.message;
    }

    const processInfo = await getProjectProcess(project).catch(() => null);
    let crashReason = null;

    if (processInfo !== null) {
      if (initialRestarts === null) {
        initialRestarts = processInfo.restarts;
      }

      const restarts = processInfo.restarts - initialRestarts;

      if (DEAD_STATES.includes(processInfo.status)) {
        crashReason = `the process is ${processInfo.status}`;
      } else if (restarts >= CRASH_RESTARTS) {
        crashReason = `the process keeps exiting (restarted ${restarts} times by pm2)`;
      }
    }

    if (crashReason !== null) {
      return { alive: false, crashed: true, url, status, elapsedMs: Date.now() - startedAt, reason: crashReason };
    }

    await wait(RETRY_DELAY_MS);
  }

  return { alive: false, crashed: false, url, status, elapsedMs: Date.now() - startedAt, reason };
}

/**
 * Whether the app answers on / right now (one short request).
 *
 * @param {import('../models/Project.js').default} project
 * @returns {Promise<boolean>}
 */
export async function answersNow(project) {
  try {
    const status = await requestRoot(project.port, QUICK_CHECK_TIMEOUT_MS);

    return status < 500;
  } catch {
    return false;
  }
}

/**
 * One line describing a probe result.
 *
 * @param {Awaited<ReturnType<typeof probeLiveness>>} result
 */
export function describeLiveness(result) {
  const seconds = (result.elapsedMs / 1000).toFixed(1);

  if (result.alive) {
    return `${result.url} answers (HTTP ${result.status}) after ${seconds}s.`;
  }

  return `${result.url} did not answer within ${seconds}s (${result.reason}).`;
}
