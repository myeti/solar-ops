<template>
  <div class="stack-lg">
    <DatabaseSetup v-if="!database.name" :project="project" :postgres="postgres" @refresh="$emit('refresh')" />

    <template v-else>
      <div v-if="!database.enabled" class="callout callout-warning">
        <FeatherIcon name="pause-circle" class="icon" />
        <span>
          The database <code>{{ database.name }}</code> still exists, but its variables are no longer given to the
          project.
          <button type="button" class="btn btn-sm btn-success inline-action" :disabled="busy" @click="enable">
            Re-enable
          </button>
        </span>
      </div>

      <div v-if="database.adopted" class="callout">
        <FeatherIcon name="link" class="icon" />
        <span>
          <strong>Linked database.</strong> It existed before SolarOps: SolarOps never changes its roles, permissions or
          data on its own, and never wipes or drops it. Dumps and restores use its own role.
        </span>
      </div>

      <div class="grid-2">
        <DatabaseConnection ref="connection" :project="project" :postgres="postgres" />
        <DatabaseOperations :project="project" @refresh="$emit('refresh')" @credentials-changed="forgetCredentials" />
      </div>

      <DatabaseBackups :project="project" @refresh="$emit('refresh')" />
      <DatabaseDumps :project="project" />
    </template>
  </div>
</template>

<script>
/**
 * Database tab: create or link a database, credentials, operations,
 * scheduled backups and dumps.
 */
import DatabaseBackups from '../../../components/projects/database/DatabaseBackups.vue';
import DatabaseConnection from '../../../components/projects/database/DatabaseConnection.vue';
import DatabaseDumps from '../../../components/projects/database/DatabaseDumps.vue';
import DatabaseOperations from '../../../components/projects/database/DatabaseOperations.vue';
import DatabaseSetup from '../../../components/projects/database/DatabaseSetup.vue';
import { suggestRestart } from '../../../components/projects/database/restartHint.js';

export default {
  name: 'DatabaseTab',
  components: { DatabaseBackups, DatabaseConnection, DatabaseDumps, DatabaseOperations, DatabaseSetup },
  props: {
    project: {
      type: Object,
      required: true,
    },
  },
  emits: ['refresh'],
  data() {
    return {
      busy: false,
      postgres: null,
    };
  },
  computed: {
    database() {
      return this.project.database;
    },
  },
  mounted() {
    this.loadPostgres();
  },
  methods: {
    async loadPostgres() {
      try {
        const { postgres } = await this.$api.get('/postgres');
        this.postgres = postgres;
      } catch {
        this.postgres = null;
      }
    },
    forgetCredentials() {
      if (this.$refs.connection) {
        this.$refs.connection.forget();
      }
    },
    /** Give the DB_* variables to the project again. */
    async enable() {
      this.busy = true;

      try {
        await this.$api.post(`/projects/${this.project.uid}/database/enable`);
        this.$toast.success('Database ready.');
        suggestRestart(this);
        this.$emit('refresh');
      } catch (error) {
        this.$toast.error(error);
      } finally {
        this.busy = false;
      }
    },
  },
};
</script>

<style>
.inline-action {
  margin-left: 8px;
}
</style>
