<template>
  <div class="stack">
    <div class="row-between row-wrap">
      <div class="tabs logs-streams">
        <button type="button" class="tab" :class="{ active: stream === 'stdout' }" @click="stream = 'stdout'">
          <FeatherIcon name="message-square" :size="15" />
          Output
        </button>
        <button type="button" class="tab" :class="{ active: stream === 'stderr' }" @click="stream = 'stderr'">
          <FeatherIcon name="alert-triangle" :size="15" />
          Errors
        </button>
      </div>
      <div class="row row-wrap">
        <ToggleSwitch v-model="live" label="Live" />
        <select v-model.number="lines" class="select logs-lines" @change="load">
          <option :value="100">100 lines</option>
          <option :value="200">200 lines</option>
          <option :value="500">500 lines</option>
          <option :value="1000">1000 lines</option>
        </select>
        <button type="button" class="btn btn-icon" title="Refresh" :disabled="loading" @click="load">
          <FeatherIcon name="refresh-cw" :size="16" />
        </button>
        <button type="button" class="btn btn-icon" title="Clear logs" @click="clear">
          <FeatherIcon name="trash-2" :size="16" />
        </button>
      </div>
    </div>

    <div class="terminal">
      <div class="terminal-header">
        <FeatherIcon name="file-text" :size="14" />
        <span>{{ fileLabel }}</span>
        <span class="spacer"></span>
        <span v-if="live" class="row-sm"><span class="live-dot"></span> live</span>
      </div>
      <div ref="body" class="terminal-body tall" :class="{ 'logs-stderr': stream === 'stderr' }">
        <div v-if="!currentText" class="terminal-empty">Silence in the void. Nothing logged yet.</div>
        <div v-else>{{ currentText }}</div>
      </div>
    </div>
  </div>
</template>

<script>
/**
 * Logs tab: tail of the pm2 stdout / stderr files, with live refresh.
 */
const LIVE_INTERVAL_MS = 3000;

export default {
  name: 'LogsTab',
  props: {
    project: {
      type: Object,
      required: true,
    },
  },
  data() {
    return {
      stream: 'stdout',
      lines: 200,
      live: true,
      loading: false,
      logs: { stdout: '', stderr: '' },
    };
  },
  computed: {
    currentText() {
      return this.logs[this.stream].trim();
    },
    fileLabel() {
      if (this.stream === 'stderr') {
        return `${this.project.path}/logs/error.log`;
      }

      return `${this.project.path}/logs/out.log`;
    },
  },
  watch: {
    live(enabled) {
      if (enabled) {
        this.startLive();
      } else {
        clearInterval(this.timer);
      }
    },
    stream() {
      this.scrollToBottom();
    },
  },
  mounted() {
    this.load();
    this.startLive();
  },
  beforeUnmount() {
    clearInterval(this.timer);
  },
  methods: {
    startLive() {
      clearInterval(this.timer);

      if (this.live) {
        this.timer = setInterval(this.load, LIVE_INTERVAL_MS);
      }
    },
    async load() {
      this.loading = true;
      const body = this.$refs.body;
      let atBottom = true;

      if (body) {
        atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
      }

      try {
        this.logs = await this.$api.get(`/projects/${this.project.uid}/logs?lines=${this.lines}`);

        if (atBottom) {
          this.scrollToBottom();
        }
      } catch (error) {
        this.live = false;
        this.$toast.error(error);
      } finally {
        this.loading = false;
      }
    },
    scrollToBottom() {
      this.$nextTick(() => {
        const body = this.$refs.body;

        if (body) {
          body.scrollTop = body.scrollHeight;
        }
      });
    },
    async clear() {
      const confirmed = await this.$confirm({
        title: 'Clear the logs?',
        message: 'Both log files of the project are emptied.',
        confirmText: 'Clear',
        danger: true,
        icon: 'trash-2',
      });

      if (!confirmed) {
        return;
      }

      try {
        await this.$api.delete(`/projects/${this.project.uid}/logs`);
        await this.load();
      } catch (error) {
        this.$toast.error(error);
      }
    },
  },
};
</script>

<style>
.logs-lines {
  width: 130px;
}

.logs-stderr {
  color: #fecdd3;
}

.live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--danger);
  box-shadow: 0 0 0 3px var(--danger-soft);
  animation: pulse-glow 1.4s ease-in-out infinite;
}
</style>
