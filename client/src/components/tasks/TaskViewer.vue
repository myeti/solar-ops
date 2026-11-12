<template>
  <ModalDialog :open="isOpen" :title="title" icon="terminal" width="xl" @close="close">
    <TaskLog v-if="isOpen" :task-id="state.taskId" tall @update="onUpdate" @finished="onFinished" />
    <template #footer>
      <span v-if="task" class="tiny text-faint">
        Task #{{ task.id }} · started {{ $format.dateTime(task.startedAt || task.createdAt) }}
      </span>
      <span class="spacer"></span>
      <button type="button" class="btn" @click="close">Close</button>
    </template>
  </ModalDialog>
</template>

<script>
/**
 * Global modal showing the live log of a task (opened with $tasks.open(id)).
 * Mounted once in App.vue.
 */
import TaskLog from './TaskLog.vue';
import { taskViewerState } from '../../services/ui.js';

export default {
  name: 'TaskViewer',
  components: { TaskLog },
  data() {
    return {
      state: taskViewerState,
      task: null,
    };
  },
  computed: {
    isOpen() {
      return this.state.taskId !== null;
    },
    title() {
      if (this.task) {
        return this.task.title;
      }

      return 'Task';
    },
  },
  watch: {
    'state.taskId'() {
      this.task = null;
    },
  },
  methods: {
    close() {
      this.$tasks.close();
    },
    onUpdate(task) {
      this.task = task;
    },
    onFinished(task) {
      if (task.status === 'success') {
        this.$toast.success(`${task.title}: success`);
      } else {
        this.$toast.error(`${task.title}: failed`);
      }

      this.$tasks.notifyFinished(task);
    },
  },
};
</script>
