<template>
  <section class="panel fade-up">
    <header class="panel-header">
      <span class="panel-icon"><FeatherIcon name="globe" :size="17" /></span>
      <h3>DNS provider accounts</h3>
      <span class="spacer"></span>
      <button type="button" class="btn btn-sm btn-primary" @click="openForm(null)">
        <FeatherIcon name="plus" :size="14" />
        Add account
      </button>
    </header>
    <div class="panel-body stack">
      <p class="text-dim small">
        Used for DNS-01 validation: certbot creates a temporary TXT record through your provider's API. Needed for
        wildcard domains, or when port 80 is not reachable.
      </p>
      <div v-if="accounts.length === 0" class="text-faint small">No DNS account yet.</div>
      <ul v-else class="list-plain">
        <li v-for="account in accounts" :key="account.id" class="list-row">
          <span class="icon-bubble"><FeatherIcon name="cloud" :size="16" /></span>
          <span class="stack-sm dns-account-text">
            <strong>{{ account.name }}</strong>
            <span class="tiny text-faint">
              {{ providerLabel(account.provider) }} · {{ account.propagationSeconds }}s propagation ·
              {{ usageLabel(account) }}
            </span>
          </span>
          <button type="button" class="btn btn-sm btn-ghost btn-icon" title="Edit" @click="openForm(account)">
            <FeatherIcon name="edit-2" :size="14" />
          </button>
          <button type="button" class="btn btn-sm btn-ghost btn-icon" title="Delete" @click="remove(account)">
            <FeatherIcon name="trash-2" :size="14" />
          </button>
        </li>
      </ul>
    </div>

    <ModalDialog :open="formOpen" :title="formTitle" icon="cloud" width="lg" @close="formOpen = false">
      <form id="dns-form" class="stack" @submit.prevent="save">
        <div class="form-grid">
          <FormField label="Name" :error="errors.name">
            <input v-model="form.name" class="input" placeholder="OVH main account" />
          </FormField>
          <FormField label="Provider" :error="errors.provider">
            <select v-model="form.provider" class="select" @change="onProviderChange">
              <option v-for="provider in providers" :key="provider.id" :value="provider.id">
                {{ provider.label }}
              </option>
            </select>
          </FormField>
        </div>
        <div v-if="currentProvider" class="callout">
          <FeatherIcon name="info" class="icon" />
          <span>
            {{ currentProvider.help }}
            Requires the certbot plugin <code>{{ currentProvider.systemPackage }}</code
            >.
          </span>
        </div>
        <div v-if="currentProvider" class="form-grid">
          <FormField
            v-for="field in currentProvider.fields"
            :key="field.key"
            :label="field.label"
            :error="errors[field.key]"
            :hint="fieldHint(field)"
          >
            <select v-if="field.type === 'select'" v-model="form.credentials[field.key]" class="select">
              <option v-for="option in field.options" :key="option" :value="option">{{ option }}</option>
            </select>
            <input
              v-else
              v-model="form.credentials[field.key]"
              class="input mono"
              :type="fieldInputType(field)"
              :placeholder="fieldPlaceholder(field)"
              autocomplete="off"
              spellcheck="false"
            />
          </FormField>
          <FormField
            label="Propagation delay (seconds)"
            :error="errors.propagationSeconds"
            hint="How long certbot waits for the TXT record to propagate."
          >
            <input v-model.number="form.propagationSeconds" class="input mono" type="number" min="10" max="3600" />
          </FormField>
        </div>
      </form>
      <template #footer>
        <button type="button" class="btn" @click="formOpen = false">Cancel</button>
        <button type="submit" form="dns-form" class="btn btn-primary" :disabled="saving">
          <span v-if="saving" class="spinner"></span>
          Save
        </button>
      </template>
    </ModalDialog>
  </section>
</template>

<script>
/**
 * DNS provider accounts used for DNS-01 validation: list, create / edit /
 * delete. Emits `changed` after a change (the parent reloads the list).
 */
export default {
  name: 'DnsAccountsPanel',
  props: {
    /** DNS accounts, with their usage. */
    accounts: {
      type: Array,
      required: true,
    },
    /** DNS providers (labels, credential fields). */
    providers: {
      type: Array,
      required: true,
    },
  },
  emits: ['changed'],
  data() {
    return {
      formOpen: false,
      editing: null,
      form: { name: '', provider: 'ovh', propagationSeconds: 60, credentials: {} },
      errors: {},
      saving: false,
    };
  },
  computed: {
    currentProvider() {
      return this.providers.find((provider) => provider.id === this.form.provider) || null;
    },
    formTitle() {
      if (this.editing) {
        return `Edit ${this.editing.name}`;
      }

      return 'New DNS account';
    },
  },
  methods: {
    providerLabel(id) {
      const provider = this.providers.find((candidate) => candidate.id === id);

      if (provider) {
        return provider.label;
      }

      return id;
    },
    usageLabel(account) {
      const users = [
        ...account.projects.map((project) => project.name),
        ...account.sharedCertificates.map((shared) => `shared ${shared.domains[0]}`),
      ];

      if (users.length === 0) {
        return 'unused';
      }

      return `used by ${users.join(', ')}`;
    },
    defaultCredentials(providerId) {
      const provider = this.providers.find((candidate) => candidate.id === providerId);
      const credentials = {};

      if (!provider) {
        return credentials;
      }

      for (const field of provider.fields) {
        credentials[field.key] = field.defaultValue || '';
      }

      return credentials;
    },
    onProviderChange() {
      this.form.credentials = this.defaultCredentials(this.form.provider);
    },
    openForm(account) {
      this.editing = account;
      this.errors = {};

      if (account) {
        this.form = {
          name: account.name,
          provider: account.provider,
          propagationSeconds: account.propagationSeconds,
          credentials: { ...this.defaultCredentials(account.provider), ...account.visibleCredentials },
        };
      } else {
        let providerId = 'ovh';

        if (this.providers.length > 0) {
          providerId = this.providers[0].id;
        }

        this.form = {
          name: '',
          provider: providerId,
          propagationSeconds: 60,
          credentials: this.defaultCredentials(providerId),
        };
      }

      this.formOpen = true;
    },
    fieldInputType(field) {
      if (field.secret) {
        return 'password';
      }

      return 'text';
    },
    fieldPlaceholder(field) {
      if (this.editing && field.secret) {
        return '•••••••• (unchanged)';
      }

      return '';
    },
    fieldHint(field) {
      if (this.editing && field.secret) {
        return 'Leave empty to keep the saved value.';
      }

      if (field.secret) {
        return 'Stored encrypted.';
      }

      return '';
    },
    async save() {
      this.saving = true;
      this.errors = {};

      try {
        if (this.editing) {
          await this.$api.put(`/dns-accounts/${this.editing.id}`, this.form);
        } else {
          await this.$api.post('/dns-accounts', this.form);
        }

        this.formOpen = false;
        this.$toast.success('DNS account saved.');
        this.$emit('changed');
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
        message: 'Projects and shared certificates must not use it anymore.',
        confirmText: 'Delete',
        danger: true,
        icon: 'trash-2',
      });

      if (!confirmed) {
        return;
      }

      try {
        await this.$api.delete(`/dns-accounts/${account.id}`);
        this.$toast.success('DNS account deleted.');
        this.$emit('changed');
      } catch (error) {
        this.$toast.error(error);
      }
    },
  },
};
</script>

<style>
.dns-account-text {
  flex: 1;
  min-width: 0;
  gap: 0;
}
</style>
