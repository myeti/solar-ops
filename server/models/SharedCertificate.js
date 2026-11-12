import { DataTypes, Model } from 'sequelize';
import sequelize from '../database/connection.js';

/**
 * A Let's Encrypt certificate shared by several projects, typically a
 * wildcard (*.example.com). It is issued once through the DNS-01 challenge
 * (the only one Let's Encrypt accepts for wildcards), renewed once, and
 * selected explicitly by each project in its Network tab.
 *
 * `name` is the certbot lineage name: files live in
 * `<data dir>/certificates/letsencrypt/live/<name>/`.
 */
export default class SharedCertificate extends Model {
  toPublic() {
    return {
      id: this.id,
      name: this.name,
      domains: this.domains,
      dnsAccountId: this.dnsAccountId,
      autoRenew: this.autoRenew,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

SharedCertificate.init(
  {
    name: {
      type: DataTypes.STRING(40),
      allowNull: false,
      unique: true,
    },
    /** Names on the certificate, e.g. ["example.com", "*.example.com"]. */
    domains: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    dnsAccountId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    autoRenew: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    sequelize,
    modelName: 'SharedCertificate',
    tableName: 'shared_certificates',
    underscored: true,
  },
);
