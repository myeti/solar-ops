<template>
  <OrbitLoader v-if="loading" label="Loading…" />

  <form v-else class="panel fade-up analytics-settings" @submit.prevent="save">
    <header class="panel-header">
      <span class="panel-icon"><FeatherIcon name="bar-chart-2" :size="17" /></span>
      <h3>Analytics</h3>
      <span class="spacer"></span>
      <ToggleSwitch v-model="form.enabled" label="Enabled" />
    </header>
    <div class="panel-body stack">
      <p class="text-dim small">
        Connect an analytics service to see the visits of your websites in SolarOps (in the projects list, matched by
        their public URL, and two dashboard cards), and give every project its tracker script as
        <code>ANALYTICS_URL</code>.
      </p>

      <div class="form-grid">
        <FormField label="Service" :error="errors.type">
          <select v-model="form.type" class="select">
            <option v-for="type in types" :key="type" :value="type">{{ typeLabel(type) }}</option>
          </select>
        </FormField>
        <FormField
          label="Address"
          :error="errors.url"
          hint="Your Umami instance (https://umami.example.com), or https://cloud.umami.is."
        >
          <input
            v-model="form.url"
            class="input mono"
            placeholder="https://umami.example.com"
            spellcheck="false"
            autocomplete="off"
          />
        </FormField>
        <FormField
          label="API key"
          class="full"
          :error="errors.apiKey"
          hint="Created in Umami under Settings › API keys. Stored encrypted, never shown again."
        >
          <input
            v-model="form.apiKey"
            class="input mono"
            type="password"
            autocomplete="new-password"
            :placeholder="apiKeyPlaceholder"
          />
        </FormField>
      </div>

      <dl v-if="scriptUrl" class="kv">
        <dt>ANALYTICS_URL</dt>
        <dd>
          <code>{{ scriptUrl }}</code>
          <div class="tiny text-faint">Given to every project when enabled: restart a project to pick it up.</div>
        </dd>
      </dl>

      <div v-if="testResult" class="callout" :class="testClass">
        <FeatherIcon :name="testIcon" class="icon" />
        <span>{{ testText }}</span>
      </div>
    </div>
    <footer class="panel-footer">
      <button type="button" class="btn btn-ghost" :disabled="testing || !form.url" @click="test">
        <span v-if="testing" class="spinner"></span>
        <FeatherIcon v-else name="wifi" :size="16" />
        Test connection
      </button>
      <span class="spacer"></span>
      <button type="submit" class="btn btn-primary" :disabled="saving">
        <span v-if="saving" class="spinner"></span>
        <FeatherIcon v-else name="save" :size="16" />
        Save
      </button>
    </footer>
  </form>
</template>

<script>
/**
 * Settings › Analytics: the connector to an analytics service (Umami for
 * now, see server/services/analytics.js). The API key is write-only.
 */
const TYPE_LABELS = { umami: 'Umami' };

const UMAMI_CLOUD_HOSTS = ['cloud.umami.is', 'api.umami.is'];

export default {
  name: 'AnalyticsSettings',
  data() {
    return {
      loading: true,
      saving: false,
      testing: false,
      types: [],
      saved: null,
      form: { enabled: false, type: 'umami', url: '', apiKey: '' },
      errors: {},
      testResult: null,
    };
  },
  computed: {
    apiKeyPlaceholder() {
      if (this.saved && this.saved.hasApiKey) {
        return '•••••••• (unchanged)';
      }

      return 'umami_…';
    },
    /** What ANALYTICS_URL becomes (the same rule as the server). */
    scriptUrl() {
      let url;

      try {
        url = new URL(this.form.url.trim());
      } catch {
        return null;
      }

      if (UMAMI_CLOUD_HOSTS.includes(url.hostname)) {
        return 'https://cloud.umami.is/script.js';
      }

      return `${url.origin}${url.pathname.replace(/\/+$/, '')}/script.js`;
    },
    testClass() {
      if (this.testResult.ok) {
        return 'callout-success';
      }

      return 'callout-danger';
    },
    testIcon() {
      if (this.testResult.ok) {
        return 'check-circle';
      }

      return 'x-circle';
    },
    testText() {
      if (this.testResult.ok) {
        return `Connected: ${this.testResult.websites} website(s) on this account.`;
      }

      return this.testResult.error;
    },
  },
  mounted() {
    this.load();
  },
  methods: {
    typeLabel(type) {
      return TYPE_LABELS[type] || type;
    },
    applySettings(settings) {
      this.saved = settings;
      this.form = { enabled: settings.enabled, type: settings.type, url: settings.url, apiKey: '' };
    },
    async load() {
      try {
        const { settings, types } = await this.$api.get('/analytics/settings');
        this.types = types;
        this.applySettings(settings);
      } catch (error) {
        this.$toast.error(error);
      } finally {
        this.loading = false;
      }
    },
    /** The form as sent: an empty API key keeps the saved one. */
    payload() {
      const body = { type: this.form.type, url: this.form.url };

      if (this.form.apiKey !== '') {
        body.apiKey = this.form.apiKey;
      }

      return body;
    },
    async test() {
      this.testing = true;
      this.errors = {};
      this.testResult = null;

      try {
        this.testResult = await this.$api.post('/analytics/test', this.payload());
      } catch (error) {
        this.errors = error.fields || {};
        this.$toast.error(error);
      } finally {
        this.testing = false;
      }
    },
    async save() {
      this.saving = true;
      this.errors = {};

      try {
        const { settings } = await this.$api.put('/analytics/settings', {
          enabled: this.form.enabled,
          ...this.payload(),
        });
        this.applySettings(settings);
        this.$toast.success('Analytics settings saved.');
      } catch (error) {
        this.errors = error.fields || {};
        this.$toast.error(error);
      } finally {
        this.saving = false;
      }
    },
  },
};
</script>

<style>
.analytics-settings {
  max-width: 860px;
}
</style>
