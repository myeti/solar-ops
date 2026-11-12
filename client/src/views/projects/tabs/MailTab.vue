<template>
  <div class="stack-lg">
    <form class="panel" @submit.prevent="save">
      <header class="panel-header">
        <span class="panel-icon"><FeatherIcon name="send" :size="17" /></span>
        <h3>Mail relay</h3>
        <span class="spacer"></span>
        <ToggleSwitch v-model="form.enabled" :label="toggleLabel" />
      </header>
      <div class="panel-body stack">
        <p v-if="project.system" class="text-dim small">
          SolarOps sends the magic login links through this relay. Pick it here, then switch the sign-in method in
          <RouterLink to="/settings/access">Settings › Access</RouterLink>.
        </p>
        <p v-else class="text-dim small">
          Link one of the server's mail relays: its settings are given to the project at startup as
          <code>SMTP_*</code> environment variables, so credentials never live in the repository.
        </p>

        <div v-if="accounts.length === 0" class="callout callout-warning">
          <FeatherIcon name="inbox" class="icon" />
          <span>
            No mail relay configured yet.
            <RouterLink to="/infrastructure/mail">Add one in Infrastructure › Mail relays</RouterLink>.
          </span>
        </div>

        <div v-else-if="form.enabled" class="choice-grid">
          <button
            v-for="account in accounts"
            :key="account.id"
            type="button"
            class="choice"
            :class="{ selected: form.accountId === account.id }"
            @click="form.accountId = account.id"
          >
            <FeatherIcon name="send" class="choice-icon" />
            <div>
              <strong>{{ account.name }}</strong>
              <span>{{ account.host }}:{{ account.port }}</span>
              <span>{{ account.fromAddress }}</span>
            </div>
          </button>
        </div>
        <span v-if="errors.accountId" class="field-error">{{ errors.accountId }}</span>

        <FormField
          v-if="form.enabled && !project.system && accounts.length > 0"
          label="From address"
          :error="errors.fromAddress"
          :hint="fromHint"
          optional
          class="mail-from"
        >
          <input v-model="form.fromAddress" class="input" :placeholder="relayFromAddress" />
        </FormField>

        <div v-if="form.enabled && !project.system" class="stack-sm">
          <div class="section-title">Variables</div>
          <div class="row row-wrap">
            <code v-for="variable in variables" :key="variable">{{ variable }}</code>
          </div>
        </div>
      </div>
      <footer class="panel-footer">
        <button type="submit" class="btn btn-primary" :disabled="saving || !isDirty">
          <span v-if="saving" class="spinner"></span>
          <FeatherIcon v-else name="save" :size="16" />
          Save
        </button>
      </footer>
    </form>
  </div>
</template>

<script>
/**
 * Mail tab: link an SMTP account to the project, optionally with its own
 * from address (the relay's otherwise).
 */
export default {
  name: 'MailTab',
  props: {
    project: {
      type: Object,
      required: true,
    },
  },
  emits: ['refresh'],
  data() {
    return {
      form: {
        enabled: this.project.smtp.enabled,
        accountId: this.project.smtp.accountId,
        fromAddress: this.project.smtp.fromAddress || '',
      },
      accounts: [],
      errors: {},
      saving: false,
      variables: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'],
    };
  },
  computed: {
    toggleLabel() {
      if (this.project.system) {
        return 'Use a mail relay';
      }

      return 'Provide SMTP variables';
    },
    /** From address of the selected relay, used when the project gives none. */
    relayFromAddress() {
      const account = this.accounts.find((candidate) => candidate.id === this.form.accountId);

      if (account) {
        return account.fromAddress;
      }

      return '';
    },
    fromHint() {
      if (this.relayFromAddress) {
        return `Given as SMTP_FROM. Empty: the relay's, ${this.relayFromAddress}.`;
      }

      return "Given as SMTP_FROM. Empty: the relay's.";
    },
    isDirty() {
      const smtp = this.project.smtp;

      return (
        this.form.enabled !== smtp.enabled ||
        this.form.accountId !== smtp.accountId ||
        this.form.fromAddress.trim() !== (smtp.fromAddress || '')
      );
    },
  },
  async mounted() {
    try {
      const { accounts } = await this.$api.get('/smtp-accounts');
      this.accounts = accounts;

      if (this.form.accountId === null && accounts.length === 1) {
        this.form.accountId = accounts[0].id;
      }
    } catch (error) {
      this.$toast.error(error);
    }
  },
  methods: {
    async save() {
      this.saving = true;
      this.errors = {};

      try {
        await this.$api.put(`/projects/${this.project.uid}/smtp`, this.form);

        if (this.project.system) {
          this.$toast.success('SolarOps mail relay saved.');
        } else {
          this.$toast.success('Mail settings saved. Restart the project to apply them.');
        }

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
.mail-from {
  max-width: 520px;
}
</style>
