/**
 * Client side routes. Views are lazy loaded (one chunk per page).
 *
 * Routes flagged `meta.public` are reachable without a session; every other
 * route redirects to the login page (or to the setup page on first run).
 */
import { createRouter, createWebHistory } from 'vue-router';
import session from './services/session.js';

const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('./views/auth/LoginView.vue'),
    meta: { public: true, title: 'Sign in' },
  },
  {
    path: '/setup',
    name: 'setup',
    component: () => import('./views/auth/SetupView.vue'),
    meta: { public: true, title: 'Setup' },
  },
  {
    path: '/auth/magic-link',
    name: 'magic-link',
    component: () => import('./views/auth/MagicLinkView.vue'),
    meta: { public: true, title: 'Signing in' },
  },
  {
    path: '/',
    name: 'dashboard',
    component: () => import('./views/DashboardView.vue'),
    // The solar system fills the page: no centered column.
    meta: { title: 'Dashboard', wide: true },
  },
  {
    path: '/projects',
    name: 'projects',
    component: () => import('./views/projects/ProjectsView.vue'),
    meta: { title: 'Projects' },
  },
  {
    path: '/projects/new',
    name: 'project-create',
    component: () => import('./views/projects/ProjectCreateView.vue'),
    meta: { title: 'New project' },
  },
  {
    path: '/projects/:uid',
    component: () => import('./views/projects/ProjectView.vue'),
    meta: { title: 'Project' },
    children: [
      { path: '', redirect: (to) => `/projects/${to.params.uid}/overview` },
      { path: 'overview', name: 'project-overview', component: () => import('./views/projects/tabs/OverviewTab.vue') },
      {
        path: 'deployment',
        name: 'project-deployment',
        component: () => import('./views/projects/tabs/DeploymentTab.vue'),
      },
      { path: 'database', name: 'project-database', component: () => import('./views/projects/tabs/DatabaseTab.vue') },
      { path: 'mail', name: 'project-mail', component: () => import('./views/projects/tabs/MailTab.vue') },
      { path: 'network', name: 'project-network', component: () => import('./views/projects/tabs/NetworkTab.vue') },
      {
        path: 'environment',
        name: 'project-environment',
        component: () => import('./views/projects/tabs/EnvironmentTab.vue'),
      },
      { path: 'logs', name: 'project-logs', component: () => import('./views/projects/tabs/LogsTab.vue') },
      { path: 'settings', name: 'project-settings', component: () => import('./views/projects/tabs/SettingsTab.vue') },
    ],
  },
  {
    path: '/infrastructure/database',
    name: 'postgres',
    component: () => import('./views/infrastructure/PostgresView.vue'),
    meta: { title: 'PostgreSQL' },
  },
  {
    path: '/infrastructure/mail',
    name: 'mail',
    component: () => import('./views/infrastructure/SmtpAccountsView.vue'),
    meta: { title: 'Mail relays' },
  },
  {
    path: '/infrastructure/domains',
    name: 'domains',
    component: () => import('./views/infrastructure/DomainsView.vue'),
    meta: { title: 'Domains & SSL' },
  },
  {
    path: '/infrastructure/git',
    name: 'git',
    component: () => import('./views/infrastructure/GitCredentialsView.vue'),
    meta: { title: 'Git credentials' },
  },
  {
    path: '/activity',
    name: 'activity',
    component: () => import('./views/ActivityView.vue'),
    meta: { title: 'Activity' },
  },
  {
    path: '/alerts',
    name: 'alerts',
    component: () => import('./views/AlertsView.vue'),
    meta: { title: 'Alerts' },
  },
  {
    path: '/settings',
    component: () => import('./views/settings/SettingsView.vue'),
    meta: { title: 'Settings' },
    children: [
      { path: '', name: 'settings', component: () => import('./views/settings/GeneralSettings.vue') },
      { path: 'access', name: 'settings-access', component: () => import('./views/settings/AccessSettings.vue') },
      { path: 'account', name: 'settings-account', component: () => import('./views/settings/AccountSettings.vue') },
      { path: 'system', name: 'settings-system', component: () => import('./views/settings/SystemSettings.vue') },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('./views/NotFoundView.vue'),
    meta: { title: 'Not found' },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from) {
    // Keep the scroll position when switching tabs of the same project.
    if (to.params.uid && to.params.uid === from.params.uid) {
      return false;
    }

    return { top: 0 };
  },
});

router.beforeEach(async (to) => {
  if (!session.loaded) {
    try {
      await session.refresh();
    } catch {
      // Server unreachable: let the page show its own error.
    }
  }

  if (session.setupRequired && to.name !== 'setup') {
    return { name: 'setup' };
  }

  if (to.meta.public) {
    const isEntryPage = to.name === 'login' || to.name === 'setup';

    if (session.authenticated && isEntryPage) {
      return { path: '/' };
    }

    return true;
  }

  if (!session.authenticated) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }

  return true;
});

router.afterEach((to) => {
  const title = to.matched
    .map((record) => record.meta.title)
    .filter(Boolean)
    .pop();

  if (title) {
    document.title = `${title} · SolarOps`;
  } else {
    document.title = 'SolarOps';
  }
});

export default router;
