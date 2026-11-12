<template>
  <section class="panel">
    <header class="panel-header">
      <span class="panel-icon"><FeatherIcon name="pie-chart" :size="17" /></span>
      <h3>Storage</h3>
      <span class="spacer"></span>
      <button type="button" class="btn btn-sm" :disabled="loading" @click="compute">
        <span v-if="loading" class="spinner"></span>
        <FeatherIcon v-else name="refresh-cw" :size="14" />
        {{ computeLabel }}
      </button>
    </header>
    <div class="panel-body stack">
      <p v-if="!storage && !loading && !error" class="text-dim small">
        Disk space taken by the project folder (sources, dependencies, dumps, logs, certificates) and its database.
        Computed on demand: large folders take a few seconds.
      </p>
      <OrbitLoader v-if="loading && !storage" inline label="Measuring…" />
      <div v-if="error" class="callout callout-danger">
        <FeatherIcon name="alert-octagon" class="icon" />
        <span>{{ error }}</span>
      </div>

      <template v-if="storage">
        <div>
          <div class="stat-value storage-total">{{ $format.bytes(totalBytes) }}</div>
          <div class="tiny text-faint">{{ totalCaption }}</div>
        </div>

        <ul class="list-plain storage-list">
          <li v-for="row in rows" :key="row.key" class="storage-row" :class="{ 'is-nested': row.nested }">
            <div class="storage-row-head">
              <span class="mono small truncate">{{ row.label }}</span>
              <span class="tiny text-faint truncate storage-kind">{{ row.kind }}</span>
              <span class="small nowrap">{{ rowSize(row) }}</span>
            </div>
            <div v-if="row.bytes !== null" class="storage-meter">
              <span :class="row.tone" :style="{ width: `${share(row.bytes)}%` }"></span>
            </div>
            <span v-if="row.error" class="tiny text-warning">{{ row.error }}</span>
          </li>
        </ul>

        <p v-if="storage.incomplete" class="tiny text-warning">
          Some files could not be read by SolarOps: the real size may be larger.
        </p>
        <p class="tiny text-faint">{{ computedCaption }}</p>
      </template>
    </div>
  </section>
</template>

<script>
/**
 * Disk space used by a project: its folder (each top-level entry, and the
 * dependencies inside repo/) and its database. Measured on demand only
 * (GET /api/projects/:uid/storage runs du).
 */
export default {
  name: 'StoragePanel',
  props: {
    project: {
      type: Object,
      required: true,
    },
  },
  data() {
    return {
      storage: null,
      loading: false,
      error: null,
    };
  },
  computed: {
    computeLabel() {
      if (this.storage) {
        return 'Recompute';
      }

      return 'Compute';
    },
    database() {
      return this.storage.database;
    },
    /** The database counts in the total when its server uses this disk. */
    databaseBytesHere() {
      if (this.database && this.database.local && this.database.bytes !== null) {
        return this.database.bytes;
      }

      return 0;
    },
    totalBytes() {
      return this.storage.folderBytes + this.databaseBytesHere;
    },
    totalCaption() {
      const parts = [`folder ${this.$format.bytes(this.storage.folderBytes)}`];

      if (this.database && this.database.bytes !== null) {
        let where = '';

        if (!this.database.local) {
          where = ` on ${this.database.host}, not counted`;
        }

        parts.push(`database ${this.$format.bytes(this.database.bytes)}${where}`);
      }

      return parts.join(' · ');
    },
    rows() {
      const rows = [];

      for (const entry of this.storage.entries) {
        rows.push({ key: entry.name, label: entry.name, kind: entry.kind, bytes: entry.bytes, tone: 'is-folder' });

        if (entry.name === 'repo' && this.storage.dependencies) {
          rows.push({
            key: 'dependencies',
            label: 'node_modules',
            kind: 'Dependencies, in repo/',
            bytes: this.storage.dependencies.bytes,
            tone: 'is-folder',
            nested: true,
          });
        }
      }

      if (this.database) {
        rows.push({
          key: 'database',
          label: this.database.name,
          kind: 'PostgreSQL database',
          bytes: this.database.bytes,
          tone: 'is-database',
          error: this.database.error,
        });
      }

      return rows;
    },
    computedCaption() {
      let took = `${this.storage.elapsedMs} ms`;

      if (this.storage.elapsedMs >= 1000) {
        took = `${(this.storage.elapsedMs / 1000).toFixed(1)}s`;
      }

      return `Measured ${this.$format.timeAgo(this.storage.computedAt)}, in ${took}.`;
    },
  },
  watch: {
    'project.uid'() {
      this.storage = null;
      this.error = null;
    },
  },
  methods: {
    async compute() {
      this.loading = true;
      this.error = null;

      try {
        const { storage } = await this.$api.get(`/projects/${this.project.uid}/storage`);
        this.storage = storage;
      } catch (error) {
        this.error = error.message;
      } finally {
        this.loading = false;
      }
    },
    /** Width of a row's bar: its share of the largest row. */
    share(bytes) {
      const largest = Math.max(...this.rows.map((row) => row.bytes || 0));

      if (!largest) {
        return 0;
      }

      return Math.max(1, (bytes / largest) * 100);
    },
    rowSize(row) {
      if (row.bytes === null) {
        return '—';
      }

      return this.$format.bytes(row.bytes);
    },
  },
};
</script>

<style>
.storage-total {
  font-size: 26px;
}

.storage-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.storage-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.storage-row.is-nested {
  padding-left: 14px;
}

.storage-row-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.storage-kind {
  flex: 1;
}

.storage-meter {
  height: 4px;
  border-radius: 2px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
}

.storage-meter span {
  display: block;
  height: 100%;
  border-radius: inherit;
  transition: width 0.4s ease;
}

.storage-meter .is-folder {
  background: linear-gradient(90deg, #60a5fa, #818cf8);
}

.storage-meter .is-database {
  background: linear-gradient(90deg, #22d3ee, #60a5fa);
}
</style>
