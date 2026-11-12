<template>
  <section class="panel fade-up">
    <header class="panel-header">
      <span class="panel-icon"><FeatherIcon name="layers" :size="17" /></span>
      <h3>Shared certificates</h3>
      <span class="spacer"></span>
      <button
        type="button"
        class="btn btn-sm btn-primary"
        :disabled="accounts.length === 0"
        @click="openSharedForm(null)"
      >
        <FeatherIcon name="plus" :size="14" />
        New certificate
      </button>
    </header>
    <div class="panel-body stack">
      <p class="text-dim small">
        One certificate for several projects, typically a wildcard like <code>*.example.com</code>. Issued once through
        your DNS provider (Let's Encrypt only validates wildcards over DNS), renewed once, and selected by each project
        in its Network tab.
      </p>
      <p v-if="accounts.length === 0" class="tiny text-faint">Add a DNS provider account below first.</p>
      <div v-if="sharedCertificates.length === 0" class="text-faint small">No shared certificate yet.</div>
      <ul v-else class="list-plain">
        <li v-for="shared in sharedCertificates" :key="shared.id" class="list-row">
          <span class="icon-bubble"><FeatherIcon name="layers" :size="16" /></span>
          <span class="stack-sm shared-text">
            <span class="row-sm row-wrap">
              <code v-for="domain in shared.domains" :key="domain">{{ domain }}</code>
              <StatusPill :status="sharedStatus(shared)" />
              <span v-if="shared.certificate.staging" class="badge badge-amber">staging</span>
            </span>
            <span class="tiny text-faint">{{ sharedSummary(shared) }}</span>
            <span v-if="shared.pendingDomains.length > 0" class="tiny text-warning">
              Not issued yet for {{ shared.pendingDomains.join(', ') }}: request it again.
            </span>
            <span class="tiny text-faint">
              <template v-if="shared.projects.length === 0">Not used by any project yet.</template>
              <template v-else>
                Used by
                <template v-for="(project, index) in shared.projects" :key="project.uid">
                  <RouterLink :to="`/projects/${project.uid}/network`">{{ project.name }}</RouterLink
                  ><template v-if="index < shared.projects.length - 1">, </template>
                </template>
              </template>
            </span>
          </span>
          <button type="button" class="btn btn-sm" @click="requestShared(shared)">
            <FeatherIcon name="refresh-cw" :size="14" />
            {{ sharedRequestLabel(shared) }}
          </button>
          <button type="button" class="btn btn-sm btn-ghost btn-icon" title="Edit" @click="openSharedForm(shared)">
            <FeatherIcon name="edit-2" :size="14" />
          </button>
          <button type="button" class="btn btn-sm btn-ghost btn-icon" title="Delete" @click="removeShared(shared)">
            <FeatherIcon name="trash-2" :size="14" />
          </button>
        </li>
      </ul>
    </div>

    <ModalDialog
      :open="sharedFormOpen"
      :title="sharedFormTitle"
      icon="layers"
      width="lg"
      @close="sharedFormOpen = false"
    >
      <form id="shared-form" class="stack" @submit.prevent="saveShared">
        <FormField
          label="Domains"
          :error="sharedErrors.domains"
          hint="Comma separated. *.example.com covers app.example.com, but neither example.com nor a.b.example.com: add each level you need."
        >
          <input
            v-model="sharedForm.domains"
            class="input mono"
            placeholder="example.com, *.example.com"
            spellcheck="false"
          />
        </FormField>
        <FormField
          label="DNS account"
          :error="sharedErrors.dnsAccountId"
          hint="certbot creates the validation TXT records through it."
        >
          <select v-model="sharedForm.dnsAccountId" class="select">
            <option :value="null" disabled>Choose an account</option>
            <option v-for="account in accounts" :key="account.id" :value="account.id">
              {{ account.name }} ({{ providerLabel(account.provider) }})
            </option>
          </select>
        </FormField>
        <ToggleSwitch
          v-model="sharedForm.autoRenew"
          label="Auto-renew"
          hint="Renewed 30 days before expiry; every project using it is reloaded with the new files."
        />
        <div v-if="sharedRequestsOnSave" class="callout">
          <FeatherIcon name="info" class="icon" />
          <span>{{ sharedRequestsOnSave }}</span>
        </div>
      </form>
      <template #footer>
        <button type="button" class="btn" @click="sharedFormOpen = false">Cancel</button>
        <button type="submit" form="shared-form" class="btn btn-primary" :disabled="sharedSaving">
          <span v-if="sharedSaving" class="spinner"></span>
          {{ sharedSaveLabel }}
        </button>
      </template>
    </ModalDialog>
  </section>
</template>

<script>
/**
 * Shared certificates (wildcards...): list, request, create / edit / delete.
 * Emits `changed` when DNS account usage may have changed.
 */
import { parseDomainList } from '../../services/domains.js';

function emptySharedForm() {
  return { domains: '', dnsAccountId: null, autoRenew: true };
}

export default {
  name: 'SharedCertificatesPanel',
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
      sharedCertificates: [],
      sharedFormOpen: false,
      sharedEditing: null,
      sharedForm: emptySharedForm(),
      sharedErrors: {},
      sharedSaving: false,
    };
  },
  computed: {
    sharedFormTitle() {
      if (this.sharedEditing) {
        return 'Edit shared certificate';
      }

      return 'New shared certificate';
    },
    /** Saving requests the certificate when it is new or its names changed. */
    sharedDomainsChanged() {
      if (!this.sharedEditing) {
        return true;
      }

      const before = [...this.sharedEditing.domains].sort().join(',');
      const after = parseDomainList(this.sharedForm.domains).sort().join(',');

      return before !== after;
    },
    sharedRequestsOnSave() {
      if (!this.sharedEditing) {
        return 'Saving requests the certificate right away (it takes about a minute, the DNS records must propagate).';
      }

      if (this.sharedDomainsChanged) {
        return 'The names changed: saving requests a new certificate, then reloads every project using it.';
      }

      return '';
    },
    sharedSaveLabel() {
      if (this.sharedDomainsChanged) {
        return 'Save & request';
      }

      return 'Save';
    },
  },
  mounted() {
    this.loadShared();
    this.unsubscribe = this.$tasks.onFinished((task) => {
      if (task.type === 'certificate') {
        this.loadShared();
      }
    });
  },
  beforeUnmount() {
    this.unsubscribe();
  },
  methods: {
    providerLabel(id) {
      const provider = this.providers.find((candidate) => candidate.id === id);

      if (provider) {
        return provider.label;
      }

      return id;
    },
    async loadShared() {
      try {
        const { certificates } = await this.$api.get('/shared-certificates');
        this.sharedCertificates = certificates;
      } catch (error) {
        this.$toast.error(error);
      }
    },
    sharedStatus(shared) {
      if (!shared.certificate.exists) {
        return 'missing';
      }

      if (shared.certificate.needsRenewal) {
        return 'expiring';
      }

      return 'valid';
    },
    sharedSummary(shared) {
      const parts = [];

      if (shared.dnsAccount) {
        parts.push(`${shared.dnsAccount.name} (${this.providerLabel(shared.dnsAccount.provider)})`);
      }

      if (shared.certificate.exists) {
        parts.push(`valid until ${this.$format.date(shared.certificate.validTo)} (${shared.certificate.daysLeft}d)`);
      } else {
        parts.push('not issued yet');
      }

      if (shared.autoRenew) {
        parts.push('auto-renew on');
      } else {
        parts.push('auto-renew off');
      }

      return parts.join(' · ');
    },
    sharedRequestLabel(shared) {
      if (shared.certificate.exists && shared.pendingDomains.length === 0) {
        return 'Renew';
      }

      return 'Request';
    },
    openSharedForm(shared) {
      this.sharedEditing = shared;
      this.sharedErrors = {};

      if (shared) {
        this.sharedForm = {
          domains: shared.domains.join(', '),
          dnsAccountId: shared.dnsAccountId,
          autoRenew: shared.autoRenew,
        };
      } else {
        this.sharedForm = emptySharedForm();

        if (this.accounts.length === 1) {
          this.sharedForm.dnsAccountId = this.accounts[0].id;
        }
      }

      this.sharedFormOpen = true;
    },
    async saveShared() {
      this.sharedSaving = true;
      this.sharedErrors = {};

      try {
        let result;

        if (this.sharedEditing) {
          result = await this.$api.put(`/shared-certificates/${this.sharedEditing.id}`, this.sharedForm);
        } else {
          result = await this.$api.post('/shared-certificates', this.sharedForm);
        }

        this.sharedFormOpen = false;
        this.loadShared();
        this.$emit('changed');

        if (result.task) {
          this.$tasks.open(result.task.id);
        } else {
          this.$toast.success('Shared certificate saved.');
        }
      } catch (error) {
        this.sharedErrors = error.fields;
        this.$toast.error(error);
      } finally {
        this.sharedSaving = false;
      }
    },
    async requestShared(shared) {
      try {
        const { task } = await this.$api.post(`/shared-certificates/${shared.id}/request`, { force: false });
        this.$tasks.open(task.id);
      } catch (error) {
        this.$toast.error(error);
      }
    },
    async removeShared(shared) {
      const confirmed = await this.$confirm({
        title: `Delete the certificate ${shared.domains[0]}?`,
        message: 'Its files are removed from the server. Projects must use another certificate first.',
        confirmText: 'Delete',
        danger: true,
        icon: 'trash-2',
      });

      if (!confirmed) {
        return;
      }

      try {
        await this.$api.delete(`/shared-certificates/${shared.id}`);
        this.$toast.success('Shared certificate deleted.');
        this.loadShared();
        this.$emit('changed');
      } catch (error) {
        this.$toast.error(error);
      }
    },
  },
};
</script>

<style>
.shared-text {
  flex: 1;
  min-width: 0;
  gap: 4px;
}
</style>
