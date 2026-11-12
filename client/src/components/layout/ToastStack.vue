<template>
  <div class="toast-stack" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="item in state.items" :key="item.id" class="toast" :class="`toast-${item.type}`">
        <FeatherIcon :name="iconFor(item.type)" :size="18" class="toast-icon" />
        <span class="toast-message">{{ item.message }}</span>
        <button type="button" class="btn btn-ghost btn-icon btn-sm" title="Dismiss" @click="dismiss(item.id)">
          <FeatherIcon name="x" :size="14" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<script>
/**
 * Notification stack (bottom right), fed by this.$toast.
 */
import { dismissToast, toastState } from '../../services/ui.js';

const ICONS = {
  success: 'check-circle',
  error: 'alert-octagon',
  warning: 'alert-triangle',
  info: 'info',
};

export default {
  name: 'ToastStack',
  data() {
    return {
      state: toastState,
    };
  },
  methods: {
    iconFor(type) {
      return ICONS[type] || 'info';
    },
    dismiss(id) {
      dismissToast(id);
    },
  },
};
</script>

<style>
.toast-stack {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 200;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(400px, calc(100vw - 40px));
}

.toast {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 11px 8px 11px 14px;
  border-radius: 12px;
  border: 1px solid var(--border-strong);
  background: var(--surface-strong);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  box-shadow: var(--shadow-overlay);
  font-size: 13.5px;
}

.toast-icon {
  margin-top: 2px;
}

.toast-message {
  flex: 1;
  padding-top: 1px;
  overflow-wrap: anywhere;
  white-space: pre-line;
}

.toast-success .toast-icon {
  color: var(--success);
}

.toast-error {
  border-color: rgba(248, 113, 113, 0.35);
}

.toast-error .toast-icon {
  color: var(--danger);
}

.toast-warning .toast-icon {
  color: var(--warning);
}

.toast-info .toast-icon {
  color: var(--accent-strong);
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(16px);
}
</style>
