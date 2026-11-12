/**
 * SolarOps UI entry point (Vue 3, Options API).
 */
import { createApp } from 'vue';

// Self-hosted fonts (no third-party requests, CSP friendly).
import '@fontsource-variable/inter/index.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';

import './styles/theme.css';
import './styles/components.css';
import './styles/layout.css';

import App from './App.vue';
import router from './router.js';
import api, { onApiEvent } from './services/api.js';
import format from './services/format.js';
import session from './services/session.js';
import { confirm, tasks, toast } from './services/ui.js';

import BrandMark from './components/base/BrandMark.vue';
import CopyButton from './components/base/CopyButton.vue';
import EmptyState from './components/base/EmptyState.vue';
import FeatherIcon from './components/base/FeatherIcon.vue';
import FormField from './components/base/FormField.vue';
import ModalDialog from './components/base/ModalDialog.vue';
import OrbitLoader from './components/base/OrbitLoader.vue';
import PageHeader from './components/base/PageHeader.vue';
import PlanetAvatar from './components/base/PlanetAvatar.vue';
import SecretValue from './components/base/SecretValue.vue';
import StatusPill from './components/base/StatusPill.vue';
import ToggleSwitch from './components/base/ToggleSwitch.vue';

const app = createApp(App);

// Base components used everywhere are registered globally.
app.component('BrandMark', BrandMark);
app.component('CopyButton', CopyButton);
app.component('EmptyState', EmptyState);
app.component('FeatherIcon', FeatherIcon);
app.component('FormField', FormField);
app.component('ModalDialog', ModalDialog);
app.component('OrbitLoader', OrbitLoader);
app.component('PageHeader', PageHeader);
app.component('PlanetAvatar', PlanetAvatar);
app.component('SecretValue', SecretValue);
app.component('StatusPill', StatusPill);
app.component('ToggleSwitch', ToggleSwitch);

// Global services: this.$api, this.$session, this.$toast, this.$confirm, this.$tasks, this.$format
app.config.globalProperties.$api = api;
app.config.globalProperties.$session = session;
app.config.globalProperties.$toast = toast;
app.config.globalProperties.$confirm = confirm;
app.config.globalProperties.$tasks = tasks;
app.config.globalProperties.$format = format;

// Session expired on the server: go back to the login screen.
onApiEvent('unauthorized', () => {
  session.clear();

  if (!router.currentRoute.value.meta.public) {
    router.push({ name: 'login', query: { redirect: router.currentRoute.value.fullPath } });
  }
});

app.use(router);
app.mount('#app');
