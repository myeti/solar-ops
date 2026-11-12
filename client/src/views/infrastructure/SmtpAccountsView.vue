<template>
  <div>
    <PageHeader
      eyebrow="Infrastructure"
      title="Mail relays"
      subtitle="SMTP accounts shared by projects, and used for magic link logins."
    >
      <template #actions>
        <button type="button" class="btn btn-primary" @click="openForm(null)">
          <FeatherIcon name="plus" />
          Add relay
        </button>
      </template>
    </PageHeader>

    <OrbitLoader v-if="loading" label="Loading…" />

    <div v-else-if="accounts.length === 0" class="panel">
      <EmptyState icon="send" title="No mail relay yet">
        Add the SMTP credentials of your e-mail provider (Brevo, Mailgun, Postmark, SES, your mailbox…). Projects
        receive them as SMTP_* variables.
        <template #actions>
          <button type="button" class="btn btn-primary" @click="openForm(null)">Add a relay</button>
        </template>
      </EmptyState>
    </div>

    <div v-else class="grid-auto">
      <article v-for="account in accounts" :key="account.id" class="panel fade-up">
        <div class="panel-body stack">
          <div class="row">
            <span class="icon-bubble cyan"><FeatherIcon name="send" :size="17" /></span>
            <div class="stack-sm relay-title">
              <strong class="truncate">{{ account.name }}</strong>
              <span class="mono tiny text-faint truncate">{{ account.host }}:{{ account.port }}</span>
            </div>
            <span v-if="account.secure" class="badge badge-green">TLS</span>
            <span v-else class="badge">STARTTLS</span>
          </div>
          <dl class="kv small">
            <dt>From</dt>
            <dd>{{ account.fromAddress }}</dd>
            <dt>User</dt>
            <dd>{{ account.username || '—' }}</dd>
            <dt>Used by</dt>
            <dd>
              <span v-if="account.usage.system" class="badge badge-violet relay-usage">{{
                systemUsageLabel(account)
              }}</span>
              <span v-for="project in account.usage.projects" :key="project.uid" class="badge relay-usage">{{
                project.name
              }}</span>
              <span v-if="!account.usage.system && account.usage.projects.length === 0" class="text-faint"
                >Nobody yet</span
              >
            </dd>
          </dl>
        </div>
        <footer class="panel-footer">
          <button type="button" class="btn btn-sm btn-ghost" @click="openTest(account)">
            <FeatherIcon name="zap" :size="14" />
            Test
          </button>
          <span class="spacer"></span>
          <button type="button" class="btn btn-sm btn-ghost btn-icon" title="Edit" @click="openForm(account)">
            <FeatherIcon name="edit-2" :size="14" />
          </button>
          <button type="button" class="btn btn-sm btn-ghost btn-icon" title="Delete" @click="remove(account)">
            <FeatherIcon name="trash-2" :size="14" />
          </button>
        </footer>
      </article>
    </div>

    <ModalDialog :open="formOpen" :title="formTitle" icon="send" width="lg" @close="formOpen = false">
      <form id="smtp-form" class="form-grid" @submit.prevent="save">
        <FormField class="full" label="Name" :error="errors.name" hint="How this relay appears in SolarOps.">
          <input v-model="form.name" class="input" placeholder="Brevo transactional" />
        </FormField>
        <FormField label="Host" :error="errors.host">
          <input v-model="form.host" class="input mono" placeholder="smtp.example.com" spellcheck="false" />
        </FormField>
        <FormField label="Port" :error="errors.port" hint="587 (STARTTLS) or 465 (TLS).">
          <input v-model.number="form.port" class="input mono" type="number" />
        </FormField>
        <FormField label="Username" :error="errors.username" optional>
          <input v-model="form.username" class="input" autocomplete="off" />
        </FormField>
        <FormField label="Password" :error="errors.password" :hint="passwordHint" optional>
          <input
            v-model="form.password"
            class="input"
            type="password"
            autocomplete="new-password"
            :placeholder="passwordPlaceholder"
          />
        </FormField>
        <FormField
          class="full"
          label="From address"
          :error="errors.fromAddress"
          hint='e.g. "My App" <no-reply@example.com>. Sender of the magic links, and default of the projects (each can set its own).'
        >
          <input v-model="form.fromAddress" class="input" />
        </FormField>
        <div class="full">
          <ToggleSwitch
            v-model="form.secure"
            label="Implicit TLS"
            hint="Enable for port 465. Port 587 upgrades with STARTTLS automatically."
          />
        </div>
      </form>
      <template #footer>
        <button type="button" class="btn" @click="formOpen = false">Cancel</button>
        <button type="submit" form="smtp-form" class="btn btn-primary" :disabled="saving">
          <span v-if="saving" class="spinner"></span>
          Save
        </button>
      </template>
    </ModalDialog>

    <ModalDialog :open="testAccount !== null" title="Test the relay" icon="zap" @close="testAccount = null">
      <div class="stack">
        <p class="text-dim small">SolarOps connects to the server, and sends a test e-mail if you give a recipient.</p>
        <FormField label="Send a test e-mail to" optional>
          <input v-model="testTo" class="input" type="email" :placeholder="$session.admin.email" />
        </FormField>
        <div v-if="testResult" class="callout" :class="testResultClass">
          <FeatherIcon :name="testResultIcon" class="icon" />
          <span>{{ testResultText }}</span>
        </div>
      </div>
      <template #footer>
        <button type="button" class="btn" @click="testAccount = null">Close</button>
        <button type="button" class="btn btn-primary" :disabled="testing" @click="runTest">
          <span v-if="testing" class="spinner"></span>
          <FeatherIcon v-else name="send" :size="16" />
          Run test
        </button>
      </template>
    </ModalDialog>
  </div>
</template>

<script>
/**
 * SMTP accounts management.
 */
function emptyForm() {
  return {
    name: '',
    host: '',
    port: 587,
    secure: false,
    username: '',
    password: '',
    fromAddress: '',
  };
}

export default {
  name: 'SmtpAccountsView',
  data() {
    return {
      accounts: [],
      loading: true,
      formOpen: false,
      editing: null,
      form: emptyForm(),
      errors: {},
      saving: false,
      testAccount: null,
      testTo: '',
      testing: false,
      testResult: null,
    };
  },
  computed: {
    formTitle() {
      if (this.editing) {
        return `Edit ${this.editing.name}`;
      }

      return 'New mail relay';
    },
    passwordPlaceholder() {
      if (this.editing && this.editing.hasPassword) {
        return '•••••••• (unchanged)';
      }

      return '';
    },
    passwordHint() {
      if (this.editing && this.editing.hasPassword) {
        return 'Leave empty to keep the saved password.';
      }

      return 'Stored encrypted.';
    },
    testResultClass() {
      if (this.testResult.ok) {
        return 'callout-success';
      }

      return 'callout-danger';
    },
    testResultIcon() {
      if (this.testResult.ok) {
        return 'check-circle';
      }

      return 'alert-octagon';
    },
    testResultText() {
      if (!this.testResult.ok) {
        return this.testResult.error;
      }

      if (this.testResult.sent) {
        return 'Connection OK and test e-mail sent. Check the inbox!';
      }

      return 'Connection and credentials OK.';
    },
  },
  mounted() {
    this.load();
  },
  methods: {
    systemUsageLabel(account) {
      if (account.usage.usedForLogin) {
        return 'SolarOps · magic links';
      }

      return 'SolarOps';
    },
    async load() {
      try {
        const { accounts } = await this.$api.get('/smtp-accounts');
        this.accounts = accounts;
      } catch (error) {
        this.$toast.error(error);
      } finally {
        this.loading = false;
      }
    },
    openForm(account) {
      this.editing = account;
      this.errors = {};

      if (account) {
        this.form = {
          name: account.name,
          host: account.host,
          port: account.port,
          secure: account.secure,
          username: account.username,
          password: '',
          fromAddress: account.fromAddress,
        };
      } else {
        this.form = emptyForm();
      }

      this.formOpen = true;
    },
    async save() {
      this.saving = true;
      this.errors = {};
      const body = { ...this.form };

      if (this.editing && body.password === '') {
        delete body.password;
      }

      try {
        if (this.editing) {
          await this.$api.put(`/smtp-accounts/${this.editing.id}`, body);
        } else {
          await this.$api.post('/smtp-accounts', body);
        }

        this.formOpen = false;
        this.$toast.success('Mail relay saved.');
        this.load();
      } catch (error) {
        this.errors = error.fields;
        this.$toast.error(error);
      } finally {
        this.saving = false;
      }
    },
    async remove(account) {
      const confirmed = await this.$confirm({
        title: `Delete ${account.name}?`,
        message: 'Projects must not use it anymore.',
        confirmText: 'Delete',
        danger: true,
        icon: 'trash-2',
      });

      if (!confirmed) {
        return;
      }

      try {
        await this.$api.delete(`/smtp-accounts/${account.id}`);
        this.$toast.success('Mail relay deleted.');
        this.load();
      } catch (error) {
        this.$toast.error(error);
      }
    },
    openTest(account) {
      this.testAccount = account;
      this.testTo = '';
      this.testResult = null;
    },
    async runTest() {
      this.testing = true;
      this.testResult = null;

      try {
        this.testResult = await this.$api.post(`/smtp-accounts/${this.testAccount.id}/test`, { to: this.testTo });
      } catch (error) {
        this.testResult = { ok: false, error: error.message };
      } finally {
        this.testing = false;
      }
    },
  },
};
</script>

<style>
.relay-title {
  flex: 1;
  min-width: 0;
  gap: 0;
}

.relay-usage {
  margin: 0 4px 4px 0;
}
</style>
