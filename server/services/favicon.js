/**
 * The favicon of a project's website, for the projects list. It is looked
 * for on this server only, never on the internet:
 *
 *   - an application: its home page on its own port (127.0.0.1), asked as
 *     nginx does (Host, X-Forwarded-Proto...) and followed through its
 *     redirects on its own site (/ => /login), whose <link rel="icon"> is
 *     fetched on that same port, else /favicon.ico;
 *   - a static site: its index.html and files, in the folder nginx serves.
 *
 * Icons served from another host (a CDN) are ignored. Results, found or
 * not, are kept in memory for CACHE_MS.
 */
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { isPathInside } from '../lib/files.js';
import { resolveProjectPaths } from './projectPaths.js';

const CACHE_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 2000;
const MAX_HTML_BYTES = 256 * 1024;
const MAX_ICON_BYTES = 256 * 1024;

/** Icons tried when the page names none. */
const FALLBACK_ICONS = ['/favicon.ico', '/favicon.svg', '/favicon.png'];

/** uid => { at, icon: { type, body } | null } */
const cache = new Map();

/**
 * The value of an attribute of an HTML tag.
 */
function attributeOf(tag, name) {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);

  if (match === null) {
    return null;
  }

  return match[1] ?? match[2] ?? match[3];
}

/**
 * The icons a page declares, best first: an SVG or the largest "icon", then
 * "shortcut icon", then "apple-touch-icon".
 *
 * @param {string} html
 * @returns {string[]} hrefs
 */
export function declaredIcons(html) {
  const icons = [];

  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attributeOf(tag, 'rel') || '').toLowerCase().split(/\s+/);
    const href = attributeOf(tag, 'href');

    if (!href || !(rel.includes('icon') || rel.includes('apple-touch-icon'))) {
      continue;
    }

    const type = (attributeOf(tag, 'type') || '').toLowerCase();
    const size = Number(/(\d+)x\d+/.exec(attributeOf(tag, 'sizes') || '')?.[1] || 0);
    let rank = 2;

    if (rel.includes('apple-touch-icon')) {
      rank = 3;
    } else if (type === 'image/svg+xml' || href.toLowerCase().endsWith('.svg')) {
      rank = 0;
    } else if (rel.includes('icon') && !rel.includes('shortcut')) {
      rank = 1;
    }

    icons.push({ href, rank, size });
  }

  icons.sort((a, b) => a.rank - b.rank || b.size - a.size);

  return icons.map((icon) => icon.href);
}

/** The hosts of a project's website: its domain and aliases, lower-cased. */
function ownHosts(project) {
  const network = project.network;

  return [network.domain, ...(network.aliases || [])].filter(Boolean).map((host) => host.toLowerCase());
}

/**
 * The path (and query) of a link on the project's own site, or null when it
 * points to another host (or is not an http link).
 *
 * @param {string} href
 * @param {import('../models/Project.js').default} project
 * @param {string} [base] the page the link comes from
 */
function localPath(href, project, base = '/') {
  let url;

  try {
    url = new URL(href, new URL(base, 'http://project.local/'));
  } catch {
    return null;
  }

  const ownHost = url.host === 'project.local' || ownHosts(project).includes(url.hostname.toLowerCase());

  if (!ownHost || !['http:', 'https:'].includes(url.protocol)) {
    return null;
  }

  return `${decodeURIComponent(url.pathname)}${url.search}`;
}

/** The first bytes of each image format (an app may answer any path with a page). */
const SIGNATURES = [
  { type: 'image/x-icon', bytes: [0x00, 0x00, 0x01, 0x00] },
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { type: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
];

/**
 * The real media type of an icon, from its content, or null when it is not
 * an image (a page or a text answered for any path).
 *
 * @param {Buffer} body
 */
function detectImageType(body) {
  if (body.length === 0 || body.length > MAX_ICON_BYTES) {
    return null;
  }

  for (const signature of SIGNATURES) {
    if (signature.bytes.every((byte, index) => body[index] === byte)) {
      return signature.type;
    }
  }

  if (body.subarray(0, 4).toString('latin1') === 'RIFF' && body.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }

  if (/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(body.subarray(0, 2048).toString('utf8'))) {
    return 'image/svg+xml';
  }

  return null;
}

/** Redirects followed on the project's own site (/ => /login...). */
const MAX_REDIRECTS = 4;

/**
 * The headers nginx gives the application (services/nginx.js): without
 * X-Forwarded-Proto, an app behind HTTPS often redirects to https://.
 */
function proxyHeaders(project) {
  const network = project.network;
  let scheme = 'http';

  if (network.certMethod !== 'none') {
    scheme = 'https';
  }

  const headers = {
    'User-Agent': 'SolarOps favicon',
    Accept: '*/*',
    'X-Forwarded-Proto': scheme,
    'X-Forwarded-For': '127.0.0.1',
    'X-Real-IP': '127.0.0.1',
  };

  if (network.domain) {
    headers.Host = network.domain;
    headers['X-Forwarded-Host'] = network.domain;
  }

  return headers;
}

/**
 * One GET on the application's port.
 *
 * @returns {Promise<{status: number, type: string, location: string|null, body: Buffer}>}
 */
function requestOnce(port, pathname, headers, maxBytes) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: pathname, timeout: TIMEOUT_MS, headers }, (response) => {
      const chunks = [];
      let size = 0;

      response.on('data', (chunk) => {
        size += chunk.length;

        if (size > maxBytes) {
          request.destroy(new Error('too large'));
          return;
        }

        chunks.push(chunk);
      });
      response.on('end', () => {
        resolve({
          status: response.statusCode,
          type: String(response.headers['content-type'] || '')
            .split(';')[0]
            .trim()
            .toLowerCase(),
          location: response.headers.location || null,
          body: Buffer.concat(chunks),
        });
      });
      response.on('error', reject);
    });

    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
  });
}

/**
 * GET a path of the application as nginx would, following its redirects
 * while they stay on the project's own site.
 *
 * @returns {Promise<{status: number, type: string, body: Buffer, path: string}>} path: the page finally served
 */
async function getLocal(project, pathname, maxBytes) {
  const headers = proxyHeaders(project);
  let current = pathname;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await requestOnce(project.port, current, headers, maxBytes);
    const redirected = response.status >= 300 && response.status < 400 && response.location;

    if (!redirected) {
      return { ...response, path: current };
    }

    const next = localPath(response.location, project, current);

    if (next === null) {
      return { ...response, path: current };
    }

    current = next;
  }

  throw new Error('too many redirects');
}

async function applicationIcon(project) {
  const candidates = [];
  let base = '/';

  try {
    const page = await getLocal(project, '/', MAX_HTML_BYTES);

    if (page.status < 400 && page.type.includes('html')) {
      candidates.push(...declaredIcons(page.body.toString('utf8')));
      // Relative links are relative to the page served (/login...).
      base = page.path;
    }
  } catch {
    // No home page: the usual favicon paths may still answer.
  }

  candidates.push(...FALLBACK_ICONS);

  for (const href of candidates) {
    const pathname = localPath(href, project, base);

    if (pathname === null) {
      continue;
    }

    try {
      const icon = await getLocal(project, pathname, MAX_ICON_BYTES);
      const type = detectImageType(icon.body);

      if (icon.status === 200 && type !== null) {
        return { type, body: icon.body };
      }
    } catch {
      // Next candidate.
    }
  }

  return null;
}

async function staticIcon(project) {
  const paths = await resolveProjectPaths(project);
  const publicRoot = path.join(paths.repo, project.network.publicFolder);
  const candidates = [];

  try {
    const html = await fs.readFile(path.join(publicRoot, 'index.html'));
    candidates.push(...declaredIcons(html.subarray(0, MAX_HTML_BYTES).toString('utf8')));
  } catch {
    // Not built (yet): the usual favicon files may still be there.
  }

  candidates.push(...FALLBACK_ICONS);

  for (const href of candidates) {
    const link = localPath(href, project);

    if (link === null) {
      continue;
    }

    // Files on disk: the path without its query.
    const pathname = link.split('?')[0];
    const file = path.join(publicRoot, pathname);

    // Never outside the folder nginx serves.
    if (!isPathInside(file, publicRoot)) {
      continue;
    }

    try {
      const body = await fs.readFile(file);
      const type = detectImageType(body);

      if (type !== null) {
        return { type, body };
      }
    } catch {
      // Next candidate.
    }
  }

  return null;
}

/**
 * The favicon of a project, or null.
 *
 * @param {import('../models/Project.js').default} project
 * @param {object|null} processStatus its pm2 process
 * @returns {Promise<{type: string, body: Buffer}|null>}
 */
export async function projectFavicon(project, processStatus) {
  const cached = cache.get(project.uid);

  if (cached && Date.now() - cached.at < CACHE_MS) {
    return cached.icon;
  }

  let icon = null;

  if (project.isStatic) {
    icon = await staticIcon(project);
  } else if (project.port && processStatus && processStatus.status === 'online') {
    icon = await applicationIcon(project);
  }

  // A stopped application is asked again next time.
  if (icon !== null || project.isStatic || (processStatus && processStatus.status === 'online')) {
    cache.set(project.uid, { at: Date.now(), icon });
  }

  return icon;
}
