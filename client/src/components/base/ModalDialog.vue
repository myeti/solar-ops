<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="modal-backdrop" @mousedown.self="close">
        <div
          ref="dialog"
          class="modal panel"
          :class="`modal-${width}`"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
        >
          <header class="modal-header">
            <span v-if="icon" class="panel-icon">
              <FeatherIcon :name="icon" :size="17" />
            </span>
            <h3>{{ title }}</h3>
            <span class="spacer"></span>
            <button type="button" class="btn btn-ghost btn-icon btn-sm" title="Close" @click="close">
              <FeatherIcon name="x" :size="17" />
            </button>
          </header>
          <div class="modal-body">
            <slot></slot>
          </div>
          <footer v-if="$slots.footer" class="modal-footer">
            <slot name="footer"></slot>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script>
/**
 * Modal dialog. Closes with Escape or a click on the backdrop.
 *
 * Usage:
 *   <ModalDialog :open="showForm" title="New account" icon="mail" @close="showForm = false">
 *     ...content...
 *     <template #footer>...buttons...</template>
 *   </ModalDialog>
 */
export default {
  name: 'ModalDialog',
  props: {
    open: {
      type: Boolean,
      default: false,
    },
    title: {
      type: String,
      default: '',
    },
    icon: {
      type: String,
      default: '',
    },
    /** md | lg | xl */
    width: {
      type: String,
      default: 'md',
    },
  },
  emits: ['close'],
  watch: {
    open: {
      immediate: true,
      handler(isOpen) {
        if (isOpen) {
          document.addEventListener('keydown', this.onKeydown);
          this.$nextTick(() => this.focusFirstField());
        } else {
          document.removeEventListener('keydown', this.onKeydown);
        }
      },
    },
  },
  beforeUnmount() {
    document.removeEventListener('keydown', this.onKeydown);
  },
  methods: {
    close() {
      this.$emit('close');
    },
    onKeydown(event) {
      if (event.key === 'Escape') {
        this.close();
      }
    },
    focusFirstField() {
      if (!this.$refs.dialog) {
        return;
      }

      const field = this.$refs.dialog.querySelector('input:not([type=hidden]), select, textarea');

      if (field) {
        field.focus();
      }
    },
  },
};
</script>

<style>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  overflow-y: auto;
}

.modal {
  width: 100%;
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  background: var(--surface-strong);
  border-color: var(--border-strong);
  box-shadow: var(--shadow-overlay);
  backdrop-filter: blur(28px) saturate(160%);
  -webkit-backdrop-filter: blur(28px) saturate(160%);
}

.modal-md {
  max-width: 540px;
}

.modal-lg {
  max-width: 740px;
}

.modal-xl {
  max-width: 1000px;
}

.modal-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}

.modal-header h3 {
  font-size: 15px;
}

.modal-header .panel-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  color: var(--text-dim);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border);
}

.modal-body {
  padding: 18px;
  overflow-y: auto;
}

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--border);
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.18s ease;
}

.modal-enter-active .modal,
.modal-leave-active .modal {
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal,
.modal-leave-to .modal {
  transform: scale(0.97) translateY(6px);
}
</style>
