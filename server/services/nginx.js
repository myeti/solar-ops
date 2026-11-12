/**
 * nginx configuration management.
 *
 * Every project has its own `etc/nginx.conf` containing complete `server`
 * blocks. nginx loads all of them through a single include placed once in
 * its http context (done by deploy/install.sh):
 *
 *     include <base folder>/*\/etc/nginx.conf;
 *
 * Applying a configuration is transactional: the new file is written, then
 * `nginx -t` validates the whole configuration. On failure the previous file
 * is restored, so a mistake never takes the other projects down.
 */
import fs from 'node:fs/promises';
import config from '../config.js';
import { runConfiguredCommand } from '../lib/exec.js';
import { conflict } from '../lib/errors.js';
import { ensureDirectory, readFileOrNull, writeFileAtomic, writeManagedFile } from '../lib/files.js';
import { findServableCertificateFiles } from './certificates.js';
import { NGINX_MARKER, resolveProjectPaths } from './projectPaths.js';

const NGINX_TIMEOUT_MS = 30 * 1000;

// Generated configs start with NGINX_MARKER: files without it are never touched.

/** Serialises every nginx change: test + reload must not interleave. */
let nginxQueue = Promise.resolve();

/**
 * Run `work` once every previous nginx operation is finished.
 *
 * @template T
 * @param {() => Promise<T>} work
 * @returns {Promise<T>}
 */
function withNginxLock(work) {
  const run = nginxQueue.then(work);

  nginxQueue = run.catch(() => {});

  return run;
}

/**
 * The include directive to add to nginx's http block.
 *
 * @param {string} baseFolder
 */
export function nginxIncludeDirective(baseFolder) {
  return `include ${baseFolder.replace(/\/+$/, '')}/*/etc/nginx.conf;`;
}

/**
 * Indent every line of a block.
 */
function indent(lines, level = 1) {
  const prefix = '    '.repeat(level);

  return lines.map((line) => {
    if (line === '') {
      return '';
    }
    return `${prefix}${line}`;
  });
}

/**
 * `listen` directives for a port.
 */
function listenDirectives(port, ssl) {
  let suffix = '';

  if (ssl) {
    suffix = ' ssl http2';
  }

  const lines = [`listen ${port}${suffix};`];

  if (config.nginx.ipv6) {
    lines.push(`listen [::]:${port}${suffix};`);
  }

  return lines;
}

/**
 * Directives serving the application itself (reverse proxy or static files).
 *
 * @param {object} network project network config
 * @param {object} paths project paths
 * @param {number} port project port (reverse proxy target)
 * @returns {string[]}
 */
function applicationDirectives(network, paths, port) {
  const lines = [
    `client_max_body_size ${network.clientMaxBodySize}m;`,
    '',
    'gzip on;',
    'gzip_types text/plain text/css application/json application/javascript text/xml application/xml image/svg+xml;',
    '',
    '# Never serve hidden files (.git, .env...)',
    'location ~ /\\.(?!well-known) {',
    '    deny all;',
    '}',
    '',
  ];

  if (network.mode === 'static') {
    let fallback = '=404';

    if (network.spaFallback) {
      fallback = '/index.html';
    }

    lines.push(
      `root ${paths.repo}/${network.publicFolder};`,
      'index index.html;',
      '# Never follow symlinks leaving the repository (e.g. to /etc)',
      'disable_symlinks if_not_owner from=$document_root;',
      '',
      'location / {',
      `    try_files $uri $uri/ ${fallback};`,
      '}',
      '',
      'location ~* \\.(?:css|js|mjs|woff2?|ttf|otf|eot|svg|png|jpe?g|gif|webp|avif|ico)$ {',
      '    expires 30d;',
      '    try_files $uri =404;',
      '}',
    );

    return lines;
  }

  lines.push(
    'location / {',
    `    proxy_pass http://127.0.0.1:${port};`,
    '    proxy_http_version 1.1;',
    '    proxy_set_header Host $host;',
    '    proxy_set_header X-Real-IP $remote_addr;',
    '    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
    '    proxy_set_header X-Forwarded-Proto $scheme;',
    '    proxy_set_header X-Forwarded-Host $host;',
    '    # WebSocket support',
    '    proxy_set_header Upgrade $http_upgrade;',
    '    proxy_set_header Connection $http_connection;',
    '    proxy_read_timeout 300s;',
    '    proxy_send_timeout 300s;',
    '}',
  );

  return lines;
}

/**
 * Render the nginx configuration of a project.
 *
 * @param {object} options
 * @param {import('../models/Project.js').default} options.project
 * @param {ReturnType<import('./projectPaths.js').getProjectPaths>} options.paths
 * @param {{fullchain: string, privateKey: string}|null} options.certificateFiles
 *   certificate to serve HTTPS with (the project's own or a shared one),
 *   null for HTTP only
 * @returns {string}
 */
export function renderNginxConfig({ project, paths, certificateFiles }) {
  const network = project.network;
  const https = certificateFiles !== null;
  const serverNames = [network.domain, ...network.aliases].join(' ');
  const redirectToHttps = https && network.forceHttps;
  // The name is free text: keep it on its comment line, whatever it contains.
  const safeName = String(project.name).replace(/[^\p{L}\p{N} ._'-]/gu, ' ');
  const lines = [
    `${NGINX_MARKER} — manual changes will be overwritten.`,
    `# Project: ${safeName} (${project.uid})`,
    '',
    'server {',
  ];

  const httpBlock = [
    ...listenDirectives(80, false),
    `server_name ${serverNames};`,
    '',
    "# Let's Encrypt HTTP-01 challenges",
    'location ^~ /.well-known/acme-challenge/ {',
    `    root ${paths.acme};`,
    '    default_type "text/plain";',
    '    try_files $uri =404;',
    '}',
    '',
  ];

  if (redirectToHttps) {
    httpBlock.push('location / {', '    return 301 https://$host$request_uri;', '}');
  } else {
    httpBlock.push(...applicationDirectives(network, paths, project.port));
  }

  lines.push(...indent(httpBlock), '}');

  if (https) {
    const httpsBlock = [
      ...listenDirectives(443, true),
      `server_name ${serverNames};`,
      '',
      `ssl_certificate ${certificateFiles.fullchain};`,
      `ssl_certificate_key ${certificateFiles.privateKey};`,
      'ssl_protocols TLSv1.2 TLSv1.3;',
      'ssl_prefer_server_ciphers off;',
      'ssl_session_cache shared:SolarOpsSSL:10m;',
      'ssl_session_timeout 1d;',
    ];

    if (network.forceHttps) {
      httpsBlock.push('add_header Strict-Transport-Security "max-age=31536000" always;');
    }

    httpsBlock.push('', ...applicationDirectives(network, paths, project.port));
    lines.push('', 'server {', ...indent(httpsBlock), '}');
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Whether nginx should currently serve this project.
 *
 * @param {import('../models/Project.js').default} project
 */
function shouldServe(project) {
  const network = project.network;
  const hasTarget = network.mode === 'static' || Boolean(project.port);

  return project.active && network.enabled && Boolean(network.domain) && hasTarget;
}

/**
 * Validate the whole nginx configuration, then reload nginx.
 */
export async function testAndReloadNginx() {
  await runConfiguredCommand(config.commands.nginxTest, [], { timeoutMs: NGINX_TIMEOUT_MS });
  await runConfiguredCommand(config.commands.nginxReload, [], { timeoutMs: NGINX_TIMEOUT_MS });
}

/**
 * Validate and reload nginx, queued with the other nginx changes. Needed
 * after a renewal: certbot updates the files, the config stays the same,
 * and nginx only reads certificates when it (re)loads.
 */
export function reloadNginx() {
  return withNginxLock(testAndReloadNginx);
}

/**
 * Put back the previous configuration file after a failed test.
 */
async function restorePrevious(filePath, previous) {
  if (previous === null) {
    await fs.rm(filePath, { force: true });
    return;
  }

  await writeFileAtomic(filePath, previous, 0o644);
}

/**
 * Preview the configuration that would be applied (or null when the
 * project is not served).
 *
 * @param {import('../models/Project.js').default} project
 */
export async function previewProjectNginx(project) {
  if (!shouldServe(project)) {
    return null;
  }

  const paths = await resolveProjectPaths(project);
  const certificateFiles = await findServableCertificateFiles(project, paths);

  return renderNginxConfig({ project, paths, certificateFiles });
}

/**
 * Write (or remove) the nginx configuration of a project and reload nginx.
 * Rolls back on failure and rethrows the nginx error.
 *
 * @param {import('../models/Project.js').default} project
 * @returns {Promise<{served: boolean, https: boolean, changed: boolean}>}
 */
export function applyProjectNginx(project) {
  return withNginxLock(async () => {
    const paths = await resolveProjectPaths(project);
    const previous = await readFileOrNull(paths.nginxConfig);
    const previousIsForeign = previous !== null && !previous.includes(NGINX_MARKER);

    if (!shouldServe(project)) {
      // A file SolarOps did not write is never deleted.
      if (previous === null || previousIsForeign) {
        return { served: false, https: false, changed: false };
      }

      await fs.rm(paths.nginxConfig, { force: true });

      try {
        await testAndReloadNginx();
      } catch (error) {
        await restorePrevious(paths.nginxConfig, previous);
        throw error;
      }

      return { served: false, https: false, changed: true };
    }

    if (previousIsForeign) {
      throw conflict(
        `${paths.nginxConfig} already exists and was not generated by SolarOps: it was left untouched (nginx already loads it). Move it away to let SolarOps manage the domain.`,
      );
    }

    const certificateFiles = await findServableCertificateFiles(project, paths);
    const https = certificateFiles !== null;
    const content = renderNginxConfig({ project, paths, certificateFiles });

    if (content === previous) {
      return { served: true, https, changed: false };
    }

    await ensureDirectory(paths.acme, 0o755);
    await writeManagedFile(paths.nginxConfig, content, { marker: NGINX_MARKER, mode: 0o644 });

    try {
      await testAndReloadNginx();
    } catch (error) {
      await restorePrevious(paths.nginxConfig, previous);
      throw error;
    }

    return { served: true, https, changed: true };
  });
}

/**
 * Remove the configuration of a project (used when deleting it).
 *
 * @param {import('../models/Project.js').default} project
 */
export function removeProjectNginx(project) {
  return withNginxLock(async () => {
    const paths = await resolveProjectPaths(project);
    const previous = await readFileOrNull(paths.nginxConfig);

    // A file SolarOps did not write is never deleted.
    if (previous === null || !previous.includes(NGINX_MARKER)) {
      return;
    }

    await fs.rm(paths.nginxConfig, { force: true });
    await testAndReloadNginx();
  });
}
