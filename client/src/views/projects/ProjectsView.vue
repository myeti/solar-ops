<template>
  <div>
    <PageHeader title="Projects" subtitle="Every project orbiting this server.">
      <template #actions>
        <div class="input-prefix projects-search">
          <FeatherIcon name="search" :size="15" class="prefix" />
          <input v-model="search" class="input" placeholder="Search projects…" />
        </div>
        <button type="button" class="btn" :disabled="loading" @click="load">
          <span v-if="loading" class="spinner"></span>
          <FeatherIcon v-else name="refresh-cw" :size="16" />
          Refresh
        </button>
        <RouterLink to="/projects/new" class="btn btn-primary">
          <FeatherIcon name="plus" />
          New project
        </RouterLink>
      </template>
    </PageHeader>

    <OrbitLoader v-if="loading && projects.length === 0" label="Loading projects…" />

    <template v-else>
      <div v-if="processError" class="callout callout-warning projects-warning">
        <FeatherIcon name="alert-triangle" class="icon" />
        <span><strong>pm2 is unreachable:</strong> {{ processError }}</span>
      </div>

      <div v-if="analyticsError" class="callout callout-warning projects-warning">
        <FeatherIcon name="alert-triangle" class="icon" />
        <span>
          <strong>Analytics unavailable:</strong> {{ analyticsError }}
          <RouterLink to="/settings/analytics">Check the connector</RouterLink>
        </span>
      </div>

      <div v-if="projects.length === 0" class="panel">
        <EmptyState icon="globe" title="No project yet">
          Each project gets its own folder, process, and optionally a git deployment, a database, a mail relay and a
          domain with HTTPS.
          <template #actions>
            <RouterLink to="/projects/new" class="btn btn-primary">
              <FeatherIcon name="plus" />
              Create the first one
            </RouterLink>
          </template>
        </EmptyState>
      </div>

      <div v-else-if="rows.length === 0" class="panel">
        <EmptyState icon="search" title="Nothing matches">No project matches “{{ search }}”.</EmptyState>
      </div>

      <div v-else class="panel fade-up">
        <div class="table-wrap">
          <table class="table projects-table">
            <thead>
              <tr>
                <th v-for="column in columns" :key="column.key" :aria-sort="ariaSort(column)" :class="column.class">
                  <button type="button" class="projects-sort" @click="sortBy(column)">
                    {{ column.label }}
                    <FeatherIcon :name="sortIcon(column)" :size="13" :class="{ 'is-idle': sort.key !== column.key }" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in rows"
                :key="row.project.id"
                class="projects-row"
                :class="{ 'is-system': row.project.system, 'is-inactive': !row.project.active }"
                @click="openRow(row, $event)"
              >
                <td>
                  <div class="projects-name">
                    <span class="projects-avatar">
                      <span v-if="row.faviconUrl" class="projects-favicon" :class="{ 'is-dim': !row.project.active }">
                        <img :src="row.faviconUrl" alt="" @error="iconFailed(row.project.uid)" />
                      </span>
                      <PlanetAvatar
                        v-else
                        :seed="row.project.uid"
                        :size="32"
                        :ring="row.project.network.enabled"
                        :orbit="row.status === 'online' || row.status === 'live'"
                        :dim="!row.project.active"
                      />
                    </span>
                    <div class="projects-name-text">
                      <RouterLink :to="`/projects/${row.project.uid}`" class="projects-link truncate">
                        {{ row.project.name }}
                      </RouterLink>
                      <span class="tiny text-faint truncate">
                        {{ row.typeLabel }}
                        <template v-if="row.version">
                          · <span class="mono">{{ row.version }}</span>
                        </template>
                      </span>
                    </div>
                  </div>
                </td>

                <td>
                  <div class="projects-status">
                    <StatusPill
                      v-for="pill in row.pills"
                      :key="pill.status"
                      :status="pill.status"
                      :title="pill.title"
                    />
                  </div>
                </td>

                <td>
                  <div class="projects-services">
                    <span v-if="row.project.system" class="badge badge-violet">system</span>
                    <span
                      v-for="service in row.services"
                      :key="service.key"
                      class="component-chip"
                      :class="{ on: service.on }"
                      :title="service.title"
                    >
                      <FeatherIcon :name="service.icon" :size="14" />
                    </span>
                  </div>
                </td>

                <td>
                  <a
                    v-if="row.publicUrl"
                    :href="row.publicUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="projects-url"
                    :title="`Open ${row.publicUrl} in a new tab`"
                  >
                    <FeatherIcon :name="row.secureIcon" :size="13" :class="row.secureClass" />
                    <span class="truncate">{{ row.project.network.domain }}</span>
                    <FeatherIcon name="external-link" :size="12" class="projects-external" />
                  </a>
                  <span v-else-if="row.domain" class="projects-url is-off" title="Not served: the project is inactive">
                    <FeatherIcon name="wifi-off" :size="13" />
                    <span class="truncate">{{ row.domain }}</span>
                  </span>
                  <span v-else class="text-faint">—</span>
                </td>

                <td>
                  <template v-if="row.process">
                    <div class="projects-metric">{{ row.cpuLabel }}</div>
                    <div class="tiny text-faint nowrap">
                      {{ $format.bytes(row.process.memory) }} · up {{ $format.duration(row.process.uptimeMs) }}
                    </div>
                  </template>
                  <span v-else class="text-faint">—</span>
                </td>

                <td v-if="showAnalytics">
                  <a
                    v-if="row.analytics"
                    :href="row.analytics.link"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="projects-analytics"
                    :title="`Open ${row.analytics.name} in Umami`"
                  >
                    <span class="projects-metric">
                      <span v-if="row.analytics.active > 0" class="projects-live"></span>
                      {{ count(row.analytics.active) }}
                      <span class="tiny text-faint">now</span>
                    </span>
                    <span class="tiny text-faint nowrap"
                      >{{ count(row.analytics.today) }} daily · {{ count(row.analytics.week) }} weekly</span
                    >
                  </a>
                  <span v-else class="text-faint" title="No Umami website for this public URL">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<script>
/**
 * Every project in a sortable table (by name by default), with its status,
 * services, public URL, resources and, when analytics are on, the visits of
 * the Umami website matching its public URL (server/routes/analytics.js).
 * Loaded when the page opens, then on Refresh only.
 */

/** Order of the statuses, ascending. */
const STATUS_RANK = {
  online: 0,
  live: 1,
  launching: 2,
  stopping: 2,
  down: 3,
  stopped: 4,
  inactive: 5,
};

const STATUS_TITLES = {
  online: 'Answers, and is served on its domain.',
  live: 'Answers, but no domain serves it.',
  down: 'Does not answer on its port.',
  stopped: 'Stopped in pm2.',
  inactive: 'Deactivated: stopped, and its domain is not served.',
};

const COLUMNS = [
  { key: 'name', label: 'Project', direction: 'asc' },
  { key: 'status', label: 'Status', direction: 'asc' },
  { key: 'services', label: 'Services', direction: 'desc' },
  { key: 'url', label: 'Public URL', direction: 'asc' },
  { key: 'resources', label: 'CPU · Memory · Uptime', direction: 'desc' },
  { key: 'analytics', label: 'Analytics', direction: 'desc' },
];

/** Sort values: a string or a number, null for "nothing" (always last). */
const SORT_VALUES = {
  name: (row) => row.project.name.toLowerCase(),
  status: (row) => STATUS_RANK[row.status] ?? 4,
  services: (row) => row.services.filter((service) => service.on).length,
  url: (row) => row.domain || null,
  resources: (row) => {
    if (!row.process) {
      return null;
    }

    return row.process.cpu;
  },
  analytics: (row) => {
    if (!row.analytics || row.analytics.week === null) {
      return null;
    }

    return row.analytics.week;
  },
};

function compareValues(a, b) {
  if (typeof a === 'string') {
    return a.localeCompare(b);
  }

  return a - b;
}

export default {
  name: 'ProjectsView',
  data() {
    return {
      projects: [],
      processError: null,
      /** GET /api/analytics, when analytics are on. */
      analytics: null,
      loading: true,
      search: '',
      sort: { key: 'name', direction: 'asc' },
      /** Changes on Refresh, so the favicons are asked again. */
      iconVersion: 0,
      /** Projects whose favicon could not be loaded: their planet instead. */
      missingIcons: {},
    };
  },
  computed: {
    showAnalytics() {
      return Boolean(this.analytics && this.analytics.enabled && !this.analytics.error);
    },
    analyticsError() {
      if (this.analytics && this.analytics.enabled && this.analytics.error) {
        return this.analytics.error;
      }

      return null;
    },
    columns() {
      return COLUMNS.filter((column) => column.key !== 'analytics' || this.showAnalytics).map((column) => {
        if (column.key === 'resources' || column.key === 'analytics') {
          return { ...column, class: 'projects-wide' };
        }

        return column;
      });
    },
    filteredProjects() {
      const query = this.search.trim().toLowerCase();

      if (query === '') {
        return this.projects;
      }

      return this.projects.filter((project) => {
        const haystack = [project.name, project.uid, project.network.domain].join(' ').toLowerCase();
        return haystack.includes(query);
      });
    },
    rows() {
      const value = SORT_VALUES[this.sort.key];
      let factor = 1;

      if (this.sort.direction === 'desc') {
        factor = -1;
      }

      return this.filteredProjects
        .map((project) => this.rowOf(project))
        .sort((left, right) => {
          const a = value(left);
          const b = value(right);

          // Nothing to compare goes last, whatever the direction.
          if (a === null && b === null) {
            return compareValues(SORT_VALUES.name(left), SORT_VALUES.name(right));
          }

          if (a === null) {
            return 1;
          }

          if (b === null) {
            return -1;
          }

          return compareValues(a, b) * factor || compareValues(SORT_VALUES.name(left), SORT_VALUES.name(right));
        });
    },
  },
  mounted() {
    this.load();
  },
  methods: {
    /** What a row shows, computed once per project. */
    rowOf(project) {
      const network = project.network;
      const status = this.statusOf(project);
      const secure = Boolean(project.certificate && project.certificate.exists);
      let domain = null;
      let publicUrl = null;

      if (network.enabled && network.domain) {
        domain = network.domain;
      }

      // nginx serves it: active project with a domain.
      if (domain && project.active) {
        let scheme = 'http';

        if (secure) {
          scheme = 'https';
        }

        publicUrl = `${scheme}://${domain}`;
      }

      let process = null;
      let cpuLabel = '';

      if (project.process && project.process.status === 'online') {
        process = project.process;
        cpuLabel = `${Math.round(process.cpu * 10) / 10}% CPU`;
      }

      let analytics = null;

      if (this.showAnalytics) {
        analytics = this.analytics.projects[project.uid] || null;
      }

      let secureIcon = 'unlock';
      let secureClass = 'text-warning';

      if (secure) {
        secureIcon = 'lock';
        secureClass = 'text-success';
      }

      return {
        project,
        status,
        pills: this.pillsOf(project, status),
        typeLabel: this.typeLabelOf(project),
        faviconUrl: this.faviconUrlOf(project, status),
        version: project.version,
        services: this.servicesOf(project),
        domain,
        publicUrl,
        secureIcon,
        secureClass,
        process,
        cpuLabel,
        analytics,
      };
    },
    /**
     * online: live and exposed on its domain; live: live, not exposed;
     * down: not answering (an app), not built (a static site); stopped: an
     * app stopped in pm2; inactive: a deactivated project. `live` is the
     * server's probe (GET /api/projects?probe=1).
     */
    /**
     * The website's favicon (GET /api/projects/:uid/favicon), when the site
     * can have one right now: live, and not SolarOps itself.
     */
    faviconUrlOf(project, status) {
      if (project.system || this.missingIcons[project.uid] || !['online', 'live'].includes(status)) {
        return null;
      }

      return `/api/projects/${project.uid}/favicon?v=${this.iconVersion}`;
    },
    iconFailed(uid) {
      this.missingIcons = { ...this.missingIcons, [uid]: true };
    },
    statusOf(project) {
      if (!project.active) {
        return 'inactive';
      }

      const processInfo = project.process;

      if (project.type === 'app' && !project.system) {
        if (processInfo === null || processInfo.status === 'stopped') {
          return 'stopped';
        }

        if (processInfo.status === 'launching' || processInfo.status === 'stopping') {
          return processInfo.status;
        }
      }

      if (!project.live) {
        return 'down';
      }

      if (project.network.enabled && project.network.domain) {
        return 'online';
      }

      return 'live';
    },
    /** The status, then what else needs saying: not exposed, unstable restarts. */
    pillsOf(project, status) {
      const pills = [{ status, title: STATUS_TITLES[status] || '' }];

      if (status === 'down' && project.type === 'static') {
        pills[0].title = `Not built: no index.html in repo/${project.network.publicFolder}.`;
      }

      if (status === 'live') {
        pills.push({ status: 'unreachable', title: 'Not exposed: no domain in its Network tab.' });
      }

      const unstable = (project.process && project.process.unstableRestarts) || 0;

      if (unstable > 0) {
        pills.push({
          status: 'unstable',
          title: `pm2 restarted it ${unstable} time(s) right after it started (unstable restarts).`,
        });
      }

      return pills;
    },
    typeLabelOf(project) {
      if (project.system) {
        return 'System · systemd';
      }

      if (project.type === 'static') {
        return 'Static site';
      }

      return 'Application';
    },
    servicesOf(project) {
      const services = [];

      if (!project.system) {
        services.push(
          { key: 'git', icon: 'git-branch', title: 'Git deployment', on: project.deployment.enabled },
          { key: 'database', icon: 'database', title: 'PostgreSQL database', on: project.database.enabled },
          { key: 'redis', icon: 'zap', title: 'Redis', on: project.redis.enabled },
        );
      }

      services.push(
        { key: 'mail', icon: 'send', title: 'Mail relay', on: project.smtp.enabled },
        { key: 'network', icon: 'globe', title: 'Network', on: project.network.enabled },
      );

      return services;
    },
    count(value) {
      if (value === null || value === undefined) {
        return '—';
      }

      return value.toLocaleString();
    },
    sortBy(column) {
      if (this.sort.key === column.key) {
        let direction = 'asc';

        if (this.sort.direction === 'asc') {
          direction = 'desc';
        }

        this.sort = { key: column.key, direction };
        return;
      }

      this.sort = { key: column.key, direction: column.direction };
    },
    sortIcon(column) {
      if (this.sort.key === column.key && this.sort.direction === 'desc') {
        return 'chevron-down';
      }

      return 'chevron-up';
    },
    ariaSort(column) {
      if (this.sort.key !== column.key) {
        return 'none';
      }

      if (this.sort.direction === 'asc') {
        return 'ascending';
      }

      return 'descending';
    },
    /** The whole row opens the project; its links keep their own target. */
    openRow(row, event) {
      if (event.target.closest('a, button')) {
        return;
      }

      this.$router.push(`/projects/${row.project.uid}`);
    },
    async load() {
      this.loading = true;
      this.iconVersion += 1;
      this.missingIcons = {};
      this.loadAnalytics();

      try {
        const result = await this.$api.get('/projects?probe=1');
        this.projects = result.projects;
        this.processError = result.processError;
      } catch (error) {
        this.$toast.error(error);
      } finally {
        this.loading = false;
      }
    },
    /** On its own: a slow analytics service never delays the list (cached 30 seconds by the server). */
    async loadAnalytics() {
      try {
        this.analytics = await this.$api.get('/analytics');
      } catch {
        this.analytics = null;
      }
    },
  },
};
</script>

<style>
.projects-search {
  width: 260px;
}

.projects-search .input {
  padding-left: 38px;
}

.projects-warning {
  margin-bottom: 20px;
}

.projects-table th {
  padding-top: 0;
  padding-bottom: 0;
}

.projects-sort {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 38px;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  white-space: nowrap;
}

.projects-sort:hover {
  color: var(--text);
}

.projects-sort .is-idle {
  opacity: 0;
}

.projects-sort:hover .is-idle {
  opacity: 0.5;
}

.projects-row {
  cursor: pointer;
  transition: background 0.15s ease;
}

.projects-row:hover {
  background: rgba(255, 255, 255, 0.025);
}

.projects-row.is-system {
  background: linear-gradient(90deg, rgba(255, 143, 90, 0.07), transparent 40%);
}

.projects-row.is-inactive .projects-link {
  color: var(--text-dim);
}

.projects-name {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 180px;
}

.projects-status {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* A slot as wide as a ringed planet: names line up. The planet's layers are positioned: let clicks reach the row. */
.projects-favicon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.06);
}

.projects-favicon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.projects-favicon.is-dim {
  opacity: 0.5;
}

.projects-avatar {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 48px;
  pointer-events: none;
}

.projects-name-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.projects-link {
  color: var(--text);
  font-weight: 600;
  font-size: 14px;
}

.projects-link:hover {
  color: var(--text);
}

.projects-services {
  display: flex;
  align-items: center;
  gap: 4px;
}

.projects-url {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  max-width: 260px;
  padding: 5px 9px;
  border-radius: 8px;
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 12px;
  transition: border-color 0.2s ease;
}

a.projects-url:hover {
  color: var(--text);
  border-color: var(--border-strong);
}

.projects-url.is-off {
  color: var(--text-faint);
}

.projects-external {
  flex-shrink: 0;
  color: var(--text-faint);
  opacity: 0;
  transition: opacity 0.2s ease;
}

a.projects-url:hover .projects-external {
  opacity: 1;
}

.projects-metric {
  font-size: 13.5px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.projects-analytics {
  display: flex;
  flex-direction: column;
  color: var(--text);
}

.projects-analytics:hover {
  color: var(--text);
}

.projects-analytics:hover .tiny {
  color: var(--text-dim);
}

.projects-live {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 4px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 0 3px var(--success-soft);
  vertical-align: middle;
}

.projects-wide {
  min-width: 150px;
}

.component-chip {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  color: var(--text-faint);
  opacity: 0.45;
}

.component-chip.on {
  opacity: 1;
  color: var(--text);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--border);
}
</style>
