/**
 * Minimal structured console logger.
 *
 * SolarOps usually runs under systemd, which already timestamps and stores
 * stdout/stderr in the journal, so we keep this deliberately simple.
 */

const LEVELS = ['debug', 'info', 'warn', 'error'];

const minimumLevel = LEVELS.indexOf(process.env.SOLAROPS_LOG_LEVEL || 'info');

/**
 * Print a log line if its level is enabled.
 *
 * @param {'debug'|'info'|'warn'|'error'} level
 * @param {string} message
 * @param {object} [context] extra data printed as JSON
 */
function write(level, message, context) {
  if (LEVELS.indexOf(level) < minimumLevel) {
    return;
  }

  const timestamp = new Date().toISOString();
  let line = `${timestamp} [${level.toUpperCase()}] ${message}`;

  if (context !== undefined) {
    line += ` ${JSON.stringify(context)}`;
  }

  if (level === 'error' || level === 'warn') {
    console.error(line);
  } else {
    console.log(line);
  }
}

const logger = {
  debug(message, context) {
    write('debug', message, context);
  },
  info(message, context) {
    write('info', message, context);
  },
  warn(message, context) {
    write('warn', message, context);
  },
  error(message, context) {
    write('error', message, context);
  },
};

export default logger;
