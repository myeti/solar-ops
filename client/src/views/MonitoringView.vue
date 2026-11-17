<template>
  <div>
    <PageHeader
      eyebrow="System"
      title="Monitoring"
      subtitle="What uses the server's CPU and memory now, and over the last 24 hours."
    >
      <template #actions>
        <span v-if="processes && processes.available" class="row-sm small text-dim">
          <span class="monitoring-live" :class="{ paused }"></span>
          {{ liveCaption }}
        </span>
        <button type="button" class="btn" @click="togglePause">
          <FeatherIcon :name="pauseButton.icon" :size="16" />
          {{ pauseButton.label }}
        </button>
      </template>
    </PageHeader>

    <OrbitLoader v-if="!processes" label="Reading the processes…" />

    <div v-else class="stack-lg fade-up">
      <div v-if="!processes.available" class="callout callout-warning">
        <FeatherIcon name="alert-triangle" class="icon" />
        <span>The process list needs Linux (<code>/proc</code>): only the usage history is shown here.</span>
      </div>

      <div class="monitoring-columns">
        <section v-for="section in sections" :key="section.key" class="panel">
          <header class="panel-header">
            <span class="panel-icon"><FeatherIcon :name="section.icon" :size="17" /></span>
            <h3>{{ section.title }}</h3>
            <span class="spacer"></span>
            <span v-if="section.now" class="monitoring-now nowrap">
              <strong>{{ section.now.value }}</strong>
              <span class="small text-dim">{{ section.now.detail }}</span>
            </span>
          </header>
          <div class="monitoring-chart">
            <div class="section-title monitoring-heading">Last 24 hours</div>
            <UsageChart :samples="section.samples" :describe="section.describe" :label="section.title" :now="now">
              <template #empty>
                The history starts when SolarOps starts: a first point within a minute, then one every minute.
              </template>
            </UsageChart>
          </div>
          <div class="monitoring-top">
            <div class="section-title monitoring-heading">Top processes</div>
            <p v-if="!processes.available" class="small text-faint">Not available on this system.</p>
            <p v-else-if="section.top.length === 0" class="small text-faint">Nothing is using it right now.</p>
            <ol v-else class="list-plain monitoring-list">
              <li v-for="entry in section.top" :key="entry.pid" class="monitoring-row">
                <div class="monitoring-process">
                  <div class="row-sm monitoring-process-name">
                    <strong class="truncate">{{ entry.name }}</strong>
                    <RouterLink v-if="entry.project" :to="`/projects/${entry.project.uid}`" class="badge badge-violet">
                      {{ entry.project.name }}
                    </RouterLink>
                    <span v-else class="tiny text-faint">{{ entry.user }}</span>
                  </div>
                  <div class="mono tiny text-faint truncate" :title="entry.command">
                    {{ entry.pid }} · {{ entry.command }}
                  </div>
                </div>
                <div class="monitoring-value">
                  <span>{{ section.valueOf(entry) }}</span>
                  <span class="monitoring-bar">
                    <span :style="{ width: `${Math.min(section.percentOf(entry), 100)}%` }"></span>
                  </span>
                </div>
              </li>
            </ol>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script>
/**
 * System › Monitoring: the top CPU and memory processes, refreshed every
 * few seconds while the page is visible, and 24 hours of server usage
 * (kept in memory by the server: server/services/monitoring.js).
 */
import UsageChart from '../components/system/UsageChart.vue';

const PROCESSES_REFRESH_MS = 3000;
const HISTORY_REFRESH_MS = 60 * 1000;

export default {
  name: 'MonitoringView',
  components: { UsageChart },
  data() {
    return {
      processes: null,
      history: { samples: [], sampleSeconds: 60 },
      now: Date.now(),
      paused: false,
      timers: [],
    };
  },
  computed: {
    pauseButton() {
      if (this.paused) {
        return { icon: 'play', label: 'Resume' };
      }

      return { icon: 'pause', label: 'Pause' };
    },
    liveCaption() {
      if (this.paused) {
        return 'Paused';
      }

      return `Live · ${this.processes.processCount} processes`;
    },
    sections() {
      const processes = this.processes;
      const cpu = processes.cpu || { percent: null, cores: null, top: [] };
      const memory = processes.memory || { used: null, total: null, top: [] };
      const samples = this.history.samples;

      // The realtime value, in bold in the header, and what it is out of.
      let cpuNow = null;
      let memoryNow = null;

      if (cpu.percent !== null) {
        cpuNow = { value: `${cpu.percent}%`, detail: `now · ${cpu.cores} cores` };
      }

      if (memory.total) {
        memoryNow = { value: this.$format.bytes(memory.used), detail: `/ ${this.$format.bytes(memory.total)} now` };
      }

      return [
        {
          key: 'cpu',
          title: 'CPU',
          icon: 'cpu',
          now: cpuNow,
          top: cpu.top,
          valueOf: (entry) => `${entry.cpu}%`,
          percentOf: (entry) => entry.cpu,
          samples: samples.map((sample) => ({ at: sample.at, value: sample.cpu })),
          describe: (sample) => ({ value: `${sample.value}%`, detail: 'Average over the minute' }),
        },
        {
          key: 'memory',
          title: 'Memory',
          icon: 'layers',
          now: memoryNow,
          top: memory.top,
          valueOf: (entry) => this.$format.bytes(entry.memory),
          percentOf: (entry) => (entry.memory / (memory.total || 1)) * 100,
          samples: samples.map((sample) => ({
            at: sample.at,
            value: Math.round((sample.memoryUsed / sample.memoryTotal) * 1000) / 10,
            used: sample.memoryUsed,
            total: sample.memoryTotal,
          })),
          describe: (sample) => ({
            value: `${sample.value}%`,
            detail: `${this.$format.bytes(sample.used)} of ${this.$format.bytes(sample.total)}`,
          }),
        },
      ];
    },
  },
  mounted() {
    this.loadProcesses();
    this.loadHistory();
    this.timers.push(
      setInterval(() => {
        if (!document.hidden && !this.paused) {
          this.loadProcesses();
        }
      }, PROCESSES_REFRESH_MS),
      setInterval(() => {
        if (!document.hidden) {
          this.loadHistory();
        }
      }, HISTORY_REFRESH_MS),
    );
  },
  beforeUnmount() {
    for (const timer of this.timers) {
      clearInterval(timer);
    }
  },
  methods: {
    togglePause() {
      this.paused = !this.paused;

      if (!this.paused) {
        this.loadProcesses();
      }
    },
    async loadProcesses() {
      try {
        this.processes = await this.$api.get('/system/monitoring/processes');
      } catch (error) {
        this.paused = true;
        this.$toast.error(error);
      }
    },
    async loadHistory() {
      try {
        this.history = await this.$api.get('/system/monitoring/history');
        this.now = Date.now();
      } catch (error) {
        this.$toast.error(error);
      }
    },
  },
};
</script>

<style>
.monitoring-now {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
}

.monitoring-now strong {
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

/* CPU on the left, memory on the right: the chart above, the processes below. */
.monitoring-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  align-items: start;
}

.monitoring-top,
.monitoring-chart {
  min-width: 0;
  padding: 18px 20px 20px;
}

.monitoring-chart {
  border-bottom: 1px solid var(--border);
}

.monitoring-heading {
  margin-bottom: 10px;
}

.monitoring-list {
  display: flex;
  flex-direction: column;
}

.monitoring-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 7px 0;
  border-bottom: 1px solid var(--border);
}

.monitoring-row:last-child {
  border-bottom: 0;
}

.monitoring-process {
  flex: 1;
  min-width: 0;
}

.monitoring-process-name {
  min-width: 0;
}

.monitoring-process-name strong {
  font-size: 13.5px;
}

.monitoring-value {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  width: 84px;
  flex-shrink: 0;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.monitoring-bar {
  width: 100%;
  height: 4px;
  border-radius: 2px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
}

.monitoring-bar span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
}

.monitoring-live {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 0 3px var(--success-soft);
  animation: pulse-glow 1.6s ease-in-out infinite;
}

.monitoring-live.paused {
  background: var(--text-faint);
  box-shadow: none;
  animation: none;
}

@media (max-width: 1100px) {
  .monitoring-columns {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
