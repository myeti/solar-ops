/**
 * Health of a project at a glance, as drawn on the dashboard:
 *
 *   - system:    SolarOps itself,
 *   - disabled:  an inactive project,
 *   - unhealthy: something needs attention (see the reasons),
 *   - healthy:   everything else.
 *
 * A project needs attention when its application is not running (pm2
 * status other than "online"), its HTTPS certificate is missing or expired,
 * or its last deployment failed. A deployment that only failed because the
 * app answered after its startup time is not a problem once it answers
 * (`meta.answeredAt`, see server/services/projects.js).
 */

/**
 * Reasons a project needs attention (empty when it is fine).
 *
 * @param {object} project project as returned by GET /api/projects
 * @returns {string[]}
 */
function attentionReasons(project) {
  const reasons = [];
  const network = project.network;
  const certificate = project.certificate || { exists: false };

  if (project.type === 'app' && !project.system) {
    if (!project.process) {
      reasons.push('not running');
    } else if (project.process.status !== 'online') {
      reasons.push(`process ${project.process.status}`);
    }
  }

  if (network.enabled && network.domain && network.certMethod !== 'none') {
    if (!certificate.exists) {
      reasons.push('no HTTPS certificate');
    } else if (certificate.daysLeft < 0) {
      reasons.push('certificate expired');
    }
  }

  const deployment = project.lastDeployment;

  if (deployment && deployment.status === 'failed' && !deployment.meta.answeredAt) {
    reasons.push('last deployment failed');
  }

  return reasons;
}

/**
 * @param {object} project project as returned by GET /api/projects
 * @returns {{state: 'system'|'disabled'|'unhealthy'|'healthy', reasons: string[]}}
 */
export function projectHealth(project) {
  if (project.system) {
    return { state: 'system', reasons: attentionReasons(project) };
  }

  if (!project.active) {
    return { state: 'disabled', reasons: [] };
  }

  const reasons = attentionReasons(project);

  if (reasons.length > 0) {
    return { state: 'unhealthy', reasons };
  }

  return { state: 'healthy', reasons };
}
