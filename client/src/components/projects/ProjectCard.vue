<template>
  <article class="project-card panel panel-interactive" :class="{ 'is-system': project.system }">
    <div class="project-card-top">
      <PlanetAvatar
        :seed="project.uid"
        :size="40"
        :ring="project.network.enabled"
        :orbit="isOnline"
        :dim="!project.active"
      />
      <div class="project-card-title">
        <h3 class="truncate">
          <RouterLink :to="projectPath" class="project-card-link">{{ project.name }}</RouterLink>
        </h3>
        <span class="tiny text-faint truncate">{{ typeLabel }}</span>
      </div>
      <StatusPill :status="status" />
    </div>

    <a
      v-if="publicUrl"
      :href="publicUrl"
      target="_blank"
      rel="noopener noreferrer"
      class="project-card-domain is-link small"
      :title="`Open ${publicUrl} in a new tab`"
    >
      <FeatherIcon :name="domainIcon" :size="14" :class="domainIconClass" />
      <span class="truncate">{{ project.network.domain }}</span>
      <FeatherIcon name="external-link" :size="13" class="project-card-external" />
    </a>
    <div v-else class="project-card-domain small">
      <template v-if="hasDomain">
        <FeatherIcon :name="domainIcon" :size="14" :class="domainIconClass" />
        <span class="truncate">{{ project.network.domain }}</span>
      </template>
      <template v-else>
        <FeatherIcon name="wifi-off" :size="14" class="text-faint" />
        <span class="text-faint">No public domain</span>
      </template>
    </div>

    <div class="project-card-footer">
      <!-- Above the card link (for the tooltips): clicks still open the project. -->
      <div class="project-card-components" @click="open">
        <span v-if="project.system" class="badge badge-violet">system</span>
        <span
          v-if="!project.system"
          class="component-chip"
          :class="{ on: project.deployment.enabled }"
          title="Git deployment"
        >
          <FeatherIcon name="git-branch" :size="14" />
        </span>
        <span
          v-if="!project.system"
          class="component-chip"
          :class="{ on: project.database.enabled }"
          title="PostgreSQL database"
        >
          <FeatherIcon name="database" :size="14" />
        </span>
        <span class="component-chip" :class="{ on: project.smtp.enabled }" title="Mail relay">
          <FeatherIcon name="send" :size="14" />
        </span>
        <span class="component-chip" :class="{ on: project.network.enabled }" title="Network">
          <FeatherIcon name="globe" :size="14" />
        </span>
      </div>
      <span class="tiny text-faint nowrap">{{ footerText }}</span>
    </div>
  </article>
</template>

<script>
/**
 * Summary card of a project (projects list). The name is the link to the
 * project, stretched over the whole card; the public domain opens the site
 * in a new tab.
 */
export default {
  name: 'ProjectCard',
  props: {
    project: {
      type: Object,
      required: true,
    },
  },
  computed: {
    projectPath() {
      return `/projects/${this.project.uid}`;
    },
    typeLabel() {
      if (this.project.system) {
        return 'System · systemd';
      }

      if (this.project.type === 'static') {
        return 'Static site';
      }

      return 'Application';
    },
    hasDomain() {
      return this.project.network.enabled && Boolean(this.project.network.domain);
    },
    /** Address of the website, when nginx serves it (active project with a domain). */
    publicUrl() {
      if (!this.hasDomain || !this.project.active) {
        return null;
      }

      let scheme = 'http';

      if (this.hasCertificate) {
        scheme = 'https';
      }

      return `${scheme}://${this.project.network.domain}`;
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
    isOnline() {
      return this.status === 'online';
    },
    hasCertificate() {
      return Boolean(this.project.certificate && this.project.certificate.exists);
    },
    domainIcon() {
      if (this.hasCertificate) {
        return 'lock';
      }

      return 'unlock';
    },
    domainIconClass() {
      if (this.hasCertificate) {
        return 'text-success';
      }

      return 'text-warning';
    },
    footerText() {
      const processInfo = this.project.process;

      if (processInfo && processInfo.status === 'online') {
        return `${this.$format.bytes(processInfo.memory)} · up ${this.$format.duration(processInfo.uptimeMs)}`;
      }

      if (this.project.lastDeployment) {
        return `Deployed ${this.$format.timeAgo(this.project.lastDeployment.createdAt)}`;
      }

      return `Created ${this.$format.timeAgo(this.project.createdAt)}`;
    },
  },
  methods: {
    open() {
      this.$router.push(this.projectPath);
    },
  },
};
</script>

<style>
.project-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  padding: 16px;
  color: var(--text);
}

/* The name links to the project; its overlay makes the whole card clickable. */
.project-card-link {
  color: inherit;
}

.project-card-link:hover {
  color: inherit;
}

.project-card-link::after {
  content: '';
  position: absolute;
  inset: 0;
}

.project-card-link:focus-visible {
  outline: none;
}

/* The planet's layers are positioned: let clicks reach the card link. */
.project-card .planet {
  pointer-events: none;
}

.project-card:has(.project-card-link:focus-visible) {
  border-color: var(--accent);
}

.project-card.is-system {
  border-color: rgba(255, 143, 90, 0.22);
  background: linear-gradient(160deg, rgba(255, 143, 90, 0.07), transparent 55%), var(--surface);
}

.project-card-top {
  display: flex;
  align-items: center;
  gap: 12px;
}

.project-card-title {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.project-card-title h3 {
  font-size: 14.5px;
}

.project-card-domain {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 8px 10px;
  border-radius: 9px;
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  font-family: var(--font-mono);
  font-size: 12px;
}

.project-card-domain.is-link,
.project-card-components {
  position: relative;
  z-index: 1;
}

.project-card-domain.is-link {
  color: var(--text);
  transition: border-color 0.2s ease;
}

.project-card-domain.is-link:hover {
  color: var(--text);
  border-color: var(--border-strong);
}

.project-card-external {
  flex-shrink: 0;
  margin-left: auto;
  color: var(--text-faint);
  opacity: 0;
  transition: opacity 0.2s ease;
}

.project-card-domain.is-link:hover .project-card-external,
.project-card-domain.is-link:focus-visible .project-card-external {
  opacity: 1;
}

.project-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.project-card-components {
  display: flex;
  align-items: center;
  gap: 4px;
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
