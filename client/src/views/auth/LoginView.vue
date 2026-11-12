<template>
  <AuthScene v-if="isMagicLink" title="Sign in" :subtitle="magicSubtitle">
    <div v-if="magicSent" class="callout callout-success">
      <FeatherIcon name="send" class="icon" />
      <span>{{ magicSentMessage }}</span>
    </div>
    <form v-else class="stack" @submit.prevent="requestMagicLink">
      <FormField label="E-mail" :error="error">
        <input v-model="email" class="input" type="email" autocomplete="username" required autofocus />
      </FormField>
      <button type="submit" class="btn btn-primary btn-lg btn-block" :disabled="busy">
        <span v-if="busy" class="spinner"></span>
        Send me a login link
      </button>
    </form>
    <button v-if="magicSent" type="button" class="btn btn-ghost btn-sm" @click="magicSent = false">
      Use another e-mail
    </button>
  </AuthScene>

  <AuthScene v-else title="Sign in" subtitle="Welcome back.">
    <form class="stack" @submit.prevent="login">
      <FormField label="E-mail">
        <input v-model="email" class="input" type="email" autocomplete="username" required autofocus />
      </FormField>
      <FormField label="Password" :error="error">
        <input v-model="password" class="input" type="password" autocomplete="current-password" required />
      </FormField>
      <button type="submit" class="btn btn-primary btn-lg btn-block" :disabled="busy">
        <span v-if="busy" class="spinner"></span>
        Sign in
      </button>
    </form>
    <p class="tiny text-faint">Lost your password? Ask another administrator to reset it.</p>
  </AuthScene>
</template>

<script>
/**
 * Login page: e-mail + password, or magic link depending on the settings.
 */
import AuthScene from './AuthScene.vue';

export default {
  name: 'LoginView',
  components: { AuthScene },
  data() {
    return {
      email: '',
      password: '',
      error: '',
      busy: false,
      magicSent: false,
      magicSentMessage: '',
    };
  },
  computed: {
    isMagicLink() {
      return this.$session.authMethod === 'magic-link';
    },
    magicSubtitle() {
      return 'We will send a single-use login link to your inbox.';
    },
  },
  methods: {
    redirectAfterLogin() {
      let target = '/';
      const redirect = this.$route.query.redirect;

      // Only follow local paths (no open redirect).
      if (typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//')) {
        target = redirect;
      }

      this.$router.push(target);
    },

    async login() {
      this.busy = true;
      this.error = '';

      try {
        const { admin } = await this.$api.post('/auth/login', { email: this.email, password: this.password });
        this.$session.setAdmin(admin);
        this.redirectAfterLogin();
      } catch (error) {
        this.error = error.message;
        this.password = '';
      } finally {
        this.busy = false;
      }
    },

    async requestMagicLink() {
      this.busy = true;
      this.error = '';

      try {
        const { message } = await this.$api.post('/auth/magic-link', { email: this.email });
        this.magicSentMessage = message;
        this.magicSent = true;
      } catch (error) {
        this.error = error.message;
      } finally {
        this.busy = false;
      }
    },
  },
};
</script>
