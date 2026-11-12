<template>
  <div class="terminal task-log">
    <div class="terminal-header">
      <FeatherIcon name="terminal" :size="14" />
      <span class="truncate">{{ headerTitle }}</span>
      <span class="spacer"></span>
      <span v-if="task" class="tiny nowrap">{{ $format.taskDuration(task) }}</span>
      <StatusPill v-if="task" :status="task.status" />
    </div>
    <div ref="body" class="terminal-body" :class="{ tall }" @scroll="onScroll">
      <div v-if="truncated" class="terminal-line terminal-empty">… {{ hiddenLines }} earlier lines hidden …</div>
      <div v-if="lines.length === 0" class="terminal-line terminal-empty">Waiting for output…</div>
      <div v-for="line in lines" :key="line.index" class="terminal-line" :class="line.kind">{{ line.text || ' ' }}</div>
    </div>
  </div>
</template>

<script>
/**
 * Live log of a task: polls the API while the task is queued or running,
 * keeps the view scrolled to the bottom (unless the user scrolled up), and
 * highlights steps, commands, errors and successes.
 */
const POLL_INTERVAL_MS = 1200;
const MAX_DISPLAYED_LINES = 3000;

/**
 * Classify a log line for colouring.
 */
function lineKind(text) {
  if (text.startsWith('▸')) {
    return 'is-step';
  }

  if (text.startsWith('$ ')) {
    return 'is-command';
  }

  if (text.startsWith('✖')) {
    return 'is-error';
  }

  if (text.startsWith('✔')) {
    return 'is-success';
  }

  return '';
}

export default {
  name: 'TaskLog',
  props: {
    taskId: {
      type: Number,
      required: true,
    },
    tall: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['finished', 'update'],
  data() {
    return {
      task: null,
      followBottom: true,
    };
  },
  computed: {
    headerTitle() {
      if (this.task) {
        return this.task.title;
      }

      return 'Connecting…';
    },
    allLines() {
      if (!this.task || !this.task.log) {
        return [];
      }

      return this.task.log.replace(/^\n+/, '').split('\n');
    },
    truncated() {
      return this.allLines.length > MAX_DISPLAYED_LINES;
    },
    hiddenLines() {
      return this.allLines.length - MAX_DISPLAYED_LINES;
    },
    lines() {
      const offset = Math.max(this.allLines.length - MAX_DISPLAYED_LINES, 0);

      return this.allLines.slice(offset).map((text, position) => {
        return { index: offset + position, text, kind: lineKind(text) };
      });
    },
  },
  watch: {
    taskId() {
      this.task = null;
      this.followBottom = true;
      this.load();
    },
  },
  mounted() {
    this.load();
  },
  beforeUnmount() {
    clearTimeout(this.timer);
    this.unmounted = true;
  },
  methods: {
    async load() {
      clearTimeout(this.timer);
      const requestedId = this.taskId;

      try {
        const { task } = await this.$api.get(`/system/tasks/${requestedId}`);

        if (this.unmounted || requestedId !== this.taskId) {
          return;
        }

        const isFirstLoad = this.task === null;
        const wasRunning = !isFirstLoad && ['queued', 'running'].includes(this.task.status);
        this.task = task;
        this.$emit('update', task);
        this.scrollIfFollowing();

        if (['queued', 'running'].includes(task.status)) {
          this.timer = setTimeout(this.load, POLL_INTERVAL_MS);
          return;
        }

        // Also report tasks that finished just before we first looked
        // (very fast tasks), but not old ones opened from the history.
        const finishedRecently = Date.now() - new Date(task.finishedAt).getTime() < 30000;

        if (wasRunning || (isFirstLoad && finishedRecently)) {
          this.$emit('finished', task);
        }
      } catch (error) {
        if (!this.unmounted) {
          this.timer = setTimeout(this.load, POLL_INTERVAL_MS * 3);
        }
      }
    },

    onScroll() {
      const body = this.$refs.body;
      this.followBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
    },

    scrollIfFollowing() {
      if (!this.followBottom) {
        return;
      }

      this.$nextTick(() => {
        const body = this.$refs.body;

        if (body) {
          body.scrollTop = body.scrollHeight;
        }
      });
    },
  },
};
</script>

<style>
.task-log .terminal-line {
  white-space: pre-wrap;
  min-height: 1.65em;
}
</style>
