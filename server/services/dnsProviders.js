/**
 * DNS providers supported for Let's Encrypt DNS-01 challenges.
 *
 * Each provider maps to a certbot DNS plugin and describes:
 *   - the fields asked in the UI (secret fields are never sent back),
 *   - how to render the plugin credentials .ini file.
 *
 * To add a provider: add an entry here and install its certbot plugin.
 */

import { DNS_CREDENTIALS_MARKER } from './projectPaths.js';

export const DNS_PROVIDERS = {
  ovh: {
    label: 'OVHcloud',
    plugin: 'dns-ovh',
    systemPackage: 'python3-certbot-dns-ovh',
    help: 'Create an API token at https://www.ovh.com/auth/api/createToken with GET, POST, PUT and DELETE rights on /domain/zone/*.',
    fields: [
      {
        key: 'endpoint',
        label: 'API endpoint',
        type: 'select',
        options: ['ovh-eu', 'ovh-ca', 'ovh-us', 'kimsufi-eu', 'kimsufi-ca', 'soyoustart-eu', 'soyoustart-ca'],
        defaultValue: 'ovh-eu',
        secret: false,
      },
      { key: 'applicationKey', label: 'Application key', type: 'text', secret: false },
      { key: 'applicationSecret', label: 'Application secret', type: 'password', secret: true },
      { key: 'consumerKey', label: 'Consumer key', type: 'password', secret: true },
    ],
    ini(credentials) {
      return {
        dns_ovh_endpoint: credentials.endpoint,
        dns_ovh_application_key: credentials.applicationKey,
        dns_ovh_application_secret: credentials.applicationSecret,
        dns_ovh_consumer_key: credentials.consumerKey,
      };
    },
  },
  cloudflare: {
    label: 'Cloudflare',
    plugin: 'dns-cloudflare',
    systemPackage: 'python3-certbot-dns-cloudflare',
    help: 'Create an API token with the "Zone › DNS › Edit" permission on the zones you use.',
    fields: [{ key: 'apiToken', label: 'API token', type: 'password', secret: true }],
    ini(credentials) {
      return {
        dns_cloudflare_api_token: credentials.apiToken,
      };
    },
  },
  digitalocean: {
    label: 'DigitalOcean',
    plugin: 'dns-digitalocean',
    systemPackage: 'python3-certbot-dns-digitalocean',
    help: 'Create a personal access token with write scope in the DigitalOcean control panel (API › Tokens).',
    fields: [{ key: 'token', label: 'Access token', type: 'password', secret: true }],
    ini(credentials) {
      return {
        dns_digitalocean_token: credentials.token,
      };
    },
  },
};

/**
 * Provider definitions safe to send to the UI (no functions).
 */
export function listDnsProviders() {
  return Object.entries(DNS_PROVIDERS).map(([id, provider]) => {
    return {
      id,
      label: provider.label,
      plugin: provider.plugin,
      systemPackage: provider.systemPackage,
      help: provider.help,
      fields: provider.fields,
    };
  });
}

/**
 * Render the certbot credentials file of a DNS account.
 *
 * @param {import('../models/DnsAccount.js').default} account
 * @returns {string}
 */
export function renderCredentialsIni(account) {
  const provider = DNS_PROVIDERS[account.provider];

  if (!provider) {
    throw new Error(`Unknown DNS provider "${account.provider}".`);
  }

  const values = provider.ini(account.credentials || {});
  const lines = [`${DNS_CREDENTIALS_MARKER} — certbot DNS plugin credentials`];

  for (const [key, value] of Object.entries(values)) {
    const text = String(value ?? '');

    if (/[\r\n]/.test(text)) {
      throw new Error(`Invalid value for ${key}.`);
    }

    lines.push(`${key} = ${text}`);
  }

  return `${lines.join('\n')}\n`;
}
