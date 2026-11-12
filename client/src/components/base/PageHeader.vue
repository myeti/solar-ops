<template>
  <header class="page-header">
    <div class="page-header-main">
      <slot name="before"></slot>
      <div class="page-header-text">
        <div v-if="eyebrow" class="eyebrow">{{ eyebrow }}</div>
        <h1 class="page-title">
          <slot name="title">{{ title }}</slot>
        </h1>
        <p v-if="subtitle || $slots.subtitle" class="page-subtitle">
          <slot name="subtitle">{{ subtitle }}</slot>
        </p>
      </div>
    </div>
    <div v-if="$slots.actions" class="page-header-actions">
      <slot name="actions"></slot>
    </div>
  </header>
</template>

<script>
/**
 * Title area at the top of every page. `eyebrow` names the parent section.
 */
export default {
  name: 'PageHeader',
  props: {
    eyebrow: {
      type: String,
      default: '',
    },
    title: {
      type: String,
      default: '',
    },
    subtitle: {
      type: String,
      default: '',
    },
  },
};
</script>

<style>
.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
  margin-bottom: 24px;
}

.page-header-main {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
}

.page-header-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.page-title {
  font-size: 26px;
  font-weight: 600;
  letter-spacing: -0.025em;
  line-height: 1.2;
  overflow-wrap: anywhere;
}

.page-subtitle {
  color: var(--text-dim);
  font-size: 14px;
}

.page-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
