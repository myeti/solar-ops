import { DataTypes, Model } from 'sequelize';
import sequelize from '../database/connection.js';

/**
 * A logged-in browser session. The primary key is the SHA-256 hash of the
 * cookie token: stealing the database does not give usable sessions.
 */
export default class Session extends Model {}

Session.init(
  {
    id: {
      type: DataTypes.STRING(64),
      primaryKey: true,
      allowNull: false,
    },
    adminId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    ip: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    userAgent: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    lastSeenAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  },
  {
    sequelize,
    modelName: 'Session',
    tableName: 'sessions',
    underscored: true,
    indexes: [{ fields: ['admin_id'] }],
  },
);
