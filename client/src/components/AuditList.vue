<template>
  <div>
    <div v-if="entries.length === 0" class="text-faint small audit-empty">Nothing logged yet.</div>
    <ul v-else class="list-plain">
      <li v-for="entry in entries" :key="entry.id" class="list-row audit-row">
        <span class="icon-bubble" :class="appearance(entry).tone">
          <FeatherIcon :name="appearance(entry).icon" :size="15" />
        </span>
        <span class="audit-text">
          <span class="audit-sentence">
            <strong>{{ entry.actor }}</strong>
            {{ appearance(entry).label.toLowerCase() }}
            <span v-if="entry.target" class="audit-target">{{ entry.target }}</span>
          </span>
          <span class="tiny text-faint">
            {{ $format.timeAgo(entry.createdAt) }}
            <span v-if="entry.ip"> · {{ entry.ip }}</span>
          </span>
        </span>
      </li>
    </ul>
  </div>
</template>

<script>
/**
 * Audit journal entries ("who did what, when").
 */
import { auditAppearance } from '../services/labels.js';

export default {
  name: 'AuditList',
  props: {
    entries: {
      type: Array,
      default: () => [],
    },
  },
  methods: {
    appearance(entry) {
      return auditAppearance(entry.action);
    },
  },
};
</script>

<style>
.audit-empty {
  padding: 18px 0;
}

.audit-row {
  align-items: flex-start;
  padding: 11px 0;
}

.audit-row .icon-bubble {
  width: 32px;
  height: 32px;
  border-radius: 10px;
}

.audit-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  font-size: 14px;
}

.audit-sentence {
  overflow-wrap: anywhere;
  color: var(--text-dim);
}

.audit-sentence strong {
  color: var(--text);
  font-weight: 500;
}

.audit-target {
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 13px;
}
</style>
