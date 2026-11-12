<template>
  <section class="panel">
    <header class="panel-header">
      <span class="panel-icon"><FeatherIcon name="navigation" :size="17" /></span>
      <h3>DNS records</h3>
    </header>
    <div class="panel-body stack">
      <p class="text-dim small">
        Create the records pointing the domain and its aliases at this server, through the API of a DNS provider
        account: <code>A → {{ ipv4 || '?' }}</code
        ><template v-if="ipv6"
          >, <code>AAAA → {{ ipv6 }}</code></template
        >.
      </p>

      <OrbitLoader v-if="loading" inline label="Loading…" />
      <div v-else-if="!ipv4" class="callout callout-warning">
        <FeatherIcon name="alert-triangle" class="icon" />
        <span>
          Set the server public IPv4 in <RouterLink to="/settings">Settings › General</RouterLink> first (it is not
          detected).
        </span>
      </div>
      <div v-else-if="accounts.length === 0" class="callout">
        <FeatherIcon name="info" class="icon" />
        <span>
          Add a DNS provider account (OVHcloud, Cloudflare, DigitalOcean) in
          <RouterLink to="/infrastructure/domains">Domains &amp; SSL</RouterLink> first.
        </span>
      </div>
      <div v-else class="dns-records-form">
        <FormField label="DNS account" :error="errors.dnsAccountId" class="dns-records-account">
          <select v-model="accountId" class="select">
            <option :value="null" disabled>Choose an account</option>
            <option v-for="account in accounts" :key="account.id" :value="account.id">
              {{ account.name }} ({{ providerLabel(account.provider) }})
            </option>
          </select>
        </FormField>
        <button type="button" class="btn btn-primary" :disabled="busy || accountId === null" @click="point(false)">
          <span v-if="busy" class="spinner"></span>
          <FeatherIcon v-else name="navigation" :size="16" />
          Create the A records
        </button>
      </div>

      <ul v-if="results" class="list-plain">
        <li v-for="(entry, index) in results" :key="index" class="list-row">
          <FeatherIcon :name="statusIcon(entry)" :class="statusClass(entry)" />
          <span class="stack-sm dns-record-result">
            <span class="mono small">{{ entry.type }} {{ entry.host }}</span>
            <span class="tiny text-faint">{{ entry.message }}</span>
          </span>
        </li>
      </ul>

      <div v-if="replaceable.length > 0" class="callout callout-warning">
        <FeatherIcon name="alert-triangle" class="icon" />
        <span class="row-between row-wrap dns-records-replace">
          <span>{{ replaceable.length }} record(s) point to another server.</span>
          <button type="button" class="btn btn-sm btn-danger" :disabled="busy" @click="confirmReplace">
            Replace them
          </button>
        </span>
      </div>

      <p class="tiny text-faint">
        New records get a 5-minute TTL. A record pointing elsewhere is only replaced after confirmation; CNAMEs and
        names with several records are never changed.
      </p>
    </div>
  </section>
</template>

<script>
/**
 * DNS records of a project: create the A (and AAAA) records of its domain
 * and aliases through a DNS provider account (services/dnsRecords.js).
 * The account used is remembered on the project.
 */
const STATUS_ICONS = {
  created: 'check-circle',
  updated: 'check-circle',
  ok: 'check-circle',
  exists: 'alert-triangle',
  warning: 'alert-triangle',
};

const STATUS_CLASSES = {
  created: 'text-success',
  updated: 'text-success',
  ok: 'text-success',
  exists: 'text-warning',
  warning: 'text-warning',
};

export default {
  name: 'DnsRecordsPanel',
  props: {
    project: {
      type: Object,
      required: true,
    },
  },
  emits: ['refresh'],
  data() {
    return {
      loading: true,
      busy: false,
      accounts: [],
      providers: [],
      ipv4: '',
      ipv6: '',
      accountId: null,
      results: null,
      errors: {},
    };
  },
  computed: {
    /** Records pointing elsewhere, that a confirmed run would replace. */
    replaceable() {
      if (!this.results) {
        return [];
      }

      return this.results.filter((entry) => entry.status === 'exists');
    },
  },
  async mounted() {
    try {
      const [dns, providers, settings] = await Promise.all([
        this.$api.get('/dns-accounts'),
        this.$api.get('/dns-accounts/providers'),
        this.$api.get('/settings'),
      ]);

      this.accounts = dns.accounts;
      this.providers = providers.providers;
      this.ipv4 = settings.settings.serverIp;
      this.ipv6 = settings.settings.serverIpv6;
      this.accountId = this.defaultAccountId();
    } catch (error) {
      this.$toast.error(error);
    } finally {
      this.loading = false;
    }
  },
  methods: {
    /** The account used last time, else the certificate's DNS account, else the only one. */
    defaultAccountId() {
      const network = this.project.network;
      const ids = this.accounts.map((account) => account.id);

      if (ids.includes(network.recordsAccountId)) {
        return network.recordsAccountId;
      }

      if (network.certMethod === 'dns' && ids.includes(network.dnsAccountId)) {
        return network.dnsAccountId;
      }

      if (ids.length === 1) {
        return ids[0];
      }

      return null;
    },
    providerLabel(id) {
      const provider = this.providers.find((candidate) => candidate.id === id);

      if (provider) {
        return provider.label;
      }

      return id;
    },
    statusIcon(entry) {
      return STATUS_ICONS[entry.status] || 'x-circle';
    },
    statusClass(entry) {
      return STATUS_CLASSES[entry.status] || 'text-danger';
    },
    async point(replace) {
      this.busy = true;
      this.errors = {};

      try {
        const { results } = await this.$api.post(`/projects/${this.project.uid}/network/dns-records`, {
          dnsAccountId: this.accountId,
          replace,
        });
        const changed = results.filter((entry) => entry.status === 'created' || entry.status === 'updated');

        this.results = results;

        if (changed.length > 0) {
          this.$toast.success(`${changed.length} record(s) saved. DNS changes take a few minutes to spread.`);
        } else if (results.every((entry) => entry.status === 'ok')) {
          this.$toast.success('Every record already points here.');
        }

        this.$emit('refresh');
      } catch (error) {
        this.errors = error.fields;
        this.$toast.error(error);
      } finally {
        this.busy = false;
      }
    },
    async confirmReplace() {
      const changes = this.replaceable.map((entry) => `${entry.type} ${entry.host}: ${entry.current.join(', ')}`);
      const confirmed = await this.$confirm({
        title: `Replace ${this.replaceable.length} record(s)?`,
        message: `They will point to this server instead of: ${changes.join(' · ')}. Whatever they served stops being reachable on these names.`,
        confirmText: 'Replace',
        danger: true,
        icon: 'navigation',
      });

      if (!confirmed) {
        return;
      }

      await this.point(true);
    },
  },
};
</script>

<style>
.dns-records-form {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px;
}

.dns-records-account {
  flex: 1;
  min-width: 240px;
  max-width: 420px;
}

.dns-record-result {
  gap: 0;
}

.dns-records-replace {
  flex: 1;
  gap: 10px;
}
</style>
