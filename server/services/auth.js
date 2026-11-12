/**
 * Authentication: passwords, sessions, magic links and first-run setup.
 */
import { Op } from 'sequelize';
import config from '../config.js';
import { Admin, MagicLink, Session } from '../models/index.js';
import { getDummyPasswordHash, hashPassword, randomToken, safeEqual, sha256, verifyPassword } from '../lib/crypto.js';
import { badRequest } from '../lib/errors.js';
import { escapeHtml, sendMail } from './mailer.js';
import { deleteSetting, getGeneralSettings, getSetting, setSetting } from './settings.js';
import { getMagicLinkReadiness, getSystemMailRelay } from './systemProject.js';

export const PASSWORD_MIN_LENGTH = 12;
export const SESSION_COOKIE = 'solarops_session';

const MAGIC_LINK_TTL_MINUTES = 15;
const SESSION_TOUCH_INTERVAL_MS = 60 * 1000;

/**
 * Return an error message when a password is too weak, otherwise null.
 *
 * @param {string} password
 * @returns {string|null}
 */
export function checkPasswordStrength(password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`;
  }

  if (password.length > 256) {
    return 'Password must be at most 256 characters long.';
  }

  const characterClasses = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((pattern) => pattern.test(password));

  if (characterClasses.length < 2) {
    return 'Password must mix at least two kinds of characters (lowercase, uppercase, digits, symbols).';
  }

  return null;
}

/**
 * Throw a 400 error if the password is too weak.
 *
 * @param {string} password
 * @param {string} [field]
 */
export function assertPasswordStrength(password, field = 'password') {
  const problem = checkPasswordStrength(password);

  if (problem !== null) {
    throw badRequest(problem, { fields: { [field]: problem } });
  }
}

/**
 * Check e-mail + password. Takes the same time whether the account exists
 * or not, to avoid leaking which e-mails are admins.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<Admin|null>}
 */
export async function authenticateWithPassword(email, password) {
  const admin = await Admin.findOne({ where: { email: String(email).trim().toLowerCase() } });

  if (admin === null) {
    await verifyPassword(String(password), await getDummyPasswordHash());
    return null;
  }

  const valid = await verifyPassword(String(password), admin.passwordHash);

  if (!valid) {
    return null;
  }

  return admin;
}

/**
 * Change an admin password and revoke their other sessions.
 *
 * @param {Admin} admin
 * @param {string} newPassword
 * @param {object} [options]
 * @param {string} [options.keepSessionId] session to keep (the current one)
 */
export async function setAdminPassword(admin, newPassword, options = {}) {
  admin.passwordHash = await hashPassword(newPassword);
  await admin.save();
  await revokeAdminSessions(admin.id, { exceptSessionId: options.keepSessionId });
}

/**
 * Open a new session for an admin.
 *
 * @param {Admin} admin
 * @param {object} client
 * @param {string} [client.ip]
 * @param {string} [client.userAgent]
 * @returns {Promise<{token: string, expiresAt: Date}>} the raw token goes into the cookie
 */
export async function createSession(admin, { ip, userAgent }) {
  const token = randomToken(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.session.maxDays * 24 * 3600 * 1000);

  await Session.create({
    id: sha256(token),
    adminId: admin.id,
    ip: ip || null,
    userAgent: String(userAgent || '').slice(0, 255),
    lastSeenAt: now,
    expiresAt,
  });

  admin.lastLoginAt = now;
  await admin.save();

  return { token, expiresAt };
}

/**
 * Resolve a session cookie into its admin. Expired sessions (idle or
 * absolute expiry) are deleted.
 *
 * @param {string} token raw cookie value
 * @returns {Promise<{session: Session, admin: Admin}|null>}
 */
export async function findSession(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) {
    return null;
  }

  const session = await Session.findByPk(sha256(token), {
    include: [{ model: Admin, as: 'admin' }],
  });

  if (session === null || session.admin === null) {
    return null;
  }

  const now = Date.now();
  const idleLimit = session.lastSeenAt.getTime() + config.session.idleHours * 3600 * 1000;

  if (session.expiresAt.getTime() < now || idleLimit < now) {
    await session.destroy();
    return null;
  }

  if (now - session.lastSeenAt.getTime() > SESSION_TOUCH_INTERVAL_MS) {
    session.lastSeenAt = new Date(now);
    await session.save();
  }

  return { session, admin: session.admin };
}

/**
 * Log out: delete the session matching a cookie token.
 *
 * @param {string} token
 */
export async function destroySession(token) {
  if (typeof token !== 'string' || token === '') {
    return;
  }

  await Session.destroy({ where: { id: sha256(token) } });
}

/**
 * Delete every session of an admin (optionally keeping one).
 *
 * @param {number} adminId
 * @param {object} [options]
 * @param {string} [options.exceptSessionId]
 */
export async function revokeAdminSessions(adminId, options = {}) {
  const where = { adminId };

  if (options.exceptSessionId) {
    where.id = { [Op.ne]: options.exceptSessionId };
  }

  await Session.destroy({ where });
}

/**
 * Housekeeping: remove expired sessions and magic links.
 */
export async function purgeExpiredAuthData() {
  const now = new Date();
  const idleThreshold = new Date(now.getTime() - config.session.idleHours * 3600 * 1000);

  await Session.destroy({
    where: {
      [Op.or]: [{ expiresAt: { [Op.lt]: now } }, { lastSeenAt: { [Op.lt]: idleThreshold } }],
    },
  });

  await MagicLink.destroy({ where: { expiresAt: { [Op.lt]: now } } });
}

/**
 * Send a magic login link through SolarOps's mail relay. Silently does
 * nothing when the e-mail is not an admin (the caller always answers
 * "if this account exists...").
 *
 * Links are built from SolarOps's own HTTPS domain, never from the request
 * Host header (which an attacker controls).
 *
 * @param {string} email
 */
export async function sendMagicLink(email) {
  const settings = await getGeneralSettings();

  if (settings.authMethod !== 'magic-link') {
    throw badRequest('Magic link login is not enabled.');
  }

  const readiness = await getMagicLinkReadiness();
  const account = await getSystemMailRelay();

  if (!readiness.ready || account === null) {
    throw badRequest(
      'Magic links need SolarOps\'s HTTPS domain and mail relay. Run "solarops auth:password" on the server to use passwords.',
    );
  }

  const baseUrl = readiness.publicUrl;

  const admin = await Admin.findOne({ where: { email: String(email).trim().toLowerCase() } });

  if (admin === null) {
    return;
  }

  const token = randomToken(32);

  await MagicLink.create({
    tokenHash: sha256(token),
    adminId: admin.id,
    expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MINUTES * 60 * 1000),
  });

  const link = `${baseUrl.replace(/\/+$/, '')}/auth/magic-link?token=${encodeURIComponent(token)}`;

  await sendMail(account, {
    to: admin.email,
    subject: 'Your SolarOps login link',
    text: [
      'Hello,',
      '',
      `Use this link to sign in to SolarOps. It expires in ${MAGIC_LINK_TTL_MINUTES} minutes and works only once:`,
      '',
      link,
      '',
      'If you did not request it, you can safely ignore this e-mail.',
    ].join('\n'),
    html: [
      '<div style="font-family:Inter,system-ui,sans-serif;background:#0c0c10;color:#f4f4f5;padding:32px;border-radius:12px">',
      '<h2 style="margin-top:0;font-weight:600">SolarOps</h2>',
      `<p>Use the button below to sign in. It expires in ${MAGIC_LINK_TTL_MINUTES} minutes and works only once.</p>`,
      `<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;border-radius:10px;`,
      'background:#f4f4f5;color:#09090b;font-weight:600;text-decoration:none">',
      'Sign in to SolarOps</a></p>',
      '<p style="color:#a1a1aa;font-size:12px">If you did not request it, you can safely ignore this e-mail.</p>',
      '</div>',
    ].join(''),
  });
}

/**
 * Consume a magic link token (one time use).
 *
 * @param {string} token
 * @returns {Promise<Admin|null>}
 */
export async function consumeMagicLink(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) {
    return null;
  }

  const link = await MagicLink.findOne({
    where: { tokenHash: sha256(token) },
    include: [{ model: Admin, as: 'admin' }],
  });

  if (link === null || link.usedAt !== null || link.expiresAt.getTime() < Date.now()) {
    return null;
  }

  link.usedAt = new Date();
  await link.save();

  return link.admin;
}

/**
 * Whether SolarOps still needs its first admin account.
 */
export async function isSetupRequired() {
  const count = await Admin.count();

  return count === 0;
}

/**
 * Generate a fresh one-time setup token (printed in the server logs at
 * startup) when no admin exists yet. Only its hash is stored.
 *
 * @returns {Promise<string|null>} the token, or null if setup is done
 */
export async function issueSetupToken() {
  const required = await isSetupRequired();

  if (!required) {
    await deleteSetting('setupTokenHash');
    return null;
  }

  const token = randomToken(18);
  await setSetting('setupTokenHash', sha256(token));

  return token;
}

/**
 * Check a setup token typed in the setup page.
 *
 * @param {string} token
 */
export async function verifySetupToken(token) {
  const storedHash = await getSetting('setupTokenHash', null);

  if (storedHash === null || typeof token !== 'string') {
    return false;
  }

  return safeEqual(sha256(token.trim()), storedHash);
}

/**
 * Invalidate the setup token once the first admin exists.
 */
export async function clearSetupToken() {
  await deleteSetting('setupTokenHash');
}
