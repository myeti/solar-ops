<template>
  <OrbitLoader v-if="!settings" label="Loading…" />

  <div v-else class="stack-lg">
    <form class="panel fade-up" @submit.prevent="saveAuth">
      <header class="panel-header">
        <span class="panel-icon"><FeatherIcon name="lock" :size="17" /></span>
        <h3>Sign-in method</h3>
      </header>
      <div class="panel-body stack-lg">
        <div class="choice-grid">
          <button
            type="button"
            class="choice"
            :class="{ selected: settings.authMethod === 'password' }"
            @click="settings.authMethod = 'password'"
          >
            <FeatherIcon name="key" class="choice-icon" />
            <div>
              <strong>E-mail + password</strong>
              <span>Classic, works without any mail relay.</span>
            </div>
          </button>
          <button
            type="button"
            class="choice"
            :class="{ selected: settings.authMethod === 'magic-link' }"
            @click="settings.authMethod = 'magic-link'"
          >
            <FeatherIcon name="send" class="choice-icon" />
            <div>
              <strong>Magic link</strong>
              <span>A single-use link sent by e-mail. No password to steal.</span>
            </div>
          </button>
        </div>

        <template v-if="settings.authMethod === 'magic-link'">
          <ul class="list-plain">
            <li class="list-row">
              <FeatherIcon :name="readinessIcon(magicLink.https)" :class="readinessClass(magicLink.https)" />
              <span class="stack-sm readiness-text">
                <strong>SolarOps's HTTPS domain</strong>
                <span class="small text-dim">{{ domainText }}</span>
              </span>
              <RouterLink to="/projects/solarops/network" class="btn btn-sm btn-ghost">Configure</RouterLink>
            </li>
            <li class="list-row">
              <FeatherIcon
                :name="readinessIcon(magicLink.mailRelay !== null)"
                :class="readinessClass(magicLink.mailRelay !== null)"
              />
              <span class="stack-sm readiness-text">
                <strong>SolarOps's mail relay</strong>
                <span class="small text-dim">{{ relayText }}</span>
              </span>
              <RouterLink to="/projects/solarops/mail" class="btn btn-sm btn-ghost">Configure</RouterLink>
            </li>
          </ul>
          <span v-if="errors.authMethod" class="field-error">{{ errors.authMethod }}</span>
          <div class="callout callout-warning">
            <FeatherIcon name="life-buoy" class="icon" />
            <span>
              Test the relay first. If e-mails stop arriving, switch back from the server shell:
              <code>solarops auth:password</code>
            </span>
          </div>
        </template>
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
        <span class="panel-icon"><FeatherIcon name="users" :size="17" /></span>
        <h3>Admins</h3>
        <span class="spacer"></span>
        <button type="button" class="btn btn-sm btn-primary" @click="openCreate">
          <FeatherIcon name="user-plus" :size="14" />
          Add admin
        </button>
      </header>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Admin</th>
              <th>Last sign-in</th>
              <th>Since</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="admin in admins" :key="admin.id">
              <td>
                <div class="row-sm">
                  <span class="sidebar-avatar admin-avatar">{{ initials(admin) }}</span>
                  <div class="stack-sm admin-identity">
                    <span>{{ admin.email }}</span>
                  </div>
                  <span v-if="admin.id === $session.admin.id" class="badge badge-cyan">you</span>
                </div>
              </td>
              <td class="small">{{ $format.timeAgo(admin.lastLoginAt) }}</td>
              <td class="small">{{ $format.date(admin.createdAt) }}</td>
              <td class="actions">
                <template v-if="admin.id !== $session.admin.id">
                  <button type="button" class="btn btn-ghost btn-sm" @click="resetPassword(admin)">
                    <FeatherIcon name="key" :size="14" />
                    Reset password
                  </button>
                  <button
                    type="button"
                    class="btn btn-ghost btn-icon btn-sm"
                    title="Remove"
                    @click="removeAdmin(admin)"
                  >
                    <FeatherIcon name="trash-2" :size="14" />
                  </button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <ModalDialog :open="createOpen" title="New admin" icon="user-plus" @close="createOpen = false">
      <form id="admin-form" class="stack" @submit.prevent="createAdmin">
        <div class="callout">
          <FeatherIcon name="info" class="icon" />
          <span>Every admin has full control over the server and its projects.</span>
        </div>
        <FormField label="E-mail" :error="createErrors.email">
          <input v-model="createForm.email" class="input" type="email" />
        </FormField>
        <FormField
          label="Password"
          :error="createErrors.password"
          hint="Leave empty to generate a strong one."
          optional
        >
          <input v-model="createForm.password" class="input" type="password" autocomplete="new-password" />
        </FormField>
      </form>
      <template #footer>
        <button type="button" class="btn" @click="createOpen = false">Cancel</button>
        <button type="submit" form="admin-form" class="btn btn-primary" :disabled="creating">
          <span v-if="creating" class="spinner"></span>
          Create
        </button>
      </template>
    </ModalDialog>

    <ModalDialog :open="generated !== null" title="Generated password" icon="key" @close="generated = null">
      <div v-if="generated" class="stack">
        <p class="text-dim small">
          Give this password to <strong>{{ generated.email }}</strong> through a safe channel. It will not be shown
          again.
        </p>
        <div class="generated-password">
          <code>{{ generated.password }}</code>
          <CopyButton :value="generated.password" />
        </div>
      </div>
      <template #footer>
        <button type="button" class="btn btn-primary" @click="generated = null">Done</button>
      </template>
    </ModalDialog>
  </div>
</template>

<script>
/**
 * Access settings: sign-in method and admin accounts.
 */
import { loadSettings, saveSettings } from './settingsForm.js';

export default {
  name: 'AccessSettings',
  data() {
    return {
      settings: null,
      magicLink: { ready: false, domain: null, https: false, publicUrl: null, mailRelay: null },
      admins: [],
      errors: {},
      saving: false,
      createOpen: false,
      createForm: { email: '', password: '' },
      createErrors: {},
      creating: false,
      generated: null,
    };
  },
  computed: {
    domainText() {
      const magicLink = this.magicLink;

      if (!magicLink.domain) {
        return 'SolarOps has no domain yet.';
      }

      if (!magicLink.https) {
        return `${magicLink.domain} has no certificate yet: links must travel over HTTPS.`;
      }

      return `Links point to ${magicLink.publicUrl}`;
    },
    relayText() {
      if (this.magicLink.mailRelay) {
        return `Sent through ${this.magicLink.mailRelay.name}.`;
      }

      return 'No mail relay selected yet.';
    },
  },
  async mounted() {
    try {
      const result = await loadSettings();
      this.settings = result.settings;
      this.magicLink = result.meta.magicLink;
    } catch (error) {
      this.$toast.error(error);
    }

    this.loadAdmins();
  },
  methods: {
    readinessIcon(ok) {
      if (ok) {
        return 'check-circle';
      }

      return 'x-circle';
    },
    readinessClass(ok) {
      if (ok) {
        return 'text-success';
      }

      return 'text-danger';
    },
    async loadAdmins() {
      try {
        const { admins } = await this.$api.get('/admins');
        this.admins = admins;
      } catch (error) {
        this.$toast.error(error);
      }
    },
    initials(admin) {
      return admin.email.slice(0, 2).toUpperCase();
    },
    async saveAuth() {
      this.saving = true;
      this.errors = {};

      try {
        const result = await saveSettings(this.settings);
        this.settings = result.settings;
        this.magicLink = result.meta.magicLink;
        this.$session.authMethod = result.settings.authMethod;
        this.$toast.success('Sign-in method saved.');
      } catch (error) {
        this.errors = error.fields;
        this.$toast.error(error);
      } finally {
        this.saving = false;
      }
    },
    openCreate() {
      this.createForm = { email: '', password: '' };
      this.createErrors = {};
      this.createOpen = true;
    },
    async createAdmin() {
      this.creating = true;
      this.createErrors = {};

      try {
        const result = await this.$api.post('/admins', this.createForm);
        this.createOpen = false;
        this.$toast.success(`${result.admin.email} added.`);

        if (result.generatedPassword) {
          this.generated = { email: result.admin.email, password: result.generatedPassword };
        }

        this.loadAdmins();
      } catch (error) {
        this.createErrors = error.fields;
        this.$toast.error(error);
      } finally {
        this.creating = false;
      }
    },
    async resetPassword(admin) {
      const confirmed = await this.$confirm({
        title: `Reset the password of ${admin.email}?`,
        message: 'A new password is generated and all their sessions are closed.',
        confirmText: 'Reset',
        icon: 'key',
      });

      if (!confirmed) {
        return;
      }

      try {
        const { generatedPassword } = await this.$api.post(`/admins/${admin.id}/reset-password`);
        this.generated = { email: admin.email, password: generatedPassword };
      } catch (error) {
        this.$toast.error(error);
      }
    },
    async removeAdmin(admin) {
      const confirmed = await this.$confirm({
        title: `Remove ${admin.email}?`,
        message: 'They lose access to SolarOps immediately.',
        confirmText: 'Remove',
        danger: true,
        icon: 'user-x',
      });

      if (!confirmed) {
        return;
      }

      try {
        await this.$api.delete(`/admins/${admin.id}`);
        this.$toast.success('Admin removed.');
        this.loadAdmins();
      } catch (error) {
        this.$toast.error(error);
      }
    },
  },
};
</script>

<style>
.readiness-text {
  flex: 1;
  min-width: 0;
  gap: 0;
}

.admin-avatar {
  width: 30px;
  height: 30px;
  font-size: 11px;
}

.admin-identity {
  gap: 0;
}

.generated-password {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px;
  border-radius: 12px;
  background: var(--surface-sunken);
  border: 1px solid rgba(129, 140, 248, 0.3);
}

.generated-password code {
  flex: 1;
  font-size: 16px;
  background: none;
  border: 0;
  color: var(--text);
}
</style>
