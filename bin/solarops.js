#!/usr/bin/env node
/**
 * SolarOps command line interface.
 *
 * Works directly on SolarOps's database, so it is the recovery path when
 * the web UI is unreachable (lost password, broken SMTP for magic links...).
 * Run it as the user SolarOps runs as, e.g.:
 *
 *   sudo -u solarops solarops admin:reset-password admin@example.com
 */
import { parseArgs } from 'node:util';
import config from '../server/config.js';
import { bootstrap } from '../server/bootstrap.js';
import { closeDatabase } from '../server/database/init.js';
import { Admin, Project, Task } from '../server/models/index.js';
import { generatePassword, hashPassword } from '../server/lib/crypto.js';
import { HttpError } from '../server/lib/errors.js';
import { CommandError } from '../server/lib/exec.js';
import { DOMAIN_PATTERN, EMAIL_PATTERN } from '../server/lib/validation.js';
import { issueSetupToken, revokeAdminSessions } from '../server/services/auth.js';
import { queueCertificate } from '../server/services/certbot.js';
import { applyProjectNginx } from '../server/services/nginx.js';
import { renewDueCertificates } from '../server/services/scheduler.js';
import { getGeneralSettings, updateGeneralSettings } from '../server/services/settings.js';
import { getPublicUrl, lockSystemNetwork, getSystemProject } from '../server/services/systemProject.js';
import { runHealthChecks } from '../server/services/system.js';

const COLORS = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
  magenta: '\u001b[35m',
};

function paint(color, text) {
  if (!process.stdout.isTTY) {
    return text;
  }

  return `${COLORS[color]}${text}${COLORS.reset}`;
}

class CliError extends Error {}

/**
 * Find an admin by e-mail or fail.
 */
async function requireAdmin(email) {
  if (!email) {
    throw new CliError('Missing <email> argument.');
  }

  const admin = await Admin.findOne({ where: { email: email.trim().toLowerCase() } });

  if (admin === null) {
    throw new CliError(`No admin with the e-mail "${email}".`);
  }

  return admin;
}

/**
 * Print a generated password in a visible box.
 */
function printPassword(label, password) {
  console.log('');
  console.log(`  ${label}`);
  console.log('');
  console.log(`      ${paint('bold', paint('cyan', password))}`);
  console.log('');
  console.log(paint('dim', '  Store it in your password manager: it will not be shown again.'));
  console.log('');
}

const COMMANDS = {
  'tasks:active': {
    usage: 'tasks:active [--count]',
    description: 'List the operations running or queued (deployments, backups, certificates...).',
    async run(args, values) {
      const tasks = await Task.findAll({ where: { status: ['queued', 'running'] }, order: [['createdAt', 'ASC']] });

      if (values.count) {
        console.log(tasks.length);
        return;
      }

      if (tasks.length === 0) {
        console.log('No operation running.');
        return;
      }

      const projects = await Project.findAll({ attributes: ['id', 'uid'] });
      const uids = new Map(projects.map((project) => [project.id, project.uid]));

      for (const task of tasks) {
        const project = uids.get(task.projectId) || 'server';
        console.log(
          `  ${paint('cyan', task.status.padEnd(8))} ${task.title} ${paint('dim', `(${project}, #${task.id})`)}`,
        );
      }
    },
  },
  'admin:list': {
    usage: 'admin:list',
    description: 'List admin accounts.',
    async run() {
      const admins = await Admin.findAll({ order: [['createdAt', 'ASC']] });

      if (admins.length === 0) {
        console.log('No admin yet. Create one with: solarops admin:create <email>');
        return;
      }

      for (const admin of admins) {
        let lastLogin = 'never';

        if (admin.lastLoginAt) {
          lastLogin = admin.lastLoginAt.toISOString();
        }

        console.log(`  ${paint('cyan', admin.email.padEnd(40))} ${paint('dim', `last login: ${lastLogin}`)}`);
      }
    },
  },

  'admin:create': {
    usage: 'admin:create <email>',
    description: 'Create an admin with a generated password.',
    async run(positionals) {
      const email = String(positionals[0] || '')
        .trim()
        .toLowerCase();

      if (!EMAIL_PATTERN.test(email)) {
        throw new CliError('Please provide a valid e-mail address.');
      }

      if (await Admin.findOne({ where: { email } })) {
        throw new CliError(`An admin with the e-mail "${email}" already exists.`);
      }

      const password = generatePassword(20);
      await Admin.create({ email, passwordHash: await hashPassword(password) });

      console.log(paint('green', `✔ Admin ${email} created.`));
      printPassword('Password:', password);
    },
  },

  'admin:reset-password': {
    usage: 'admin:reset-password <email>',
    description: 'Generate a new password for an admin and log them out everywhere.',
    async run(positionals) {
      const admin = await requireAdmin(positionals[0]);
      const password = generatePassword(20);

      admin.passwordHash = await hashPassword(password);
      await admin.save();
      await revokeAdminSessions(admin.id);

      console.log(paint('green', `✔ Password of ${admin.email} reset, all their sessions were revoked.`));
      printPassword('New password:', password);
    },
  },

  'admin:delete': {
    usage: 'admin:delete <email>',
    description: 'Delete an admin account.',
    async run(positionals) {
      const admin = await requireAdmin(positionals[0]);

      if ((await Admin.count()) <= 1) {
        throw new CliError('Refusing to delete the last admin.');
      }

      await admin.destroy();
      console.log(paint('green', `✔ Admin ${admin.email} deleted.`));
    },
  },

  'auth:password': {
    usage: 'auth:password',
    description: 'Switch the login method back to e-mail + password (e.g. when SMTP is broken).',
    async run() {
      await updateGeneralSettings({ authMethod: 'password' });
      console.log(paint('green', '✔ Login method set to password.'));
      console.log(paint('dim', '  Lost your password too? Run: solarops admin:reset-password <email>'));
    },
  },

  'sessions:revoke': {
    usage: 'sessions:revoke [email]',
    description: 'Log out every session (of one admin, or of everyone).',
    async run(positionals) {
      if (positionals[0]) {
        const admin = await requireAdmin(positionals[0]);
        await revokeAdminSessions(admin.id);
        console.log(paint('green', `✔ Sessions of ${admin.email} revoked.`));
        return;
      }

      const admins = await Admin.findAll();

      for (const admin of admins) {
        await revokeAdminSessions(admin.id);
      }

      console.log(paint('green', '✔ Every session was revoked.'));
    },
  },

  'setup:token': {
    usage: 'setup:token',
    description: 'Print a new one-time token for the web setup page (only before the first admin exists).',
    async run() {
      const token = await issueSetupToken();

      if (token === null) {
        throw new CliError('SolarOps is already set up (an admin exists).');
      }

      console.log(`Setup token: ${paint('bold', paint('cyan', token))}`);
      console.log(paint('dim', 'It replaces the token printed by the server at startup.'));
    },
  },

  'certs:renew': {
    usage: 'certs:renew',
    description: 'Renew certificates expiring within 30 days (suitable for a daily cron job).',
    async run() {
      const { tasks, finished } = await renewDueCertificates({ trigger: 'schedule', triggeredBy: 'cli' });

      if (tasks.length === 0) {
        console.log('No certificate needs renewal.');
        return;
      }

      console.log(`Renewing ${tasks.length} certificate(s)…`);
      await finished;

      let failures = 0;

      for (const task of tasks) {
        await task.reload();

        if (task.status === 'success') {
          console.log(`  ${paint('green', '✔')} ${task.title}`);
        } else {
          failures += 1;
          console.log(`  ${paint('red', '✖')} ${task.title} ${paint('dim', `(task #${task.id})`)}`);
        }
      }

      if (failures > 0) {
        throw new CliError(`${failures} renewal(s) failed. Open the tasks in the SolarOps UI for the full log.`);
      }

      console.log(paint('green', '✔ Every certificate was renewed.'));
    },
  },

  'domain:set': {
    usage: 'domain:set <domain> [--email you@example.com] [--no-certificate]',
    description: 'Serve SolarOps on a domain and obtain its HTTPS certificate.',
    async run(positionals, options) {
      const domain = String(positionals[0] || '')
        .trim()
        .toLowerCase();

      if (!DOMAIN_PATTERN.test(domain)) {
        throw new CliError('Please provide a valid domain, e.g. solarops.example.com');
      }

      if (options.email) {
        if (!EMAIL_PATTERN.test(options.email)) {
          throw new CliError("Please provide a valid e-mail address for Let's Encrypt.");
        }

        await updateGeneralSettings({ acmeEmail: options.email.trim().toLowerCase() });
      }

      const project = await getSystemProject();
      const previous = project.network;
      project.networkConfig = lockSystemNetwork({
        ...previous,
        enabled: true,
        domain,
        aliases: [],
        certMethod: 'http',
        autoRenew: true,
        forceHttps: true,
      });
      await project.save();

      try {
        await applyProjectNginx(project);
      } catch (error) {
        project.networkConfig = previous;
        await project.save();
        throw error;
      }

      console.log(paint('green', `✔ nginx serves SolarOps on http://${domain} (proxy to port ${config.port}).`));

      if (options['no-certificate']) {
        return;
      }

      console.log("Requesting a Let's Encrypt certificate…");
      const { task, finished } = await queueCertificate(project, { trigger: 'manual', triggeredBy: 'cli' });
      await finished;
      await task.reload();

      if (task.status !== 'success') {
        console.log(paint('dim', task.log.trim().split('\n').slice(-20).join('\n')));
        throw new CliError(
          `No certificate yet: check that ${domain} points to this server, then run this command again.`,
        );
      }

      console.log(paint('green', `✔ SolarOps is live on https://${domain}`));
    },
  },

  'domain:show': {
    usage: 'domain:show',
    description: "Print SolarOps's public address (nothing without a domain).",
    async run() {
      const url = await getPublicUrl();

      if (url) {
        console.log(url);
      }
    },
  },
  'domain:reset': {
    usage: 'domain:reset',
    description: 'Stop serving SolarOps on its domain (reach it through an SSH tunnel again).',
    async run() {
      // Unlock the login first, so it is done even if nginx misbehaves.
      const settings = await getGeneralSettings();

      if (settings.authMethod === 'magic-link') {
        await updateGeneralSettings({ authMethod: 'password' });
        console.log(paint('yellow', '  Magic links need the domain: the sign-in method is now password.'));
      }

      const project = await getSystemProject();
      project.networkConfig = { ...project.network, enabled: false };
      await project.save();

      await applyProjectNginx(project);
      console.log(paint('green', '✔ SolarOps is no longer served by nginx.'));

      console.log(
        `  Reach SolarOps with: ssh -L ${config.port}:127.0.0.1:${config.port} you@server, then http://127.0.0.1:${config.port}`,
      );
    },
  },

  doctor: {
    usage: 'doctor',
    description: 'Check the server dependencies and configuration.',
    async run() {
      const { checks } = await runHealthChecks();
      let failures = 0;

      for (const check of checks) {
        let mark = paint('green', '✔');

        if (!check.ok) {
          mark = paint('red', '✖');
          failures += 1;
        }

        console.log(`  ${mark} ${check.label.padEnd(16)} ${paint('dim', check.message)}`);
      }

      if (failures > 0) {
        console.log('');
        console.log(paint('yellow', `  ${failures} check(s) need attention.`));
      }
    },
  },
};

function printHelp() {
  console.log('');
  console.log(`  ${paint('bold', 'SolarOps')} — command line`);
  console.log('');
  console.log('  Usage: solarops <command> [arguments]');
  console.log('');

  const commands = Object.values(COMMANDS);
  const width = Math.max(...commands.map((command) => command.usage.length)) + 2;

  for (const command of commands) {
    console.log(`    ${paint('cyan', command.usage.padEnd(width))} ${command.description}`);
  }

  console.log('');
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      email: { type: 'string' },
      'no-certificate': { type: 'boolean' },
      count: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  const [commandName, ...args] = positionals;

  if (!commandName || values.help || commandName === 'help') {
    printHelp();
    return;
  }

  const command = COMMANDS[commandName];

  if (!command) {
    printHelp();
    throw new CliError(`Unknown command "${commandName}".`);
  }

  await bootstrap();

  try {
    await command.run(args, values);
  } finally {
    await closeDatabase();
  }
}

main().catch((error) => {
  // Operational errors (failed command, invalid input) need no stack trace.
  if (error instanceof CliError || error instanceof CommandError || error instanceof HttpError) {
    console.error(paint('red', `✖ ${error.message}`));
  } else {
    console.error(paint('red', `✖ ${error.stack || error.message}`));
  }

  process.exit(1);
});
