/**
 * Security middleware: HTTP headers, CSRF protection and rate limiting.
 */
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { forbidden } from '../lib/errors.js';

/** Header the UI sends on every API call. */
export const REQUEST_HEADER = 'x-solarops-request';

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

/**
 * Strict security headers. The UI is fully self-hosted (fonts included),
 * so the Content Security Policy only allows same-origin resources.
 */
export function securityHeaders() {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'img-src': ["'self'", 'data:'],
        'font-src': ["'self'", 'data:'],
        'connect-src': ["'self'"],
        'frame-ancestors': ["'none'"],
        'form-action': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'upgrade-insecure-requests': null,
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'same-origin' },
  });
}

/**
 * CSRF protection for the JSON API.
 *
 * State-changing requests must carry the custom `X-SolarOps-Request`
 * header. Browsers cannot add custom headers to cross-site requests without
 * a CORS preflight, which SolarOps never allows. Combined with the
 * SameSite=Strict session cookie this blocks cross-site request forgery.
 * The Origin header, when present, must also match the Host.
 */
export function csrfProtection(req, res, next) {
  if (SAFE_METHODS.includes(req.method)) {
    next();
    return;
  }

  if (req.get(REQUEST_HEADER) !== '1') {
    throw forbidden('Missing X-SolarOps-Request header.');
  }

  const origin = req.get('origin');

  if (origin) {
    let originHost;

    try {
      originHost = new URL(origin).host;
    } catch {
      throw forbidden('Invalid Origin header.');
    }

    if (originHost !== req.get('host')) {
      throw forbidden('Cross-origin request refused.');
    }
  }

  next();
}

/**
 * Build a JSON rate limiter.
 */
function createLimiter({ windowMinutes, limit, message }) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler(req, res) {
      res.status(429).json({ error: message });
    },
  });
}

/** Login, magic link and setup attempts: 10 per 15 minutes per IP. */
export const authLimiter = createLimiter({
  windowMinutes: 15,
  limit: 10,
  message: 'Too many attempts. Please wait a few minutes before trying again.',
});

/** Incoming webhooks: 30 per minute per IP. */
export const webhookLimiter = createLimiter({
  windowMinutes: 1,
  limit: 30,
  message: 'Too many webhook calls.',
});

/** Whole API: generous limit to contain runaway scripts. */
export const apiLimiter = createLimiter({
  windowMinutes: 1,
  limit: 600,
  message: 'Too many requests.',
});
