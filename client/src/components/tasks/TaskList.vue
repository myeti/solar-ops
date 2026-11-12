<template>
  <div>
    <div v-if="tasks.length === 0" class="task-list-empty text-faint small">
      {{ emptyText }}
    </div>
    <ul v-else class="list-plain task-list">
      <li v-for="task in tasks" :key="task.id">
        <button type="button" class="task-row" @click="$tasks.open(task.id)">
          <span class="icon-bubble" :class="bubbleTone(task)">
            <FeatherIcon :name="typeIcon(task.type)" :size="16" />
          </span>
          <span class="task-row-main">
            <span class="task-row-title truncate">{{ task.title }}</span>
            <span class="task-row-meta tiny text-faint">
              <span v-if="showProject && task.project">{{ task.project.name }} ·</span>
              {{ triggerLabel(task) }} · {{ $format.timeAgo(task.createdAt) }}
              <span v-if="task.meta && task.meta.commit">
                · <span class="mono">{{ task.meta.commit.shortHash }}</span></span
              >
            </span>
          </span>
          <StatusPill :status="task.status" />
          <FeatherIcon name="chevron-right" :size="16" class="text-faint" />
        </button>
      </li>
    </ul>
  </div>
</template>

<script>
/**
 * Compact list of tasks. Clicking a task opens its live log.
 */
const TYPE_ICONS = {
  deploy: 'upload-cloud',
  pull: 'download-cloud',
  certificate: 'shield',
  'db-dump': 'archive',
  'db-backup': 'calendar',
  'db-restore': 'rotate-ccw',
  'db-wipe': 'trash-2',
};

export default {
  name: 'TaskList',
  props: {
    tasks: {
      type: Array,
      default: () => [],
    },
    showProject: {
      type: Boolean,
      default: false,
    },
    emptyText: {
      type: String,
      default: 'No operations yet.',
    },
  },
  methods: {
    typeIcon(type) {
      return TYPE_ICONS[type] || 'activity';
    },
    bubbleTone(task) {
      if (task.status === 'failed') {
        return 'red';
      }

      if (task.status === 'success') {
        return 'green';
      }

      return 'cyan';
    },
    triggerLabel(task) {
      if (task.trigger === 'webhook') {
        return 'via webhook';
      }

      if (task.trigger === 'schedule') {
        return 'scheduled';
      }

      if (task.triggeredBy) {
        return `by ${task.triggeredBy}`;
      }

      return task.trigger;
    },
  },
};
</script>

<style>
.task-list-empty {
  padding: 18px 0;
}

.task-row {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 12px 10px;
  margin: 0 -10px;
  width: calc(100% + 20px);
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease;
}

.task-row:hover {
  background: rgba(255, 255, 255, 0.04);
}

.task-row-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.task-row-title {
  font-size: 14px;
  font-weight: 500;
}
</style>
