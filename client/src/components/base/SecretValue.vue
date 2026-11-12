<template>
  <span class="secret-value">
    <code class="secret-text">{{ displayed }}</code>
    <button
      type="button"
      class="btn btn-ghost btn-icon btn-sm"
      :title="visibilityTitle"
      :disabled="loading"
      @click="toggle"
    >
      <span v-if="loading" class="spinner"></span>
      <FeatherIcon v-else-if="visible" name="eye-off" :size="15" />
      <FeatherIcon v-else name="eye" :size="15" />
    </button>
    <CopyButton v-if="visible && value" :value="value" />
  </span>
</template>

<script>
/**
 * A masked secret with reveal + copy buttons.
 *
 * When `value` is null, clicking the eye emits `reveal` so the parent can
 * fetch the secret on demand (reveals are audited server side).
 */
export default {
  name: 'SecretValue',
  props: {
    value: {
      type: String,
      default: null,
    },
    loading: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['reveal'],
  data() {
    return {
      visible: false,
    };
  },
  computed: {
    displayed() {
      if (this.visible && this.value) {
        return this.value;
      }

      return '••••••••••••••••';
    },
    visibilityTitle() {
      if (this.visible) {
        return 'Hide';
      }

      return 'Reveal';
    },
  },
  watch: {
    value(newValue) {
      if (newValue) {
        this.visible = true;
      }
    },
  },
  methods: {
    toggle() {
      if (this.visible) {
        this.visible = false;
        return;
      }

      if (this.value === null) {
        this.$emit('reveal');
        return;
      }

      this.visible = true;
    },
  },
};
</script>

<style>
.secret-value {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 100%;
}

.secret-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  word-break: normal;
}
</style>
