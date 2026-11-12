<template>
  <section class="panel">
    <header class="panel-header">
      <span class="panel-icon"><FeatherIcon name="archive" :size="17" /></span>
      <h3>Dumps</h3>
      <span class="spacer"></span>
      <button type="button" class="btn btn-ghost btn-sm" @click="loadDumps">
        <FeatherIcon name="refresh-cw" :size="14" />
      </button>
    </header>
    <div v-if="dumps.length === 0" class="panel-body">
      <p class="text-faint small">No dump yet.</p>
    </div>
    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>File</th>
            <th>Size</th>
            <th>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="dumpFile in dumps" :key="dumpFile.name">
            <td>
              <span class="mono small">{{ dumpFile.name }}</span>
              <span v-if="dumpFile.automatic" class="badge badge-violet dump-auto">auto</span>
            </td>
            <td>{{ $format.bytes(dumpFile.size) }}</td>
            <td>{{ $format.dateTime(dumpFile.createdAt) }}</td>
            <td class="actions">
              <a :href="downloadUrl(dumpFile)" class="btn btn-ghost btn-icon btn-sm" title="Download" download>
                <FeatherIcon name="download" :size="15" />
              </a>
              <button
                type="button"
                class="btn btn-ghost btn-icon btn-sm"
                title="Restore"
                :disabled="!database.enabled"
                @click="restore(dumpFile)"
              >
                <FeatherIcon name="rotate-ccw" :size="15" />
              </button>
              <button type="button" class="btn btn-ghost btn-icon btn-sm" title="Delete" @click="removeDump(dumpFile)">
                <FeatherIcon name="trash-2" :size="15" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script>
/**
 * Dumps of the project database (manual and automatic): download, restore,
 * delete. Reloaded when a database task finishes.
 */
export default {
  name: 'DatabaseDumps',
  props: {
    project: {
      type: Object,
      required: true,
    },
  },
  data() {
    return {
      dumps: [],
    };
  },
  computed: {
    database() {
      return this.project.database;
    },
  },
  mounted() {
    this.loadDumps();
    this.unsubscribe = this.$tasks.onFinished((task) => {
      if (task.projectId === this.project.id && task.type.startsWith('db-')) {
        this.loadDumps();
      }
    });
  },
  beforeUnmount() {
    this.unsubscribe();
  },
  methods: {
    endpoint(path) {
      return `/projects/${this.project.uid}/database${path}`;
    },
    downloadUrl(dumpFile) {
      return `/api${this.endpoint(`/dumps/${encodeURIComponent(dumpFile.name)}`)}`;
    },
    async loadDumps() {
      try {
        const { dumps } = await this.$api.get(this.endpoint('/dumps'));
        this.dumps = dumps;
      } catch (error) {
        this.$toast.error(error);
      }
    },
    async restore(dumpFile) {
      const confirmed = await this.$confirm({
        title: `Restore ${dumpFile.name}?`,
        message: 'Existing objects are dropped and replaced by the content of the dump.',
        confirmText: 'Restore',
        danger: true,
        requireText: this.project.uid,
        icon: 'rotate-ccw',
      });

      if (!confirmed) {
        return;
      }

      try {
        const path = this.endpoint(`/dumps/${encodeURIComponent(dumpFile.name)}/restore`);
        const { task } = await this.$api.post(path, { confirm: this.project.uid });
        this.$tasks.open(task.id);
      } catch (error) {
        this.$toast.error(error);
      }
    },
    async removeDump(dumpFile) {
      const confirmed = await this.$confirm({
        title: `Delete ${dumpFile.name}?`,
        message: 'The file is removed from the server.',
        confirmText: 'Delete',
        danger: true,
        icon: 'trash-2',
      });

      if (!confirmed) {
        return;
      }

      try {
        await this.$api.delete(this.endpoint(`/dumps/${encodeURIComponent(dumpFile.name)}`));
        this.loadDumps();
      } catch (error) {
        this.$toast.error(error);
      }
    },
  },
};
</script>

<style>
.dump-auto {
  margin-left: 6px;
}
</style>
