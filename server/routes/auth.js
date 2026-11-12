/**
 * Authentication routes: status, first-run setup, login (password or magic
 * link), logout and password change.
 */
import express from 'express';
import { Admin } from '../models/index.js';
import { hashPassword, verifyPassword } from '../lib/crypto.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import logger from '../lib/logger.js';
import { Validator } from '../lib/validation.js';
import { clearSessionCookie, requireAuth, setSessionCookie } from '../middleware/auth.js';
import { authLimiter } from '../middleware/security.js';
import { recordAudit } from '../services/audit.js';
import {
  SESSION_COOKIE,
  assertPasswordStrength,
  authenticateWithPassword,
  clearSetupToken,
  consumeMagicLink,
  createSession,
  destroySession,
  isSetupRequired,
  revokeAdminSessions,
  sendMagicLink,
  setAdminPassword,
  verifySetupToken,
} from '../services/auth.js';
import { getGeneralSettings } from '../services/settings.js';

const router = express.Router();

/**
 * Open a session and set the cookie.
 */
async function logIn(req, res, admin) {
  const { token, expiresAt } = await createSession(admin, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });

  setSessionCookie(req, res, token, expiresAt);
}

/**
 * What the login screen needs to know.
 */
router.get('/status', async (req, res) => {
  const settings = await getGeneralSettings();
  let admin = null;

  if (req.admin) {
    admin = req.admin.toPublic();
  }

  res.json({
    setupRequired: await isSetupRequired(),
    authMethod: settings.authMethod,
    authenticated: Boolean(req.admin),
    admin,
  });
});

/**
 * First-run setup: create the first admin. Requires the one-time token
 * printed in the server logs at startup.
 */
router.post('/setup', authLimiter, async (req, res) => {
  if (!(await isSetupRequired())) {
    throw badRequest('SolarOps is already set up.');
  }

  const input = new Validator(req.body);
  const token = input.string('token', { required: true, max: 100 });
  const email = input.email('email', { required: true });
  const password = input.string('password', { required: true, max: 256, trim: false });
  input.assertValid();

  if (!(await verifySetupToken(token))) {
    throw badRequest('Invalid setup token. Check the SolarOps server logs.', { fields: { token: 'Invalid token.' } });
  }

  assertPasswordStrength(password);

  const admin = await Admin.create({ email, passwordHash: await hashPassword(password) });
  await clearSetupToken();

  await logIn(req, res, admin);
  req.admin = admin;
  await recordAudit({ req, action: 'setup.complete', target: email });
  logger.info(`First admin created: ${email}`);

  res.status(201).json({ admin: admin.toPublic() });
});

/**
 * Password login.
 */
router.post('/login', authLimiter, async (req, res) => {
  const settings = await getGeneralSettings();

  if (settings.authMethod !== 'password') {
    throw badRequest('Password login is disabled: use a magic link.');
  }

  const email = String(req.body?.email || '');
  const password = String(req.body?.password || '');
  const admin = await authenticateWithPassword(email, password);

  if (admin === null) {
    await recordAudit({ req, actor: email.slice(0, 254) || 'unknown', action: 'auth.login-failed' });
    throw unauthorized('Invalid e-mail or password.');
  }

  await logIn(req, res, admin);
  req.admin = admin;
  await recordAudit({ req, action: 'auth.login' });

  res.json({ admin: admin.toPublic() });
});

/**
 * Ask for a magic link. Always answers the same way, whether the account
 * exists or not.
 */
router.post('/magic-link', authLimiter, async (req, res) => {
  const settings = await getGeneralSettings();

  if (settings.authMethod !== 'magic-link') {
    throw badRequest('Magic link login is disabled.');
  }

  const email = String(req.body?.email || '').slice(0, 254);

  try {
    await sendMagicLink(email);
  } catch (error) {
    logger.error('Could not send magic link', { error: error.message });
    throw badRequest('The login e-mail could not be sent. Please try again later, or contact an administrator.');
  }

  res.json({ message: 'If this e-mail belongs to an admin, a login link is on its way.' });
});

/**
 * Exchange a magic link token for a session.
 */
router.post('/magic-link/verify', authLimiter, async (req, res) => {
  const admin = await consumeMagicLink(String(req.body?.token || ''));

  if (admin === null) {
    throw unauthorized('This link is invalid or has expired. Request a new one.');
  }

  await logIn(req, res, admin);
  req.admin = admin;
  await recordAudit({ req, action: 'auth.magic-link-login' });

  res.json({ admin: admin.toPublic() });
});

/**
 * Log out the current session.
 */
router.post('/logout', async (req, res) => {
  await destroySession(req.cookies?.[SESSION_COOKIE]);
  clearSessionCookie(req, res);

  res.json({ ok: true });
});

/**
 * Log out every session of the current admin, including this one.
 */
router.post('/logout-everywhere', requireAuth, async (req, res) => {
  await revokeAdminSessions(req.admin.id);
  clearSessionCookie(req, res);
  await recordAudit({ req, action: 'auth.logout-everywhere' });

  res.json({ ok: true });
});

/**
 * Change the current admin password (other sessions are revoked).
 */
router.post('/password', requireAuth, authLimiter, async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');

  if (!(await verifyPassword(currentPassword, req.admin.passwordHash))) {
    throw badRequest('The current password is incorrect.', { fields: { currentPassword: 'Incorrect password.' } });
  }

  assertPasswordStrength(newPassword, 'newPassword');
  await setAdminPassword(req.admin, newPassword, { keepSessionId: req.session.id });
  await recordAudit({ req, action: 'auth.password-change' });

  res.json({ ok: true });
});

export default router;
