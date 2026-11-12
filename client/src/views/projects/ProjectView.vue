<template>
  <div>
    <OrbitLoader v-if="!project && !notFound" label="Loading project…" />

    <div v-else-if="notFound" class="panel">
      <EmptyState icon="crosshair" title="Project not found">
        There is no project with the identifier <code>{{ uid }}</code
        >.
        <template #actions>
          <RouterLink to="/projects" class="btn btn-primary">Back to projects</RouterLink>
        </template>
      </EmptyState>
    </div>

    <template v-else>
      <PageHeader :title="project.name">
        <template #before>
          <PlanetAvatar
            :seed="project.uid"
            :size="56"
            :ring="project.network.enabled"
            :orbit="status === 'online'"
            :dim="!project.active"
          />
        </template>
        <template #subtitle>
          <span class="project-meta">
            <StatusPill :status="status" />
            <span class="mono small">{{ project.uid }}</span>
            <span v-if="project.port" class="mono small text-faint">:{{ project.port }}</span>
            <a v-if="publicUrl" :href="publicUrl" target="_blank" rel="noopener noreferrer" class="small row-sm">
              {{ project.network.domain }}
              <FeatherIcon name="external-link" :size="13" />
            </a>
          </span>
        </template>
        <template v-if="!project.system" #actions>
          <template v-if="project.active && project.type === 'app'">
            <button
              v-if="!isRunning"
              type="button"
              class="btn btn-success"
              :disabled="busy"
              @click="runAction('start')"
            >
              <FeatherIcon name="play" :size="16" />
              Start
            </button>
            <template v-else>
              <button type="button" class="btn" :disabled="busy" @click="runAction('restart')">
                <FeatherIcon name="refresh-cw" :size="16" />
                Restart
              </button>
              <button type="button" class="btn btn-danger" :disabled="busy" @click="runAction('stop')">
                <FeatherIcon name="square" :size="16" />
                Stop
              </button>
            </template>
          </template>
          <button
            v-if="project.deployment.enabled"
            type="button"
            class="btn btn-primary"
            :disabled="busy"
            @click="deploy"
          >
            <FeatherIcon name="upload-cloud" :size="17" />
            Deploy
          </button>
        </template>
      </PageHeader>

      <div v-if="project.system" class="callout project-banner">
        <FeatherIcon name="aperture" class="icon" />
        <span>
          This is <strong>SolarOps itself</strong>. It runs as the <code>solarops</code> systemd service and is upgraded
          with <code>deploy/install.sh</code>: only its domain, HTTPS certificate and mail relay are managed here.
        </span>
      </div>

      <div v-if="hasForeignProcess" class="callout callout-warning project-banner">
        <FeatherIcon name="alert-triangle" class="icon" />
        <span>
          A pm2 process named <code>{{ project.uid }}</code> is running, but it was not started by SolarOps: it is left
          as is, and Start / Restart are refused. When ready, remove it from the server (<code
            >pm2 delete {{ project.uid }}</code
          >) to let SolarOps manage the project.
        </span>
      </div>

      <div v-if="!project.active" class="callout callout-warning project-banner">
        <FeatherIcon name="moon" class="icon" />
        <span>
          This project is <strong>inactive</strong>: it is stopped, not served by nginx and ignores webhooks.
          <RouterLink :to="`/projects/${project.uid}/settings`">Activate it in Settings</RouterLink>.
        </span>
      </div>

      <nav class="tabs project-tabs">
        <RouterLink v-for="tab in tabs" :key="tab.name" :to="`/projects/${project.uid}/${tab.name}`" class="tab">
          <FeatherIcon :name="tab.icon" :size="16" />
          {{ tab.label }}
          <span v-if="tab.enabled" class="tab-dot" title="Enabled"></span>
        </RouterLink>
      </nav>

      <RouterView :project="project" @refresh="load" />
    </template>
  </div>
</template>

<script>
/**
 * Project page: header with lifecycle actions, and one tab per concern.
 * Tabs receive the project as a prop and emit "refresh" after changes.
 */
const REFRESH_INTERVAL_MS = 10000;

/** Tabs available for SolarOps itself (the system project). */
const SYSTEM_TABS = ['overview', 'mail', 'network'];

export default {
  name: 'ProjectView',
  data() {
    return {
      project: null,
      notFound: false,
      busy: false,
    };
  },
  computed: {
    uid() {
      return this.$route.params.uid;
    },
    status() {
      if (!this.project.active) {
        return 'inactive';
      }

      if (this.project.type === 'static') {
        return 'static';
      }

      if (this.project.process) {
        return this.project.process.status;
      }

      return 'offline';
    },
    hasForeignProcess() {
      const processInfo = this.project.process;

      return Boolean(processInfo && !this.project.system && processInfo.managed === false);
    },
    isRunning() {
      return ['online', 'launching', 'errored'].includes(this.status);
    },
    publicUrl() {
      const network = this.project.network;

      if (!network.enabled || !network.domain) {
        return null;
      }

      if (this.project.certificate && this.project.certificate.exists) {
        return `https://${network.domain}`;
      }

      return `http://${network.domain}`;
    },
    tabs() {
      const project = this.project;

      if (project.system) {
        return SYSTEM_TABS.map((name) => this.allTabs.find((tab) => tab.name === name));
      }

      // A static site has no process, hence no process logs.
      if (project.type === 'static') {
        return this.allTabs.filter((tab) => tab.name !== 'logs');
      }

      return this.allTabs;
    },
    allTabs() {
      const project = this.project;

      return [
        { name: 'overview', label: 'Overview', icon: 'compass', enabled: false },
        { name: 'deployment', label: 'Deployment', icon: 'git-branch', enabled: project.deployment.enabled },
        { name: 'database', label: 'Database', icon: 'database', enabled: project.database.enabled },
        { name: 'mail', label: 'Mail', icon: 'send', enabled: project.smtp.enabled },
        { name: 'network', label: 'Network', icon: 'globe', enabled: project.network.enabled },
        { name: 'environment', label: 'Environment', icon: 'list', enabled: false },
        { name: 'logs', label: 'Logs', icon: 'file-text', enabled: false },
        { name: 'settings', label: 'Settings', icon: 'settings', enabled: false },
      ];
    },
  },
  watch: {
    uid() {
      this.project = null;
      this.notFound = false;
      this.load();
    },
    '$route.name'() {
      this.enforceSystemTabs();
    },
  },
  mounted() {
    this.load();
    this.timer = setInterval(() => this.refreshIfVisible(), REFRESH_INTERVAL_MS);
    this.unsubscribe = this.$tasks.onFinished((task) => {
      if (this.project && task.projectId === this.project.id) {
        this.load();
      }
    });
  },
  beforeUnmount() {
    clearInterval(this.timer);
    this.unsubscribe();
  },
  methods: {
    /** Live status refresh, skipped while the browser tab is hidden. */
    refreshIfVisible() {
      if (document.visibilityState === 'visible') {
        this.load({ silent: true });
      }
    },
    async load(options = {}) {
      try {
        const { project } = await this.$api.get(`/projects/${this.uid}`);
        this.project = project;
        this.enforceSystemTabs();
      } catch (error) {
        if (error.status === 404) {
          this.notFound = true;
          return;
        }

        if (!options.silent) {
          this.$toast.error(error);
        }
      }
    },

    /**
     * SolarOps itself only has some tabs: redirect the others to the overview.
     */
    enforceSystemTabs() {
      if (!this.project || !this.project.system) {
        return;
      }

      const tab = String(this.$route.name || '').replace('project-', '');

      if (!SYSTEM_TABS.includes(tab)) {
        this.$router.replace(`/projects/${this.project.uid}/overview`);
      }
    },

    async runAction(action) {
      this.busy = true;

      try {
        const { project, liveness } = await this.$api.post(`/projects/${this.uid}/${action}`);
        this.project = project;

        const messages = {
          start: 'Project started.',
          restart: 'Restarted.',
          stop: 'Stopped.',
        };

        // Start / restart probe the app on / (liveness): report the result.
        if (!liveness) {
          this.$toast.success(messages[action]);
        } else if (liveness.alive) {
          this.$toast.success(`${messages[action]} ${liveness.message}`);
        } else if (liveness.starting) {
          this.$toast.info(`${messages[action]} Still starting: ${liveness.message}`);
        } else {
          this.$toast.warning(`${messages[action]} But ${liveness.message} Check the logs.`);
        }
      } catch (error) {
        this.$toast.error(error);
      } finally {
        this.busy = false;
      }
    },

    async deploy() {
      this.busy = true;

      try {
        const { task } = await this.$api.post(`/projects/${this.uid}/deployment/deploy`);
        this.$tasks.open(task.id);
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
.project-meta {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.project-banner {
  margin-bottom: 20px;
}

.project-tabs {
  margin-bottom: 24px;
}
</style>
