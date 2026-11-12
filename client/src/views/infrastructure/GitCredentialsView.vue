<template>
  <div>
    <PageHeader
      eyebrow="Infrastructure"
      title="Git credentials"
      subtitle="Access tokens used to clone and pull private repositories over HTTPS."
    >
      <template #actions>
        <button type="button" class="btn" @click="openTest(null)">
          <FeatherIcon name="wifi" :size="16" />
          Test a repository
        </button>
        <button type="button" class="btn btn-primary" @click="openForm(null)">
          <FeatherIcon name="plus" />
          Add credential
        </button>
      </template>
    </PageHeader>

    <div class="callout git-callout">
      <FeatherIcon name="lock" class="icon" />
      <span>
        Tokens are stored encrypted and given to git through <code>GIT_ASKPASS</code> only for the duration of a
        command: they never appear in repository URLs, <code>.git/config</code> or logs.
      </span>
    </div>

    <OrbitLoader v-if="loading" label="Loading credentials…" />

    <div v-else-if="credentials.length === 0" class="panel">
      <EmptyState icon="key" title="No credential yet">
        Public repositories and SSH URLs work without one. For private HTTPS repositories, add a personal access token
        (GitHub, GitLab) or an app password (Bitbucket).
        <template #actions>
          <button type="button" class="btn btn-primary" @click="openForm(null)">Add a credential</button>
        </template>
      </EmptyState>
    </div>

    <div v-else class="grid-auto">
      <article v-for="credential in credentials" :key="credential.id" class="panel fade-up">
        <div class="panel-body stack">
          <div class="row">
            <span class="icon-bubble"><FeatherIcon :name="providerIcon(credential.provider)" :size="17" /></span>
            <div class="stack-sm credential-title">
              <strong class="truncate">{{ credential.name }}</strong>
              <span class="tiny text-faint">{{ providerLabel(credential.provider) }}</span>
            </div>
          </div>
          <dl class="kv small">
            <dt>Username</dt>
            <dd class="mono">{{ credential.username }}</dd>
            <dt>Token</dt>
            <dd class="mono">{{ credential.tokenHint || '••••' }}</dd>
            <dt>Used by</dt>
            <dd>
              <span v-if="credential.projects.length === 0" class="text-faint">Nobody yet</span>
              <RouterLink
                v-for="project in credential.projects"
                :key="project.uid"
                :to="`/projects/${project.uid}/deployment`"
                class="badge credential-usage"
              >
                {{ project.name }}
              </RouterLink>
            </dd>
          </dl>
        </div>
        <footer class="panel-footer">
          <button type="button" class="btn btn-sm btn-ghost" @click="openTest(credential)">
            <FeatherIcon name="wifi" :size="14" />
            Test
          </button>
          <span class="spacer"></span>
          <button type="button" class="btn btn-sm btn-ghost btn-icon" title="Edit" @click="openForm(credential)">
            <FeatherIcon name="edit-2" :size="14" />
          </button>
          <button type="button" class="btn btn-sm btn-ghost btn-icon" title="Delete" @click="remove(credential)">
            <FeatherIcon name="trash-2" :size="14" />
          </button>
        </footer>
      </article>
    </div>

    <ModalDialog :open="formOpen" :title="formTitle" icon="key" @close="formOpen = false">
      <form id="git-form" class="stack" @submit.prevent="save">
        <FormField label="Provider" :error="errors.provider">
          <div class="choice-grid git-providers">
            <button
              v-for="provider in providers"
              :key="provider.id"
              type="button"
              class="choice"
              :class="{ selected: form.provider === provider.id }"
              @click="form.provider = provider.id"
            >
              <FeatherIcon :name="provider.icon" class="choice-icon" />
              <div>
                <strong>{{ provider.label }}</strong>
              </div>
            </button>
          </div>
        </FormField>
        <FormField label="Name" :error="errors.name">
          <input v-model="form.name" class="input" placeholder="GitHub — acme organisation" />
        </FormField>
        <FormField label="Username" :error="errors.username" :hint="currentProvider.usernameHint">
          <input v-model="form.username" class="input mono" autocomplete="off" spellcheck="false" />
        </FormField>
        <FormField label="Token" :error="errors.token" :hint="tokenHint">
          <input
            v-model="form.token"
            class="input mono"
            type="password"
            autocomplete="new-password"
            :placeholder="tokenPlaceholder"
          />
        </FormField>
      </form>
      <template #footer>
        <button type="button" class="btn" @click="formOpen = false">Cancel</button>
        <button type="submit" form="git-form" class="btn btn-primary" :disabled="saving">
          <span v-if="saving" class="spinner"></span>
          Save
        </button>
      </template>
    </ModalDialog>

    <ModalDialog :open="testOpen" title="Test repository access" icon="wifi" @close="testOpen = false">
      <form id="git-test-form" class="stack" @submit.prevent="runTest">
        <FormField label="Repository URL">
          <input
            v-model="test.url"
            class="input mono"
            placeholder="https://github.com/acme/app.git"
            spellcheck="false"
          />
        </FormField>
        <FormField label="Credential">
          <select v-model="test.credentialId" class="select">
            <option :value="null">None (public or SSH)</option>
            <option v-for="credential in credentials" :key="credential.id" :value="credential.id">
              {{ credential.name }}
            </option>
          </select>
        </FormField>
        <div v-if="testResult" class="callout" :class="testResultClass">
          <FeatherIcon :name="testResultIcon" class="icon" />
          <span>{{ testResultText }}</span>
        </div>
      </form>
      <template #footer>
        <button type="button" class="btn" @click="testOpen = false">Close</button>
        <button type="submit" form="git-test-form" class="btn btn-primary" :disabled="testing || !test.url">
          <span v-if="testing" class="spinner"></span>
          Run git ls-remote
        </button>
      </template>
    </ModalDialog>
  </div>
</template>

<script>
/**
 * Git credentials management and repository access test.
 */
const PROVIDERS = [
  {
    id: 'github',
    label: 'GitHub',
    icon: 'github',
    usernameHint: 'Your GitHub username.',
    tokenHint: 'Fine-grained personal access token with "Contents: read" on the repositories.',
  },
  {
    id: 'gitlab',
    label: 'GitLab',
    icon: 'gitlab',
    usernameHint: 'Your GitLab username (or "oauth2").',
    tokenHint: 'Personal or project access token with the read_repository scope.',
  },
  {
    id: 'bitbucket',
    label: 'Bitbucket',
    icon: 'box',
    usernameHint: 'Your Bitbucket username (or "x-token-auth" for repository access tokens).',
    tokenHint: 'App password with "Repositories: read", or a repository access token.',
  },
  {
    id: 'other',
    label: 'Other',
    icon: 'git-branch',
    usernameHint: 'Username expected by your git server.',
    tokenHint: 'Password or token used for HTTPS authentication.',
  },
];

export default {
  name: 'GitCredentialsView',
  data() {
    return {
      credentials: [],
      loading: true,
      providers: PROVIDERS,
      formOpen: false,
      editing: null,
      form: { name: '', provider: 'github', username: '', token: '' },
      errors: {},
      saving: false,
      testOpen: false,
      test: { url: '', credentialId: null },
      testing: false,
      testResult: null,
    };
  },
  computed: {
    currentProvider() {
      return PROVIDERS.find((provider) => provider.id === this.form.provider) || PROVIDERS[3];
    },
    formTitle() {
      if (this.editing) {
        return `Edit ${this.editing.name}`;
      }

      return 'New git credential';
    },
    tokenPlaceholder() {
      if (this.editing) {
        return '•••••••• (unchanged)';
      }

      return '';
    },
    tokenHint() {
      if (this.editing) {
        return `Leave empty to keep the saved token. ${this.currentProvider.tokenHint}`;
      }

      return this.currentProvider.tokenHint;
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

      const branches = this.testResult.branches;
      const preview = branches.slice(0, 8).join(', ');
      let suffix = '';

      if (branches.length > 8) {
        suffix = '…';
      }

      return `Access granted. ${branches.length} branch(es): ${preview}${suffix}`;
    },
  },
  mounted() {
    this.load();
  },
  methods: {
    async load() {
      try {
        const { credentials } = await this.$api.get('/git-credentials');
        this.credentials = credentials;
      } catch (error) {
        this.$toast.error(error);
      } finally {
        this.loading = false;
      }
    },
    providerIcon(id) {
      const provider = PROVIDERS.find((candidate) => candidate.id === id);

      if (provider) {
        return provider.icon;
      }

      return 'git-branch';
    },
    providerLabel(id) {
      const provider = PROVIDERS.find((candidate) => candidate.id === id);

      if (provider) {
        return provider.label;
      }

      return id;
    },
    openForm(credential) {
      this.editing = credential;
      this.errors = {};

      if (credential) {
        this.form = { name: credential.name, provider: credential.provider, username: credential.username, token: '' };
      } else {
        this.form = { name: '', provider: 'github', username: '', token: '' };
      }

      this.formOpen = true;
    },
    async save() {
      this.saving = true;
      this.errors = {};
      const body = { ...this.form };

      if (this.editing && body.token === '') {
        delete body.token;
      }

      try {
        if (this.editing) {
          await this.$api.put(`/git-credentials/${this.editing.id}`, body);
        } else {
          await this.$api.post('/git-credentials', body);
        }

        this.formOpen = false;
        this.$toast.success('Git credential saved.');
        this.load();
      } catch (error) {
        this.errors = error.fields;
        this.$toast.error(error);
      } finally {
        this.saving = false;
      }
    },
    async remove(credential) {
      const confirmed = await this.$confirm({
        title: `Delete ${credential.name}?`,
        message: 'Projects must not use it for their deployments anymore.',
        confirmText: 'Delete',
        danger: true,
        icon: 'trash-2',
      });

      if (!confirmed) {
        return;
      }

      try {
        await this.$api.delete(`/git-credentials/${credential.id}`);
        this.$toast.success('Credential deleted.');
        this.load();
      } catch (error) {
        this.$toast.error(error);
      }
    },
    openTest(credential) {
      this.testResult = null;
      this.test = { url: '', credentialId: null };

      if (credential) {
        this.test.credentialId = credential.id;
      }

      this.testOpen = true;
    },
    async runTest() {
      this.testing = true;
      this.testResult = null;

      try {
        this.testResult = await this.$api.post('/git-credentials/test', this.test);
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
.git-callout {
  margin-bottom: 24px;
}

.credential-title {
  flex: 1;
  min-width: 0;
  gap: 0;
}

.credential-usage {
  margin: 0 4px 4px 0;
}

.git-providers {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.git-providers .choice {
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 6px;
}

@media (max-width: 600px) {
  .git-providers {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
