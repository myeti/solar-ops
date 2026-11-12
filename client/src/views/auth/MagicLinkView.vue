<template>
  <AuthScene title="Signing you in">
    <OrbitLoader v-if="busy" label="Checking your link…" />
    <template v-else-if="error">
      <div class="callout callout-danger">
        <FeatherIcon name="alert-octagon" class="icon" />
        <span>{{ error }}</span>
      </div>
      <RouterLink to="/login" class="btn btn-primary btn-block">Request a new link</RouterLink>
    </template>
  </AuthScene>
</template>

<script>
/**
 * Landing page of magic login links. The token is exchanged through a POST
 * (not consumed by a simple GET), so e-mail link scanners cannot burn it.
 */
import AuthScene from './AuthScene.vue';

export default {
  name: 'MagicLinkView',
  components: { AuthScene },
  data() {
    return {
      busy: true,
      error: '',
    };
  },
  async mounted() {
    const token = String(this.$route.query.token || '');

    // Remove the token from the address bar and history.
    await this.$router.replace({ name: 'magic-link' });

    try {
      const { admin } = await this.$api.post('/auth/magic-link/verify', { token });
      this.$session.setAdmin(admin);
      this.$router.replace('/');
    } catch (error) {
      this.error = error.message;
      this.busy = false;
    }
  },
};
</script>
