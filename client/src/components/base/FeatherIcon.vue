<template>
  <!-- eslint-disable vue/no-v-html -- the inner SVG of a bundled feather icon, never user input -->
  <svg
    class="icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="content"
  ></svg>
  <!-- eslint-enable vue/no-v-html -->
</template>

<script>
/**
 * Feather icon (https://feathericons.com), rendered inline so it inherits
 * the text color. Icon contents come from the feather-icons package (static
 * markup, safe for v-html).
 *
 * Usage: <FeatherIcon name="globe" :size="16" />
 */
import icons from 'feather-icons/dist/icons.json';

export default {
  name: 'FeatherIcon',
  props: {
    name: {
      type: String,
      required: true,
    },
    size: {
      type: [Number, String],
      default: 18,
    },
    strokeWidth: {
      type: [Number, String],
      default: 2,
    },
  },
  computed: {
    content() {
      if (icons[this.name]) {
        return icons[this.name];
      }

      return icons.circle;
    },
  },
};
</script>

<style>
.icon {
  display: inline-block;
  flex-shrink: 0;
  vertical-align: middle;
}
</style>
