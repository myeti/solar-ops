<template>
  <section class="panel">
    <header class="panel-header">
      <span class="panel-icon"><FeatherIcon name="activity" :size="15" /></span>
      <h3>System health</h3>
      <span class="spacer"></span>
      <button type="button" class="btn btn-ghost btn-sm" :disabled="loading" title="Check again" @click="load">
        <FeatherIcon name="refresh-cw" :size="14" />
      </button>
      <RouterLink to="/settings/system" class="small">Details</RouterLink>
    </header>
    <div class="panel-body">
      <OrbitLoader v-if="!health" inline label="Checking…" />
      <div v-else class="health-grid">
        <div v-for="check in health.checks" :key="check.id" class="health-item" :title="check.message">
          <FeatherIcon v-if="check.ok" name="check-circle" :size="16" class="text-success" />
          <FeatherIcon v-else name="alert-circle" :size="16" class="text-danger" />
          <span class="health-item-text">
            <span>{{ check.label }}</span>
            <span class="tiny text-faint">{{ check.purpose }}</span>
          </span>
        </div>
      </div>
    </div>
  </section>
</template>

<script>
/**
 * What the server needs for SolarOps to work (nginx, pm2, certbot,
 * PostgreSQL...), one check each.
 */
export default {
  name: 'SystemHealthPanel',
  data() {
    return {
      health: null,
      loading: false,
    };
  },
  mounted() {
    this.load();
  },
  methods: {
    async load() {
      this.loading = true;

      try {
        this.health = await this.$api.get('/system/health');
      } catch (error) {
        this.health = { checks: [] };
        this.$toast.error(error);
      } finally {
        this.loading = false;
      }
    },
  },
};
</script>

<style>
.health-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 8px;
}

.health-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--surface-sunken);
  border: 1px solid var(--border);
}

.health-item-text {
  display: flex;
  flex-direction: column;
  font-size: 13px;
  line-height: 1.3;
}
</style>
