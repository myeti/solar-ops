<template>
  <AmbientBackground />

  <div v-if="isPublicRoute" class="public-shell">
    <RouterView />
  </div>

  <div v-else class="app-shell">
    <AppSidebar :open="menuOpen" @logout="logout" @navigate="menuOpen = false" />
    <div v-if="menuOpen" class="sidebar-scrim" @click="menuOpen = false"></div>

    <main class="app-main">
      <button type="button" class="btn btn-icon mobile-menu" title="Menu" @click="menuOpen = true">
        <FeatherIcon name="menu" />
      </button>
      <div class="app-content" :class="{ 'is-wide': isWideRoute }">
        <RouterView v-slot="{ Component, route }">
          <Transition name="fade" mode="out-in">
            <component :is="Component" :key="pageKey(route)" />
          </Transition>
        </RouterView>
      </div>
    </main>
  </div>

  <ToastStack />
  <ConfirmDialog />
  <TaskViewer />
</template>

<script>
/**
 * Root component: ambient background, layout shell and global overlays.
 */
import AppSidebar from './components/layout/AppSidebar.vue';
import ConfirmDialog from './components/layout/ConfirmDialog.vue';
import ToastStack from './components/layout/ToastStack.vue';
import AmbientBackground from './components/base/AmbientBackground.vue';
import TaskViewer from './components/tasks/TaskViewer.vue';

export default {
  name: 'App',
  components: {
    AmbientBackground,
    AppSidebar,
    ConfirmDialog,
    TaskViewer,
    ToastStack,
  },
  data() {
    return {
      menuOpen: false,
    };
  },
  computed: {
    isPublicRoute() {
      return Boolean(this.$route.meta.public);
    },
    /** Pages using the whole width (meta.wide), e.g. the dashboard. */
    isWideRoute() {
      return Boolean(this.$route.meta.wide);
    },
  },
  methods: {
    /**
     * Key used for page transitions: tabs of a same page (project tabs,
     * settings sections) do not re-animate the whole page.
     */
    pageKey(route) {
      if (route.matched.length > 0) {
        return route.matched[0].path.replace(':uid', route.params.uid || '');
      }

      return route.path;
    },
    async logout() {
      await this.$session.logout();
      this.$router.push({ name: 'login' });
    },
  },
};
</script>
