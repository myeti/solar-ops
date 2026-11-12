<template>
  <div class="empty-state">
    <div class="empty-state-icon">
      <FeatherIcon :name="icon" :size="20" />
    </div>
    <h3>{{ title }}</h3>
    <p v-if="$slots.default" class="text-dim">
      <slot></slot>
    </p>
    <div v-if="$slots.actions" class="row">
      <slot name="actions"></slot>
    </div>
  </div>
</template>

<script>
/**
 * Placeholder shown when a list is empty.
 */
export default {
  name: 'EmptyState',
  props: {
    icon: {
      type: String,
      default: 'compass',
    },
    title: {
      type: String,
      required: true,
    },
  },
};
</script>

<style>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 44px 24px;
  text-align: center;
}

.empty-state p {
  max-width: 440px;
  font-size: 13.5px;
}

.empty-state h3 {
  font-size: 15px;
}

.empty-state-icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  margin-bottom: 4px;
  border-radius: 12px;
  color: var(--text-dim);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-strong);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}
</style>
