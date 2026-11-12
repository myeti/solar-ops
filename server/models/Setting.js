import { DataTypes, Model } from 'sequelize';
import sequelize from '../database/connection.js';

/**
 * Key / value store for SolarOps settings. Values are JSON encoded.
 * Use services/settings.js rather than this model directly: it knows the
 * defaults and which values are secret.
 */
export default class Setting extends Model {}

Setting.init(
  {
    key: {
      type: DataTypes.STRING(64),
      primaryKey: true,
      allowNull: false,
    },
    value: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
  },
  {
    sequelize,
    modelName: 'Setting',
    tableName: 'settings',
    underscored: true,
  },
);
