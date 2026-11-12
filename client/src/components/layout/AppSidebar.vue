<template>
  <aside class="sidebar" :class="{ open }">
    <RouterLink to="/" class="sidebar-brand" @click="$emit('navigate')">
      <BrandMark :size="34" />
      <span class="sidebar-brand-text">
        <span class="sidebar-brand-name">SolarOps</span>
        <span class="sidebar-version" :title="`SolarOps ${version}`">v{{ version }}</span>
      </span>
    </RouterLink>

    <nav class="sidebar-nav">
      <div v-for="group in groups" :key="group.title" class="sidebar-group">
        <div class="sidebar-group-title">{{ group.title }}</div>
        <RouterLink
          v-for="item in group.items"
          :key="item.to"
          :to="item.to"
          class="sidebar-link"
          :class="{ active: isActive(item) }"
          @click="$emit('navigate')"
        >
          <FeatherIcon :name="item.icon" :size="16" />
          <span>{{ item.label }}</span>
        </RouterLink>
      </div>
    </nav>

    <div v-if="$session.admin" class="sidebar-footer">
      <RouterLink to="/settings/account" class="sidebar-user" @click="$emit('navigate')">
        <span class="sidebar-avatar">{{ initials }}</span>
        <span class="sidebar-user-text">
          <span class="truncate">{{ $session.admin.email }}</span>
        </span>
      </RouterLink>
      <button type="button" class="btn btn-ghost btn-icon btn-sm" title="Sign out" @click="$emit('logout')">
        <FeatherIcon name="log-out" :size="15" />
      </button>
    </div>
  </aside>
</template>

<script>
/**
 * Main navigation.
 */
export default {
  name: 'AppSidebar',
  props: {
    /** Mobile: whether the drawer is open. */
    open: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['logout', 'navigate'],
  data() {
    return {
      /** package.json version, built in by client/vite.config.js. */
      version: import.meta.env.SOLAROPS_VERSION,
      groups: [
        {
          title: 'Workspace',
          items: [
            { to: '/', label: 'Dashboard', icon: 'grid', exact: true },
            { to: '/projects', label: 'Projects', icon: 'globe', exclude: '/projects/solarops' },
          ],
        },
        {
          title: 'Infrastructure',
          items: [
            { to: '/infrastructure/git', label: 'Git credentials', icon: 'git-branch' },
            { to: '/infrastructure/domains', label: 'Domains & SSL', icon: 'shield' },
            { to: '/infrastructure/database', label: 'PostgreSQL', icon: 'database' },
            { to: '/infrastructure/mail', label: 'Mail relays', icon: 'send' },
          ],
        },
        {
          title: 'System',
          items: [
            { to: '/projects/solarops', label: 'SolarOps', icon: 'sun' },
            { to: '/activity', label: 'Activity', icon: 'activity' },
            { to: '/alerts', label: 'Alerts', icon: 'bell' },
            { to: '/settings', label: 'Settings', icon: 'sliders' },
          ],
        },
      ],
    };
  },
  computed: {
    /** Two letters from the e-mail: "jane.doe@..." => "JD", "ops@..." => "OP". */
    initials() {
      const local = this.$session.admin.email.split('@')[0];
      const parts = local.split(/[._-]+/).filter(Boolean);

      if (parts.length >= 2) {
        return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
      }

      return local.slice(0, 2).toUpperCase();
    },
  },
  methods: {
    isActive(item) {
      const path = this.$route.path;

      if (item.exact) {
        return path === item.to;
      }

      if (item.exclude && path.startsWith(item.exclude)) {
        return false;
      }

      return path.startsWith(item.to);
    },
  },
};
</script>

<style>
.sidebar {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  width: var(--sidebar-width);
  padding: 18px 12px 12px;
  background: rgba(12, 12, 16, 0.62);
  border-right: 1px solid var(--border);
  backdrop-filter: var(--glass);
  -webkit-backdrop-filter: var(--glass);
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 10px 20px;
  color: var(--text);
}

.sidebar-brand:hover {
  color: var(--text);
}

.sidebar-brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}

.sidebar-brand-name {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 18px;
  flex: 1;
  overflow-y: auto;
}

.sidebar-group {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.sidebar-group-title {
  padding: 0 10px 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-faint);
}

.sidebar-link {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  color: var(--text-dim);
  font-size: 13.5px;
  font-weight: 500;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.sidebar-link:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.04);
}

.sidebar-link.active {
  color: var(--text);
  background: rgba(255, 255, 255, 0.08);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.sidebar-link.active .icon {
  color: var(--accent-strong);
}

.sidebar-version {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-faint);
}

.sidebar-footer {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.sidebar-user {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border-radius: 8px;
  color: var(--text);
}

.sidebar-user:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.04);
}

.sidebar-user-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  font-size: 13px;
  line-height: 1.3;
}

.sidebar-avatar {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--accent-soft);
  border: 1px solid rgba(129, 140, 248, 0.3);
  color: var(--accent-strong);
  font-weight: 600;
  font-size: 11px;
}

@media (max-width: 960px) {
  .sidebar {
    transform: translateX(-100%);
    transition: transform 0.25s ease;
    background: var(--surface-strong);
  }

  .sidebar.open {
    transform: translateX(0);
    box-shadow: 30px 0 80px rgba(0, 0, 0, 0.6);
  }
}
</style>
