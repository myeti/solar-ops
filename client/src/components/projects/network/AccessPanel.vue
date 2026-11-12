<template>
  <form class="panel" @submit.prevent="save">
    <header class="panel-header">
      <span class="panel-icon"><FeatherIcon name="lock" :size="17" /></span>
      <h3>Access</h3>
      <span class="spacer"></span>
      <ToggleSwitch v-model="form.enabled" label="Restrict access" :disabled="loading" />
    </header>
    <div class="panel-body stack">
      <p class="text-dim small">
        Ask visitors for a password, or only let some IP addresses in. When both are set, the allowed addresses skip the
        password. Let's Encrypt renewals keep working.
      </p>
      <OrbitLoader v-if="loading" inline label="Loading…" />

      <template v-else-if="form.enabled">
        <div v-if="clearTextWarning" class="callout callout-warning">
          <FeatherIcon name="alert-triangle" class="icon" />
          <span>{{ clearTextWarning }}</span>
        </div>

        <div class="stack-sm">
          <div class="section-title">Users</div>
          <div v-for="(user, index) in form.users" :key="user.id" class="access-user">
            <input
              v-model="user.username"
              class="input mono"
              placeholder="user name"
              autocomplete="off"
              spellcheck="false"
            />
            <input
              v-model="user.password"
              class="input"
              type="password"
              :placeholder="passwordPlaceholder(user)"
              autocomplete="new-password"
            />
            <button type="button" class="btn btn-ghost btn-icon btn-sm" title="Remove" @click="removeUser(index)">
              <FeatherIcon name="trash-2" :size="15" />
            </button>
          </div>
          <div class="row row-wrap">
            <button type="button" class="btn btn-sm" @click="addUser">
              <FeatherIcon name="user-plus" :size="15" />
              Add user
            </button>
            <span class="tiny text-faint">Passwords are stored hashed: leave one empty to keep it.</span>
          </div>
          <span v-if="errors.users" class="field-error">{{ errors.users }}</span>
        </div>

        <FormField
          label="Allowed IP addresses"
          optional
          hint="One per line: IPv4 or IPv6 addresses, or ranges (198.51.100.0/24)."
          :error="errors.allowedIps"
        >
          <textarea
            v-model="form.allowedIps"
            class="textarea mono access-ips"
            rows="3"
            placeholder="203.0.113.7&#10;198.51.100.0/24"
            spellcheck="false"
          ></textarea>
        </FormField>
        <div v-if="yourIp && !listsYourIp">
          <button type="button" class="btn btn-sm btn-ghost" @click="addYourIp">
            <FeatherIcon name="plus" :size="15" />
            Add my address ({{ yourIp }})
          </button>
        </div>
      </template>
    </div>
    <footer class="panel-footer">
      <span class="tiny text-faint">{{ summary }}</span>
      <span class="spacer"></span>
      <button type="submit" class="btn btn-primary" :disabled="saving || loading || !isDirty">
        <span v-if="saving" class="spinner"></span>
        <FeatherIcon v-else name="save" :size="16" />
        Save
      </button>
    </footer>
  </form>
</template>

<script>
/**
 * Access protection of the website (server/services/access.js): users with
 * a password, and / or allowed IP addresses, enforced by nginx. Passwords
 * are sent once, hashed by the server, never shown again.
 */
let userSequence = 0;

function makeUser(username, existing) {
  userSequence += 1;

  return { id: userSequence, username, password: '', existing };
}

function ipLines(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export default {
  name: 'AccessPanel',
  props: {
    project: {
      type: Object,
      required: true,
    },
  },
  emits: ['saved', 'refresh'],
  data() {
    return {
      loading: true,
      saving: false,
      saved: { enabled: false, users: [], allowedIps: [] },
      form: { enabled: false, users: [], allowedIps: '' },
      yourIp: null,
      errors: {},
    };
  },
  computed: {
    isDirty() {
      const form = this.form;
      const saved = this.saved;

      return (
        form.enabled !== saved.enabled ||
        JSON.stringify(form.users.map((user) => user.username.trim())) !==
          JSON.stringify(saved.users.map((user) => user.username)) ||
        form.users.some((user) => user.password !== '') ||
        JSON.stringify(ipLines(form.allowedIps)) !== JSON.stringify(saved.allowedIps)
      );
    },
    https() {
      return Boolean(this.project.certificate && this.project.certificate.exists);
    },
    /** A password must never travel over plain HTTP. */
    clearTextWarning() {
      if (this.form.users.length === 0) {
        return null;
      }

      if (!this.https) {
        return 'No HTTPS certificate yet: passwords would travel in clear. Get a certificate first (form above).';
      }

      if (!this.project.network.forceHttps) {
        return 'Force HTTPS is off: the password can also be sent over plain http://. Turn it on in the form above.';
      }

      return null;
    },
    listsYourIp() {
      return ipLines(this.form.allowedIps).includes(this.yourIp);
    },
    summary() {
      const saved = this.saved;

      if (!saved.enabled) {
        return 'Open to everyone.';
      }

      const parts = [];

      if (saved.users.length > 0) {
        parts.push(`${saved.users.length} user(s)`);
      }

      if (saved.allowedIps.length > 0) {
        parts.push(`${saved.allowedIps.length} allowed address(es)`);
      }

      return `Restricted: ${parts.join(', ')}.`;
    },
  },
  mounted() {
    this.load();
  },
  methods: {
    applyState(access) {
      this.saved = access;
      this.form = {
        enabled: access.enabled,
        users: access.users.map((user) => makeUser(user.username, true)),
        allowedIps: access.allowedIps.join('\n'),
      };
    },
    async load() {
      try {
        const { access, yourIp } = await this.$api.get(`/projects/${this.project.uid}/network/access`);
        this.yourIp = yourIp;
        this.applyState(access);
      } catch (error) {
        this.$toast.error(error);
      } finally {
        this.loading = false;
      }
    },
    passwordPlaceholder(user) {
      if (user.existing) {
        return '•••••••• (unchanged)';
      }

      return 'password (8 characters or more)';
    },
    addUser() {
      this.form.users.push(makeUser('', false));
    },
    removeUser(index) {
      this.form.users.splice(index, 1);
    },
    addYourIp() {
      const lines = ipLines(this.form.allowedIps);
      lines.push(this.yourIp);
      this.form.allowedIps = lines.join('\n');
    },
    async save() {
      this.saving = true;
      this.errors = {};

      try {
        const result = await this.$api.put(`/projects/${this.project.uid}/network/access`, {
          enabled: this.form.enabled,
          users: this.form.users.map((user) => ({ username: user.username.trim(), password: user.password })),
          allowedIps: ipLines(this.form.allowedIps),
        });

        this.applyState(result.access);

        if (result.applyError) {
          this.$toast.error('Saved, but nginx refused the configuration: see the message above.');
        } else {
          this.$toast.success('Access saved and applied.');
        }

        this.$emit('saved', result);
        this.$emit('refresh');
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
.access-user {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) auto;
  gap: 8px;
  align-items: center;
}

.access-ips {
  min-height: 84px;
}
</style>
