import { DataTypes, Model } from 'sequelize';
import sequelize from '../database/connection.js';

export const TASK_STATUSES = ['queued', 'running', 'success', 'failed'];

/**
 * A long running operation (deployment, certificate, database dump...)
 * with its full log. See services/taskRunner.js.
 */
export default class Task extends Model {
  /**
   * @param {object} [options]
   * @param {boolean} [options.withLog] include the (possibly large) log
   */
  toPublic(options = {}) {
    const result = {
      id: this.id,
      projectId: this.projectId,
      type: this.type,
      title: this.title,
      status: this.status,
      trigger: this.trigger,
      triggeredBy: this.triggeredBy,
      meta: this.meta || {},
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
    };

    if (this.project) {
      result.project = {
        uid: this.project.uid,
        name: this.project.name,
      };
    }

    if (options.withLog) {
      result.log = this.log;
    }

    return result;
  }
}

Task.init(
  {
    projectId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    type: {
      type: DataTypes.STRING(40),
      allowNull: false,
    },
    title: {
      type: DataTypes.STRING(200),
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'queued',
    },
    trigger: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'manual',
    },
    triggeredBy: {
      type: DataTypes.STRING(254),
      allowNull: true,
    },
    log: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: '',
    },
    meta: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    startedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    finishedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'Task',
    tableName: 'tasks',
    underscored: true,
    // Project history, newest first.
    indexes: [{ fields: ['project_id', 'created_at'] }],
  },
);
