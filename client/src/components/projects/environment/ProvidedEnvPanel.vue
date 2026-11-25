<template>
  <form class="panel" @submit.prevent="save">
    <header class="panel-header">
      <span class="panel-icon"><FeatherIcon name="share-2" :size="17" /></span>
      <h3>Provided to other projects</h3>
      <span class="spacer"></span>
      <ToggleSwitch v-model="form.enabled" label="Provide" :disabled="loading" />
    </header>
    <div class="panel-body stack">
      <p class="text-dim small">
        Every other project receives these variables, prefixed with <code>{{ prefix }}</code
        >: e.g. <code>SCRIPT_URL</code> becomes <code>{{ prefix }}SCRIPT_URL</code>. Values can use this project's own
        variables: <code>SCRIPT_URL=${PUBLIC_URL}/script.js</code>.
      </p>
      <OrbitLoader v-if="loading" inline label="Loading…" />

      <template v-else-if="form.enabled">
        <KeyValueEditor v-model="form.variables" />
        <span v-if="errors.variables" class="field-error">{{ errors.variables }}</span>

        <div v-if="preview.length > 0" class="stack-sm">
          <div class="section-title">The other projects receive</div>
          <ul class="list-plain provided-preview">
            <li v-for="entry in preview" :key="entry.key">
              <span class="mono small">{{ entry.key }}</span>
              <span class="mono small text-dim truncate">{{ entry.value }}</span>
              <span v-for="problem in entry.problems" :key="problem" class="tiny text-warning">{{ problem }}</span>
            </li>
          </ul>
          <p class="tiny text-faint">As saved. Secrets stay masked, here and in the other projects.</p>
        </div>
      </template>
    </div>
    <footer class="panel-footer">
      <span class="tiny text-faint">{{ footerHint }}</span>
      <span class="spacer"></span>
      <button type="submit" class="btn btn-primary" :disabled="saving || loading || !isDirty">
        <span v-if="saving" class="spinner"></span>
        <FeatherIcon v-else name="save" :size="16" />
        Save
      </button>
    </footer>
  </form>
</template>

<script>
/**
 * Variables this project provides to every other project, prefixed with its
 * uid (server/services/environment.js). Emits `saved` so the tab reloads its
 * final environment.
 */
import KeyValueEditor from '../../KeyValueEditor.vue';

export default {
  name: 'ProvidedEnvPanel',
  components: { KeyValueEditor },
  props: {
    project: {
      type: Object,
      required: true,
    },
  },
  emits: ['saved'],
  data() {
    return {
      loading: true,
      saving: false,
      prefix: '',
      preview: [],
      receivers: 0,
      saved: { enabled: false, variables: [] },
      form: { enabled: false, variables: [] },
      errors: {},
    };
  },
  computed: {
    isDirty() {
      return JSON.stringify(this.form) !== JSON.stringify(this.saved);
    },
    footerHint() {
      if (!this.saved.enabled) {
        return 'Nothing provided.';
      }

      return `${this.receivers} project(s) receive them: restart (or redeploy) them to apply a change.`;
    },
  },
  mounted() {
    this.load();
  },
  methods: {
    applyState(state) {
      this.prefix = state.prefix;
      this.preview = state.preview;
      this.receivers = state.receivers;
      this.saved = { enabled: state.enabled, variables: state.variables };
      this.form = { enabled: state.enabled, variables: state.variables.map((entry) => ({ ...entry })) };
    },
    async load() {
      try {
        this.applyState(await this.$api.get(`/projects/${this.project.uid}/environment/provided`));
      } catch (error) {
        this.$toast.error(error);
      } finally {
        this.loading = false;
      }
    },
    async save() {
      this.saving = true;
      this.errors = {};

      try {
        this.applyState(
          await this.$api.put(`/projects/${this.project.uid}/environment/provided`, {
            enabled: this.form.enabled,
            variables: this.form.variables,
          }),
        );
        this.$toast.success('Provided variables saved. Restart the projects using them to apply.');
        this.$emit('saved');
      } catch (error) {
        this.errors = error.fields || {};
        this.$toast.error(error);
      } finally {
        this.saving = false;
      }
    },
  },
};
</script>

<style>
.provided-preview li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
  gap: 4px 12px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
}

.provided-preview li:last-child {
  border-bottom: 0;
}

.provided-preview .text-warning {
  grid-column: 1 / -1;
}
</style>
