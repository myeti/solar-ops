<template>
  <div class="stack-lg">
    <section class="panel fade-up">
      <header class="panel-header">
        <span class="panel-icon"><FeatherIcon name="activity" :size="17" /></span>
        <h3>Health checks</h3>
        <span class="spacer"></span>
        <button type="button" class="btn btn-sm" :disabled="loading" @click="load">
          <span v-if="loading" class="spinner"></span>
          <FeatherIcon v-else name="refresh-cw" :size="14" />
          Run again
        </button>
      </header>
      <OrbitLoader v-if="!health" label="Running diagnostics…" />
      <ul v-else class="list-plain panel-body">
        <li v-for="check in health.checks" :key="check.id" class="list-row">
          <span class="icon-bubble" :class="checkTone(check)">
            <FeatherIcon :name="checkIcon(check)" :size="16" />
          </span>
          <span class="stack-sm system-check">
            <span
              ><strong>{{ check.label }}</strong> <span class="tiny text-faint">· {{ check.purpose }}</span></span
            >
            <span class="small text-dim system-check-message">{{ check.message }}</span>
          </span>
        </li>
      </ul>
    </section>

    <div class="grid-2">
      <section v-if="health" class="panel fade-up">
        <header class="panel-header">
          <span class="panel-icon"><FeatherIcon name="server" :size="17" /></span>
          <h3>Host</h3>
        </header>
        <div class="panel-body">
          <dl class="kv">
            <dt>Hostname</dt>
            <dd>{{ health.host.hostname }}</dd>
            <dt>System</dt>
            <dd>{{ health.host.platform }}</dd>
            <dt>Uptime</dt>
            <dd>{{ $format.duration(health.host.uptimeSeconds * 1000) }}</dd>
            <dt>Load</dt>
            <dd>
              {{ loadAverage }} <span class="text-faint">({{ health.host.cpus }} CPU)</span>
            </dd>
            <dt>Memory</dt>
            <dd>{{ $format.bytes(usedMemory) }} / {{ $format.bytes(health.host.totalMemory) }}</dd>
            <dt>Runs as</dt>
            <dd>
              <code>{{ health.host.user }}</code>
            </dd>
          </dl>
        </div>
      </section>

      <section class="panel fade-up">
        <header class="panel-header">
          <span class="panel-icon"><FeatherIcon name="life-buoy" :size="17" /></span>
          <h3>Emergency commands</h3>
        </header>
        <div class="panel-body stack">
          <p class="small text-dim">Run on the server (as the SolarOps user) when the UI is out of reach:</p>
          <ul class="list-plain stack-sm">
            <li v-for="command in commands" :key="command.line" class="system-command">
              <div class="row-sm">
                <code>{{ command.line }}</code>
                <CopyButton :value="command.line" />
              </div>
              <span class="tiny text-faint">{{ command.description }}</span>
            </li>
          </ul>
        </div>
      </section>
    </div>
  </div>
</template>

<script>
/**
 * System information: health checks, host and recovery commands.
 */
export default {
  name: 'SystemSettings',
  data() {
    return {
      health: null,
      loading: false,
      commands: [
        {
          line: 'solarops admin:reset-password <email>',
          description: 'Generate a new password and close the sessions of an admin.',
        },
        { line: 'solarops auth:password', description: 'Switch back to password login (broken mail relay).' },
        {
          line: 'solarops domain:reset',
          description: 'Stop serving SolarOps on its domain (wrong domain, broken certificate).',
        },
        {
          line: 'solarops domain:set <domain> --email <email>',
          description: 'Serve SolarOps on a domain with an HTTPS certificate.',
        },
        { line: 'solarops admin:create <email>', description: 'Create an admin with a generated password.' },
        { line: 'solarops sessions:revoke', description: 'Sign everybody out.' },
        { line: 'solarops certs:renew', description: 'Renew due certificates (suitable for cron).' },
        { line: 'solarops doctor', description: 'Run these health checks from the shell.' },
      ],
    };
  },
  computed: {
    loadAverage() {
      return this.health.host.loadAverage.map((value) => value.toFixed(2)).join(' · ');
    },
    usedMemory() {
      return this.health.host.totalMemory - this.health.host.freeMemory;
    },
  },
  mounted() {
    this.load();
  },
  methods: {
    async load() {
      this.loading = true;

      try {
        this.health = await this.$api.get('/system/health');
      } catch (error) {
        this.$toast.error(error);
      } finally {
        this.loading = false;
      }
    },
    checkIcon(check) {
      if (check.ok) {
        return 'check';
      }

      return 'alert-triangle';
    },
    checkTone(check) {
      if (check.ok) {
        return 'green';
      }

      return 'red';
    },
  },
};
</script>

<style>
.system-check {
  gap: 2px;
  min-width: 0;
}

.system-check-message {
  overflow-wrap: anywhere;
}

.system-command {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
</style>
