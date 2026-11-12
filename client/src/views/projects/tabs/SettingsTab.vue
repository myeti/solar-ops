<template>
  <div class="stack-lg">
    <form class="panel" @submit.prevent="save">
      <header class="panel-header">
        <span class="panel-icon"><FeatherIcon name="settings" :size="17" /></span>
        <h3>General</h3>
      </header>
      <div class="panel-body form-grid">
        <FormField label="Name" :error="errors.name">
          <input v-model="form.name" class="input" />
        </FormField>
        <FormField label="Type">
          <select v-model="form.type" class="select">
            <option value="app">Application (process + port)</option>
            <option value="static">Static site (frontend only)</option>
          </select>
        </FormField>
        <template v-if="form.type === 'app'">
          <FormField
            label="Start command"
            :error="errors.startCommand"
            hint="Run by pm2 inside repo/ (no shell). Restart to apply."
          >
            <input v-model="form.startCommand" class="input mono" spellcheck="false" />
          </FormField>
          <FormField label="Port" :error="errors.port" :hint="portHint">
            <input
              v-model.number="form.port"
              class="input mono"
              type="number"
              min="1024"
              max="65535"
              :disabled="project.type !== 'app'"
            />
          </FormField>
          <FormField label="Startup time (seconds)" :error="errors.livenessTimeoutSeconds" :hint="startupHint" optional>
            <input
              v-model="form.livenessTimeoutSeconds"
              class="input mono"
              type="number"
              min="5"
              max="900"
              :placeholder="String(project.livenessDefaultSeconds)"
            />
          </FormField>
        </template>
        <FormField label="Identifier" hint="Fixed at creation.">
          <input :value="project.uid" class="input mono" disabled />
        </FormField>
        <FormField label="Folder" hint="Fixed at creation.">
          <input :value="project.path" class="input mono" disabled />
        </FormField>
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
        <span class="panel-icon"><FeatherIcon name="power" :size="17" /></span>
        <h3>Activation</h3>
      </header>
      <div class="panel-body">
        <ToggleSwitch
          :model-value="project.active"
          :disabled="toggling"
          label="Project active"
          hint="An inactive project is stopped, removed from nginx, and ignores webhooks and automatic certificate renewals."
          @change="setActive"
        />
      </div>
    </section>

    <section class="panel panel-danger">
      <header class="panel-header">
        <span class="panel-icon"><FeatherIcon name="alert-octagon" :size="17" /></span>
        <h3>Danger zone</h3>
      </header>
      <div class="panel-body stack">
        <p class="text-dim small">
          Deleting the project stops its process and removes its nginx configuration. Choose what else should disappear
          with it:
        </p>
        <ToggleSwitch v-model="removal.removeFiles" label="Delete the project folder" :hint="removeFilesHint" />
        <div v-if="removal.removeFiles && project.folderExisted" class="callout callout-danger">
          <FeatherIcon name="alert-octagon" class="icon" />
          <span
            >This folder existed before SolarOps: everything it contained before adoption would be deleted too.</span
          >
        </div>
        <ToggleSwitch
          v-if="project.database.name && !project.database.adopted"
          v-model="removal.dropDatabase"
          label="Drop the database and its role"
          :hint="`${project.database.name} on the PostgreSQL server`"
        />
        <p v-if="project.database.adopted" class="small text-dim">
          The linked database <code>{{ project.database.name }}</code> is always kept: SolarOps did not create it.
        </p>
      </div>
      <footer class="panel-footer">
        <button type="button" class="btn btn-danger" :disabled="deleting" @click="remove">
          <span v-if="deleting" class="spinner"></span>
          <FeatherIcon v-else name="trash-2" :size="16" />
          Delete project
        </button>
      </footer>
    </section>
  </div>
</template>

<script>
/**
 * Project settings: name, start command, startup time, activation and
 * deletion.
 */

/** Startup time of the form: '' when the project uses the server default. */
function startupOf(project) {
  const seconds = project.deployment.livenessTimeoutSeconds;

  if (seconds === null || seconds === undefined) {
    return '';
  }

  return String(seconds);
}
export default {
  name: 'SettingsTab',
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
        name: this.project.name,
        type: this.project.type,
        port: this.project.port,
        startCommand: this.project.startCommand,
        livenessTimeoutSeconds: startupOf(this.project),
      },
      removal: {
        removeFiles: false,
        dropDatabase: false,
      },
      errors: {},
      saving: false,
      // Take the server values at the next refresh (after a save).
      resync: false,
      toggling: false,
      deleting: false,
    };
  },
  computed: {
    removeFilesHint() {
      return `rm -rf ${this.project.path} (repository, certificates, dumps, logs)`;
    },
    isDirty() {
      const project = this.project;
      const form = this.form;

      return (
        form.name !== project.name ||
        form.type !== project.type ||
        form.port !== project.port ||
        form.startCommand !== project.startCommand ||
        String(form.livenessTimeoutSeconds).trim() !== startupOf(project)
      );
    },
    startupHint() {
      return `How long the app may take to answer on / after a deploy or restart. Empty: ${this.project.livenessDefaultSeconds}s.`;
    },
    portHint() {
      if (this.project.type !== 'app') {
        return 'Allocated (next free slot, see Settings › General) once saved as an application.';
      }

      return 'Given to the app as PORT; nginx proxies to it. Must be unique across projects.';
    },
  },
  watch: {
    /**
     * Follow the server (port allocated, type switched...) unless the form
     * holds unsaved edits: the page refreshes the project every 10 seconds.
     */
    project(project, previous) {
      const untouched =
        this.form.name === previous.name &&
        this.form.type === previous.type &&
        this.form.port === previous.port &&
        this.form.startCommand === previous.startCommand &&
        String(this.form.livenessTimeoutSeconds).trim() === startupOf(previous);

      if (untouched || this.resync) {
        this.resync = false;
        this.form = {
          name: project.name,
          type: project.type,
          port: project.port,
          startCommand: project.startCommand,
          livenessTimeoutSeconds: startupOf(project),
        };
      }
    },
  },
  methods: {
    showWarnings(warnings) {
      for (const warning of warnings || []) {
        this.$toast.warning(warning);
      }
    },
    /**
     * Switching the type has consequences on the server: say which.
     */
    async confirmTypeChange() {
      if (this.form.type === this.project.type) {
        return true;
      }

      let message =
        'A port is allocated (next free slot, see Settings › General), and nginx will proxy to it. Start the application afterwards.';

      if (this.form.type === 'static') {
        message =
          'The pm2 process started by SolarOps is removed and the port is freed. nginx will serve the files of the public folder.';
      }

      return this.$confirm({
        title: `Turn ${this.project.name} into ${this.typeLabel(this.form.type)}?`,
        message,
        confirmText: 'Switch',
        icon: 'repeat',
      });
    },
    typeLabel(type) {
      if (type === 'static') {
        return 'a static site';
      }

      return 'an application';
    },
    /**
     * Only send what applies to the (new) type.
     */
    payload() {
      const body = { name: this.form.name, type: this.form.type };

      if (this.form.type === 'app') {
        body.startCommand = this.form.startCommand;

        // Empty: back to the server default.
        const startup = String(this.form.livenessTimeoutSeconds).trim();
        body.livenessTimeoutSeconds = null;

        if (startup !== '') {
          body.livenessTimeoutSeconds = Number(startup);
        }
      }

      // The port of a new application is allocated by the server.
      if (this.form.type === 'app' && this.project.type === 'app' && this.form.port) {
        body.port = this.form.port;
      }

      return body;
    },
    async save() {
      if (!(await this.confirmTypeChange())) {
        return;
      }

      this.saving = true;
      this.errors = {};

      try {
        const { warnings, restartRequired } = await this.$api.patch(`/projects/${this.project.uid}`, this.payload());
        this.showWarnings(warnings);

        if (restartRequired && this.project.process) {
          this.$toast.success('Project saved. Restart it to use the new port.');
        } else {
          this.$toast.success('Project saved.');
        }

        this.resync = true;
        this.$emit('refresh');
      } catch (error) {
        this.errors = error.fields;
        this.$toast.error(error);
      } finally {
        this.saving = false;
      }
    },
    async setActive(active) {
      if (!active) {
        const confirmed = await this.$confirm({
          title: 'Deactivate the project?',
          message: 'Its process is stopped and nginx stops serving it.',
          confirmText: 'Deactivate',
          danger: true,
          icon: 'moon',
        });

        if (!confirmed) {
          return;
        }
      }

      this.toggling = true;

      try {
        const { warnings } = await this.$api.patch(`/projects/${this.project.uid}`, { active });
        this.showWarnings(warnings);

        if (active) {
          this.$toast.success('Project activated. Start it from the header.');
        } else {
          this.$toast.success('Project deactivated.');
        }

        this.$emit('refresh');
      } catch (error) {
        this.$toast.error(error);
      } finally {
        this.toggling = false;
      }
    },
    async remove() {
      const consequences = ['The process is stopped and removed from pm2.', 'The nginx configuration is removed.'];

      if (this.removal.removeFiles) {
        consequences.push(`The folder ${this.project.path} is deleted.`);
      }

      if (this.removal.dropDatabase) {
        consequences.push(`The database ${this.project.database.name} is dropped.`);
      }

      const confirmed = await this.$confirm({
        title: `Delete ${this.project.name}?`,
        message: consequences.join('\n'),
        confirmText: 'Delete forever',
        danger: true,
        requireText: this.project.uid,
        icon: 'trash-2',
      });

      if (!confirmed) {
        return;
      }

      this.deleting = true;

      try {
        const { warnings } = await this.$api.delete(`/projects/${this.project.uid}`, {
          confirm: this.project.uid,
          removeFiles: this.removal.removeFiles,
          dropDatabase: this.removal.dropDatabase,
        });

        this.showWarnings(warnings);
        this.$toast.success(`${this.project.name} deleted.`);
        this.$router.push('/projects');
      } catch (error) {
        this.$toast.error(error);
      } finally {
        this.deleting = false;
      }
    },
  },
};
</script>
