<template>
  <details class="env-details" @toggle="onEnvToggle">
    <summary class="env-summary">
      <FeatherIcon name="chevron-right" :size="15" class="env-chevron" />
      <span class="env-summary-title">Env vars</span>
      <span class="tiny text-faint">{{ envHint }}</span>
    </summary>
    <div class="env-content">
      <OrbitLoader v-if="env.loading" inline label="Loading…" />
      <div v-else-if="env.content !== null" class="terminal">
        <div class="terminal-header">
          <FeatherIcon name="file-text" :size="13" />
          <span>.env · {{ env.count }} variables · secrets redacted</span>
          <span class="spacer"></span>
          <CopyButton :value="env.content" title="Copy (redacted)" />
        </div>
        <!-- One inline span per line, ended by its own line break (blank lines included). -->
        <pre class="terminal-body env-dotenv"><span
          v-for="(line, index) in envLines"
          :key="index"
        ><span v-if="line.comment" class="env-comment">{{ line.text }}</span><template v-else-if="line.key"><span class="env-key">{{ line.key }}</span>=<span
            v-for="(segment, segmentIndex) in line.segments"
            :key="segmentIndex"
            :class="{ 'env-redacted': segment.redacted }"
          >{{ segment.text }}</span></template><template v-else>{{ line.text }}</template>
</span></pre>
      </div>
    </div>
  </details>
</template>

<script>
/**
 * The environment of a project as a .env file, secrets redacted by the
 * server. Closed by default, loaded each time it is opened.
 */

/** Mark used by the server in place of secret values. */
const REDACTED = '••••••••';

export default {
  name: 'EnvVarsDetails',
  props: {
    project: {
      type: Object,
      required: true,
    },
  },
  data() {
    return {
      env: {
        loading: false,
        content: null,
        count: 0,
      },
    };
  },
  computed: {
    envHint() {
      if (this.project.type === 'static') {
        return 'given to the install and build commands';
      }

      return 'given to the process at startup';
    },
    /**
     * .env lines split for display: comments, keys, and values cut around
     * the redaction marks (only "••••••••" is dimmed in a URL).
     */
    envLines() {
      const lines = this.env.content.replace(/\n$/, '').split('\n');

      return lines.map((text) => {
        if (text.startsWith('#')) {
          return { text, comment: true };
        }

        const separator = text.indexOf('=');

        if (separator === -1) {
          return { text };
        }

        const parts = text.slice(separator + 1).split(REDACTED);
        const segments = [];

        for (let index = 0; index < parts.length; index += 1) {
          if (index > 0) {
            segments.push({ text: REDACTED, redacted: true });
          }

          if (parts[index] !== '') {
            segments.push({ text: parts[index], redacted: false });
          }
        }

        return { text, key: text.slice(0, separator), segments };
      });
    },
  },
  methods: {
    /**
     * Load the variables when the section is opened (closed by default),
     * fresh each time.
     */
    async onEnvToggle(event) {
      if (!event.target.open) {
        return;
      }

      this.env.loading = true;

      try {
        const { content, count } = await this.$api.get(`/projects/${this.project.uid}/environment/dotenv`);
        this.env.content = content;
        this.env.count = count;
      } catch (error) {
        this.$toast.error(error);
      } finally {
        this.env.loading = false;
      }
    },
  },
};
</script>

<style>
.env-details {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}

.env-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  cursor: pointer;
  list-style: none;
  user-select: none;
}

.env-summary::-webkit-details-marker {
  display: none;
}

.env-summary-title {
  font-size: 13.5px;
  font-weight: 500;
}

.env-chevron {
  color: var(--text-faint);
  transition: transform 0.15s ease;
}

.env-details[open] .env-chevron {
  transform: rotate(90deg);
}

.env-content {
  margin-top: 12px;
}

.env-dotenv {
  max-height: 420px;
}

.env-comment {
  color: var(--text-faint);
}

.env-key {
  color: var(--accent-strong);
}

.env-redacted {
  color: var(--text-faint);
}
</style>
