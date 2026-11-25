/**
 * Projects can get their own Redis instance (Redis tab): its settings in a
 * new column, the password encrypted: models/Project.js (redisConfig),
 * services/redis.js.
 */
import { DataTypes } from 'sequelize';

export async function up({ queryInterface, transaction }) {
  const columns = await queryInterface.describeTable('projects', { transaction });

  if (!columns.redis_config) {
    await queryInterface.addColumn(
      'projects',
      'redis_config',
      { type: DataTypes.JSON, allowNull: true },
      { transaction },
    );
  }
}
