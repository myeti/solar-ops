/**
 * Sequelize attribute definitions that transparently encrypt secrets at rest
 * (AES-256-GCM, see lib/crypto.js).
 *
 * The application always reads and writes plain values; only the database
 * sees ciphertext. IMPORTANT: because getters decrypt, never send a model's
 * `toJSON()` to the client. Use the explicit `toPublic()` serializers.
 */
import { DataTypes } from 'sequelize';
import { encrypt, decrypt } from '../lib/crypto.js';

/**
 * An encrypted text column.
 *
 * @param {string} attribute model attribute name
 * @param {string} field database column name
 */
export function encryptedString(attribute, field) {
  return {
    type: DataTypes.TEXT,
    allowNull: true,
    field,
    get() {
      const stored = this.getDataValue(attribute);

      if (stored === null || stored === undefined || stored === '') {
        return null;
      }

      return decrypt(stored);
    },
    set(value) {
      if (value === null || value === undefined || value === '') {
        this.setDataValue(attribute, null);
        return;
      }

      this.setDataValue(attribute, encrypt(String(value)));
    },
  };
}

/**
 * An encrypted column holding any JSON value.
 *
 * @param {string} attribute model attribute name
 * @param {string} field database column name
 * @param {*} emptyValue value returned when nothing is stored
 */
export function encryptedJson(attribute, field, emptyValue) {
  return {
    type: DataTypes.TEXT,
    allowNull: true,
    field,
    get() {
      const stored = this.getDataValue(attribute);

      if (stored === null || stored === undefined || stored === '') {
        return structuredClone(emptyValue);
      }

      return JSON.parse(decrypt(stored));
    },
    set(value) {
      if (value === null || value === undefined) {
        this.setDataValue(attribute, null);
        return;
      }

      this.setDataValue(attribute, encrypt(JSON.stringify(value)));
    },
  };
}

/**
 * A JSON column where only some keys are secret: those keys are encrypted,
 * the rest stays readable (handy when inspecting the database in an
 * emergency).
 *
 * @param {string} attribute model attribute name
 * @param {string} field database column name
 * @param {string[]} secretKeys keys of the object to encrypt
 */
export function jsonWithSecrets(attribute, field, secretKeys) {
  return {
    type: DataTypes.JSON,
    allowNull: true,
    field,
    get() {
      const stored = this.getDataValue(attribute);

      if (stored === null || stored === undefined) {
        return null;
      }

      const value = { ...stored };

      for (const key of secretKeys) {
        if (typeof value[key] === 'string' && value[key] !== '') {
          value[key] = decrypt(value[key]);
        }
      }

      return value;
    },
    set(value) {
      if (value === null || value === undefined) {
        this.setDataValue(attribute, null);
        return;
      }

      const stored = { ...value };

      for (const key of secretKeys) {
        if (typeof stored[key] === 'string' && stored[key] !== '') {
          stored[key] = encrypt(stored[key]);
        }
      }

      this.setDataValue(attribute, stored);
    },
  };
}
