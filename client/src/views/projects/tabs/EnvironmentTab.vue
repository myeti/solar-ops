<template>
  <div class="stack-lg">
    <form class="panel" @submit.prevent="save">
      <header class="panel-header">
        <span class="panel-icon"><FeatherIcon name="list" :size="17" /></span>
        <h3>Custom variables</h3>
      </header>
      <div class="panel-body stack">
        <p v-if="project.type === 'static'" class="text-dim small">
          Given to the install and build commands (e.g. <code>VITE_API_URL</code>, baked into the build). Stored
          encrypted. Rebuild (deploy) to apply changes.
        </p>
        <p v-else class="text-dim small">
          Given to the process at startup and to install / build commands. Stored encrypted. A custom variable overrides
          one provided by SolarOps with the same name.
        </p>
        <OrbitLoader v-if="loading" inline label="Loading…" />
        <KeyValueEditor v-else v-model="custom" />
        <span v-if="errors.variables" class="field-error">{{ errors.variables }}</span>
      </div>
      <footer class="panel-footer">
        <span class="tiny text-faint">{{ applyHint }}</span>
        <span class="spacer"></span>
        <button type="submit" class="btn btn-primary" :disabled="saving || !isDirty">
          <span v-if="saving" class="spinner"></span>
          <FeatherIcon v-else name="save" :size="16" />
          Save
        </button>
      </footer>
    </form>

    <section class="panel">
      <header class="panel-header">
        <span class="panel-icon"><FeatherIcon name="cpu" :size="17" /></span>
        <h3>Final environment</h3>
        <span class="spacer"></span>
        <span class="tiny text-faint">What the process receives</span>
      </header>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Variable</th>
              <th>Value</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="variable in variables"
              :key="`${variable.source}-${variable.key}`"
              :class="{ 'env-overridden': variable.overridden }"
            >
              <td>
                <span class="mono small">{{ variable.key }}</span>
              </td>
              <td class="env-value">
                <span class="mono small truncate">{{ displayValue(variable) }}</span>
              </td>
              <td>
                <span class="badge" :class="sourceBadge(variable.source)">{{ variable.source }}</span>
                <span v-if="variable.overridden" class="tiny text-faint env-overridden-label">overridden</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<script>
/**
 * Environment tab: custom variables and the computed final environment.
 */
import KeyValueEditor from '../../../components/KeyValueEditor.vue';

const SOURCE_BADGES = {
  system: 'badge-violet',
  database: 'badge-cyan',
  smtp: 'badge-green',
  custom: 'badge-amber',
};

export default {
  name: 'EnvironmentTab',
  components: { KeyValueEditor },
  props: {
    project: {
      type: Object,
      required: true,
    },
  },
  emits: ['refresh'],
  data() {
    return {
      custom: [],
      saved: [],
      variables: [],
      errors: {},
      loading: true,
      saving: false,
    };
  },
  computed: {
    isDirty() {
      return JSON.stringify(this.custom) !== JSON.stringify(this.saved);
    },
    applyHint() {
      if (this.project.type === 'static') {
        return 'Deploy again to rebuild with the new values.';
      }

      return 'Restart the project to apply changes.';
    },
  },
  mounted() {
    this.load();
  },
  methods: {
    async load() {
      try {
        const result = await this.$api.get(`/projects/${this.project.uid}/environment`);
        this.custom = result.custom;
        this.saved = result.custom;
        this.variables = result.variables;
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
        await this.$api.put(`/projects/${this.project.uid}/environment`, { variables: this.custom });
        this.$toast.success('Environment saved. Restart the project to apply it.');
        await this.load();
        this.$emit('refresh');
      } catch (error) {
        this.errors = error.fields;
        this.$toast.error(error);
      } finally {
        this.saving = false;
      }
    },
    sourceBadge(source) {
      return SOURCE_BADGES[source] || '';
    },
    displayValue(variable) {
      if (variable.secret) {
        return '••••••••';
      }

      return variable.value;
    },
  },
};
</script>

<style>
.env-value {
  max-width: 420px;
}

.env-overridden td:first-child,
.env-overridden .env-value {
  text-decoration: line-through;
  opacity: 0.5;
}

.env-overridden-label {
  margin-left: 6px;
}
</style>
