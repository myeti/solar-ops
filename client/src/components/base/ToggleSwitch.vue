<template>
  <label class="toggle" :class="{ disabled }">
    <button
      type="button"
      role="switch"
      class="toggle-track"
      :class="{ on: modelValue }"
      :aria-checked="String(modelValue)"
      :disabled="disabled"
      @click="toggle"
    >
      <span class="toggle-thumb"></span>
    </button>
    <span v-if="label || $slots.default" class="toggle-text">
      <span class="toggle-label">
        <slot>{{ label }}</slot>
      </span>
      <span v-if="hint" class="toggle-hint">{{ hint }}</span>
    </span>
  </label>
</template>

<script>
/**
 * On / off switch, usable with v-model.
 *
 * Usage: <ToggleSwitch v-model="form.enabled" label="Enabled" hint="..." />
 */
export default {
  name: 'ToggleSwitch',
  props: {
    modelValue: {
      type: Boolean,
      default: false,
    },
    label: {
      type: String,
      default: '',
    },
    hint: {
      type: String,
      default: '',
    },
    disabled: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['update:modelValue', 'change'],
  methods: {
    toggle() {
      if (this.disabled) {
        return;
      }

      const next = !this.modelValue;
      this.$emit('update:modelValue', next);
      this.$emit('change', next);
    },
  },
};
</script>

<style>
.toggle {
  display: inline-flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
  user-select: none;
}

.toggle.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.toggle-track {
  position: relative;
  flex-shrink: 0;
  width: 34px;
  height: 20px;
  margin-top: 1px;
  padding: 0;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  background: rgba(255, 255, 255, 0.08);
  cursor: inherit;
  transition:
    background 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.toggle-track:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-ring);
}

.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #d4d4d8;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
  transition:
    transform 0.2s cubic-bezier(0.3, 1.3, 0.5, 1),
    background 0.2s ease;
}

.toggle-track.on {
  border-color: transparent;
  background: var(--accent);
}

.toggle-track.on .toggle-thumb {
  transform: translateX(14px);
  background: #fff;
}

.toggle-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.toggle-label {
  font-size: 13.5px;
  font-weight: 500;
}

.toggle-hint {
  font-size: 12px;
  color: var(--text-faint);
}
</style>
