<template>
  <div class="stack-lg">
    <div v-if="project.processError" class="callout callout-warning">
      <FeatherIcon name="alert-triangle" class="icon" />
      <span><strong>pm2 is unreachable:</strong> {{ project.processError }}</span>
    </div>

    <div class="grid-4">
      <div v-for="metric in metrics" :key="metric.label" class="panel stat">
        <div class="stat-label">
          <FeatherIcon :name="metric.icon" :size="15" />
          {{ metric.label }}
        </div>
        <div class="stat-value overview-metric">{{ metric.value }}</div>
        <div class="stat-caption">{{ metric.caption }}</div>
      </div>
    </div>

    <SystemHealthPanel v-if="project.system" />

    <div class="grid-2">
      <section class="panel">
        <header class="panel-header">
          <span class="panel-icon"><FeatherIcon name="layers" :size="17" /></span>
          <h3>Components</h3>
        </header>
        <div class="panel-body">
          <ul class="list-plain">
            <li v-for="component in components" :key="component.tab" class="list-row">
              <span class="icon-bubble" :class="{ cyan: component.enabled }">
                <FeatherIcon :name="component.icon" :size="16" />
              </span>
              <span class="overview-component-text">
                <strong>{{ component.label }}</strong>
                <span class="small text-dim truncate">{{ component.description }}</span>
              </span>
              <StatusPill :status="component.status" />
              <RouterLink
                :to="`/projects/${project.uid}/${component.tab}`"
                class="btn btn-ghost btn-icon btn-sm"
                title="Configure"
              >
                <FeatherIcon name="chevron-right" :size="16" />
              </RouterLink>
            </li>
          </ul>
        </div>
      </section>

      <section class="panel">
        <header class="panel-header">
          <span class="panel-icon"><FeatherIcon name="radio" :size="17" /></span>
          <h3>Recent operations</h3>
        </header>
        <div class="panel-body">
          <TaskList :tasks="tasks" />
        </div>
      </section>
    </div>

    <ServerPanel v-if="project.system" :project="project" />
    <div v-else class="overview-server-row">
      <ServerPanel :project="project" />
      <StoragePanel :project="project" />
    </div>
  </div>
</template>

<script>
/**
 * Project overview: process metrics, components, recent tasks, paths and
 * storage.
 */
import ServerPanel from '../../../components/projects/overview/ServerPanel.vue';
import StoragePanel from '../../../components/projects/overview/StoragePanel.vue';
import SystemHealthPanel from '../../../components/system/SystemHealthPanel.vue';
import TaskList from '../../../components/tasks/TaskList.vue';

export default {
  name: 'OverviewTab',
  components: { ServerPanel, StoragePanel, SystemHealthPanel, TaskList },
  props: {
    project: {
      type: Object,
      required: true,
    },
  },
  emits: ['refresh'],
  data() {
    return {
      tasks: [],
    };
  },
  computed: {
    processInfo() {
      return this.project.process;
    },
    metrics() {
      const processInfo = this.processInfo;

      if (this.project.type === 'static') {
        return this.staticMetrics;
      }

      if (!processInfo) {
        return [
          { label: 'Status', icon: 'power', value: 'Off', caption: 'Not known by pm2' },
          { label: 'CPU', icon: 'cpu', value: '—', caption: 'No process' },
          { label: 'Memory', icon: 'hard-drive', value: '—', caption: 'No process' },
          { label: 'Restarts', icon: 'rotate-ccw', value: '—', caption: 'No process' },
        ];
      }

      let pidCaption = 'Not running';
      if (processInfo.pid) {
        pidCaption = `PID ${processInfo.pid}`;
      }

      return [
        {
          label: 'Uptime',
          icon: 'clock',
          value: this.$format.duration(processInfo.uptimeMs),
          caption: `${processInfo.status} · ${pidCaption}`,
        },
        { label: 'CPU', icon: 'cpu', value: `${processInfo.cpu}%`, caption: this.cpuCaption },
        {
          label: 'Memory',
          icon: 'hard-drive',
          value: this.$format.bytes(processInfo.memory),
          caption: 'Resident memory',
        },
        {
          label: 'Restarts',
          icon: 'rotate-ccw',
          value: String(processInfo.restarts),
          caption: `${processInfo.unstableRestarts} unstable`,
        },
      ];
    },
    /** A static site has no process: show how it is served instead. */
    staticMetrics() {
      const project = this.project;
      const network = project.network;
      let domain = '—';
      let domainCaption = 'Not exposed yet (Network tab)';
      let https = 'Off';
      let httpsCaption = 'No certificate';
      let deployed = 'Never';
      let deployedCaption = 'No deployment yet';

      if (network.enabled && network.domain) {
        domain = network.domain;
        domainCaption = 'Served by nginx';
      }

      if (project.certificate && project.certificate.exists) {
        https = 'On';
        httpsCaption = `${project.certificate.daysLeft} days left`;
      }

      if (project.lastDeployment) {
        deployed = this.$format.timeAgo(project.lastDeployment.createdAt);
        deployedCaption = project.lastDeployment.status;

        if (project.lastDeployment.meta.answeredAt) {
          deployedCaption = 'live, after a slow start';
        }
      }

      return [
        { label: 'Domain', icon: 'globe', value: domain, caption: domainCaption },
        { label: 'Files', icon: 'folder', value: `repo/${network.publicFolder}`, caption: 'Public folder' },
        { label: 'HTTPS', icon: 'shield', value: https, caption: httpsCaption },
        { label: 'Deployed', icon: 'upload-cloud', value: deployed, caption: deployedCaption },
      ];
    },
    cpuCaption() {
      if (this.processInfo && this.processInfo.managedBy === 'systemd') {
        return 'Average since start';
      }

      return 'Current usage';
    },
    components() {
      const project = this.project;
      let deploymentDescription = 'Clone, build and restart from a git repository';
      let databaseDescription = 'Dedicated PostgreSQL database and role';
      let mailDescription = 'SMTP_* variables from a mail relay';
      let networkDescription = 'Domain, reverse proxy and HTTPS';

      if (project.deployment.enabled) {
        deploymentDescription = `${project.deployment.url} · ${project.deployment.branch}`;
      }

      if (project.database.enabled) {
        databaseDescription = `Database ${project.database.name}, role ${project.database.user}`;
      }

      if (project.system) {
        mailDescription = 'Mail relay sending the magic login links';
      }

      if (project.smtp.enabled && !project.system) {
        mailDescription = 'SMTP_* variables provided at startup';
      }

      if (project.network.enabled) {
        networkDescription = this.networkDescription();
      }

      const list = [
        {
          tab: 'deployment',
          label: 'Deployment',
          icon: 'git-branch',
          enabled: project.deployment.enabled,
          description: deploymentDescription,
        },
        {
          tab: 'database',
          label: 'Database',
          icon: 'database',
          enabled: project.database.enabled,
          description: databaseDescription,
        },
        { tab: 'mail', label: 'Mail', icon: 'send', enabled: project.smtp.enabled, description: mailDescription },
        {
          tab: 'network',
          label: 'Network',
          icon: 'globe',
          enabled: project.network.enabled,
          description: networkDescription,
        },
      ];

      for (const component of list) {
        component.status = 'disabled';

        if (component.enabled) {
          component.status = 'enabled';
        }
      }

      // SolarOps itself only has a mail relay and a domain.
      if (project.system) {
        return list.filter((component) => ['mail', 'network'].includes(component.tab));
      }

      return list;
    },
  },
  watch: {
    'project.lastDeployment.status'() {
      this.loadTasks();
    },
  },
  mounted() {
    this.loadTasks();
  },
  methods: {
    networkDescription() {
      const network = this.project.network;
      let target = `port ${this.project.port}`;

      if (network.mode === 'static') {
        target = `static ${network.publicFolder}/`;
      }

      let https = 'HTTP only';
      if (this.project.certificate.exists) {
        https = 'HTTPS';
      }

      return `${network.domain} → ${target} · ${https}`;
    },
    async loadTasks() {
      try {
        const { tasks } = await this.$api.get(`/projects/${this.project.uid}/tasks?limit=6`);
        this.tasks = tasks;
      } catch (error) {
        this.$toast.error(error);
      }
    },
  },
};
</script>

<style>
.overview-metric {
  font-size: 26px;
}

.overview-component-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.overview-server-row {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

/* Long start commands and paths wrap in the narrower column. */
.overview-server-row code {
  overflow-wrap: anywhere;
}

@media (max-width: 1100px) {
  .overview-server-row {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
