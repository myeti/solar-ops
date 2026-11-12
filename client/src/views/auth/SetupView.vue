<template>
  <AuthScene
    title="Create the first admin"
    subtitle="Use the one-time setup token printed in the SolarOps logs at startup."
    tagline="Let's set up your server."
  >
    <form class="stack" @submit.prevent="submit">
      <FormField label="Setup token" :error="errors.token">
        <input v-model="form.token" class="input mono" autocomplete="off" spellcheck="false" required autofocus />
      </FormField>
      <FormField label="E-mail" :error="errors.email">
        <input v-model="form.email" class="input" type="email" autocomplete="username" required />
      </FormField>
      <FormField
        label="Password"
        :error="errors.password"
        hint="At least 12 characters, mixing letters, digits or symbols."
      >
        <input v-model="form.password" class="input" type="password" autocomplete="new-password" required />
      </FormField>
      <div v-if="error && !hasFieldErrors" class="callout callout-danger">
        <FeatherIcon name="alert-octagon" class="icon" />
        <span>{{ error }}</span>
      </div>
      <button type="submit" class="btn btn-primary btn-lg btn-block" :disabled="busy">
        <span v-if="busy" class="spinner"></span>
        Create admin account
      </button>
    </form>
  </AuthScene>
</template>

<script>
/**
 * First-run setup: create the first admin account.
 */
import AuthScene from './AuthScene.vue';

export default {
  name: 'SetupView',
  components: { AuthScene },
  data() {
    return {
      form: {
        token: '',
        email: '',
        password: '',
      },
      errors: {},
      error: '',
      busy: false,
    };
  },
  computed: {
    hasFieldErrors() {
      return Object.keys(this.errors).length > 0;
    },
  },
  methods: {
    async submit() {
      this.busy = true;
      this.errors = {};
      this.error = '';

      try {
        const { admin } = await this.$api.post('/auth/setup', this.form);
        this.$session.setAdmin(admin);
        this.$toast.success('Welcome! SolarOps is ready.');
        this.$router.push('/');
      } catch (error) {
        this.errors = error.fields;
        this.error = error.message;
      } finally {
        this.busy = false;
      }
    },
  },
};
</script>
