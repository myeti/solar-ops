/**
 * Express application: API, webhooks and the built Vue UI.
 */
import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import config from './config.js';
import { loadSession, requireAuth } from './middleware/auth.js';
import { apiNotFound, errorHandler } from './middleware/errors.js';
import { apiLimiter, csrfProtection, securityHeaders } from './middleware/security.js';
import adminsRouter from './routes/admins.js';
import alertsRouter from './routes/alerts.js';
import authRouter from './routes/auth.js';
import dnsAccountsRouter, { listCertificates } from './routes/dnsAccounts.js';
import gitCredentialsRouter from './routes/gitCredentials.js';
import postgresRouter from './routes/postgres.js';
import projectsRouter from './routes/projects.js';
import settingsRouter from './routes/settings.js';
import sharedCertificatesRouter from './routes/sharedCertificates.js';
import smtpAccountsRouter from './routes/smtpAccounts.js';
import systemRouter from './routes/system.js';
import webhooksRouter from './routes/webhooks.js';

/**
 * Convert the SOLAROPS_TRUST_PROXY value to what Express expects.
 */
function parseTrustProxy(value) {
  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  return value;
}

/**
 * Serve the built single page application, if present.
 */
function mountClient(app) {
  const indexFile = path.join(config.clientDist, 'index.html');

  if (!fs.existsSync(indexFile)) {
    app.get('/', (req, res) => {
      res.type('text/plain').send('SolarOps API is running. The UI is not built yet: run "npm run build".');
    });
    return;
  }

  // Hashed assets can be cached forever.
  app.use('/assets', express.static(path.join(config.clientDist, 'assets'), { immutable: true, maxAge: '1y' }));
  app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));

  // Any other path is a client side route.
  app.get('/{*path}', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(indexFile);
  });
}

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', parseTrustProxy(config.trustProxy));
  app.use(securityHeaders());

  // Webhooks: raw body for signature checks, no session, no CSRF header.
  app.use('/hooks', webhooksRouter);

  // API: JSON body, session cookie, CSRF protection.
  app.use('/api', apiLimiter, express.json({ limit: '1mb' }), cookieParser(), loadSession, csrfProtection);
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // Public authentication routes.
  app.use('/api/auth', authRouter);

  // Everything else requires a logged in admin.
  const api = express.Router();
  api.use(requireAuth);
  api.use('/admins', adminsRouter);
  api.use('/settings', settingsRouter);
  api.use('/postgres', postgresRouter);
  api.use('/smtp-accounts', smtpAccountsRouter);
  api.use('/git-credentials', gitCredentialsRouter);
  api.use('/dns-accounts', dnsAccountsRouter);
  api.get('/certificates', listCertificates);
  api.use('/shared-certificates', sharedCertificatesRouter);
  api.use('/projects', projectsRouter);
  api.use('/system', systemRouter);
  api.use('/alerts', alertsRouter);
  app.use('/api', api);
  app.use('/api', apiNotFound);

  mountClient(app);

  app.use(errorHandler);

  return app;
}
