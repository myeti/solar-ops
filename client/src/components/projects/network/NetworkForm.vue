<template>
  <form class="panel" @submit.prevent="save">
    <header class="panel-header">
      <span class="panel-icon"><FeatherIcon name="globe" :size="17" /></span>
      <h3>Domain &amp; routing</h3>
      <span class="spacer"></span>
      <ToggleSwitch v-model="form.enabled" label="Expose on the web" />
    </header>

    <div v-if="!form.enabled" class="panel-body">
      <p v-if="project.system" class="text-dim small">
        Serve SolarOps on its own domain, with a Let's Encrypt certificate renewed automatically. Until then, reach it
        through an SSH tunnel to <code>127.0.0.1:{{ project.port }}</code
        >.
      </p>
      <p v-else class="text-dim small">
        Expose the project on a domain: SolarOps writes its nginx configuration, validates it with
        <code>nginx -t</code> and reloads nginx. Add a free Let's Encrypt certificate for HTTPS.
      </p>
    </div>

    <div v-else class="panel-body stack-lg">
      <div class="form-grid">
        <FormField label="Domain" :error="errors.domain" :hint="domainHint">
          <input v-model="form.domain" class="input mono" placeholder="app.example.com" spellcheck="false" />
        </FormField>
        <FormField label="Aliases" :error="errors.aliases" hint="Comma separated, e.g. www.example.com" optional>
          <input v-model="form.aliases" class="input mono" placeholder="www.app.example.com" spellcheck="false" />
        </FormField>
      </div>

      <div v-if="project.system" class="callout">
        <FeatherIcon name="shuffle" class="icon" />
        <span>
          nginx forwards requests to SolarOps on <code>127.0.0.1:{{ project.port }}</code> (set by
          <code>SOLAROPS_PORT</code>). The domain must already point to this server: SolarOps refuses a domain that
          would make it unreachable.
        </span>
      </div>

      <div v-if="!project.system && project.type === 'app'" class="callout">
        <FeatherIcon name="shuffle" class="icon" />
        <span>
          Application: nginx forwards requests to <code>127.0.0.1:{{ project.port }}</code
          >, the project port (given to the app as <code>PORT</code>). Change it in
          <RouterLink :to="`/projects/${project.uid}/settings`">Settings</RouterLink>.
        </span>
      </div>
      <div v-if="project.type === 'static'" class="callout">
        <FeatherIcon name="layout" class="icon" />
        <span> Static site: nginx serves the files of the public folder directly, no process involved. </span>
      </div>

      <div class="form-grid">
        <template v-if="project.type === 'static'">
          <FormField
            label="Public folder"
            :error="errors.publicFolder"
            hint="Relative to repo/, where the build lands (dist, build…)."
          >
            <div class="input-prefix">
              <span class="prefix">repo/</span>
              <input v-model="form.publicFolder" class="input mono public-folder-input" spellcheck="false" />
            </div>
          </FormField>
          <div class="field network-toggle-field">
            <ToggleSwitch
              v-model="form.spaFallback"
              label="Single page app"
              hint="Unknown paths serve index.html (client side routing)."
            />
          </div>
        </template>
        <FormField
          label="Max upload size (MB)"
          :error="errors.clientMaxBodySize"
          hint="Request body limit (nginx), 100 by default."
        >
          <input v-model.number="form.clientMaxBodySize" class="input mono" type="number" min="1" max="10240" />
        </FormField>
      </div>

      <div class="divider"></div>

      <div class="stack-sm">
        <div class="field-label">HTTPS certificate</div>
        <div class="choice-grid">
          <button
            v-for="method in availableCertMethods"
            :key="method.id"
            type="button"
            class="choice"
            :class="{ selected: form.certMethod === method.id }"
            @click="form.certMethod = method.id"
          >
            <FeatherIcon :name="method.icon" class="choice-icon" />
            <div>
              <strong>{{ method.label }}</strong>
              <span>{{ method.description }}</span>
            </div>
          </button>
        </div>
        <span v-if="errors.certMethod" class="field-error">{{ errors.certMethod }}</span>
      </div>

      <div v-if="suggestedShared" class="callout">
        <FeatherIcon name="layers" class="icon" />
        <span class="row-between row-wrap shared-suggestion">
          <span>
            The shared certificate <code>{{ suggestedShared.domains.join(', ') }}</code> covers these domains.
          </span>
          <button type="button" class="btn btn-sm" @click="useShared(suggestedShared)">Use it</button>
        </span>
      </div>

      <div v-if="form.certMethod !== 'none'" class="form-grid">
        <FormField v-if="form.certMethod === 'dns'" label="DNS account" :error="errors.dnsAccountId">
          <select v-model="form.dnsAccountId" class="select">
            <option :value="null" disabled>Choose an account</option>
            <option v-for="account in dnsAccounts" :key="account.id" :value="account.id">
              {{ account.name }} ({{ account.provider }})
            </option>
          </select>
          <template #hint>
            <RouterLink to="/infrastructure/domains">Manage DNS accounts</RouterLink>
          </template>
        </FormField>
        <FormField v-if="form.certMethod === 'shared'" label="Shared certificate" :error="errors.sharedCertificateId">
          <select v-model="form.sharedCertificateId" class="select">
            <option :value="null" disabled>Choose a certificate</option>
            <option v-for="option in sharedOptions" :key="option.id" :value="option.id" :disabled="option.disabled">
              {{ option.label }}
            </option>
          </select>
          <template #hint>
            Only certificates covering the domain and every alias can be selected.
            <RouterLink to="/infrastructure/domains">Manage shared certificates</RouterLink>
          </template>
        </FormField>
        <div v-if="form.certMethod !== 'shared'" class="field network-toggle-field">
          <ToggleSwitch v-model="form.autoRenew" label="Auto-renew" hint="Renewed 30 days before expiry." />
        </div>
        <div class="field network-toggle-field">
          <ToggleSwitch v-model="form.forceHttps" label="Force HTTPS" hint="Redirect HTTP to HTTPS and send HSTS." />
        </div>
      </div>
    </div>

    <footer class="panel-footer">
      <span class="spacer"></span>
      <button type="submit" class="btn btn-primary" :disabled="saving || !isDirty">
        <span v-if="saving" class="spinner"></span>
        <FeatherIcon v-else name="save" :size="16" />
        Save &amp; apply
      </button>
    </footer>
  </form>
</template>

<script>
/**
 * Network form of a project: domain, routing and certificate method.
 * Emits `saved` with the apply result ({ applyError }) after a save.
 */
import { parseDomainList, uncoveredDomains } from '../../../services/domains.js';

function formFrom(network) {
  return {
    enabled: network.enabled,
    domain: network.domain,
    aliases: network.aliases.join(', '),
    publicFolder: network.publicFolder,
    spaFallback: network.spaFallback,
    certMethod: network.certMethod,
    dnsAccountId: network.dnsAccountId,
    sharedCertificateId: network.sharedCertificateId,
    autoRenew: network.autoRenew,
    forceHttps: network.forceHttps,
    clientMaxBodySize: network.clientMaxBodySize,
  };
}

export default {
  name: 'NetworkForm',
  props: {
    project: {
      type: Object,
      required: true,
    },
  },
  emits: ['refresh', 'saved'],
  data() {
    return {
      form: formFrom(this.project.network),
      errors: {},
      saving: false,
      resync: false,
      dnsAccounts: [],
      sharedCertificates: [],
      certMethods: [
        { id: 'none', icon: 'unlock', label: 'None', description: 'HTTP only.' },
        {
          id: 'http',
          icon: 'shield',
          label: "Let's Encrypt · HTTP",
          description: 'Validated through this server on port 80. Simplest.',
        },
        {
          id: 'dns',
          icon: 'globe',
          label: "Let's Encrypt · DNS",
          description: 'Validated through your DNS provider. Supports wildcards.',
        },
        {
          id: 'shared',
          icon: 'layers',
          label: 'Shared certificate',
          description: 'One of Domains & SSL, e.g. a wildcard used by several projects.',
        },
      ],
    };
  },
  computed: {
    domainHint() {
      if (this.project.system) {
        return 'Must point to this server (A / AAAA record).';
      }

      return 'Must point to this server (A / AAAA record). Given to the app as PUBLIC_URL.';
    },
    network() {
      return this.project.network;
    },
    /** Domain and aliases as currently typed. */
    formDomains() {
      return [this.form.domain, ...parseDomainList(this.form.aliases)].filter(Boolean);
    },
    /** Shared certificates, those not covering every typed name disabled. */
    sharedOptions() {
      return this.sharedCertificates.map((shared) => {
        const uncovered = uncoveredDomains(shared.domains, this.formDomains);
        let label = shared.domains.join(', ');

        if (uncovered.length > 0) {
          label = `${label} — does not cover ${uncovered.join(', ')}`;
        } else if (!shared.certificate.exists) {
          label = `${label} — not issued yet`;
        }

        return { id: shared.id, label, disabled: uncovered.length > 0 };
      });
    },
    /**
     * A shared certificate covering every typed name, offered when another
     * method is selected. Never applied without a click (explicit choice).
     */
    suggestedShared() {
      if (!this.form.enabled || this.form.certMethod === 'shared' || this.formDomains.length === 0) {
        return null;
      }

      const covering = this.sharedCertificates.find(
        (shared) => uncoveredDomains(shared.domains, this.formDomains).length === 0,
      );

      return covering || null;
    },
    /** SolarOps itself is always served over HTTPS. */
    availableCertMethods() {
      if (this.project.system) {
        return this.certMethods
          .filter((method) => method.id !== 'none')
          .map((method) => {
            if (method.id === 'dns') {
              return { ...method, description: 'Validated through your DNS provider. Useful when port 80 is closed.' };
            }

            return method;
          });
      }

      return this.certMethods;
    },
    /** Whether saving would move SolarOps to another address. */
    movesSystemAddress() {
      const network = this.network;

      if (!this.project.system) {
        return false;
      }

      if (network.enabled !== this.form.enabled) {
        return true;
      }

      return (
        this.form.enabled && (this.form.domain !== network.domain || this.form.aliases !== network.aliases.join(', '))
      );
    },
    isDirty() {
      return JSON.stringify(this.form) !== JSON.stringify(formFrom(this.network));
    },
  },
  watch: {
    /**
     * The page refreshes the project every 10 seconds: follow the server
     * only when the form holds no unsaved edit (or right after a save).
     */
    'project.network': {
      deep: true,
      handler(network, previous) {
        const untouched = JSON.stringify(this.form) === JSON.stringify(formFrom(previous));

        if (untouched || this.resync) {
          this.resync = false;
          this.form = formFrom(network);
        }
      },
    },
  },
  async mounted() {
    try {
      const [dns, shared] = await Promise.all([this.$api.get('/dns-accounts'), this.$api.get('/shared-certificates')]);
      this.dnsAccounts = dns.accounts;
      this.sharedCertificates = shared.certificates;
    } catch (error) {
      this.$toast.error(error);
    }
  },
  methods: {
    /** Select a suggested shared certificate (saved with the form). */
    useShared(shared) {
      this.form.certMethod = 'shared';
      this.form.sharedCertificateId = shared.id;
    },
    /**
     * Changing SolarOps's own address can cut the connection the admin is
     * using right now: ask first, and remind the way back.
     */
    async confirmSystemMove() {
      let title = `Serve SolarOps on ${this.form.domain}?`;
      let message = `SolarOps will answer on ${this.form.domain}. If that address does not load, connect with an SSH tunnel and run "sudo solarops domain:reset".`;

      if (!this.form.enabled) {
        title = 'Stop serving SolarOps on its domain?';
        const port = this.project.port;
        message = `SolarOps will only be reachable through an SSH tunnel (ssh -L ${port}:127.0.0.1:${port} you@server). If you are using the domain right now, you will be disconnected.`;
      }

      return this.$confirm({
        title,
        message,
        confirmText: 'Apply',
        danger: !this.form.enabled,
        icon: 'aperture',
      });
    },
    async save() {
      if (this.movesSystemAddress && !(await this.confirmSystemMove())) {
        return;
      }

      this.saving = true;
      this.errors = {};

      try {
        const result = await this.$api.put(`/projects/${this.project.uid}/network`, this.form);

        if (!result.applyError) {
          this.$toast.success('Network saved and applied.');
        }

        this.resync = true;
        this.$emit('saved', result);
        this.$emit('refresh');
      } catch (error) {
        this.errors = error.fields;
        this.$toast.error(error);
      } finally {
        this.saving = false;
      }
    },
  },
};
</script>

<style>
.network-toggle-field {
  justify-content: center;
}

.shared-suggestion {
  flex: 1;
  gap: 10px;
}
</style>
