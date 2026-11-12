/**
 * Human readable labels for audit actions.
 */

const AUDIT_ACTIONS = {
  'setup.complete': { label: 'Completed the first launch', icon: 'zap' },
  'auth.login': { label: 'Signed in', icon: 'log-in' },
  'auth.magic-link-login': { label: 'Signed in with a magic link', icon: 'log-in' },
  'auth.login-failed': { label: 'Failed sign-in attempt', icon: 'alert-triangle', tone: 'red' },
  'auth.logout-everywhere': { label: 'Signed out everywhere', icon: 'log-out' },
  'auth.password-change': { label: 'Changed their password', icon: 'key' },
  'admin.create': { label: 'Added admin', icon: 'user-plus' },
  'admin.update': { label: 'Updated admin', icon: 'user' },
  'admin.reset-password': { label: 'Reset the password of', icon: 'key', tone: 'amber' },
  'admin.delete': { label: 'Removed admin', icon: 'user-x', tone: 'red' },
  'settings.update': { label: 'Updated SolarOps settings', icon: 'sliders' },
  'alerts.update': { label: 'Updated the alert settings', icon: 'bell' },
  'alerts.test': { label: 'Sent a test alert', icon: 'bell' },
  'alerts.sent': { label: 'Sent an alert e-mail:', icon: 'bell', tone: 'amber' },
  'alerts.failed': { label: 'Could not send an alert e-mail:', icon: 'bell', tone: 'red' },
  'postgres.update': { label: 'Updated the PostgreSQL connection', icon: 'database' },
  'smtp.create': { label: 'Added mail relay', icon: 'send' },
  'smtp.update': { label: 'Updated mail relay', icon: 'send' },
  'smtp.delete': { label: 'Removed mail relay', icon: 'send', tone: 'red' },
  'git-credential.create': { label: 'Added git credential', icon: 'git-branch' },
  'git-credential.update': { label: 'Updated git credential', icon: 'git-branch' },
  'git-credential.delete': { label: 'Removed git credential', icon: 'git-branch', tone: 'red' },
  'dns-account.create': { label: 'Added DNS account', icon: 'globe' },
  'dns-account.update': { label: 'Updated DNS account', icon: 'globe' },
  'dns-account.delete': { label: 'Removed DNS account', icon: 'globe', tone: 'red' },
  'shared-certificate.create': { label: 'Added shared certificate', icon: 'layers', tone: 'cyan' },
  'shared-certificate.update': { label: 'Updated shared certificate', icon: 'layers' },
  'shared-certificate.request': { label: 'Requested shared certificate', icon: 'layers', tone: 'cyan' },
  'shared-certificate.delete': { label: 'Removed shared certificate', icon: 'layers', tone: 'red' },
  'project.create': { label: 'Created project', icon: 'plus-circle', tone: 'green' },
  'project.update': { label: 'Updated project', icon: 'edit-2' },
  'project.delete': { label: 'Deleted project', icon: 'trash-2', tone: 'red' },
  'project.start': { label: 'Started', icon: 'play', tone: 'green' },
  'project.restart': { label: 'Restarted', icon: 'refresh-cw' },
  'project.stop': { label: 'Stopped', icon: 'square', tone: 'amber' },
  'project.deploy': { label: 'Deployed', icon: 'upload-cloud', tone: 'cyan' },
  'project.pull': { label: 'Pulled sources of', icon: 'download-cloud' },
  'project.logs-clear': { label: 'Cleared the logs of', icon: 'file-text' },
  'project.environment-update': { label: 'Updated the environment of', icon: 'list' },
  'project.smtp-update': { label: 'Updated the mail relay of', icon: 'send' },
  'project.deployment-update': { label: 'Updated the deployment of', icon: 'git-branch' },
  'project.webhook-reveal': { label: 'Revealed the webhook secret of', icon: 'eye', tone: 'amber' },
  'project.webhook-rotate': { label: 'Rotated the webhook secret of', icon: 'refresh-cw' },
  'project.database-enable': { label: 'Provisioned the database of', icon: 'database', tone: 'green' },
  'project.database-disable': { label: 'Disabled the database of', icon: 'database' },
  'project.database-reveal': { label: 'Revealed database credentials of', icon: 'eye', tone: 'amber' },
  'project.database-rotate-password': { label: 'Rotated the database password of', icon: 'key' },
  'project.database-dump': { label: 'Dumped the database of', icon: 'archive' },
  'project.database-backups': { label: 'Configured the scheduled backups of', icon: 'calendar' },
  'project.database-download': { label: 'Downloaded a dump of', icon: 'download', tone: 'amber' },
  'project.database-dump-delete': { label: 'Deleted a dump of', icon: 'trash-2' },
  'project.database-restore': { label: 'Restored a dump into', icon: 'rotate-ccw', tone: 'amber' },
  'project.database-wipe': { label: 'Wiped the database of', icon: 'trash-2', tone: 'red' },
  'project.database-drop': { label: 'Dropped the database of', icon: 'trash-2', tone: 'red' },
  'project.database-link': { label: 'Linked an existing database to', icon: 'link', tone: 'cyan' },
  'project.database-unlink': { label: 'Unlinked the database of', icon: 'scissors' },
  'project.network-update': { label: 'Updated the network of', icon: 'globe' },
  'project.network-apply': { label: 'Applied the nginx config of', icon: 'globe' },
  'project.dns-records': { label: 'Pointed the DNS records at this server for', icon: 'navigation', tone: 'cyan' },
  'project.certificate': { label: 'Requested a certificate for', icon: 'shield', tone: 'cyan' },
};

/**
 * @param {string} action
 * @returns {{label: string, icon: string, tone?: string}}
 */
export function auditAppearance(action) {
  if (AUDIT_ACTIONS[action]) {
    return AUDIT_ACTIONS[action];
  }

  return { label: action, icon: 'activity' };
}
