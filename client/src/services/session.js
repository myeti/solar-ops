/**
 * Current session state, shared by every component as `this.$session`.
 */
import { reactive } from 'vue';
import api from './api.js';

const session = reactive({
  loaded: false,
  setupRequired: false,
  authMethod: 'password',
  admin: null,

  get authenticated() {
    return this.admin !== null;
  },

  /**
   * Ask the server who we are.
   */
  async refresh() {
    const status = await api.get('/auth/status');

    this.setupRequired = status.setupRequired;
    this.authMethod = status.authMethod;
    this.admin = status.admin;
    this.loaded = true;

    return status;
  },

  /**
   * Store the admin returned by a successful login.
   */
  setAdmin(admin) {
    this.admin = admin;
    this.setupRequired = false;
  },

  async logout() {
    try {
      await api.post('/auth/logout');
    } finally {
      this.admin = null;
    }
  },

  /** Forget the admin locally (session expired server side). */
  clear() {
    this.admin = null;
  },
});

export default session;
