import { DataTypes, Model } from 'sequelize';
import sequelize from '../database/connection.js';
import { encryptedJson } from './encryptedAttributes.js';

/**
 * A DNS provider account (OVH, Cloudflare...) used by certbot to solve the
 * DNS-01 challenge. Required for wildcard certificates and for servers not
 * reachable on port 80.
 */
export default class DnsAccount extends Model {
  toPublic() {
    return {
      id: this.id,
      name: this.name,
      provider: this.provider,
      propagationSeconds: this.propagationSeconds,
      configuredFields: Object.keys(this.credentials || {}),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

DnsAccount.init(
  {
    name: {
      type: DataTypes.STRING(80),
      allowNull: false,
      unique: true,
    },
    provider: {
      type: DataTypes.STRING(30),
      allowNull: false,
    },
    credentials: { ...encryptedJson('credentials', 'credentials_enc', {}), allowNull: false },
    propagationSeconds: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 60,
    },
  },
  {
    sequelize,
    modelName: 'DnsAccount',
    tableName: 'dns_accounts',
    underscored: true,
  },
);
