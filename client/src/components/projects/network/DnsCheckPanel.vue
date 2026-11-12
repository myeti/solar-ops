<template>
  <section class="panel">
    <header class="panel-header">
      <span class="panel-icon"><FeatherIcon name="crosshair" :size="17" /></span>
      <h3>DNS check</h3>
      <span class="spacer"></span>
      <button type="button" class="btn btn-sm" :disabled="dnsBusy" @click="checkDns">
        <span v-if="dnsBusy" class="spinner"></span>
        <FeatherIcon v-else name="search" :size="14" />
        Check
      </button>
    </header>
    <div class="panel-body">
      <p v-if="!dns" class="text-dim small">Check where the domains point before requesting a certificate.</p>
      <ul v-else class="list-plain">
        <li v-for="result in dns.results" :key="result.domain" class="list-row">
          <FeatherIcon :name="dnsIcon(result)" :class="dnsIconClass(result)" />
          <span class="stack-sm dns-result">
            <span class="mono small">{{ result.domain }}</span>
            <span class="tiny text-faint">{{ dnsDescription(result) }}</span>
          </span>
        </li>
      </ul>
      <p v-if="dns && !dns.serverIp" class="tiny text-faint dns-hint">
        Set the server IP in <RouterLink to="/settings">Settings</RouterLink> to verify that domains point here.
      </p>
    </div>
  </section>
</template>

<script>
/**
 * Where the domains of a project point, compared to the server IP.
 */
export default {
  name: 'DnsCheckPanel',
  props: {
    project: {
      type: Object,
      required: true,
    },
  },
  data() {
    return {
      dns: null,
      dnsBusy: false,
    };
  },
  methods: {
    async checkDns() {
      this.dnsBusy = true;

      try {
        this.dns = await this.$api.get(`/projects/${this.project.uid}/network/dns-check`);
      } catch (error) {
        this.$toast.error(error);
      } finally {
        this.dnsBusy = false;
      }
    },
    dnsIcon(result) {
      if (result.error || result.pointsToServer === false) {
        return 'x-circle';
      }

      if (result.pointsToServer === true) {
        return 'check-circle';
      }

      return 'help-circle';
    },
    dnsIconClass(result) {
      if (result.error || result.pointsToServer === false) {
        return 'text-danger';
      }

      if (result.pointsToServer === true) {
        return 'text-success';
      }

      return 'text-faint';
    },
    dnsDescription(result) {
      if (result.error) {
        return result.error;
      }

      const addresses = [...result.ipv4, ...result.ipv6].join(', ');

      if (result.pointsToServer === true) {
        return `Points to this server (${addresses}).`;
      }

      if (result.pointsToServer === false) {
        return `Points to ${addresses}, not to ${this.dns.serverIp}.`;
      }

      return `Resolves to ${addresses}.`;
    },
  },
};
</script>

<style>
.dns-result {
  gap: 0;
}

.dns-hint {
  margin-top: 12px;
}
</style>
