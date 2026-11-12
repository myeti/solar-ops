<template>
  <div class="auth-scene">
    <div class="auth-brand fade-up">
      <div class="auth-logo">
        <BrandMark :size="72" />
      </div>
      <h1 class="auth-wordmark">SolarOps</h1>
      <p class="auth-tagline">{{ tagline }}</p>
    </div>

    <section class="auth-card panel fade-up">
      <div class="panel-body stack-lg">
        <div class="stack-sm">
          <h2 class="auth-title">{{ title }}</h2>
          <p v-if="subtitle" class="text-dim small">{{ subtitle }}</p>
        </div>
        <slot></slot>
      </div>
    </section>

    <p class="auth-footnote tiny text-faint">
      <FeatherIcon name="lock" :size="12" />
      Secure access
    </p>
  </div>
</template>

<script>
/**
 * Shared layout of the login, setup and magic link pages: the brand mark
 * above a glass card.
 */
export default {
  name: 'AuthScene',
  props: {
    title: {
      type: String,
      required: true,
    },
    subtitle: {
      type: String,
      default: '',
    },
    tagline: {
      type: String,
      default: 'Every project in its own orbit.',
    },
  },
};
</script>

<style>
.auth-scene {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 28px;
  min-height: 100vh;
  padding: 48px 20px;
}

.auth-brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
}

/* A soft sunlight halo behind the logo. */
.auth-logo {
  position: relative;
  display: grid;
  place-items: center;
  width: 112px;
  height: 112px;
  margin-bottom: 6px;
}

.auth-logo::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 143, 90, 0.22), rgba(229, 72, 127, 0.08) 45%, transparent 70%);
  filter: blur(6px);
}

.auth-wordmark {
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.03em;
}

.auth-tagline {
  font-size: 14px;
  color: var(--text-dim);
}

.auth-card {
  width: 100%;
  max-width: 400px;
  animation-delay: 0.06s;
}

.auth-title {
  font-size: 18px;
}

.auth-footnote {
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
