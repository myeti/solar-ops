<template>
  <div class="not-found">
    <div class="not-found-code">404</div>
    <h1>Page not found</h1>
    <p class="text-dim">This page does not exist, or has moved.</p>
    <RouterLink to="/" class="btn btn-primary">
      <FeatherIcon name="arrow-left" :size="15" />
      Back to the dashboard
    </RouterLink>
  </div>
</template>

<script>
/**
 * Unknown route.
 */
export default {
  name: 'NotFoundView',
};
</script>

<style>
.not-found {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 96px 20px;
  text-align: center;
}

.not-found h1 {
  font-size: 22px;
}

.not-found-code {
  font-size: 72px;
  font-weight: 700;
  letter-spacing: -0.05em;
  line-height: 1;
  color: rgba(255, 255, 255, 0.1);
}
</style>
