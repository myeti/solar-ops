<template>
  <ModalDialog :open="state.open" :title="state.title" :icon="state.icon" @close="cancel">
    <div class="stack">
      <p v-if="state.message" class="confirm-message text-dim">{{ state.message }}</p>
      <FormField v-if="state.requireText" :label="`Type ${state.requireText} to confirm`">
        <input
          v-model="typed"
          class="input mono"
          autocomplete="off"
          spellcheck="false"
          :placeholder="state.requireText"
          @keydown.enter="submit"
        />
      </FormField>
    </div>
    <template #footer>
      <button type="button" class="btn" @click="cancel">Cancel</button>
      <button type="button" class="btn" :class="confirmClass" :disabled="!canConfirm" @click="submit">
        {{ state.confirmText }}
      </button>
    </template>
  </ModalDialog>
</template>

<script>
/**
 * Global confirmation dialog driven by this.$confirm(). Mounted once in App.vue.
 * With `requireText`, the user must type the given text (e.g. the project
 * uid) before confirming a destructive action.
 */
import { confirmState, settleConfirm } from '../../services/ui.js';

export default {
  name: 'ConfirmDialog',
  data() {
    return {
      state: confirmState,
      typed: '',
    };
  },
  computed: {
    canConfirm() {
      if (!this.state.requireText) {
        return true;
      }

      return this.typed.trim() === this.state.requireText;
    },
    confirmClass() {
      if (this.state.danger) {
        return 'btn-danger';
      }

      return 'btn-primary';
    },
  },
  watch: {
    'state.open'(isOpen) {
      if (isOpen) {
        this.typed = '';
      }
    },
  },
  methods: {
    cancel() {
      settleConfirm(false);
    },
    submit() {
      if (!this.canConfirm) {
        return;
      }

      settleConfirm(true);
    },
  },
};
</script>

<style>
.confirm-message {
  white-space: pre-line;
}
</style>
