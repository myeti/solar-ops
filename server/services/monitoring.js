/**
 * System › Monitoring: the processes using the most CPU and memory right
 * now, and 24 hours of server CPU and memory usage.
 *
 * Nothing is stored: the history is a ring kept in memory (one sample a
 * minute, the CPU as the average over that minute), lost when SolarOps
 * restarts. Processes are read from /proc (Linux only): their CPU usage is
 * measured between two readings, as a share of the whole server (100% =
 * every core busy), like the server CPU.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCommand } from '../lib/exec.js';
import { Project } from '../models/index.js';
import { getProcessMap } from './pm2.js';
import { memoryUsage, sampleCpu } from './serverMetrics.js';

export const SAMPLE_MS = 60 * 1000;
const HISTORY_MS = 24 * 60 * 60 * 1000;
const MAX_SAMPLES = HISTORY_MS / SAMPLE_MS + 1;

/** Processes listed in each top. */
const TOP_COUNT = 10;

/** Shortest window measuring the CPU of processes (shorter is too noisy). */
const MIN_WINDOW_MS = 1000;
/** A reading older than this is not compared with (nobody was looking). */
const MAX_WINDOW_MS = 30 * 1000;
const FIRST_WINDOW_MS = 600;

/** Characters of a command line shown. */
const MAX_COMMAND_LENGTH = 160;

/** scheme://user:password@rest: the password is never shown. */
const URL_WITH_PASSWORD = /([a-z][a-z0-9+.-]*:\/\/[^:/@\s]*:)[^@\s]*@/gi;

const history = [];
let historyCpu = null;

/** The latest /proc reading: { at, ticks: Map<pid, ticks>, cpu: sampleCpu() }. */
let lastReading = null;
/** The latest answer, reused within MIN_WINDOW_MS (several open pages). */
let lastTop = null;

let clockTicks = null;
let users = null;

/**
 * Record one sample of the server CPU (average since the previous sample)
 * and memory. Called every SAMPLE_MS by the scheduler, and once at startup.
 */
export async function recordUsageSample() {
  const cpu = sampleCpu();
  const memory = await memoryUsage();
  let cpuPercent = null;

  if (historyCpu !== null && cpu.total > historyCpu.total) {
    const total = cpu.total - historyCpu.total;
    const busy = total - (cpu.idle - historyCpu.idle);
    cpuPercent = Math.round((busy / total) * 1000) / 10;
  }

  historyCpu = cpu;

  // The first sample only starts the CPU window.
  if (cpuPercent === null) {
    return;
  }

  history.push({ at: cpu.at, cpu: cpuPercent, memoryUsed: memory.used, memoryTotal: memory.total });

  while (history.length > MAX_SAMPLES || (history.length > 0 && history[0].at < cpu.at - HISTORY_MS)) {
    history.shift();
  }
}

/**
 * The last 24 hours of server usage.
 */
export function usageHistory() {
  return { sampleSeconds: SAMPLE_MS / 1000, samples: history };
}

/** Clock ticks per second of /proc/<pid>/stat times (CLK_TCK, almost always 100). */
async function ticksPerSecond() {
  if (clockTicks === null) {
    clockTicks = 100;

    try {
      const { stdout } = await runCommand('getconf', ['CLK_TCK'], { timeoutMs: 3000 });
      const value = Number(stdout.trim());

      if (value > 0) {
        clockTicks = value;
      }
    } catch {
      // Keep 100.
    }
  }

  return clockTicks;
}

/** User names by uid, from /etc/passwd. */
async function userNames() {
  if (users === null) {
    users = new Map();

    try {
      for (const line of (await fs.readFile('/etc/passwd', 'utf8')).split('\n')) {
        const [name, , uid] = line.split(':');

        if (name && uid) {
          users.set(uid, name);
        }
      }
    } catch {
      // Uids are shown instead.
    }
  }

  return users;
}

/** The kernel keeps 15 characters of a process name (16 with the NUL). */
const KERNEL_NAME_LENGTH = 15;

/** Characters of a process title shown as its name. */
const MAX_NAME_LENGTH = 40;

/**
 * The name of a process: its program (node, nginx, postgres...), or the
 * title it gave itself (pm2's "PM2 v6: God Daemon"), when the kernel's
 * name does not do: the kernel cuts it at 15 characters, and Node.js renames
 * it "MainThread".
 *
 * @param {string} kernelName from /proc/<pid>/stat
 * @param {string} cmdline from /proc/<pid>/cmdline (arguments separated by NUL)
 */
function processName(kernelName, cmdline) {
  const argv = cmdline.replace(/\0+$/, '').split('\0');

  // The kernel's name, when it is whole and not Node.js's thread name.
  if (argv[0] === '' || (kernelName !== 'MainThread' && kernelName.length < KERNEL_NAME_LENGTH)) {
    return kernelName;
  }

  // A real argument list: the program's file name.
  if (argv.length > 1 || !argv[0].includes(' ')) {
    return path.basename(argv[0]).slice(0, MAX_NAME_LENGTH);
  }

  // A title set by the process itself.
  return argv[0].slice(0, MAX_NAME_LENGTH);
}

/**
 * One process from /proc, or null when it is gone (or unreadable).
 */
async function readProcess(pid) {
  try {
    const [stat, status, cmdline] = await Promise.all([
      fs.readFile(`/proc/${pid}/stat`, 'utf8'),
      fs.readFile(`/proc/${pid}/status`, 'utf8'),
      fs.readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => ''),
    ]);

    // "pid (comm) state ppid ...": comm may hold spaces and parentheses.
    const close = stat.lastIndexOf(')');
    const kernelName = stat.slice(stat.indexOf('(') + 1, close);
    const fields = stat.slice(close + 2).split(' ');
    const rss = /^VmRSS:\s+(\d+) kB/m.exec(status);
    const uid = /^Uid:\s+(\d+)/m.exec(status);
    // Kernel threads have no memory of their own.
    let memory = 0;
    let owner = null;

    if (rss !== null) {
      memory = Number(rss[1]) * 1024;
    }

    if (uid !== null) {
      owner = uid[1];
    }

    return {
      pid,
      ppid: Number(fields[1]),
      name: processName(kernelName, cmdline),
      // utime + stime (fields 14 and 15 of the stat line).
      ticks: Number(fields[11]) + Number(fields[12]),
      memory,
      uid: owner,
      command: cmdline.replace(/\0+$/, '').replace(/\0/g, ' '),
    };
  } catch {
    return null;
  }
}

/** Every process of the server. */
async function readProcesses() {
  const entries = await fs.readdir('/proc');
  const pids = entries.filter((entry) => /^\d+$/.test(entry)).map(Number);

  return (await Promise.all(pids.map(readProcess))).filter((entry) => entry !== null);
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * The project running each process: pm2 starts a project's process, which
 * may start others (npm start → node): a process belongs to the project of
 * its nearest ancestor started by pm2. SolarOps is this very process.
 */
async function projectsByPid(processes) {
  const owners = new Map();
  const { processes: pm2Processes } = await getProcessMap();
  const projects = await Project.findAll();

  for (const project of projects) {
    if (project.system) {
      owners.set(process.pid, { uid: project.uid, name: project.name });
      continue;
    }

    const pm2Process = pm2Processes.get(project.uid);

    if (pm2Process && pm2Process.pid) {
      owners.set(pm2Process.pid, { uid: project.uid, name: project.name });
    }
  }

  const parents = new Map(processes.map((entry) => [entry.pid, entry.ppid]));

  return (pid) => {
    let current = pid;

    // Up to the root, at most a few levels in practice.
    for (let depth = 0; depth < 32 && current > 1; depth += 1) {
      if (owners.has(current)) {
        return owners.get(current);
      }

      current = parents.get(current);

      if (current === undefined) {
        break;
      }
    }

    return null;
  };
}

/** What the page shows of a process (a URL password is masked). */
function presentProcess(entry, extra) {
  let command = entry.command;

  if (command === '') {
    command = `[${entry.name}]`;
  }

  command = command.replace(URL_WITH_PASSWORD, '$1••••••••@');

  if (command.length > MAX_COMMAND_LENGTH) {
    command = `${command.slice(0, MAX_COMMAND_LENGTH - 1)}…`;
  }

  return {
    pid: entry.pid,
    name: entry.name,
    command,
    user: (users && users.get(entry.uid)) || entry.uid,
    project: extra.projectOf(entry.pid),
    cpu: extra.cpu,
    memory: entry.memory,
  };
}

/**
 * The processes using the most CPU and the most memory right now, with the
 * server CPU over the same window and its memory. Null `processes` when
 * /proc is not there (not Linux).
 */
export async function topProcesses() {
  if (lastTop !== null && Date.now() - lastTop.at < MIN_WINDOW_MS) {
    return lastTop.result;
  }

  try {
    await fs.access('/proc/self/stat');
  } catch {
    return { available: false, cpu: null, memory: null };
  }

  const ticksPerSec = await ticksPerSecond();
  await userNames();

  let previous = lastReading;

  if (previous === null || Date.now() - previous.at > MAX_WINDOW_MS) {
    const processes = await readProcesses();
    previous = { at: Date.now(), cpu: sampleCpu(), ticks: new Map(processes.map((entry) => [entry.pid, entry.ticks])) };
    await wait(FIRST_WINDOW_MS);
  }

  const processes = await readProcesses();
  const now = Date.now();
  const serverCpu = sampleCpu();
  const seconds = (now - previous.at) / 1000;
  const cores = os.cpus().length;

  lastReading = { at: now, cpu: serverCpu, ticks: new Map(processes.map((entry) => [entry.pid, entry.ticks])) };

  const cpuOf = (entry) => {
    // A process started since the previous reading: its whole life.
    const before = previous.ticks.get(entry.pid) ?? 0;
    const used = Math.max(0, entry.ticks - before) / ticksPerSec;

    return Math.round(Math.min(100, (used / seconds / cores) * 100) * 10) / 10;
  };

  const projectOf = await projectsByPid(processes);
  const withCpu = processes.map((entry) => ({ entry, cpu: cpuOf(entry) }));

  const byCpu = withCpu
    .filter((item) => item.cpu > 0)
    .sort((a, b) => b.cpu - a.cpu || b.entry.memory - a.entry.memory)
    .slice(0, TOP_COUNT);
  const byMemory = withCpu
    .filter((item) => item.entry.memory > 0)
    .sort((a, b) => b.entry.memory - a.entry.memory)
    .slice(0, TOP_COUNT);

  const serverTotal = serverCpu.total - previous.cpu.total;
  let serverPercent = 0;

  if (serverTotal > 0) {
    serverPercent = Math.round(((serverTotal - (serverCpu.idle - previous.cpu.idle)) / serverTotal) * 1000) / 10;
  }

  const memory = await memoryUsage();
  const result = {
    available: true,
    at: new Date(now).toISOString(),
    processCount: processes.length,
    cpu: {
      percent: serverPercent,
      cores,
      top: byCpu.map((item) => presentProcess(item.entry, { cpu: item.cpu, projectOf })),
    },
    memory: {
      used: memory.used,
      total: memory.total,
      top: byMemory.map((item) => presentProcess(item.entry, { cpu: item.cpu, projectOf })),
    },
  };

  lastTop = { at: now, result };

  return result;
}
