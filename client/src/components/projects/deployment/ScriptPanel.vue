<template>
  <form class="panel" @submit.prevent="run">
    <header class="panel-header">
      <span class="panel-icon"><FeatherIcon name="terminal" :size="17" /></span>
      <h3>Run a script</h3>
      <span class="spacer"></span>
      <button type="button" class="btn btn-ghost btn-sm" title="Read package.json again" @click="load">
        <FeatherIcon name="refresh-cw" :size="14" />
      </button>
    </header>
    <div class="panel-body stack">
      <OrbitLoader v-if="loading" inline label="Reading package.json…" />

      <p v-else-if="scripts === null" class="text-dim small">
        No <code>package.json</code> in <code>repo/</code> yet: deploy the project first, its scripts appear here.
      </p>

      <p v-else-if="scripts.length === 0" class="text-dim small">package.json has no scripts.</p>

      <template v-else>
        <p class="text-dim small">
          Runs a script of <code>package.json</code> from <code>repo/</code>, with every variable of the project (its
          Environment tab), like the builds. The output shows live and stays in the history.
        </p>

        <div class="form-grid">
          <FormField label="Script" :hint="selectedCommand">
            <select v-model="form.script" class="select mono">
              <option v-for="entry in scripts" :key="entry.name" :value="entry.name">{{ entry.name }}</option>
            </select>
          </FormField>
          <FormField
            label="Arguments"
            optional
            :error="errors.args"
            hint="Split like a command line: quote an argument holding spaces."
          >
            <input
              v-model="form.args"
              class="input mono"
              placeholder="test@email.com"
              spellcheck="false"
              autocomplete="off"
            />
          </FormField>
        </div>

        <ToggleSwitch
          v-model="form.hideArgs"
          label="Hide the arguments"
          hint="For passwords or tokens: masked in the output, the history and the activity journal."
        />

        <div class="script-preview">
          <span class="tiny text-faint">Will run</span>
          <code class="mono">{{ preview }}</code>
        </div>

        <div v-if="!manager.available" class="callout callout-warning">
          <FeatherIcon name="alert-triangle" class="icon" />
          <span>{{ manager.name }} is needed but not installed on this server: run npm run setup again.</span>
        </div>
      </template>
    </div>
    <footer v-if="scripts && scripts.length > 0" class="panel-footer">
      <span class="tiny text-faint">{{ manager.description }}</span>
      <span class="spacer"></span>
      <button type="submit" class="btn btn-primary" :disabled="running || !form.script || !manager.available">
        <span v-if="running" class="spinner"></span>
        <FeatherIcon v-else name="play" :size="16" />
        Run
      </button>
    </footer>
  </form>
</template>

<script>
/**
 * Run a package.json script with arguments (server/services/scripts.js):
 * `npm run create:admin -- test@email.com`, as a task whose output opens
 * live. Emits `launched` once it is queued.
 */
export default {
  name: 'ScriptPanel',
  props: {
    project: {
      type: Object,
      required: true,
    },
  },
  emits: ['launched'],
  data() {
    return {
      loading: true,
      running: false,
      scripts: null,
      manager: null,
      form: { script: '', args: '', hideArgs: false },
      errors: {},
    };
  },
  computed: {
    /** What package.json runs for the selected script. */
    selectedCommand() {
      const entry = (this.scripts || []).find((candidate) => candidate.name === this.form.script);

      if (!entry) {
        return '';
      }

      return entry.command;
    },
    /** The command line, as the server builds it (arguments masked when hidden). */
    preview() {
      const parts = [this.manager.binary, 'run', this.form.script];
      let args = this.form.args.trim();

      if (args !== '' && this.form.hideArgs) {
        args = '•••••';
      }

      if (args !== '') {
        if (this.manager.separator) {
          parts.push('--');
        }

        parts.push(args);
      }

      return parts.join(' ');
    },
  },
  mounted() {
    this.load();
  },
  methods: {
    async load() {
      this.loading = true;

      try {
        const { scripts, manager } = await this.$api.get(`/projects/${this.project.uid}/deployment/scripts`);
        this.scripts = scripts;
        this.manager = manager;

        // Keep the selection when the script still exists.
        if (scripts && !scripts.some((entry) => entry.name === this.form.script)) {
          this.form.script = '';

          if (scripts.length > 0) {
            this.form.script = scripts[0].name;
          }
        }
      } catch (error) {
        this.$toast.error(error);
      } finally {
        this.loading = false;
      }
    },
    async run() {
      this.running = true;
      this.errors = {};

      try {
        const { task } = await this.$api.post(`/projects/${this.project.uid}/deployment/scripts/run`, {
          script: this.form.script,
          args: this.form.args,
          hideArgs: this.form.hideArgs,
        });
        this.$tasks.open(task.id);
        this.$emit('launched');
      } catch (error) {
        this.errors = error.fields || {};
        this.$toast.error(error);
      } finally {
        this.running = false;
      }
    },
  },
};
</script>

<style>
.script-preview {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--surface-sunken);
  border: 1px solid var(--border);
}

.script-preview code {
  padding: 0;
  border: 0;
  background: none;
  font-size: 12.5px;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
