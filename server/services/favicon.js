/**
 * The favicon of a project's website, for the projects list. It is looked
 * for on this server only, never on the internet:
 *
 *   - an application: its home page on its own port (127.0.0.1), whose
 *     <link rel="icon"> is followed on that same port, else /favicon.ico;
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

/**
 * The path of an icon href on the project's own site, or null when it is
 * on another host (or not an http path).
 *
 * @param {string} href
 * @param {string|null} domain the project's domain, if any
 */
function localPath(href, domain) {
  let url;

  try {
    url = new URL(href, 'http://project.local/');
  } catch {
    return null;
  }

  const ownHost = url.host === 'project.local' || (domain && url.hostname === domain);

  if (!ownHost || !['http:', 'https:'].includes(url.protocol)) {
    return null;
  }

  return decodeURIComponent(url.pathname);
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

/**
 * One GET on the application's port.
 *
 * @returns {Promise<{status: number, type: string, body: Buffer}>}
 */
function getLocal(port, pathname, domain, maxBytes) {
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'SolarOps favicon', Accept: '*/*' };

    if (domain) {
      headers.Host = domain;
    }

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
          body: Buffer.concat(chunks),
        });
      });
      response.on('error', reject);
    });

    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
  });
}

async function applicationIcon(project) {
  const domain = project.network.domain || null;
  const candidates = [];

  try {
    const page = await getLocal(project.port, '/', domain, MAX_HTML_BYTES);

    if (page.status < 400 && page.type.includes('html')) {
      candidates.push(...declaredIcons(page.body.toString('utf8')));
    }
  } catch {
    // No home page: the usual favicon paths may still answer.
  }

  candidates.push(...FALLBACK_ICONS);

  for (const href of candidates) {
    const pathname = localPath(href, domain);

    if (pathname === null) {
      continue;
    }

    try {
      const icon = await getLocal(project.port, pathname, domain, MAX_ICON_BYTES);
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
    const pathname = localPath(href, project.network.domain || null);

    if (pathname === null) {
      continue;
    }

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
