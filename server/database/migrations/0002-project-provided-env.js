/**
 * Projects can provide variables to the others (Environment tab), stored
 * encrypted in a new column: models/Project.js (providedEnv),
 * services/environment.js.
 */
import { DataTypes } from 'sequelize';

export async function up({ queryInterface, transaction }) {
  const columns = await queryInterface.describeTable('projects', { transaction });

  if (!columns.provided_env_enc) {
    await queryInterface.addColumn(
      'projects',
      'provided_env_enc',
      { type: DataTypes.TEXT, allowNull: true },
      { transaction },
    );
  }
}
