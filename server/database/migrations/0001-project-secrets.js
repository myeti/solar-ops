/**
 * Projects get generated secrets (JWT_SECRET...), stored encrypted in a
 * new column: models/Project.js (secrets), services/projectSecrets.js.
 */
import { DataTypes } from 'sequelize';

export async function up({ queryInterface, transaction }) {
  const columns = await queryInterface.describeTable('projects', { transaction });

  if (!columns.secrets_enc) {
    await queryInterface.addColumn(
      'projects',
      'secrets_enc',
      { type: DataTypes.TEXT, allowNull: true },
      { transaction },
    );
  }
}
