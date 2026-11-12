/**
 * SolarOps server entry point.
 */
import config from './config.js';
import { bootstrap } from './bootstrap.js';
import { createApp } from './app.js';
import { closeDatabase } from './database/init.js';
import logger from './lib/logger.js';
import { issueSetupToken } from './services/auth.js';
import { installAskPassScript } from './services/git.js';
import { applyProjectNginx } from './services/nginx.js';
import { fillMissingProjectSecrets } from './services/projectSecrets.js';
import { startScheduler, stopScheduler } from './services/scheduler.js';
import { failInterruptedTasks } from './services/taskRunner.js';

/**
 * Print the one-time setup token when no admin exists yet.
 */
async function announceSetup() {
  const token = await issueSetupToken();

  if (token === null) {
    return;
  }

  // Bound to every interface (e.g. in a container): show a usable address.
  let displayHost = config.host;

  if (displayHost === '0.0.0.0' || displayHost === '::') {
    displayHost = '127.0.0.1';
  }

  const lines = [
    '',
    '  ╔════════════════════════════════════════════════════════════╗',
    '  ║  SolarOps needs its first admin                            ║',
    '  ╚════════════════════════════════════════════════════════════╝',
    '',
    `  Open http://${displayHost}:${config.port}/setup and use this one-time token:`,
    '',
    `      ${token}`,
    '',
    '  Or create the admin from the shell: solarops admin:create <email>',
    '',
  ];

  console.log(lines.join('\n'));
}

/**
 * Re-apply SolarOps's own nginx configuration, e.g. after SOLAROPS_PORT
 * changed. Nothing happens (no reload) when the file is already up to date.
 */
async function syncSystemNginx(systemProject) {
  if (!systemProject.network.enabled) {
    return;
  }

  try {
    const result = await applyProjectNginx(systemProject);

    if (result.changed) {
      logger.info('SolarOps nginx configuration updated');
    }
  } catch (error) {
    logger.error('Could not apply the SolarOps nginx configuration', { error: error.message });
  }
}

async function main() {
  const { systemProject } = await bootstrap();
  await fillMissingProjectSecrets();
  await failInterruptedTasks();
  await installAskPassScript();
  await syncSystemNginx(systemProject);

  const app = createApp();
  const server = app.listen(config.port, config.host, () => {
    logger.info(`SolarOps listening on http://${config.host}:${config.port}`);
  });

  await announceSetup();
  startScheduler();

  const shutdown = (signal) => {
    logger.info(`${signal} received, shutting down…`);
    stopScheduler();

    server.close(async () => {
      await closeDatabase();
      process.exit(0);
    });

    // Running tasks (builds...) do not hold the shutdown forever.
    setTimeout(() => process.exit(0), 10000).unref();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  // Some errors (Sequelize's) keep their message out of the stack.
  logger.error(`SolarOps failed to start: ${error.message || error.name}`, { error: error.stack || error.message });
  process.exit(1);
});
