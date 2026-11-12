/**
 * Safe external command execution.
 *
 * - Commands are spawned WITHOUT a shell and with an argument array, so user
 *   input can never be interpreted by a shell (no injection).
 * - The only exception is `runShellScript()`, used on purpose for scripts an
 *   administrator typed (build command, install command...).
 * - Each command runs in its own process group so a timeout kills the whole
 *   tree (e.g. `npm run build` and every child it spawned).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const MAX_CAPTURED_OUTPUT = 2 * 1024 * 1024;

export class CommandError extends Error {
  constructor(message, { command, exitCode, stdout, stderr }) {
    super(message);
    this.name = 'CommandError';
    this.command = command;
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

/**
 * Split a command line into arguments, honouring simple single and double
 * quotes: `sudo -n systemctl reload nginx` => ['sudo', '-n', 'systemctl', ...].
 *
 * @param {string} line
 * @returns {string[]}
 */
export function splitCommandLine(line) {
  const args = [];
  let current = '';
  let quote = null;
  let hasToken = false;

  for (const character of String(line)) {
    if (quote !== null) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      hasToken = true;
      continue;
    }

    if (/\s/.test(character)) {
      if (hasToken) {
        args.push(current);
        current = '';
        hasToken = false;
      }
      continue;
    }

    current += character;
    hasToken = true;
  }

  if (quote !== null) {
    throw new Error(`Unbalanced quote in command: ${line}`);
  }

  if (hasToken) {
    args.push(current);
  }

  return args;
}

/**
 * Keep only the tail of a growing output buffer.
 */
function appendCapped(buffer, chunk) {
  const combined = buffer + chunk;

  if (combined.length > MAX_CAPTURED_OUTPUT) {
    return combined.slice(combined.length - MAX_CAPTURED_OUTPUT);
  }

  return combined;
}

/**
 * Run an executable with arguments.
 *
 * @param {string} file executable name or path
 * @param {string[]} [args]
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @param {object} [options.env] full environment (defaults to process.env)
 * @param {number} [options.timeoutMs] default 5 minutes
 * @param {(text: string, stream: 'stdout'|'stderr') => void} [options.onOutput]
 * @param {boolean} [options.allowFailure] resolve instead of reject on non-zero exit
 * @param {string} [options.input] data written to stdin
 * @returns {Promise<{exitCode: number, stdout: string, stderr: string}>}
 */
export function runCommand(file, args = [], options = {}) {
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
  const commandLabel = [file, ...args].join(' ');

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      shell: false,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const killTree = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch {
        // The process group is already gone.
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree('SIGTERM');
      setTimeout(() => killTree('SIGKILL'), 5000).unref();
    }, timeoutMs);

    child.stdout.on('data', (data) => {
      const text = data.toString();
      stdout = appendCapped(stdout, text);
      if (options.onOutput) {
        options.onOutput(text, 'stdout');
      }
    });

    child.stderr.on('data', (data) => {
      const text = data.toString();
      stderr = appendCapped(stderr, text);
      if (options.onOutput) {
        options.onOutput(text, 'stderr');
      }
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      if (settled) {
        return;
      }
      settled = true;

      if (error.code === 'ENOENT') {
        reject(
          new CommandError(`Command not found: "${file}". Is it installed and in the PATH?`, {
            command: commandLabel,
            exitCode: null,
            stdout,
            stderr,
          }),
        );
        return;
      }

      reject(
        new CommandError(`Could not run "${file}": ${error.message}`, {
          command: commandLabel,
          exitCode: null,
          stdout,
          stderr,
        }),
      );
    });

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      if (settled) {
        return;
      }
      settled = true;

      if (timedOut) {
        reject(
          new CommandError(`Command timed out after ${Math.round(timeoutMs / 1000)}s: ${commandLabel}`, {
            command: commandLabel,
            exitCode,
            stdout,
            stderr,
          }),
        );
        return;
      }

      if (exitCode !== 0 && !options.allowFailure) {
        const output = (stderr.trim() || stdout.trim()).split('\n').slice(-15).join('\n');
        reject(
          new CommandError(`Command failed (exit code ${exitCode}): ${commandLabel}\n${output}`, {
            command: commandLabel,
            exitCode,
            stdout,
            stderr,
          }),
        );
        return;
      }

      resolve({ exitCode, stdout, stderr });
    });

    if (options.input !== undefined) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
  });
}

/**
 * Run a command configured as a single command line (see config.commands).
 *
 * @param {string} commandLine e.g. "sudo -n nginx -t"
 * @param {string[]} [extraArgs] appended after the configured arguments
 * @param {object} [options] same as runCommand()
 */
export function runConfiguredCommand(commandLine, extraArgs = [], options = {}) {
  const [file, ...args] = splitCommandLine(commandLine);

  return runCommand(file, [...args, ...extraArgs], options);
}

/**
 * Run a script typed by an administrator through `/bin/sh -c`.
 * Only use this for trusted, admin-defined scripts.
 *
 * @param {string} script
 * @param {object} [options] same as runCommand()
 */
export function runShellScript(script, options = {}) {
  return runCommand('/bin/sh', ['-c', script], options);
}

/**
 * Locate an executable in the PATH (like `which`).
 *
 * @param {string} binary
 * @returns {string|null} absolute path or null when not found
 */
export function findExecutable(binary) {
  if (binary.includes('/')) {
    if (isExecutable(binary)) {
      return binary;
    }
    return null;
  }

  const directories = (process.env.PATH || '').split(path.delimiter);

  for (const directory of directories) {
    const candidate = path.join(directory, binary);
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return null;
}

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}
