/**
 * Session handling middleware.
 */
import config from '../config.js';
import { unauthorized } from '../lib/errors.js';
import { SESSION_COOKIE, findSession } from '../services/auth.js';

/**
 * Whether the session cookie must carry the Secure flag.
 *
 * @param {import('express').Request} req
 */
function isSecureCookie(req) {
  if (config.cookieSecure === 'true') {
    return true;
  }

  if (config.cookieSecure === 'false') {
    return false;
  }

  return req.secure;
}

/**
 * Set the session cookie: HttpOnly (no JS access), SameSite=Strict (never
 * sent on cross-site requests), Secure when served over HTTPS.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {string} token
 * @param {Date} expiresAt
 */
export function setSessionCookie(req, res, token, expiresAt) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isSecureCookie(req),
    expires: expiresAt,
    path: '/',
  });
}

/**
 * Remove the session cookie.
 */
export function clearSessionCookie(req, res) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isSecureCookie(req),
    path: '/',
  });
}

/**
 * Attach `req.admin` and `req.session` when the cookie is valid.
 */
export async function loadSession(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];

  if (token) {
    const found = await findSession(token);

    if (found !== null) {
      req.admin = found.admin;
      req.session = found.session;
    } else {
      clearSessionCookie(req, res);
    }
  }

  next();
}

/**
 * Reject requests without a valid session.
 */
export function requireAuth(req, res, next) {
  if (!req.admin) {
    throw unauthorized();
  }

  next();
}
