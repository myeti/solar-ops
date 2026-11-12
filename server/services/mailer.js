/**
 * E-mail sending through a configured SMTP account (nodemailer).
 */
import nodemailer from 'nodemailer';

/**
 * Build a nodemailer transport for an SMTP account.
 *
 * @param {import('../models/SmtpAccount.js').default} account
 */
function createTransport(account) {
  const options = {
    host: account.host,
    port: account.port,
    secure: account.secure,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  };

  if (account.username) {
    options.auth = {
      user: account.username,
      pass: account.password || '',
    };
  }

  return nodemailer.createTransport(options);
}

/**
 * Send an e-mail.
 *
 * @param {import('../models/SmtpAccount.js').default} account
 * @param {object} message
 * @param {string} message.to
 * @param {string} message.subject
 * @param {string} message.text
 * @param {string} [message.html]
 */
export async function sendMail(account, { to, subject, text, html }) {
  const transport = createTransport(account);

  try {
    return await transport.sendMail({
      from: account.fromAddress,
      to,
      subject,
      text,
      html,
    });
  } finally {
    transport.close();
  }
}

/**
 * Check that the SMTP server accepts the connection and credentials.
 *
 * @param {import('../models/SmtpAccount.js').default} account
 */
export async function verifySmtpAccount(account) {
  const transport = createTransport(account);

  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

/**
 * Escape text for safe inclusion in an HTML e-mail.
 *
 * @param {string} value
 */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
