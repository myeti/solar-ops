<template>
  <div>
    <PageHeader
      eyebrow="System"
      title="Alerts"
      subtitle="E-mails to every administrator when the server or a project needs attention."
    >
      <template #actions>
        <button type="button" class="btn" :disabled="loading" @click="load">
          <FeatherIcon name="refresh-cw" :size="16" />
          Refresh
        </button>
      </template>
    </PageHeader>

    <OrbitLoader v-if="loading && !data" label="Loading…" />

    <div v-else-if="data" class="stack-lg fade-up">
      <div class="grid-2">
        <form class="panel" @submit.prevent="save">
          <header class="panel-header">
            <span class="panel-icon"><FeatherIcon name="bell" :size="17" /></span>
            <h3>Rules</h3>
            <span class="spacer"></span>
            <ToggleSwitch v-model="form.enabled" label="Send alerts" />
          </header>
          <div class="panel-body stack">
            <p class="text-dim small">
              Checked every {{ data.state.intervalSeconds }} seconds. An e-mail is sent when an alert opens, and when it
              is resolved.
            </p>
            <ToggleSwitch
              v-for="rule in data.rules"
              :key="rule.id"
              v-model="form.rules[rule.id]"
              :label="rule.label"
              :hint="rule.description"
            />
          </div>
          <footer class="panel-footer">
            <button type="submit" class="btn btn-primary" :disabled="saving || !isDirty">
              <span v-if="saving" class="spinner"></span>
              <FeatherIcon v-else name="save" :size="16" />
              Save
            </button>
          </footer>
        </form>

        <section class="panel">
          <header class="panel-header">
            <span class="panel-icon"><FeatherIcon name="send" :size="17" /></span>
            <h3>Delivery</h3>
            <span class="spacer"></span>
            <button type="button" class="btn btn-sm" :disabled="!data.relay || testing" @click="sendTest">
              <span v-if="testing" class="spinner"></span>
              <FeatherIcon v-else name="mail" :size="14" />
              Send a test e-mail
            </button>
          </header>
          <div class="panel-body stack">
            <div v-if="!data.relay" class="callout callout-warning">
              <FeatherIcon name="alert-triangle" class="icon" />
              <span>
                Alerts need a mail relay: choose SolarOps's in
                <RouterLink to="/projects/solarops/mail">Projects › SolarOps › Mail</RouterLink> (add one in
                <RouterLink to="/infrastructure/mail">Infrastructure › Mail relays</RouterLink> first).
              </span>
            </div>
            <dl v-else class="kv">
              <dt>Relay</dt>
              <dd>
                {{ data.relay.name }}
                <RouterLink to="/projects/solarops/mail" class="small">change</RouterLink>
              </dd>
              <dt>From</dt>
              <dd>
                <code>{{ data.relay.fromAddress }}</code>
              </dd>
            </dl>

            <div class="stack-sm">
              <div class="section-title">Recipients</div>
              <div class="row row-wrap">
                <span v-for="email in data.recipients" :key="email" class="badge">{{ email }}</span>
              </div>
              <p class="tiny text-faint">Every administrator of SolarOps.</p>
            </div>

            <div v-if="testResult" class="callout" :class="testResultClass">
              <FeatherIcon :name="testResultIcon" class="icon" />
              <span>{{ testResultText }}</span>
            </div>
          </div>
        </section>
      </div>

      <section class="panel">
        <header class="panel-header">
          <span class="panel-icon"><FeatherIcon name="activity" :size="17" /></span>
          <h3>Now</h3>
          <span class="spacer"></span>
          <span class="tiny text-faint">{{ checkCaption }}</span>
        </header>
        <div class="panel-body">
          <p v-if="!data.settings.enabled" class="text-dim small">Alerts are off: nothing is checked.</p>
          <p v-else-if="data.state.open.length === 0" class="row-sm small">
            <FeatherIcon name="check-circle" :size="16" class="text-success" />
            All clear.
          </p>
          <ul v-else class="list-plain">
            <li v-for="alert in data.state.open" :key="alert.key" class="list-row">
              <FeatherIcon name="alert-triangle" class="text-warning" />
              <span class="alert-text">
                <strong>{{ alert.title }}</strong>
                <span class="small text-dim">{{ alert.message }}</span>
              </span>
              <span class="tiny text-faint nowrap">since {{ $format.timeAgo(alert.since) }}</span>
            </li>
          </ul>
        </div>
      </section>

      <section class="panel">
        <header class="panel-header">
          <span class="panel-icon"><FeatherIcon name="inbox" :size="17" /></span>
          <h3>Sent alerts</h3>
          <span class="spacer"></span>
          <span class="tiny text-faint">Since SolarOps started (kept in memory)</span>
        </header>
        <div class="panel-body">
          <p v-if="data.state.history.length === 0" class="text-dim small">No alert since SolarOps started.</p>
          <ul v-else class="list-plain">
            <li v-for="event in data.state.history" :key="event.at" class="list-row">
              <FeatherIcon :name="eventIcon(event)" :class="eventIconClass(event)" />
              <span class="alert-text">
                <strong>{{ eventTitle(event) }}</strong>
                <span class="small text-dim">{{ eventDetails(event) }}</span>
                <span v-if="event.error" class="tiny text-danger">{{ event.error }}</span>
              </span>
              <span class="tiny text-faint nowrap">{{ eventCaption(event) }}</span>
            </li>
          </ul>
        </div>
      </section>
    </div>
  </div>
</template>

<script>
/**
 * System › Alerts: which rules send e-mails to the administrators, through
 * which relay, what is wrong now and what was sent (server/services/alerts.js).
 */
const REFRESH_MS = 20 * 1000;

function formFrom(settings) {
  return { enabled: settings.enabled, rules: { ...settings.rules } };
}

export default {
  name: 'AlertsView',
  data() {
    return {
      data: null,
      form: { enabled: false, rules: {} },
      loading: true,
      saving: false,
      testing: false,
      testResult: null,
      timer: null,
    };
  },
  computed: {
    isDirty() {
      if (!this.data) {
        return false;
      }

      return JSON.stringify(this.form) !== JSON.stringify(formFrom(this.data.settings));
    },
    checkCaption() {
      if (!this.data.settings.enabled) {
        return 'Off';
      }

      if (!this.data.state.lastCheckAt) {
        return `First check within ${this.data.state.intervalSeconds} seconds`;
      }

      return `Checked ${this.$format.timeAgo(this.data.state.lastCheckAt)}`;
    },
    testResultClass() {
      if (this.testResult.error) {
        return 'callout-danger';
      }

      return 'callout-success';
    },
    testResultIcon() {
      if (this.testResult.error) {
        return 'alert-octagon';
      }

      return 'check-circle';
    },
    testResultText() {
      if (this.testResult.error) {
        return this.testResult.error;
      }

      return `Test e-mail sent to ${this.testResult.sent} administrator(s). Check the inboxes!`;
    },
  },
  mounted() {
    this.load();
    this.timer = setInterval(() => this.load({ quiet: true }), REFRESH_MS);
  },
  beforeUnmount() {
    clearInterval(this.timer);
  },
  methods: {
    async load({ quiet = false } = {}) {
      if (!quiet) {
        this.loading = true;
      }

      try {
        const wasDirty = this.isDirty;
        this.data = await this.$api.get('/alerts');

        // Keep unsaved edits across the periodic refresh.
        if (!wasDirty) {
          this.form = formFrom(this.data.settings);
        }
      } catch (error) {
        if (!quiet) {
          this.$toast.error(error);
        }
      } finally {
        this.loading = false;
      }
    },
    async save() {
      this.saving = true;

      try {
        this.data = await this.$api.put('/alerts', this.form);
        this.form = formFrom(this.data.settings);
        this.$toast.success('Alert settings saved.');
      } catch (error) {
        this.$toast.error(error);
      } finally {
        this.saving = false;
      }
    },
    async sendTest() {
      this.testing = true;
      this.testResult = null;

      try {
        this.testResult = await this.$api.post('/alerts/test');
      } catch (error) {
        this.testResult = { sent: 0, error: error.message };
      } finally {
        this.testing = false;
      }
    },
    eventTitle(event) {
      const parts = [];

      if (event.opened.length > 0) {
        parts.push(`${event.opened.length} new`);
      }

      if (event.resolved.length > 0) {
        parts.push(`${event.resolved.length} resolved`);
      }

      return parts.join(', ');
    },
    eventDetails(event) {
      const parts = [];

      if (event.opened.length > 0) {
        parts.push(`New: ${event.opened.map((alert) => alert.title).join(', ')}`);
      }

      if (event.resolved.length > 0) {
        parts.push(`Resolved: ${event.resolved.map((alert) => alert.title).join(', ')}`);
      }

      return parts.join(' · ');
    },
    eventCaption(event) {
      const when = this.$format.timeAgo(event.at);

      if (event.sent > 0) {
        return `${when} · sent to ${event.sent}`;
      }

      return `${when} · not sent`;
    },
    eventIcon(event) {
      if (event.error) {
        return 'alert-octagon';
      }

      return 'mail';
    },
    eventIconClass(event) {
      if (event.error) {
        return 'text-danger';
      }

      return 'text-success';
    },
  },
};
</script>

<style>
.alert-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
</style>
