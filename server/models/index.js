/**
 * Model registry and associations.
 */
import Admin from './Admin.js';
import AuditLog from './AuditLog.js';
import DnsAccount from './DnsAccount.js';
import GitCredential from './GitCredential.js';
import MagicLink from './MagicLink.js';
import Project from './Project.js';
import Session from './Session.js';
import Setting from './Setting.js';
import SharedCertificate from './SharedCertificate.js';
import SmtpAccount from './SmtpAccount.js';
import Task from './Task.js';

Session.belongsTo(Admin, { as: 'admin', foreignKey: 'adminId', onDelete: 'CASCADE' });
Admin.hasMany(Session, { as: 'sessions', foreignKey: 'adminId' });

MagicLink.belongsTo(Admin, { as: 'admin', foreignKey: 'adminId', onDelete: 'CASCADE' });

AuditLog.belongsTo(Admin, { as: 'admin', foreignKey: 'adminId', onDelete: 'SET NULL' });

Task.belongsTo(Project, { as: 'project', foreignKey: 'projectId', onDelete: 'CASCADE' });

// A DNS account still used by a shared certificate cannot be deleted.
SharedCertificate.belongsTo(DnsAccount, { as: 'dnsAccount', foreignKey: 'dnsAccountId', onDelete: 'RESTRICT' });
Project.hasMany(Task, { as: 'tasks', foreignKey: 'projectId' });

export {
  Admin,
  AuditLog,
  DnsAccount,
  GitCredential,
  MagicLink,
  Project,
  Session,
  Setting,
  SharedCertificate,
  SmtpAccount,
  Task,
};
