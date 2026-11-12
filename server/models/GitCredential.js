import { DataTypes, Model } from 'sequelize';
import sequelize from '../database/connection.js';
import { encryptedString } from './encryptedAttributes.js';

export const GIT_PROVIDERS = ['github', 'gitlab', 'bitbucket', 'other'];

/**
 * Credentials used to clone / pull private repositories over HTTPS
 * (username + personal access token / app password).
 */
export default class GitCredential extends Model {
  toPublic() {
    const token = this.token || '';
    let tokenHint = '';

    if (token.length > 8) {
      tokenHint = `${token.slice(0, 4)}…${token.slice(-4)}`;
    }

    return {
      id: this.id,
      name: this.name,
      provider: this.provider,
      username: this.username,
      tokenHint,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

GitCredential.init(
  {
    name: {
      type: DataTypes.STRING(80),
      allowNull: false,
      unique: true,
    },
    provider: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    username: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
    token: { ...encryptedString('token', 'token_enc'), allowNull: false },
  },
  {
    sequelize,
    modelName: 'GitCredential',
    tableName: 'git_credentials',
    underscored: true,
  },
);
