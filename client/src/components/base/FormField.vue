<template>
  <div class="field" :class="{ 'has-error': Boolean(error) }">
    <label v-if="label" class="field-label" :for="inputId">
      {{ label }}
      <span v-if="optional" class="optional">(optional)</span>
    </label>
    <slot></slot>
    <span v-if="error" class="field-error">{{ error }}</span>
    <span v-else-if="hint || $slots.hint" class="field-hint">
      <slot name="hint">{{ hint }}</slot>
    </span>
  </div>
</template>

<script>
/**
 * Label + input + hint / error wrapper.
 *
 * Usage:
 *   <FormField label="Domain" :error="errors.domain" hint="e.g. app.example.com">
 *     <input v-model="form.domain" class="input" />
 *   </FormField>
 */
export default {
  name: 'FormField',
  props: {
    label: {
      type: String,
      default: '',
    },
    hint: {
      type: String,
      default: '',
    },
    error: {
      type: String,
      default: '',
    },
    optional: {
      type: Boolean,
      default: false,
    },
    inputId: {
      type: String,
      default: undefined,
    },
  },
};
</script>
