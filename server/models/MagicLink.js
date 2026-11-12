import { DataTypes, Model } from 'sequelize';
import sequelize from '../database/connection.js';

/**
 * A one-time login link sent by e-mail. Only the token hash is stored.
 */
export default class MagicLink extends Model {}

MagicLink.init(
  {
    tokenHash: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
    },
    adminId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    usedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'MagicLink',
    tableName: 'magic_links',
    underscored: true,
  },
);
