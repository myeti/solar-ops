<template>
  <span class="status-pill" :class="`is-${appearance.tone}`">
    <span class="status-dot" :class="{ pulse: appearance.pulse }"></span>
    {{ label || appearance.label }}
  </span>
</template>

<script>
/**
 * Coloured status indicator for processes (pm2), tasks and certificates.
 *
 * Usage: <StatusPill status="online" />
 */
const APPEARANCES = {
  online: { label: 'Online', tone: 'green', pulse: false },
  launching: { label: 'Launching', tone: 'blue', pulse: true },
  stopping: { label: 'Stopping', tone: 'amber', pulse: true },
  stopped: { label: 'Stopped', tone: 'grey', pulse: false },
  errored: { label: 'Errored', tone: 'red', pulse: false },
  offline: { label: 'Not running', tone: 'grey', pulse: false },
  inactive: { label: 'Inactive', tone: 'grey', pulse: false },
  static: { label: 'Static site', tone: 'violet', pulse: false },
  queued: { label: 'Queued', tone: 'violet', pulse: true },
  running: { label: 'Running', tone: 'blue', pulse: true },
  success: { label: 'Success', tone: 'green', pulse: false },
  failed: { label: 'Failed', tone: 'red', pulse: false },
  valid: { label: 'Valid', tone: 'green', pulse: false },
  expiring: { label: 'Expiring soon', tone: 'amber', pulse: false },
  missing: { label: 'Missing', tone: 'red', pulse: false },
  enabled: { label: 'Enabled', tone: 'green', pulse: false },
  disabled: { label: 'Disabled', tone: 'grey', pulse: false },
  unknown: { label: 'Unknown', tone: 'grey', pulse: false },
};

export default {
  name: 'StatusPill',
  props: {
    status: {
      type: String,
      default: 'unknown',
    },
    /** Override the default label. */
    label: {
      type: String,
      default: '',
    },
  },
  computed: {
    appearance() {
      if (APPEARANCES[this.status]) {
        return APPEARANCES[this.status];
      }

      return { label: this.status, tone: 'grey', pulse: false };
    },
  },
};
</script>

<style>
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  border: 1px solid var(--border-strong);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-dim);
  --tone: #71717a;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--tone);
}

.status-dot.pulse {
  animation: pulse-glow 1.6s ease-in-out infinite;
}

.status-pill.is-green {
  --tone: var(--success);
  color: #a7f3d0;
  border-color: rgba(52, 211, 153, 0.25);
  background: var(--success-soft);
}

.status-pill.is-blue {
  --tone: var(--info);
  color: #bae6fd;
  border-color: rgba(56, 189, 248, 0.25);
  background: var(--info-soft);
}

.status-pill.is-violet {
  --tone: var(--accent);
  color: #c7d2fe;
  border-color: rgba(129, 140, 248, 0.28);
  background: var(--accent-soft);
}

.status-pill.is-amber {
  --tone: var(--warning);
  color: #fde68a;
  border-color: rgba(251, 191, 36, 0.25);
  background: var(--warning-soft);
}

.status-pill.is-red {
  --tone: var(--danger);
  color: #fecaca;
  border-color: rgba(248, 113, 113, 0.25);
  background: var(--danger-soft);
}
</style>
