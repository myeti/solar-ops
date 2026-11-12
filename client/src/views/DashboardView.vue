<template>
  <div class="dashboard" :style="{ minHeight: `${minimumPageHeight}px` }">
    <!--
      The whole page is space: the system floats below the header and numbers.
      Teleported into .app-main so page transitions (transforms) never move it.
      Deferred: right after signing in, .app-main is rendered with this page.
    -->
    <Teleport to=".app-main" defer>
      <div ref="space" class="dashboard-space">
        <SolarSystem v-if="overview" :projects="projects" :top-inset="spaceTop" @minimum-height="systemHeight = $event">
          <div v-if="projectCount === 0" class="dashboard-first-project">
            <span class="small">Only SolarOps orbits here so far.</span>
            <RouterLink to="/projects/new" class="btn btn-primary btn-sm">Create a project</RouterLink>
          </div>
        </SolarSystem>
      </div>
    </Teleport>

    <div ref="foreground" class="dashboard-foreground">
      <PageHeader :title="greeting">
        <template #subtitle>
          <span class="row-sm">
            <span class="health-dot" :class="healthTone"></span>
            {{ healthSentence }}
            <RouterLink v-if="failingChecks.length > 0" to="/projects/solarops" class="small">Details</RouterLink>
          </span>
        </template>
        <template #actions>
          <button type="button" class="btn" :disabled="loading" @click="load">
            <FeatherIcon name="refresh-cw" :size="16" />
            Refresh
          </button>
          <RouterLink to="/projects/new" class="btn btn-primary">
            <FeatherIcon name="plus" />
            New project
          </RouterLink>
        </template>
      </PageHeader>

      <OrbitLoader v-if="!overview" label="Loading…" />

      <div v-else class="stack-lg">
        <div v-if="overview.processError" class="callout callout-warning fade-up">
          <FeatherIcon name="alert-triangle" class="icon" />
          <span><strong>pm2 is unreachable:</strong> {{ overview.processError }}</span>
        </div>

        <div class="dashboard-tiles">
          <component
            :is="tileElement(tile)"
            v-for="(tile, index) in tiles"
            :key="tile.label"
            :to="tile.to"
            class="panel stat fade-up"
            :class="tileClasses(tile)"
            :style="{ animationDelay: `${index * 30}ms` }"
          >
            <div class="stat-label">
              <FeatherIcon :name="tile.icon" :size="15" />
              {{ tile.label }}
            </div>
            <div class="stat-value">
              {{ tile.value }}<small v-if="tile.total !== undefined"> / {{ tile.total }}</small>
            </div>
            <div v-if="tile.percent !== undefined" class="stat-meter">
              <span :class="meterTone(tile.percent)" :style="{ width: `${Math.min(tile.percent, 100)}%` }"></span>
            </div>
            <div class="stat-caption">{{ tile.caption }}</div>
          </component>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
/**
 * Dashboard: key numbers (projects, then the server resources and health,
 * then certificates, databases and pipelines) over the projects drawn as a
 * solar system filling the page. Health check details are on SolarOps's page.
 */
import SolarSystem from '../components/dashboard/SolarSystem.vue';

/** Planets follow the projects state. */
const REFRESH_INTERVAL_MS = 15000;

export default {
  name: 'DashboardView',
  components: { SolarSystem },
  data() {
    return {
      overview: null,
      projects: [],
      health: null,
      loading: false,
      // Where the free space starts below the header and numbers, in pixels.
      spaceTop: 0,
      // Height the solar system needs below that (it reports it).
      systemHeight: 420,
      // Vertical padding of .app-main, around the page.
      mainPadding: 0,
    };
  },
  computed: {
    greeting() {
      const hour = new Date().getHours();
      let period = 'Good evening';

      if (hour < 5) {
        period = 'Good night';
      } else if (hour < 12) {
        period = 'Good morning';
      } else if (hour < 18) {
        period = 'Good afternoon';
      }

      return period;
    },
    failingChecks() {
      if (!this.health) {
        return [];
      }

      return this.health.checks.filter((check) => !check.ok);
    },
    healthTone() {
      if (!this.health) {
        return 'pending';
      }

      if (this.failingChecks.length === 0) {
        return 'ok';
      }

      return 'warning';
    },
    healthSentence() {
      if (!this.health) {
        return 'Checking the server…';
      }

      if (this.failingChecks.length === 0) {
        return 'All systems operational.';
      }

      if (this.failingChecks.length === 1) {
        return `1 check needs attention: ${this.failingChecks[0].label}.`;
      }

      return `${this.failingChecks.length} checks need attention.`;
    },
    /** The page is tall enough for the header, the numbers and the system below them. */
    minimumPageHeight() {
      return Math.max(this.spaceTop + this.systemHeight - this.mainPadding, 0);
    },
    /** Projects besides SolarOps itself. */
    projectCount() {
      return this.projects.filter((project) => !project.system).length;
    },
    /**
     * Online, CPU, memory, storage, health, certificates, databases and
     * pipelines.
     */
    tiles() {
      const stats = this.overview.stats;
      const server = this.overview.server;

      return [
        {
          label: 'Online',
          icon: 'activity',
          value: stats.projects.online,
          total: stats.projects.apps,
          caption: `Applications running${this.staticCaption(stats)}${this.erroredCaption(stats)}`,
        },
        this.cpuTile(server.cpu),
        this.memoryTile(server.memory),
        this.storageTile(server.storage),
        this.healthTile(),
        this.certificatesTile(stats.certificates),
        {
          label: 'Databases',
          icon: 'database',
          value: stats.databases,
          caption: 'PostgreSQL databases',
        },
        {
          label: 'Pipelines',
          icon: 'git-branch',
          value: stats.deployments,
          caption: 'Projects deployed from git',
        },
      ];
    },
  },
  mounted() {
    this.load();
    this.measureSpace();
    this.resizeObserver = new ResizeObserver(() => {
      this.measureSpace();
    });
    this.resizeObserver.observe(this.$refs.foreground);
    this.unsubscribe = this.$tasks.onFinished(() => this.loadProjects());
    this.timer = setInterval(() => {
      // No refresh while the tab is in the background.
      if (!document.hidden) {
        this.loadProjects();
      }
    }, REFRESH_INTERVAL_MS);
  },
  beforeUnmount() {
    this.unsubscribe();
    clearInterval(this.timer);
    this.resizeObserver.disconnect();
  },
  methods: {
    /** Server-wide CPU usage (since the previous refresh). */
    cpuTile(cpu) {
      return {
        label: 'CPU',
        icon: 'cpu',
        value: `${cpu.percent}%`,
        percent: cpu.percent,
        caption: `${cpu.cores} cores · load ${cpu.loadAverage.toFixed(2)}`,
      };
    },
    /** Used memory (page cache counted as free). */
    memoryTile(memory) {
      const percent = Math.round((memory.used / memory.total) * 100);

      return {
        label: 'Memory',
        icon: 'layers',
        value: this.$format.bytes(memory.used),
        total: this.$format.bytes(memory.total),
        percent,
        caption: `${percent}% used`,
      };
    },
    /** The disk holding the projects (base folder). */
    storageTile(storage) {
      if (storage === null) {
        return { label: 'Storage', icon: 'hard-drive', value: '—', caption: 'Base folder unreadable' };
      }

      const percent = Math.round((storage.used / storage.total) * 100);

      return {
        label: 'Storage',
        icon: 'hard-drive',
        value: this.$format.bytes(storage.used),
        total: this.$format.bytes(storage.total),
        percent,
        caption: `${percent}% used · ${storage.path}`,
      };
    },
    /** Server health checks, detailed on SolarOps's page. */
    healthTile() {
      const tile = { label: 'Health', icon: 'heart', to: '/projects/solarops' };

      if (!this.health) {
        return { ...tile, value: '…', caption: 'Checking the server…' };
      }

      const checks = this.health.checks;
      const failing = this.failingChecks;
      let caption = 'All checks pass';
      let tone;

      if (failing.length > 0) {
        caption = `Failing: ${failing.map((check) => check.label).join(', ')}`;
        tone = 'warning';
      }

      return { ...tile, value: checks.length - failing.length, total: checks.length, caption, tone };
    },
    certificatesTile(certificates) {
      let caption = 'All certificates are valid';

      if (certificates.expiringSoon > 0) {
        caption = `${certificates.expiringSoon} expiring soon`;
      } else if (certificates.missing > 0) {
        caption = `${certificates.missing} not issued yet`;
      } else if (certificates.total === 0) {
        caption = 'No HTTPS domain yet';
      }

      return {
        label: 'Certificates',
        icon: 'shield',
        value: certificates.valid,
        total: certificates.total,
        caption,
      };
    },
    /** Tiles with a destination are links. */
    tileElement(tile) {
      if (tile.to) {
        return 'RouterLink';
      }

      return 'div';
    },
    tileClasses(tile) {
      const classes = [];

      if (tile.to) {
        classes.push('stat-link');
      }

      if (tile.tone) {
        classes.push(`is-${tile.tone}`);
      }

      return classes;
    },
    meterTone(percent) {
      if (percent >= 90) {
        return 'is-danger';
      }

      if (percent >= 75) {
        return 'is-warning';
      }

      return 'is-ok';
    },
    /** Bottom of the header and numbers, from the top of the space. */
    measureSpace() {
      const foreground = this.$refs.foreground;
      const space = this.$refs.space;

      if (!foreground || !space) {
        return;
      }

      const bottom = foreground.getBoundingClientRect().bottom - space.getBoundingClientRect().top;
      const mainStyle = getComputedStyle(space.parentElement);

      this.spaceTop = Math.max(Math.round(bottom + 16), 0);
      this.mainPadding = parseFloat(mainStyle.paddingTop) + parseFloat(mainStyle.paddingBottom);
    },
    staticCaption(stats) {
      if (stats.projects.staticSites > 0) {
        return ` · ${stats.projects.staticSites} static site(s)`;
      }

      return '';
    },
    erroredCaption(stats) {
      if (stats.projects.errored > 0) {
        return ` · ${stats.projects.errored} errored`;
      }

      return '';
    },
    /** Everything, health checks included (on load and Refresh). */
    async load() {
      await this.loadProjects();

      try {
        this.health = await this.$api.get('/system/health');
      } catch {
        this.health = { checks: [] };
      }
    },
    /** Numbers and planets only: the health checks run commands on the server. */
    async loadProjects() {
      this.loading = true;

      try {
        const [overview, projects] = await Promise.all([this.$api.get('/system/overview'), this.$api.get('/projects')]);

        this.overview = overview;
        // SolarOps itself is a planet too (purple).
        this.projects = projects.projects;
        // The numbers just appeared (or changed size): the system moves below them.
        this.$nextTick(() => this.measureSpace());
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
.health-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-faint);
}

.health-dot.ok {
  background: var(--success);
  box-shadow: 0 0 0 3px var(--success-soft);
}

.health-dot.warning {
  background: var(--warning);
  box-shadow: 0 0 0 3px var(--warning-soft);
}

.health-dot.pending {
  animation: pulse-glow 1.2s ease-in-out infinite;
}

/*
 * The space covers the whole main area (teleported into .app-main, the
 * positioned ancestor); header and numbers float above it.
 */
.dashboard-space {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
}

.dashboard-foreground {
  position: relative;
  z-index: 1;
}

/* Eight cards: two rows of four, one row on wide screens. */
.dashboard-tiles {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.dashboard-tiles .stat-value {
  font-size: 24px;
}

/* "/ 7.7 GB" stays in one piece when a narrow card wraps. */
.dashboard-tiles .stat-value small {
  white-space: nowrap;
}

.stat-meter {
  height: 4px;
  margin-top: 4px;
  border-radius: 2px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
}

.stat-meter span {
  display: block;
  height: 100%;
  border-radius: inherit;
  transition: width 0.4s ease;
}

.stat-meter .is-ok {
  background: linear-gradient(90deg, #60a5fa, #818cf8);
}

.stat-meter .is-warning {
  background: var(--warning);
}

.stat-meter .is-danger {
  background: var(--danger);
}

.stat.is-warning .stat-value {
  color: var(--warning);
}

.stat-link {
  color: inherit;
  transition: border-color 0.15s ease;
}

.stat-link:hover {
  border-color: rgba(255, 255, 255, 0.18);
}

@media (min-width: 1680px) {
  .dashboard-tiles {
    grid-template-columns: repeat(8, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .dashboard-tiles {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.dashboard-first-project {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
</style>
