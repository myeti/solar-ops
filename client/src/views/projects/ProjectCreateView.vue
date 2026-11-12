<template>
  <div>
    <PageHeader
      eyebrow="Projects"
      title="New project"
      subtitle="Name it, SolarOps prepares its folder. Components can be enabled right after."
    >
      <template #actions>
        <RouterLink to="/projects" class="btn btn-ghost">
          <FeatherIcon name="arrow-left" :size="16" />
          Back
        </RouterLink>
      </template>
    </PageHeader>

    <div class="create-layout">
      <form class="panel fade-up" @submit.prevent="submit">
        <div class="panel-body stack-lg">
          <FormField label="Project name" :error="errors.name" hint="Displayed everywhere in SolarOps.">
            <input
              v-model="form.name"
              class="input"
              placeholder="My awesome app"
              required
              autofocus
              @input="onNameInput"
            />
          </FormField>

          <div class="stack-sm">
            <div class="field-label">What kind of project?</div>
            <div class="choice-grid">
              <button
                type="button"
                class="choice"
                :class="{ selected: form.type === 'app' }"
                @click="form.type = 'app'"
              >
                <FeatherIcon name="cpu" class="choice-icon" />
                <div>
                  <strong>Application</strong>
                  <span>A process run by pm2 on its own port (Node API, SSR, bot…), behind nginx.</span>
                </div>
              </button>
              <button
                type="button"
                class="choice"
                :class="{ selected: form.type === 'static' }"
                @click="form.type = 'static'"
              >
                <FeatherIcon name="layout" class="choice-icon" />
                <div>
                  <strong>Static site</strong>
                  <span>Frontend only (Vue, React, docs…): built, then served by nginx. No process, no port.</span>
                </div>
              </button>
            </div>
          </div>

          <div class="form-grid">
            <FormField
              label="Identifier (uid)"
              :error="errors.uid"
              hint="Used for the folder, pm2 process, database and certificate. Cannot change later."
            >
              <input
                v-model="form.uid"
                class="input mono"
                placeholder="my-awesome-app"
                spellcheck="false"
                @input="uidTouched = true"
              />
            </FormField>
            <FormField label="Folder" :error="errors.folder" hint="Created inside the base folder." optional>
              <input
                v-model="form.folder"
                class="input mono"
                :placeholder="effectiveUid || 'same as uid'"
                spellcheck="false"
              />
            </FormField>
          </div>

          <div v-if="form.type === 'app'" class="form-grid">
            <FormField
              label="Start command"
              :error="errors.startCommand"
              hint="Run by pm2 inside the repo folder, without a shell (e.g. npm start, node server.js)."
            >
              <div class="input-prefix">
                <span class="prefix">$</span>
                <input v-model="form.startCommand" class="input mono start-command" spellcheck="false" />
              </div>
            </FormField>
            <FormField
              label="Port"
              :error="errors.port"
              hint="Given to the app as PORT. Suggested: the next free slot (starting port and step in Settings)."
            >
              <input v-model.number="form.port" class="input mono" type="number" min="1024" max="65535" />
            </FormField>
          </div>
          <template v-else>
            <div class="form-grid">
              <FormField
                label="Public folder"
                :error="errors.publicFolder"
                hint="Relative to repo/: where the build lands (dist, build, public…)."
              >
                <div class="input-prefix">
                  <span class="prefix">repo/</span>
                  <input
                    v-model="form.publicFolder"
                    class="input mono public-folder-input"
                    placeholder="dist"
                    spellcheck="false"
                  />
                </div>
              </FormField>
            </div>
            <div class="callout">
              <FeatherIcon name="info" class="icon" />
              <span>
                nginx serves the files of <code>repo/{{ form.publicFolder || 'dist' }}</code> (it can be changed later,
                with the single-page-app fallback, in the Network tab). Deployments run the install and build commands,
                nothing else.
              </span>
            </div>
          </template>

          <div v-if="folderCheck && folderCheck.warnings.length > 0" class="callout callout-warning">
            <FeatherIcon name="folder" class="icon" />
            <div class="stack-sm folder-warnings">
              <strong>This folder already exists — it will be adopted, never erased or replaced.</strong>
              <ul class="folder-warning-list">
                <li v-for="warning in folderCheck.warnings" :key="warning">{{ warning }}</li>
              </ul>
              <div v-if="folderCheck.sample.length > 0" class="row-sm row-wrap">
                <code v-for="item in folderCheck.sample" :key="item">{{ item }}</code>
                <span v-if="folderCheck.itemCount > folderCheck.sample.length" class="tiny text-faint">
                  + {{ folderCheck.itemCount - folderCheck.sample.length }} more
                </span>
              </div>
            </div>
          </div>

          <div v-if="error && !hasFieldErrors" class="callout callout-danger">
            <FeatherIcon name="alert-octagon" class="icon" />
            <span>{{ error }}</span>
          </div>
        </div>
        <footer class="panel-footer">
          <RouterLink to="/projects" class="btn btn-ghost">Cancel</RouterLink>
          <button type="submit" class="btn btn-primary btn-lg" :disabled="busy || !form.name">
            <span v-if="busy" class="spinner"></span>
            Create project
          </button>
        </footer>
      </form>

      <aside class="stack fade-up">
        <div class="panel">
          <div class="panel-body stack">
            <div class="row">
              <PlanetAvatar :seed="effectiveUid || 'new-project'" :size="48" ring />
              <div class="stack-sm create-preview-title">
                <strong class="truncate">{{ form.name || 'Untitled project' }}</strong>
                <span class="mono tiny text-faint">{{ effectiveUid || 'uid' }}</span>
              </div>
            </div>
            <div class="section-title">Folder layout</div>
            <pre
              class="tree"
            ><span class="accent">{{ folderPath }}/</span> <span v-if="folderExists" class="text-warning">(existing)</span>
├── repo/   <span class="text-faint"># {{ repoComment }}</span>
├── etc/    <span class="text-faint"># nginx config, certificates, pm2</span>
├── db/     <span class="text-faint"># database dumps</span>
└── logs/   <span class="text-faint"># stdout / stderr</span></pre>
          </div>
        </div>
        <div class="callout">
          <FeatherIcon name="info" class="icon" />
          <span>
            After creation, enable what the project needs: <strong>git deployment</strong>, a
            <strong>PostgreSQL database</strong> (DB_* variables), a <strong>mail relay</strong> (SMTP_* variables) and
            a <strong>domain</strong> with automatic HTTPS.
          </span>
        </div>
      </aside>
    </div>
  </div>
</template>

<script>
/**
 * Project creation form with a live preview of the folder layout.
 */

/**
 * Same slug rules as the server (lib/slug.js), for the live preview.
 */
function slugify(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

export default {
  name: 'ProjectCreateView',
  data() {
    return {
      form: {
        name: '',
        uid: '',
        folder: '',
        startCommand: 'npm start',
        type: 'app',
        port: null,
        publicFolder: 'dist',
      },
      uidTouched: false,
      baseFolder: '',
      folderCheck: null,
      errors: {},
      error: '',
      busy: false,
    };
  },
  computed: {
    effectiveUid() {
      if (this.form.uid) {
        return this.form.uid;
      }

      return slugify(this.form.name);
    },
    folderPath() {
      const folder = this.form.folder || this.effectiveUid || '<uid>';
      let base = this.baseFolder;

      if (!base) {
        base = '<base folder>';
      }

      return `${base}/${folder}`;
    },
    hasFieldErrors() {
      return Object.keys(this.errors).length > 0;
    },
    /** Folder that will be used (explicit folder, or the uid). */
    effectiveFolder() {
      return this.form.folder || this.effectiveUid;
    },
    folderExists() {
      return Boolean(this.folderCheck && this.folderCheck.exists);
    },
    repoComment() {
      if (this.form.type === 'static') {
        return 'your site (git clone, built files served)';
      }

      return 'your application (git clone)';
    },
  },
  watch: {
    effectiveFolder() {
      clearTimeout(this.folderTimer);
      this.folderTimer = setTimeout(() => this.checkFolder(), 350);
    },
  },
  async mounted() {
    try {
      const [{ settings }, { port }] = await Promise.all([
        this.$api.get('/settings'),
        this.$api.get('/projects/next-port'),
      ]);
      this.baseFolder = settings.baseFolder;
      this.form.port = port;
    } catch {
      this.baseFolder = '';
    }
  },
  beforeUnmount() {
    clearTimeout(this.folderTimer);
  },
  methods: {
    /**
     * Ask the server what already exists in the target folder.
     */
    async checkFolder() {
      const folder = this.effectiveFolder;

      if (!folder) {
        this.folderCheck = null;
        return;
      }

      try {
        const result = await this.$api.get(`/projects/folder-check?folder=${encodeURIComponent(folder)}`);

        if (folder === this.effectiveFolder) {
          this.folderCheck = result;
        }
      } catch {
        // Invalid folder name: the form validation will report it.
        this.folderCheck = null;
      }
    },
    /**
     * Static sites have no process (no start command, no port) but a public folder.
     */
    payload() {
      const body = { name: this.form.name, uid: this.form.uid, folder: this.form.folder, type: this.form.type };

      if (this.form.type === 'app') {
        body.startCommand = this.form.startCommand;

        if (this.form.port) {
          body.port = this.form.port;
        }
      } else {
        body.publicFolder = this.form.publicFolder;
      }

      return body;
    },
    onNameInput() {
      if (!this.uidTouched) {
        this.form.uid = slugify(this.form.name);
      }
    },
    async submit() {
      this.busy = true;
      this.errors = {};
      this.error = '';

      try {
        const { project, warnings } = await this.$api.post('/projects', this.payload());

        if (warnings.length > 0) {
          this.$toast.warning(`${project.name} adopted its existing folder: nothing was erased or replaced.`);
        } else {
          this.$toast.success(`${project.name} created.`);
        }

        this.$router.push(`/projects/${project.uid}`);
      } catch (error) {
        this.errors = error.fields;
        this.error = error.message;
      } finally {
        this.busy = false;
      }
    },
  },
};
</script>

<style>
.create-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}

.create-preview-title {
  min-width: 0;
}

.start-command {
  padding-left: 30px;
}

.folder-warnings {
  min-width: 0;
}

.folder-warning-list {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

@media (max-width: 1000px) {
  .create-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
