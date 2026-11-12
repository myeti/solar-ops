<template>
  <button
    type="button"
    class="btn btn-ghost btn-icon btn-sm copy-button"
    :class="{ copied }"
    :title="title"
    :disabled="!value"
    @click="copy"
  >
    <FeatherIcon v-if="copied" name="check" :size="15" />
    <FeatherIcon v-else name="copy" :size="15" />
  </button>
</template>

<script>
/**
 * Copy a value to the clipboard, with visual feedback.
 */
export default {
  name: 'CopyButton',
  props: {
    value: {
      type: String,
      default: '',
    },
    title: {
      type: String,
      default: 'Copy to clipboard',
    },
  },
  data() {
    return {
      copied: false,
    };
  },
  methods: {
    async copy() {
      try {
        await this.writeClipboard(this.value);
        this.copied = true;
        setTimeout(() => {
          this.copied = false;
        }, 1500);
      } catch {
        this.$toast.error('Could not copy to the clipboard.');
      }
    },

    /**
     * Clipboard API when available (HTTPS / localhost), legacy fallback otherwise.
     */
    async writeClipboard(text) {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
      }

      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.className = 'sr-only';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    },
  },
};
</script>

<style>
.copy-button.copied {
  color: var(--success);
}
</style>
