/**
 * Small, dependency-free input validation.
 *
 * Usage:
 *   const input = new Validator(req.body);
 *   const name = input.string('name', { required: true, max: 80 });
 *   const port = input.integer('port', { min: 1, max: 65535 });
 *   input.assertValid(); // throws a 400 error listing every invalid field
 *
 * Every method returns the normalised value (or `undefined` / default when
 * the field is absent) and records an error message per invalid field, so
 * the UI can highlight all problems at once.
 */
import { badRequest } from './errors.js';

/** RFC 1123 hostname, at least two labels (example.com, app.example.co.uk). */
export const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:(?!-)[a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/;

/** Same as DOMAIN_PATTERN but allows a leading wildcard label (*.example.com). */
export const DOMAIN_OR_WILDCARD_PATTERN = /^(?:\*\.)?(?=.{1,253}$)(?:(?!-)[a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/;

/** Reasonable e-mail check (the SMTP server is the real judge). */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** POSIX-style environment variable name. */
export const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Folder name allowed directly inside the base folder. */
export const FOLDER_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

/** Absolute path made of safe characters (it ends up in nginx configs). */
export const ABSOLUTE_PATH_PATTERN = /^\/[A-Za-z0-9._/-]*$/;

/** Control characters are never accepted (tabs and line breaks aside). */
// eslint-disable-next-line no-control-regex -- matching control characters is the point.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const LINE_BREAKS = /[\r\n]/;

export class Validator {
  /**
   * @param {object} source the object to validate (usually `req.body`)
   */
  constructor(source) {
    this.source = source || {};
    this.errors = {};
  }

  /** Whether the field is present (not undefined / null). */
  has(field) {
    return this.source[field] !== undefined && this.source[field] !== null;
  }

  /** Record an error for a field (keeps the first one only). */
  fail(field, message) {
    if (this.errors[field] === undefined) {
      this.errors[field] = message;
    }
  }

  /**
   * Validate a string. Values are trimmed.
   *
   * @param {string} field
   * @param {object} [options]
   * @param {boolean} [options.required]
   * @param {number} [options.min] minimum length
   * @param {number} [options.max] maximum length (default 255)
   * @param {RegExp} [options.pattern]
   * @param {string} [options.patternMessage]
   * @param {boolean} [options.lowercase] normalise to lower case
   * @param {boolean} [options.trim] trim spaces (default true)
   * @param {boolean} [options.multiline] accept line breaks (scripts)
   * @param {string} [options.defaultValue]
   * @returns {string|undefined}
   */
  string(field, options = {}) {
    const maxLength = options.max ?? 255;
    const shouldTrim = options.trim ?? true;

    if (!this.has(field) || this.source[field] === '') {
      if (options.required) {
        this.fail(field, 'This field is required.');
      }
      return options.defaultValue;
    }

    if (typeof this.source[field] !== 'string' && typeof this.source[field] !== 'number') {
      this.fail(field, 'Must be a text value.');
      return undefined;
    }

    let value = String(this.source[field]);

    if (shouldTrim) {
      value = value.trim();
    }

    if (options.lowercase) {
      value = value.toLowerCase();
    }

    if (value === '' && options.required) {
      this.fail(field, 'This field is required.');
      return undefined;
    }

    if (CONTROL_CHARACTERS.test(value)) {
      this.fail(field, 'Contains invalid characters.');
      return undefined;
    }

    if (!options.multiline && LINE_BREAKS.test(value)) {
      this.fail(field, 'Must be a single line.');
      return undefined;
    }

    if (options.min !== undefined && value.length < options.min) {
      this.fail(field, `Must be at least ${options.min} characters.`);
    }

    if (value.length > maxLength) {
      this.fail(field, `Must be at most ${maxLength} characters.`);
    }

    if (options.pattern && value !== '' && !options.pattern.test(value)) {
      this.fail(field, options.patternMessage || 'Invalid format.');
    }

    return value;
  }

  /**
   * Validate an e-mail address (lower-cased).
   */
  email(field, options = {}) {
    return this.string(field, {
      ...options,
      max: 254,
      lowercase: true,
      pattern: EMAIL_PATTERN,
      patternMessage: 'Must be a valid e-mail address.',
    });
  }

  /**
   * Validate a domain name (lower-cased).
   */
  domain(field, options = {}) {
    return this.string(field, {
      ...options,
      max: 253,
      lowercase: true,
      pattern: DOMAIN_PATTERN,
      patternMessage: 'Must be a valid domain name, e.g. app.example.com',
    });
  }

  /**
   * Validate an integer, accepting numeric strings.
   *
   * @param {string} field
   * @param {object} [options]
   * @param {boolean} [options.required]
   * @param {number} [options.min]
   * @param {number} [options.max]
   * @param {number} [options.defaultValue]
   * @returns {number|undefined|null}
   */
  integer(field, options = {}) {
    if (!this.has(field) || this.source[field] === '') {
      if (options.required) {
        this.fail(field, 'This field is required.');
      }
      return options.defaultValue;
    }

    const value = Number(this.source[field]);

    if (!Number.isInteger(value)) {
      this.fail(field, 'Must be a whole number.');
      return undefined;
    }

    if (options.min !== undefined && value < options.min) {
      this.fail(field, `Must be greater than or equal to ${options.min}.`);
    }

    if (options.max !== undefined && value > options.max) {
      this.fail(field, `Must be less than or equal to ${options.max}.`);
    }

    return value;
  }

  /**
   * Validate a boolean (accepts true/false only).
   */
  boolean(field, options = {}) {
    if (!this.has(field)) {
      if (options.required) {
        this.fail(field, 'This field is required.');
      }
      return options.defaultValue;
    }

    if (typeof this.source[field] !== 'boolean') {
      this.fail(field, 'Must be true or false.');
      return undefined;
    }

    return this.source[field];
  }

  /**
   * Validate that a value is one of the allowed options.
   */
  oneOf(field, allowedValues, options = {}) {
    if (!this.has(field) || this.source[field] === '') {
      if (options.required) {
        this.fail(field, 'This field is required.');
      }
      return options.defaultValue;
    }

    const value = this.source[field];

    if (!allowedValues.includes(value)) {
      this.fail(field, `Must be one of: ${allowedValues.join(', ')}.`);
      return undefined;
    }

    return value;
  }

  /**
   * Validate an optional reference to another record (positive integer or null).
   */
  reference(field, options = {}) {
    if (!this.has(field) || this.source[field] === '') {
      if (options.required) {
        this.fail(field, 'Please make a selection.');
      }
      return null;
    }

    return this.integer(field, { min: 1 });
  }

  /**
   * Validate a list of environment variables: [{ key, value }].
   *
   * @returns {Array<{key: string, value: string}>|undefined}
   */
  envList(field) {
    if (!this.has(field)) {
      return undefined;
    }

    const list = this.source[field];

    if (!Array.isArray(list)) {
      this.fail(field, 'Must be a list of variables.');
      return undefined;
    }

    const seen = new Set();
    const result = [];

    for (const entry of list) {
      const key = String(entry?.key ?? '').trim();
      const value = String(entry?.value ?? '');

      if (key === '') {
        continue;
      }

      if (!ENV_KEY_PATTERN.test(key)) {
        this.fail(field, `"${key}" is not a valid variable name (letters, digits and _ only).`);
        continue;
      }

      if (seen.has(key)) {
        this.fail(field, `"${key}" is defined twice.`);
        continue;
      }

      if (value.length > 16384) {
        this.fail(field, `"${key}" is too long.`);
        continue;
      }

      seen.add(key);
      result.push({ key, value });
    }

    return result;
  }

  /**
   * Validate a relative path that must stay inside its parent folder
   * (no absolute path, no "..", conservative character set).
   */
  relativePath(field, options = {}) {
    const value = this.string(field, {
      ...options,
      max: 200,
      pattern: /^[A-Za-z0-9._/-]+$/,
      patternMessage: 'Only letters, digits, ".", "_", "-" and "/" are allowed.',
    });

    if (value === undefined || value === '') {
      return value;
    }

    const segments = value.split('/');

    if (value.startsWith('/') || segments.includes('..')) {
      this.fail(field, 'Must be a relative path inside the repository.');
    }

    return value.replace(/\/+$/, '');
  }

  /**
   * Throw a 400 error if any field is invalid.
   */
  assertValid() {
    const fields = Object.keys(this.errors);

    if (fields.length > 0) {
      throw badRequest('Some fields are invalid.', { fields: this.errors });
    }
  }
}
