<template>
  <div class="loader" :class="{ inline }" role="status">
    <span class="loader-ring"></span>
    <span v-if="label" class="loader-label">{{ label }}</span>
  </div>
</template>

<script>
/**
 * Loading indicator: a thin ring with a moving arc.
 */
export default {
  name: 'OrbitLoader',
  props: {
    label: {
      type: String,
      default: '',
    },
    inline: {
      type: Boolean,
      default: false,
    },
  },
};
</script>

<style>
.loader {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 56px 0;
}

.loader.inline {
  flex-direction: row;
  padding: 0;
  gap: 10px;
}

.loader-ring {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-top-color: var(--accent-strong);
  animation: spin 0.8s linear infinite;
}

.loader.inline .loader-ring {
  width: 16px;
  height: 16px;
}

.loader-label {
  font-size: 13px;
  color: var(--text-dim);
}
</style>
