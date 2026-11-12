/**
 * Resources of the whole server, for the dashboard: CPU usage, memory and
 * the disk holding the projects (base folder).
 *
 * CPU usage is measured between two calls (the dashboard refreshes every
 * few seconds), or over a short sample for the first call.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import { readFileOrNull } from '../lib/files.js';
import { getGeneralSettings } from './settings.js';

/** Shortest window measuring the CPU usage (a shorter one is too noisy). */
const MIN_CPU_WINDOW_MS = 1000;
/** A previous sample older than this is not used (idle dashboard). */
const MAX_CPU_WINDOW_MS = 5 * 60 * 1000;
const FIRST_SAMPLE_MS = 300;

let previousSample = null;
let lastCpuPercent = null;

/**
 * Busy and total CPU time of every core so far (also sampled by the alerts,
 * at their own pace: services/alerts.js).
 */
export function sampleCpu() {
  let idle = 0;
  let total = 0;

  for (const cpu of os.cpus()) {
    for (const time of Object.values(cpu.times)) {
      total += time;
    }

    idle += cpu.times.idle;
  }

  return { idle, total, at: Date.now() };
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * CPU usage of the whole server, in percent.
 *
 * @returns {Promise<number>}
 */
async function cpuPercent() {
  let previous = previousSample;

  if (previous !== null && Date.now() - previous.at < MIN_CPU_WINDOW_MS && lastCpuPercent !== null) {
    return lastCpuPercent;
  }

  if (previous === null || Date.now() - previous.at > MAX_CPU_WINDOW_MS) {
    previous = sampleCpu();
    await wait(FIRST_SAMPLE_MS);
  }

  const current = sampleCpu();
  const total = current.total - previous.total;
  const busy = total - (current.idle - previous.idle);
  previousSample = current;
  lastCpuPercent = 0;

  if (total > 0) {
    lastCpuPercent = Math.round((busy / total) * 1000) / 10;
  }

  return lastCpuPercent;
}

/**
 * Used and total memory. On Linux, "available" memory counts the page cache
 * as free (like `free -h`); elsewhere the OS free memory is used.
 *
 * @returns {Promise<{total: number, used: number}>}
 */
export async function memoryUsage() {
  const meminfo = await readFileOrNull('/proc/meminfo').catch(() => null);

  if (meminfo !== null) {
    const total = /^MemTotal:\s+(\d+) kB/m.exec(meminfo);
    const available = /^MemAvailable:\s+(\d+) kB/m.exec(meminfo);

    if (total !== null && available !== null) {
      const totalBytes = Number(total[1]) * 1024;

      return { total: totalBytes, used: totalBytes - Number(available[1]) * 1024 };
    }
  }

  return { total: os.totalmem(), used: os.totalmem() - os.freemem() };
}

/**
 * Used and total space of the disk holding the base folder (like `df`).
 *
 * @returns {Promise<{path: string, total: number, used: number}|null>} null when unreadable
 */
export async function storageUsage() {
  const settings = await getGeneralSettings();

  try {
    const stats = await fs.statfs(settings.baseFolder);
    const used = (stats.blocks - stats.bfree) * stats.bsize;
    const available = stats.bavail * stats.bsize;

    return { path: settings.baseFolder, total: used + available, used };
  } catch {
    return null;
  }
}

/**
 * Every metric at once.
 */
export async function collectServerMetrics() {
  const [cpu, memory, disk] = await Promise.all([cpuPercent(), memoryUsage(), storageUsage()]);

  return {
    cpu: { percent: cpu, cores: os.cpus().length, loadAverage: os.loadavg()[0] },
    memory,
    storage: disk,
    uptimeSeconds: os.uptime(),
  };
}
