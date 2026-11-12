<template>
  <section class="panel">
    <header class="panel-header">
      <span class="panel-icon"><FeatherIcon name="code" :size="17" /></span>
      <h3>nginx configuration</h3>
      <span class="spacer"></span>
      <button type="button" class="btn btn-sm btn-ghost" @click="$emit('reapply')">
        <FeatherIcon name="upload" :size="14" />
        Re-apply
      </button>
      <button type="button" class="btn btn-sm" @click="togglePreview">
        <FeatherIcon :name="previewIcon" :size="14" />
        {{ previewLabel }}
      </button>
    </header>
    <div v-if="preview !== null" class="panel-body stack">
      <p class="tiny text-faint">
        Written to <code>{{ project.path }}/etc/nginx.conf</code> and loaded by nginx through
        <code>{{ preview.includeDirective }}</code>
      </p>
      <div class="terminal">
        <pre class="terminal-body">{{ preview.config || '# Not served (project inactive or network disabled)' }}</pre>
      </div>
    </div>
  </section>
</template>

<script>
/**
 * Generated nginx configuration of a project (shown on demand). The parent
 * bumps `version` after a change so an open preview is reloaded.
 */
export default {
  name: 'NginxPreviewPanel',
  props: {
    project: {
      type: Object,
      required: true,
    },
    version: {
      type: Number,
      default: 0,
    },
  },
  emits: ['reapply'],
  data() {
    return {
      preview: null,
    };
  },
  computed: {
    previewIcon() {
      if (this.preview === null) {
        return 'eye';
      }

      return 'eye-off';
    },
    previewLabel() {
      if (this.preview === null) {
        return 'Show';
      }

      return 'Hide';
    },
  },
  watch: {
    version() {
      if (this.preview !== null) {
        this.loadPreview();
      }
    },
  },
  methods: {
    async togglePreview() {
      if (this.preview !== null) {
        this.preview = null;
        return;
      }

      await this.loadPreview();
    },
    async loadPreview() {
      try {
        this.preview = await this.$api.get(`/projects/${this.project.uid}/network/preview`);
      } catch (error) {
        this.$toast.error(error);
      }
    },
  },
};
</script>
