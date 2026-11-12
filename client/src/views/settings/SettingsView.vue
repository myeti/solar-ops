<template>
  <div>
    <PageHeader eyebrow="System" title="Settings" subtitle="How SolarOps itself behaves." />

    <nav class="tabs settings-tabs">
      <RouterLink
        v-for="tab in tabs"
        :key="tab.to"
        :to="tab.to"
        class="tab"
        :class="{ active: $route.path === tab.to }"
      >
        <FeatherIcon :name="tab.icon" :size="16" />
        {{ tab.label }}
      </RouterLink>
    </nav>

    <RouterView />
  </div>
</template>

<script>
/**
 * Settings container with one tab per section.
 */
export default {
  name: 'SettingsView',
  data() {
    return {
      tabs: [
        { to: '/settings', label: 'General', icon: 'sliders' },
        { to: '/settings/access', label: 'Access & admins', icon: 'users' },
        { to: '/settings/account', label: 'My account', icon: 'user' },
        { to: '/settings/system', label: 'System', icon: 'cpu' },
      ],
    };
  },
};
</script>

<style>
.settings-tabs {
  margin-bottom: 24px;
  width: fit-content;
  max-width: 100%;
}

/* Only the exact route is highlighted ("/settings" is a prefix of the others). */
.settings-tabs .tab.router-link-active:not(.active) {
  background: transparent;
  box-shadow: none;
  color: var(--text-dim);
}
</style>
