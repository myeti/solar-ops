import { DataTypes, Model } from 'sequelize';
import sequelize from '../database/connection.js';
import { encryptedJson, jsonWithSecrets } from './encryptedAttributes.js';

export const DEFAULT_BUILD_COMMAND = 'npm run build';
export const DEFAULT_START_COMMAND = 'npm start';

/** Default nginx client_max_body_size of a project, in MB. */
export const DEFAULT_MAX_UPLOAD_MB = 100;

/**
 * - app:    a process run by pm2, with a port (PORT), behind nginx as a reverse proxy;
 * - static: a frontend only site: no process, no port, nginx serves its files.
 */
export const PROJECT_TYPES = ['app', 'static'];

/**
 * A project hosted on the server.
 *
 * Each optional component (deployment, database, smtp, network) is stored as
 * a JSON object with an `enabled` flag, so disabling a component keeps its
 * configuration for later. Secret keys inside those objects are encrypted.
 */
export default class Project extends Model {
  /** Default configuration of the deployment component. */
  static defaultDeployment() {
    return {
      enabled: false,
      gitCredentialId: null,
      url: '',
      branch: 'main',
      installCommand: '',
      buildCommand: DEFAULT_BUILD_COMMAND,
      restartAfterDeploy: true,
      webhookEnabled: false,
      webhookSecret: '',
      // Seconds the app is given to answer on / after a (re)start; null:
      // SOLAROPS_LIVENESS_TIMEOUT_SECONDS (see services/health.js).
      livenessTimeoutSeconds: null,
    };
  }

  /**
   * Default configuration of the database component. `adopted` marks a
   * database that existed before SolarOps (linked, never created, wiped or
   * dropped by SolarOps).
   */
  static defaultDatabase() {
    return {
      enabled: false,
      name: '',
      user: '',
      password: '',
      adopted: false,
      provisionedAt: null,
      linkedAt: null,
      backups: Project.defaultBackups(),
    };
  }

  /**
   * Default scheduled backups of the database (off): a dump every day (or
   * every week on `weekday`, 0 = Sunday) at `hour` (server time), keeping
   * the last `keep` automatic dumps. See services/backups.js.
   */
  static defaultBackups() {
    return {
      enabled: false,
      frequency: 'daily',
      hour: 3,
      weekday: 0,
      keep: 7,
      // Slots before this date are never caught up (no backup on enabling).
      enabledAt: null,
      lastRunAt: null,
    };
  }

  /** Default configuration of the SMTP component. */
  static defaultSmtp() {
    return {
      enabled: false,
      accountId: null,
      // Sender given as SMTP_FROM; empty: the relay's from address.
      fromAddress: '',
    };
  }

  /** Default configuration of the network component. */
  static defaultNetwork() {
    return {
      enabled: false,
      domain: '',
      aliases: [],
      mode: 'proxy',
      publicFolder: 'dist',
      spaFallback: true,
      // none | http | dns | shared (see SharedCertificate)
      certMethod: 'none',
      dnsAccountId: null,
      sharedCertificateId: null,
      // DNS account last used to create the A / AAAA records (Network tab).
      recordsAccountId: null,
      autoRenew: true,
      forceHttps: true,
      clientMaxBodySize: DEFAULT_MAX_UPLOAD_MB,
      appliedAt: null,
    };
  }

  /** Deployment config merged with defaults (never null). */
  get deployment() {
    return { ...Project.defaultDeployment(), ...(this.deploymentConfig || {}) };
  }

  /** Database config merged with defaults (never null). */
  get database() {
    const stored = this.databaseConfig || {};

    return {
      ...Project.defaultDatabase(),
      ...stored,
      backups: { ...Project.defaultBackups(), ...(stored.backups || {}) },
    };
  }

  /** SMTP config merged with defaults (never null). */
  get smtp() {
    return { ...Project.defaultSmtp(), ...(this.smtpConfig || {}) };
  }

  /** Whether the project runs a process (pm2, port...). */
  get isStatic() {
    return this.type === 'static';
  }

  /**
   * Network config merged with defaults (never null). How nginx serves the
   * project always follows its type.
   */
  get network() {
    let mode = 'proxy';

    if (this.isStatic) {
      mode = 'static';
    }

    return { ...Project.defaultNetwork(), ...(this.networkConfig || {}), mode };
  }

  /**
   * Safe representation for the API: secrets are replaced by flags.
   */
  toPublic() {
    const deployment = this.deployment;
    const database = this.database;

    return {
      id: this.id,
      uid: this.uid,
      name: this.name,
      active: this.active,
      system: this.system,
      folder: this.folder,
      folderExisted: this.folderExisted,
      type: this.type,
      port: this.port,
      startCommand: this.startCommand,
      envCount: this.env.length,
      deployment: {
        enabled: deployment.enabled,
        gitCredentialId: deployment.gitCredentialId,
        url: deployment.url,
        branch: deployment.branch,
        installCommand: deployment.installCommand,
        buildCommand: deployment.buildCommand,
        restartAfterDeploy: deployment.restartAfterDeploy,
        webhookEnabled: deployment.webhookEnabled,
        hasWebhookSecret: Boolean(deployment.webhookSecret),
        livenessTimeoutSeconds: deployment.livenessTimeoutSeconds,
      },
      database: {
        enabled: database.enabled,
        name: database.name,
        user: database.user,
        adopted: database.adopted,
        provisionedAt: database.provisionedAt,
        linkedAt: database.linkedAt,
        backups: database.backups,
      },
      smtp: this.smtp,
      network: this.network,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

Project.init(
  {
    uid: {
      type: DataTypes.STRING(40),
      allowNull: false,
      unique: true,
    },
    name: {
      type: DataTypes.STRING(80),
      allowNull: false,
    },
    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    /** SolarOps itself (see services/systemProject.js). */
    system: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    folder: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
    },
    /** The folder already existed when the project was created (adopted). */
    folderExisted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    startCommand: {
      type: DataTypes.STRING(500),
      allowNull: false,
      defaultValue: DEFAULT_START_COMMAND,
    },
    /** "app" or "static" (see PROJECT_TYPES). */
    type: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: 'app',
    },
    /**
     * Port of an application, unique across projects: given as PORT at
     * startup and used by the nginx reverse proxy (see services/ports.js).
     * Static sites have none.
     */
    port: {
      type: DataTypes.INTEGER,
      allowNull: true,
      unique: true,
    },
    /** Extra environment variables: [{ key, value }], fully encrypted. */
    env: encryptedJson('env', 'env_enc', []),
    deploymentConfig: jsonWithSecrets('deploymentConfig', 'deployment_config', ['webhookSecret']),
    databaseConfig: jsonWithSecrets('databaseConfig', 'database_config', ['password']),
    smtpConfig: {
      type: DataTypes.JSON,
      allowNull: true,
      field: 'smtp_config',
    },
    networkConfig: {
      type: DataTypes.JSON,
      allowNull: true,
      field: 'network_config',
    },
  },
  {
    sequelize,
    modelName: 'Project',
    tableName: 'projects',
    underscored: true,
  },
);
