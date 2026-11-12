<template>
  <OrbitLoader v-if="!settings" label="Loading settings…" />

  <div v-else class="stack-lg">
    <form class="panel fade-up" @submit.prevent="save">
      <header class="panel-header">
        <span class="panel-icon"><FeatherIcon name="hard-drive" :size="17" /></span>
        <h3>Server</h3>
      </header>
      <div class="panel-body form-grid">
        <FormField label="Projects base folder" :error="errors.baseFolder" :hint="baseFolderHint">
          <input
            v-model="settings.baseFolder"
            class="input mono"
            :disabled="meta.baseFolderLocked"
            spellcheck="false"
          />
        </FormField>
        <FormField
          label="Server public IPv4"
          :error="errors.serverIp"
          hint="Checked by the DNS check, and used for A records created through a DNS account. Not detected: copy it from your host."
          optional
        >
          <input v-model="settings.serverIp" class="input mono" placeholder="203.0.113.10" spellcheck="false" />
        </FormField>
        <FormField
          label="Server public IPv6"
          :error="errors.serverIpv6"
          hint="If the server has one: AAAA records are created too. Leave empty otherwise."
          optional
        >
          <input v-model="settings.serverIpv6" class="input mono" placeholder="2001:db8::10" spellcheck="false" />
        </FormField>
      </div>

      <header class="panel-header settings-subheader">
        <span class="panel-icon"><FeatherIcon name="hash" :size="17" /></span>
        <h3>Project ports</h3>
      </header>
      <div class="panel-body stack">
        <div class="form-grid">
          <FormField label="Starting port" :error="errors.firstPort" hint="First port suggested to a new application.">
            <input v-model.number="settings.firstPort" class="input mono" type="number" min="1024" max="65535" />
          </FormField>
          <FormField
            label="Port step"
            :error="errors.portStep"
            hint="Gap between two suggested ports: room for a project's side processes (worker, websocket…)."
          >
            <input v-model.number="settings.portStep" class="input mono" type="number" min="1" max="1000" />
          </FormField>
        </div>
        <p class="tiny text-faint">
          New applications get the first free port among <code>{{ portSequence }}</code
          >; existing projects keep theirs.
        </p>
      </div>

      <header class="panel-header settings-subheader">
        <span class="panel-icon"><FeatherIcon name="shield" :size="17" /></span>
        <h3>Let's Encrypt</h3>
      </header>
      <div class="panel-body stack">
        <div class="form-grid">
          <FormField
            label="Account e-mail"
            :error="errors.acmeEmail"
            hint="Receives expiry warnings from Let's Encrypt."
            optional
          >
            <input v-model="settings.acmeEmail" class="input" type="email" placeholder="ops@example.com" />
          </FormField>
          <div class="field settings-toggle-field">
            <ToggleSwitch
              v-model="settings.acmeStaging"
              label="Staging environment"
              hint="Untrusted test certificates, without rate limits. For trying things out."
            />
          </div>
        </div>
      </div>

      <footer class="panel-footer">
        <button type="submit" class="btn btn-primary" :disabled="saving">
          <span v-if="saving" class="spinner"></span>
          <FeatherIcon v-else name="save" :size="16" />
          Save
        </button>
      </footer>
    </form>

    <section class="panel fade-up">
      <header class="panel-header">
        <span class="panel-icon"><FeatherIcon name="aperture" :size="17" /></span>
        <h3>SolarOps's own domain</h3>
        <span class="spacer"></span>
        <RouterLink to="/projects/solarops/network" class="btn btn-sm">Configure</RouterLink>
      </header>
      <div class="panel-body">
        <p class="text-dim small">
          SolarOps manages its own domain, HTTPS certificate and mail relay like a project (<RouterLink
            to="/projects/solarops"
            >Projects › SolarOps</RouterLink
          >). Webhook URLs and magic links use that domain.
        </p>
      </div>
    </section>

    <section class="panel fade-up">
      <header class="panel-header">
        <span class="panel-icon"><FeatherIcon name="code" :size="17" /></span>
        <h3>nginx integration</h3>
      </header>
      <div class="panel-body stack">
        <p class="text-dim small">
          nginx loads every project configuration through this single directive, placed in its <code>http</code> block
          (the install script writes it to <code>/etc/nginx/conf.d/solarops.conf</code>):
        </p>
        <div class="row-sm">
          <code>{{ meta.nginxInclude }}</code>
          <CopyButton :value="meta.nginxInclude" />
        </div>
      </div>
    </section>
  </div>
</template>

<script>
/**
 * General settings: base folder, server IP, project ports, Let's Encrypt.
 */
import { loadSettings, saveSettings } from './settingsForm.js';

export default {
  name: 'GeneralSettings',
  data() {
    return {
      settings: null,
      meta: {},
      errors: {},
      saving: false,
    };
  },
  computed: {
    baseFolderHint() {
      if (this.meta.baseFolderLocked) {
        return `Locked: ${this.meta.projectCount} project(s) live in it.`;
      }

      return 'Every project gets its own folder inside it.';
    },
    /** The first suggested ports, e.g. "3000, 3010, 3020…". */
    portSequence() {
      const first = Number(this.settings.firstPort);
      const step = Number(this.settings.portStep);

      if (!Number.isInteger(first) || !Number.isInteger(step) || step < 1) {
        return '…';
      }

      return `${first}, ${first + step}, ${first + step * 2}…`;
    },
  },
  async mounted() {
    try {
      const result = await loadSettings();
      this.settings = result.settings;
      this.meta = result.meta;
    } catch (error) {
      this.$toast.error(error);
    }
  },
  methods: {
    async save() {
      this.saving = true;
      this.errors = {};

      try {
        const result = await saveSettings(this.settings);
        this.settings = result.settings;
        this.meta = result.meta;
        this.$toast.success('Settings saved.');
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
.settings-subheader {
  border-top: 1px solid var(--border);
}

.settings-toggle-field {
  justify-content: center;
}
</style>
