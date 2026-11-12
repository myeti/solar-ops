import { DataTypes, Model } from 'sequelize';
import sequelize from '../database/connection.js';

/**
 * A SolarOps administrator. Every admin has full control over the server.
 */
export default class Admin extends Model {
  /**
   * Safe representation for the API (never includes the password hash).
   */
  toPublic() {
    return {
      id: this.id,
      email: this.email,
      lastLoginAt: this.lastLoginAt,
      createdAt: this.createdAt,
    };
  }
}

Admin.init(
  {
    email: {
      type: DataTypes.STRING(254),
      allowNull: false,
      unique: true,
      set(value) {
        this.setDataValue('email', String(value).trim().toLowerCase());
      },
    },
    passwordHash: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    lastLoginAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'Admin',
    tableName: 'admins',
    underscored: true,
  },
);
