import { DataTypes, Model } from 'sequelize';
import sequelize from '../database/connection.js';
import { encryptedString } from './encryptedAttributes.js';

/**
 * An SMTP relay usable by projects (SMTP_* variables) and by SolarOps
 * itself to send magic login links.
 */
export default class SmtpAccount extends Model {
  toPublic() {
    return {
      id: this.id,
      name: this.name,
      host: this.host,
      port: this.port,
      secure: this.secure,
      username: this.username,
      hasPassword: Boolean(this.getDataValue('password')),
      fromAddress: this.fromAddress,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

SmtpAccount.init(
  {
    name: {
      type: DataTypes.STRING(80),
      allowNull: false,
      unique: true,
    },
    host: {
      type: DataTypes.STRING(253),
      allowNull: false,
    },
    port: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    secure: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    username: {
      type: DataTypes.STRING(254),
      allowNull: true,
    },
    password: encryptedString('password', 'password_enc'),
    fromAddress: {
      type: DataTypes.STRING(254),
      allowNull: false,
    },
  },
  {
    sequelize,
    modelName: 'SmtpAccount',
    tableName: 'smtp_accounts',
    underscored: true,
  },
);
