import { DataTypes, Model } from 'sequelize';
import sequelize from '../database/connection.js';

/**
 * Append-only journal of sensitive actions (logins, configuration changes,
 * deployments, secret reveals...).
 */
export default class AuditLog extends Model {
  toPublic() {
    return {
      id: this.id,
      actor: this.actor,
      action: this.action,
      target: this.target,
      details: this.details || {},
      ip: this.ip,
      createdAt: this.createdAt,
    };
  }
}

AuditLog.init(
  {
    adminId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    actor: {
      type: DataTypes.STRING(254),
      allowNull: false,
    },
    action: {
      type: DataTypes.STRING(80),
      allowNull: false,
    },
    target: {
      type: DataTypes.STRING(200),
      allowNull: true,
    },
    details: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    ip: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'AuditLog',
    tableName: 'audit_logs',
    underscored: true,
    updatedAt: false,
    indexes: [{ fields: ['created_at'] }],
  },
);
