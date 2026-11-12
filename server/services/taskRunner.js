/**
 * Background task runner.
 *
 * Long operations (deployments, certificates, dumps...) run as tasks:
 * - each task is persisted with its status and full log,
 * - tasks of the same project run one after the other (no concurrent
 *   deployments on the same folder),
 * - logs are streamed to the database every second so the UI can follow
 *   them live, and secrets are redacted before being stored.
 */
import { Op } from 'sequelize';
import { Task } from '../models/index.js';
import { runCommand, runShellScript } from '../lib/exec.js';
import logger from '../lib/logger.js';

const MAX_LOG_LENGTH = 1024 * 1024;
const FLUSH_INTERVAL_MS = 1000;

/** Promise chain per queue key ("project:<id>" or "global"). */
const queues = new Map();

/** Contexts of running tasks, by task id. */
const runningContexts = new Map();

/**
 * Handed to task handlers: logging and command helpers.
 */
export class TaskContext {
  /**
   * @param {Task} task
   */
  constructor(task) {
    this.task = task;
    this.log = '';
    this.secrets = [];
    this.dirty = false;
  }

  /**
   * Register a value that must never appear in the log.
   *
   * @param {string} value
   */
  addSecret(value) {
    if (typeof value === 'string' && value.length >= 4) {
      this.secrets.push(value);
    }
  }

  /**
   * Register several secrets at once.
   *
   * @param {string[]} values
   */
  addSecrets(values) {
    for (const value of values) {
      this.addSecret(value);
    }
  }

  /** Replace every registered secret by "•••••". */
  redact(text) {
    let result = text;

    for (const secret of this.secrets) {
      result = result.split(secret).join('•••••');
    }

    return result;
  }

  /**
   * Append raw text to the log.
   *
   * @param {string} text
   */
  write(text) {
    this.log += this.redact(String(text));

    if (this.log.length > MAX_LOG_LENGTH) {
      this.log = `[… log truncated …]\n${this.log.slice(this.log.length - MAX_LOG_LENGTH)}`;
    }

    this.dirty = true;
  }

  /**
   * Append a line to the log.
   *
   * @param {string} line
   */
  info(line) {
    this.write(`${line}\n`);
  }

  /**
   * Log the beginning of a new step (rendered as a header in the UI).
   *
   * @param {string} title
   */
  step(title) {
    this.write(`\n▸ ${title}\n`);
  }

  /**
   * Merge data into the task metadata (e.g. the deployed commit).
   *
   * @param {object} patch
   */
  setMeta(patch) {
    this.task.meta = { ...(this.task.meta || {}), ...patch };
  }

  /**
   * Run a command, streaming its output into the log.
   *
   * @param {string} file
   * @param {string[]} args
   * @param {object} [options] see lib/exec.js runCommand()
   * @param {string} [options.display] how to print the command in the log
   */
  async run(file, args, options = {}) {
    const display = options.display || [file, ...args].join(' ');
    this.info(`$ ${display}`);

    return runCommand(file, args, {
      ...options,
      onOutput: (text) => this.write(text),
    });
  }

  /**
   * Run an admin-defined shell script, streaming its output into the log.
   *
   * @param {string} script
   * @param {object} [options] see lib/exec.js runCommand()
   */
  async shell(script, options = {}) {
    this.info(`$ ${script}`);

    return runShellScript(script, {
      ...options,
      onOutput: (text) => this.write(text),
    });
  }
}

/**
 * Persist the log / meta of a context if they changed.
 *
 * @param {TaskContext} context
 */
async function flush(context) {
  if (!context.dirty) {
    return;
  }

  context.dirty = false;
  context.task.log = context.log;
  context.task.changed('meta', true);
  await context.task.save({ fields: ['log', 'meta'] });
}

/**
 * Execute a task handler and record the outcome.
 *
 * @param {Task} task
 * @param {(context: TaskContext) => Promise<void>} handler
 */
async function execute(task, handler) {
  const context = new TaskContext(task);
  runningContexts.set(task.id, context);

  task.status = 'running';
  task.startedAt = new Date();
  await task.save();

  const timer = setInterval(() => {
    flush(context).catch((error) => logger.error('Could not flush task log', { error: error.message }));
  }, FLUSH_INTERVAL_MS);

  try {
    await handler(context);
    context.info('\n✔ Done.');
    task.status = 'success';
  } catch (error) {
    context.info(`\n✖ ${error.message}`);
    task.status = 'failed';
    logger.warn(`Task #${task.id} (${task.type}) failed`, { error: error.message });
  } finally {
    clearInterval(timer);
    context.dirty = true;
    task.finishedAt = new Date();
    await flush(context);
    await task.save();
    runningContexts.delete(task.id);
  }
}

/**
 * Queue a task.
 *
 * @param {object} definition
 * @param {number|null} definition.projectId project the task belongs to
 * @param {string} definition.type e.g. "deploy", "certificate"
 * @param {string} definition.title human readable title
 * @param {string} [definition.trigger] manual | webhook | schedule | system
 * @param {string} [definition.triggeredBy] actor label
 * @param {object} [definition.meta]
 * @param {(context: TaskContext) => Promise<void>} handler the actual work
 * @returns {Promise<{task: Task, finished: Promise<void>}>}
 */
export async function enqueueTask(definition, handler) {
  const task = await Task.create({
    projectId: definition.projectId ?? null,
    type: definition.type,
    title: definition.title,
    status: 'queued',
    trigger: definition.trigger || 'manual',
    triggeredBy: definition.triggeredBy || null,
    meta: definition.meta || {},
    log: '',
  });

  let queueKey = 'global';
  if (task.projectId !== null) {
    queueKey = `project:${task.projectId}`;
  }

  const previous = queues.get(queueKey) || Promise.resolve();
  const finished = previous.then(() => execute(task, handler));
  const tail = finished.catch(() => {});

  queues.set(queueKey, tail);

  tail.then(() => {
    if (queues.get(queueKey) === tail) {
      queues.delete(queueKey);
    }
  });

  return { task, finished };
}

/**
 * Whether a project currently has queued or running tasks.
 *
 * @param {number} projectId
 */
export function isProjectBusy(projectId) {
  return queues.has(`project:${projectId}`);
}

/**
 * Load a task with its most recent log (live when the task is running).
 *
 * @param {number} taskId
 * @returns {Promise<Task|null>}
 */
export async function findTaskWithLiveLog(taskId) {
  const task = await Task.findByPk(taskId, { include: ['project'] });

  if (task === null) {
    return null;
  }

  const context = runningContexts.get(task.id);

  if (context) {
    task.log = context.log;
  }

  return task;
}

/**
 * At startup, tasks left "running" or "queued" by a previous process can
 * never finish: mark them as failed.
 */
export async function failInterruptedTasks() {
  const interrupted = await Task.findAll({ where: { status: { [Op.in]: ['queued', 'running'] } } });

  for (const task of interrupted) {
    task.status = 'failed';
    task.finishedAt = new Date();
    task.log = `${task.log}\n✖ Interrupted: SolarOps was restarted while this task was running.\n`;
    await task.save();
  }
}

/**
 * Delete finished tasks older than the given number of days.
 *
 * @param {number} days
 */
export async function pruneOldTasks(days) {
  const threshold = new Date(Date.now() - days * 24 * 3600 * 1000);

  await Task.destroy({
    where: {
      createdAt: { [Op.lt]: threshold },
      status: { [Op.in]: ['success', 'failed'] },
    },
  });
}
