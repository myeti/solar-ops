/**
 * SolarOps general settings.
 *
 * SolarOps's own domain, certificate and mail relay are not settings: they
 * are configured on the system project (see services/systemProject.js).
 */
import net from 'node:net';
import path from 'node:path';
import express from 'express';
import config from '../config.js';
import { Project } from '../models/index.js';
import { badRequest } from '../lib/errors.js';
import { ABSOLUTE_PATH_PATTERN, Validator } from '../lib/validation.js';
import { recordAudit } from '../services/audit.js';
import { nginxIncludeDirective } from '../services/nginx.js';
import { canonicalAddress } from '../services/dnsRecords.js';
import { MAX_PORT, MAX_PORT_STEP, MIN_PORT } from '../services/ports.js';
import { AUTH_METHODS, getGeneralSettings, updateGeneralSettings } from '../services/settings.js';
import { getMagicLinkReadiness, getSystemProject } from '../services/systemProject.js';

const router = express.Router();

const IPV4_PATTERN = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

/**
 * The base folder cannot move once something lives in it: a project, or
 * SolarOps's own nginx configuration.
 */
async function isBaseFolderLocked() {
  const projectCount = await Project.count({ where: { system: false } });
  const systemProject = await getSystemProject();
  const systemServed = systemProject !== null && systemProject.network.enabled;

  return { projectCount, locked: projectCount > 0 || systemServed };
}

/**
 * Settings + information the settings screen needs.
 */
async function settingsResponse() {
  const settings = await getGeneralSettings();
  const baseFolder = await isBaseFolderLocked();
  let databaseDialect = 'sqlite';

  if (config.database.url) {
    databaseDialect = 'postgres';
  }

  return {
    settings,
    meta: {
      projectCount: baseFolder.projectCount,
      baseFolderLocked: baseFolder.locked,
      nginxInclude: nginxIncludeDirective(settings.baseFolder),
      dataDir: config.dataDir,
      databaseDialect,
      magicLink: await getMagicLinkReadiness(),
    },
  };
}

router.get('/', async (req, res) => {
  res.json(await settingsResponse());
});

router.put('/', async (req, res) => {
  const current = await getGeneralSettings();
  const input = new Validator(req.body);

  const baseFolder = input.string('baseFolder', {
    required: true,
    max: 200,
    pattern: ABSOLUTE_PATH_PATTERN,
    patternMessage: 'Absolute path with letters, digits, ".", "_", "-" and "/" only.',
  });
  const authMethod = input.oneOf('authMethod', AUTH_METHODS, { required: true });
  const acmeEmail = input.email('acmeEmail', { defaultValue: '' });
  const acmeStaging = input.boolean('acmeStaging', { defaultValue: false });
  const serverIp = input.string('serverIp', {
    max: 15,
    defaultValue: '',
    pattern: IPV4_PATTERN,
    patternMessage: 'Must be an IPv4 address.',
  });
  const serverIpv6 = input.string('serverIpv6', { max: 45, defaultValue: '' });

  if (serverIpv6 && !net.isIPv6(serverIpv6)) {
    input.fail('serverIpv6', 'Must be an IPv6 address.');
  }

  // Ports suggested to new applications (existing projects keep theirs).
  const firstPort = input.integer('firstPort', { min: MIN_PORT, max: MAX_PORT, defaultValue: current.firstPort });
  const portStep = input.integer('portStep', { min: 1, max: MAX_PORT_STEP, defaultValue: current.portStep });
  input.assertValid();

  const normalizedBaseFolder = path.normalize(baseFolder).replace(/\/+$/, '');
  const baseFolderState = await isBaseFolderLocked();

  if (normalizedBaseFolder !== current.baseFolder && baseFolderState.locked) {
    throw badRequest("The base folder cannot change once projects (or SolarOps's domain) live in it.", {
      fields: { baseFolder: 'Locked.' },
    });
  }

  if (authMethod === 'magic-link') {
    const readiness = await getMagicLinkReadiness();

    if (!readiness.ready) {
      throw badRequest(
        "Magic links need SolarOps's domain with an HTTPS certificate and a mail relay (Projects › SolarOps).",
        {
          fields: { authMethod: 'SolarOps is not ready for magic links yet.' },
        },
      );
    }
  }

  await updateGeneralSettings({
    baseFolder: normalizedBaseFolder,
    authMethod,
    acmeEmail,
    acmeStaging,
    serverIp,
    serverIpv6: canonicalAddress(serverIpv6),
    firstPort,
    portStep,
  });

  await recordAudit({ req, action: 'settings.update', details: { authMethod, acmeStaging, firstPort, portStep } });

  res.json(await settingsResponse());
});

export default router;
