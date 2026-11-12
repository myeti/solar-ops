/**
 * Cryptographic helpers: secrets encryption at rest, password hashing and
 * random tokens. Only Node's built-in `crypto` module is used.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const scryptAsync = promisify(crypto.scrypt);

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_VERSION = 'v1';

/**
 * scrypt parameters (N = 2^16, r = 8, p = 1 => 64 MiB per hash).
 * They are stored alongside each hash so they can be raised later
 * without breaking existing passwords.
 */
const SCRYPT_PARAMS = { N: 65536, r: 8, p: 1 };
const SCRYPT_KEY_LENGTH = 64;

/** Characters used for generated passwords (no ambiguous characters). */
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

let masterKey = null;

/**
 * Load (or create on first run) the master key used to encrypt secrets.
 *
 * @param {object} options
 * @param {string} options.dataDir directory where `master.key` lives
 * @param {string} [options.fromEnvironment] key provided through the environment
 */
export function initMasterKey({ dataDir, fromEnvironment }) {
  if (fromEnvironment) {
    masterKey = decodeKey(fromEnvironment);
    return;
  }

  const keyFile = path.join(dataDir, 'master.key');

  if (!fs.existsSync(keyFile)) {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const generated = crypto.randomBytes(32).toString('base64');
    fs.writeFileSync(keyFile, `${generated}\n`, { mode: 0o600, flag: 'wx' });
  }

  masterKey = decodeKey(fs.readFileSync(keyFile, 'utf8').trim());
}

/**
 * Decode a 32-byte key written either in hex or in base64.
 *
 * @param {string} value
 * @returns {Buffer}
 */
function decodeKey(value) {
  let key;

  if (/^[0-9a-f]{64}$/i.test(value)) {
    key = Buffer.from(value, 'hex');
  } else {
    key = Buffer.from(value, 'base64');
  }

  if (key.length !== 32) {
    throw new Error('The SolarOps master key must be exactly 32 bytes (hex or base64 encoded).');
  }

  return key;
}

function requireMasterKey() {
  if (masterKey === null) {
    throw new Error('Master key not initialised: call initMasterKey() first.');
  }

  return masterKey;
}

/**
 * Encrypt a string with AES-256-GCM.
 * Output format: `v1:<iv>:<auth tag>:<ciphertext>` (base64 parts).
 *
 * @param {string} plaintext
 * @returns {string}
 */
export function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, requireMasterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [ENCRYPTION_VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

/**
 * Decrypt a value produced by `encrypt()`.
 *
 * @param {string} payload
 * @returns {string}
 */
export function decrypt(payload) {
  const parts = String(payload).split(':');

  if (parts.length !== 4 || parts[0] !== ENCRYPTION_VERSION) {
    throw new Error('Unsupported encrypted payload.');
  }

  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const ciphertext = Buffer.from(parts[3], 'base64');

  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, requireMasterKey(), iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Hash a password with scrypt and a random salt.
 * Format: `scrypt$N$r$p$<salt base64>$<hash base64>`.
 *
 * @param {string} password
 * @returns {Promise<string>}
 */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await deriveKey(password, salt, SCRYPT_PARAMS);

  return [
    'scrypt',
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/**
 * Check a password against a hash produced by `hashPassword()`.
 * The comparison is constant-time.
 *
 * @param {string} password
 * @param {string} storedHash
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, storedHash) {
  const parts = String(storedHash).split('$');

  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }

  const params = {
    N: Number(parts[1]),
    r: Number(parts[2]),
    p: Number(parts[3]),
  };
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  const derived = await deriveKey(password, salt, params);

  if (derived.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(derived, expected);
}

/**
 * Run scrypt with enough memory headroom for the given parameters.
 */
function deriveKey(password, salt, params) {
  const maxmem = 256 * params.N * params.r;

  return scryptAsync(String(password), salt, SCRYPT_KEY_LENGTH, { ...params, maxmem });
}

let dummyHashPromise = null;

/**
 * A valid hash for a random password. Verifying against it when an account
 * does not exist keeps login timing identical (prevents user enumeration).
 *
 * @returns {Promise<string>}
 */
export function getDummyPasswordHash() {
  if (dummyHashPromise === null) {
    dummyHashPromise = hashPassword(randomToken(16));
  }

  return dummyHashPromise;
}

/**
 * Cryptographically secure random token, URL safe.
 *
 * @param {number} [bytes=32]
 * @returns {string}
 */
export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * SHA-256 hex digest, used to store tokens (sessions, magic links) so a
 * database leak does not leak usable tokens.
 *
 * @param {string} value
 * @returns {string}
 */
export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/**
 * HMAC-SHA256 hex digest.
 *
 * @param {string} secret
 * @param {Buffer|string} payload
 * @returns {string}
 */
export function hmacSha256(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Constant-time string comparison.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function safeEqual(a, b) {
  const bufferA = Buffer.from(String(a));
  const bufferB = Buffer.from(String(b));

  if (bufferA.length !== bufferB.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufferA, bufferB);
}

/**
 * Generate a strong random password.
 *
 * @param {number} [length=24]
 * @returns {string}
 */
export function generatePassword(length = 24) {
  let password = '';

  for (let index = 0; index < length; index += 1) {
    password += PASSWORD_ALPHABET[crypto.randomInt(PASSWORD_ALPHABET.length)];
  }

  return password;
}
