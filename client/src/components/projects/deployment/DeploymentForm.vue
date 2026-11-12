<template>
  <form class="panel" @submit.prevent="save">
    <header class="panel-header">
      <span class="panel-icon"><FeatherIcon name="git-branch" :size="17" /></span>
      <h3>Source</h3>
      <span class="spacer"></span>
      <ToggleSwitch v-model="form.enabled" label="Deploy from git" />
    </header>

    <div v-if="!form.enabled" class="panel-body">
      <p class="text-dim small">
        Enable git deployment to clone the repository into <code>repo/</code>, install dependencies, build and restart
        the project in one click — or automatically on every push with a webhook.
      </p>
    </div>

    <div v-else class="panel-body stack-lg">
      <div class="form-grid">
        <FormField
          class="full"
          label="Repository URL"
          :error="errors.url"
          hint="HTTPS (with a credential for private repositories) or SSH (uses the server's SSH key)."
        >
          <input
            v-model="form.url"
            class="input mono"
            placeholder="https://github.com/acme/app.git"
            spellcheck="false"
          />
        </FormField>
        <FormField label="Branch" :error="errors.branch">
          <input v-model="form.branch" class="input mono" placeholder="main" spellcheck="false" />
        </FormField>
        <FormField label="Git credential" :error="errors.gitCredentialId">
          <select v-model="form.gitCredentialId" class="select">
            <option :value="null">None (public repository or SSH key)</option>
            <option v-for="credential in credentials" :key="credential.id" :value="credential.id">
              {{ credential.name }} — {{ credential.username }}
            </option>
          </select>
          <template #hint>
            <RouterLink to="/infrastructure/git">Manage credentials</RouterLink>
          </template>
        </FormField>
        <FormField
          label="Install commands"
          :error="errors.installCommand"
          hint="One per line, run in order from repo/, stopping at the first failure. Empty: detected from package.json and the lockfile (npm, pnpm, yarn, bun)."
          optional
        >
          <textarea
            v-model="form.installCommand"
            class="textarea mono"
            rows="3"
            placeholder="auto"
            spellcheck="false"
          ></textarea>
        </FormField>
        <FormField
          label="Build commands"
          :error="errors.buildCommand"
          hint="One per line, like install. Empty to skip. The default npm run build runs with the detected package manager, and is skipped without a build script."
          optional
        >
          <textarea
            v-model="form.buildCommand"
            class="textarea mono"
            rows="3"
            placeholder="npm run build"
            spellcheck="false"
          ></textarea>
        </FormField>
      </div>

      <ToggleSwitch
        v-if="project.type === 'app'"
        v-model="form.restartAfterDeploy"
        label="Restart after deploy"
        hint="Restart the pm2 process once the build succeeds (active projects only)."
      />
      <p v-else class="small text-dim">
        Static site: once built, the files of <code>repo/{{ project.network.publicFolder }}</code> are served by nginx
        right away.
      </p>

      <div class="divider"></div>

      <ToggleSwitch
        v-model="form.webhookEnabled"
        label="Deploy on push (webhook)"
        hint="GitHub, GitLab, Bitbucket or any CI can trigger a deployment."
      />

      <div v-if="accessResult" class="callout" :class="accessResultClass">
        <FeatherIcon :name="accessResultIcon" class="icon" />
        <span>{{ accessResultText }}</span>
      </div>
    </div>

    <footer class="panel-footer">
      <button
        v-if="project.deployment.enabled"
        type="button"
        class="btn btn-ghost"
        :disabled="testing || isDirty"
        @click="testAccess"
      >
        <span v-if="testing" class="spinner"></span>
        <FeatherIcon v-else name="wifi" :size="16" />
        Test access
      </button>
      <span class="spacer"></span>
      <button type="submit" class="btn btn-primary" :disabled="saving || !isDirty">
        <span v-if="saving" class="spinner"></span>
        <FeatherIcon v-else name="save" :size="16" />
        Save
      </button>
    </footer>
  </form>
</template>

<script>
/**
 * Deployment source of a project: repository, branch, credential, install
 * and build commands, restart and webhook switches, access test.
 */

/**
 * Editable copy of the deployment configuration.
 */
function formFrom(deployment) {
  return {
    enabled: deployment.enabled,
    url: deployment.url,
    branch: deployment.branch,
    gitCredentialId: deployment.gitCredentialId,
    installCommand: deployment.installCommand,
    buildCommand: deployment.buildCommand,
    restartAfterDeploy: deployment.restartAfterDeploy,
    webhookEnabled: deployment.webhookEnabled,
  };
}

export default {
  name: 'DeploymentForm',
  props: {
    project: {
      type: Object,
      required: true,
    },
  },
  emits: ['refresh'],
  data() {
    return {
      form: formFrom(this.project.deployment),
      errors: {},
      credentials: [],
      saving: false,
      resync: false,
      testing: false,
      accessResult: null,
    };
  },
  computed: {
    isDirty() {
      return JSON.stringify(this.form) !== JSON.stringify(formFrom(this.project.deployment));
    },
    accessResultClass() {
      if (this.accessResult.ok) {
        return 'callout-success';
      }

      return 'callout-danger';
    },
    accessResultIcon() {
      if (this.accessResult.ok) {
        return 'check-circle';
      }

      return 'alert-octagon';
    },
    accessResultText() {
      const result = this.accessResult;

      if (!result.ok) {
        return result.error;
      }

      if (!result.branchExists) {
        return `Repository reachable, but the branch "${this.project.deployment.branch}" does not exist. Branches: ${result.branches.join(', ')}`;
      }

      return `Repository reachable. ${result.branches.length} branch(es) found, "${this.project.deployment.branch}" included.`;
    },
  },
  watch: {
    /**
     * The page refreshes the project every 10 seconds: follow the server
     * only when the form holds no unsaved edit (or right after a save).
     */
    'project.deployment': {
      deep: true,
      handler(deployment, previous) {
        const untouched = JSON.stringify(this.form) === JSON.stringify(formFrom(previous));

        if (untouched || this.resync) {
          this.resync = false;
          this.form = formFrom(deployment);
        }
      },
    },
  },
  mounted() {
    this.loadCredentials();
  },
  methods: {
    async loadCredentials() {
      try {
        const { credentials } = await this.$api.get('/git-credentials');
        this.credentials = credentials;
      } catch (error) {
        this.$toast.error(error);
      }
    },
    async save() {
      this.saving = true;
      this.errors = {};

      try {
        await this.$api.put(`/projects/${this.project.uid}/deployment`, this.form);
        this.$toast.success('Deployment settings saved.');
        this.accessResult = null;
        this.resync = true;
        this.$emit('refresh');
      } catch (error) {
        this.errors = error.fields;
        this.$toast.error(error);
      } finally {
        this.saving = false;
      }
    },
    async testAccess() {
      this.testing = true;
      this.accessResult = null;

      try {
        this.accessResult = await this.$api.post(`/projects/${this.project.uid}/deployment/test`);
      } catch (error) {
        this.accessResult = { ok: false, error: error.message };
      } finally {
        this.testing = false;
      }
    },
  },
};
</script>
