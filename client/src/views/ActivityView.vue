<template>
  <div>
    <PageHeader eyebrow="System" title="Activity" subtitle="Every operation and every sensitive action, recorded.">
      <template #actions>
        <button type="button" class="btn" :disabled="loading" @click="load">
          <FeatherIcon name="refresh-cw" :size="16" />
          Refresh
        </button>
      </template>
    </PageHeader>

    <nav class="tabs activity-tabs">
      <button type="button" class="tab" :class="{ active: view === 'tasks' }" @click="view = 'tasks'">
        <FeatherIcon name="radio" :size="16" />
        Operations
      </button>
      <button type="button" class="tab" :class="{ active: view === 'audit' }" @click="view = 'audit'">
        <FeatherIcon name="book-open" :size="16" />
        Audit journal
      </button>
    </nav>

    <OrbitLoader v-if="loading && tasks.length === 0" label="Loading…" />

    <section v-else-if="view === 'tasks'" class="panel fade-up">
      <div class="panel-body">
        <TaskList :tasks="tasks" show-project empty-text="No operation yet." />
      </div>
    </section>

    <section v-else class="panel fade-up">
      <div class="panel-body">
        <AuditList :entries="entries" />
      </div>
    </section>
  </div>
</template>

<script>
/**
 * Full history of tasks and audit entries.
 */
import AuditList from '../components/AuditList.vue';
import TaskList from '../components/tasks/TaskList.vue';

export default {
  name: 'ActivityView',
  components: { AuditList, TaskList },
  data() {
    return {
      view: 'tasks',
      tasks: [],
      entries: [],
      loading: true,
    };
  },
  mounted() {
    this.load();
    this.unsubscribe = this.$tasks.onFinished(() => this.load());
  },
  beforeUnmount() {
    this.unsubscribe();
  },
  methods: {
    async load() {
      this.loading = true;

      try {
        const [tasks, audit] = await Promise.all([
          this.$api.get('/system/tasks?limit=100'),
          this.$api.get('/system/audit?limit=200'),
        ]);
        this.tasks = tasks.tasks;
        this.entries = audit.entries;
      } catch (error) {
        this.$toast.error(error);
      } finally {
        this.loading = false;
      }
    },
  },
};
</script>

<style>
.activity-tabs {
  margin-bottom: 24px;
  width: fit-content;
}
</style>
