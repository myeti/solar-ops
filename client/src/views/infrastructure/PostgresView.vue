<template>
  <div>
    <PageHeader eyebrow="Infrastructure" title="PostgreSQL" subtitle="The server hosting one database per project." />

    <div class="stack-lg">
      <form class="panel fade-up" @submit.prevent="save">
        <header class="panel-header">
          <span class="panel-icon"><FeatherIcon name="server" :size="17" /></span>
          <h3>Admin connection</h3>
        </header>
        <div class="panel-body stack-lg">
          <p class="text-dim small">
            SolarOps uses this role to create a role and a database for each project. It needs
            <code>CREATEDB</code> and <code>CREATEROLE</code> (superuser is not required). The install script creates
            <code>solarops_admin</code> for you.
          </p>
          <div class="form-grid">
            <FormField label="Host" :error="errors.host">
              <input v-model="form.host" class="input mono" spellcheck="false" />
            </FormField>
            <FormField label="Port" :error="errors.port">
              <input v-model.number="form.port" class="input mono" type="number" />
            </FormField>
            <FormField label="Admin user" :error="errors.user">
              <input v-model="form.user" class="input mono" spellcheck="false" autocomplete="off" />
            </FormField>
            <FormField label="Password" :error="errors.password" :hint="passwordHint">
              <input
                v-model="form.password"
                class="input"
                type="password"
                autocomplete="new-password"
                :placeholder="passwordPlaceholder"
              />
            </FormField>
            <FormField
              label="Maintenance database"
              :error="errors.database"
              hint="Database SolarOps connects to (usually postgres)."
            >
              <input v-model="form.database" class="input mono" spellcheck="false" />
            </FormField>
            <div class="field postgres-ssl">
              <ToggleSwitch v-model="form.ssl" label="Use SSL" hint="For a remote server." />
            </div>
          </div>
          <div v-if="testResult" class="callout" :class="testClass">
            <FeatherIcon :name="testIcon" class="icon" />
            <span>{{ testText }}</span>
          </div>
        </div>
        <footer class="panel-footer">
          <button type="button" class="btn btn-ghost" :disabled="testing" @click="test">
            <span v-if="testing" class="spinner"></span>
            <FeatherIcon v-else name="wifi" :size="16" />
            Test connection
          </button>
          <span class="spacer"></span>
          <button type="submit" class="btn btn-primary" :disabled="saving">
            <span v-if="saving" class="spinner"></span>
            <FeatherIcon v-else name="save" :size="16" />
            Save
          </button>
        </footer>
      </form>

      <section class="panel fade-up">
        <header class="panel-header">
          <span class="panel-icon"><FeatherIcon name="database" :size="17" /></span>
          <h3>Databases on the server</h3>
          <span class="spacer"></span>
          <button type="button" class="btn btn-ghost btn-sm" @click="loadDatabases">
            <FeatherIcon name="refresh-cw" :size="14" />
          </button>
        </header>
        <div v-if="databasesError" class="panel-body">
          <div class="callout callout-warning">
            <FeatherIcon name="alert-triangle" class="icon" />
            <span>{{ databasesError }}</span>
          </div>
        </div>
        <div v-else-if="databases.length === 0" class="panel-body">
          <p class="text-faint small">No database found.</p>
        </div>
        <div v-else class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Database</th>
                <th>Owner</th>
                <th>Size</th>
                <th>Project</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="database in databases" :key="database.name">
                <td>
                  <span class="mono small">{{ database.name }}</span>
                </td>
                <td>
                  <span class="mono small text-dim">{{ database.owner }}</span>
                </td>
                <td>{{ $format.bytes(database.sizeBytes) }}</td>
                <td>
                  <RouterLink v-if="database.project" :to="`/projects/${database.project.uid}/database`" class="row-sm">
                    <PlanetAvatar :seed="database.project.uid" :size="20" />
                    {{ database.project.name }}
                  </RouterLink>
                  <span v-else class="text-faint small">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
</template>

<script>
/**
 * PostgreSQL server configuration and database list.
 */
export default {
  name: 'PostgresView',
  data() {
    return {
      form: {
        host: '127.0.0.1',
        port: 5432,
        user: 'solarops_admin',
        password: '',
        database: 'postgres',
        ssl: false,
      },
      hasPassword: false,
      errors: {},
      saving: false,
      testing: false,
      testResult: null,
      databases: [],
      databasesError: null,
    };
  },
  computed: {
    passwordPlaceholder() {
      if (this.hasPassword) {
        return '•••••••• (unchanged)';
      }

      return '';
    },
    passwordHint() {
      if (this.hasPassword) {
        return 'Leave empty to keep the saved password.';
      }

      return 'Stored encrypted.';
    },
    testClass() {
      if (this.testResult.ok) {
        return 'callout-success';
      }

      return 'callout-danger';
    },
    testIcon() {
      if (this.testResult.ok) {
        return 'check-circle';
      }

      return 'alert-octagon';
    },
    testText() {
      const result = this.testResult;

      if (!result.ok) {
        return result.error;
      }

      const missing = [];

      if (!result.canCreateDatabases) {
        missing.push('CREATEDB');
      }

      if (!result.canCreateRoles) {
        missing.push('CREATEROLE');
      }

      if (missing.length > 0) {
        return `Connected to PostgreSQL ${result.version}, but the role lacks: ${missing.join(', ')}.`;
      }

      return `Connected to PostgreSQL ${result.version}. The role can create databases and roles.`;
    },
  },
  mounted() {
    this.load();
    this.loadDatabases();
  },
  methods: {
    payload() {
      const body = { ...this.form };

      if (body.password === '') {
        delete body.password;
      }

      return body;
    },
    async load() {
      try {
        const { postgres } = await this.$api.get('/postgres');
        this.form.host = postgres.host;
        this.form.port = postgres.port;
        this.form.user = postgres.user;
        this.form.database = postgres.database;
        this.form.ssl = postgres.ssl;
        this.hasPassword = postgres.hasPassword;
      } catch (error) {
        this.$toast.error(error);
      }
    },
    async loadDatabases() {
      try {
        const { databases, error } = await this.$api.get('/postgres/databases');
        this.databases = databases;
        this.databasesError = error;
      } catch (error) {
        this.databasesError = error.message;
      }
    },
    async save() {
      this.saving = true;
      this.errors = {};

      try {
        const { postgres } = await this.$api.put('/postgres', this.payload());
        this.hasPassword = postgres.hasPassword;
        this.form.password = '';
        this.$toast.success('PostgreSQL connection saved.');
        this.loadDatabases();
      } catch (error) {
        this.errors = error.fields;
        this.$toast.error(error);
      } finally {
        this.saving = false;
      }
    },
    async test() {
      this.testing = true;
      this.testResult = null;

      try {
        this.testResult = await this.$api.post('/postgres/test', this.payload());
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
.postgres-ssl {
  justify-content: center;
}
</style>
