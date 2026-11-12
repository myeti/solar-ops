<template>
  <form class="panel" @submit.prevent="save">
    <header class="panel-header">
      <span class="panel-icon"><FeatherIcon name="calendar" :size="17" /></span>
      <h3>Scheduled backups</h3>
      <span class="spacer"></span>
      <ToggleSwitch v-model="form.enabled" label="Automatic dumps" />
    </header>

    <div v-if="!form.enabled" class="panel-body">
      <p class="text-dim small">
        Off. Turn it on to dump the database into <code>db/</code> every day or every week, keeping only the most recent
        automatic dumps. Manual dumps are never deleted.
      </p>
    </div>

    <div v-else class="panel-body stack">
      <div class="form-grid">
        <FormField label="Frequency" :error="errors.frequency">
          <select v-model="form.frequency" class="select">
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
          </select>
        </FormField>
        <FormField v-if="form.frequency === 'weekly'" label="Day" :error="errors.weekday">
          <select v-model.number="form.weekday" class="select">
            <option v-for="(day, index) in weekdays" :key="day" :value="index">{{ day }}</option>
          </select>
        </FormField>
        <FormField label="Time" :error="errors.hour" :hint="timeHint">
          <select v-model.number="form.hour" class="select">
            <option v-for="hour in hours" :key="hour" :value="hour">{{ hourLabel(hour) }}</option>
          </select>
        </FormField>
        <FormField label="Keep" :error="errors.keep" hint="Most recent automatic dumps kept; older ones are deleted.">
          <input v-model.number="form.keep" class="input mono" type="number" min="1" max="90" />
        </FormField>
      </div>
      <p v-if="!project.database.enabled" class="small text-warning">
        The database is disabled: no backup runs until it is re-enabled.
      </p>
    </div>

    <footer class="panel-footer">
      <span class="tiny text-faint">{{ summary }}</span>
      <span class="spacer"></span>
      <button type="submit" class="btn btn-primary" :disabled="saving || !isDirty">
        <span v-if="saving" class="spinner"></span>
        <FeatherIcon v-else name="save" :size="16" />
        Save
      </button>
    </footer>
  </form>
</template>

<script>
/**
 * Scheduled backups of the project database (off by default): frequency,
 * time (server time zone) and how many automatic dumps are kept.
 */
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Editable copy of the backups configuration.
 */
function formFrom(backups) {
  return {
    enabled: backups.enabled,
    frequency: backups.frequency,
    hour: backups.hour,
    weekday: backups.weekday,
    keep: backups.keep,
  };
}

export default {
  name: 'DatabaseBackups',
  props: {
    project: {
      type: Object,
      required: true,
    },
  },
  emits: ['refresh'],
  data() {
    return {
      form: formFrom(this.project.database.backups),
      errors: {},
      saving: false,
      resync: false,
      schedule: null,
      weekdays: WEEKDAYS,
      hours: Array.from({ length: 24 }, (value, index) => index),
    };
  },
  computed: {
    backups() {
      return this.project.database.backups;
    },
    isDirty() {
      return JSON.stringify(this.form) !== JSON.stringify(formFrom(this.backups));
    },
    timeHint() {
      if (this.schedule) {
        return `Server time (${this.schedule.timeZone}).`;
      }

      return 'Server time.';
    },
    summary() {
      if (!this.backups.enabled) {
        return 'No scheduled backup.';
      }

      const parts = [];

      if (this.schedule && this.schedule.nextRunAt) {
        parts.push(`Next: ${this.$format.dateTime(this.schedule.nextRunAt)}`);
      }

      if (this.backups.lastRunAt) {
        parts.push(`last: ${this.$format.timeAgo(this.backups.lastRunAt)}`);
      } else {
        parts.push('none yet');
      }

      return parts.join(' · ');
    },
  },
  watch: {
    /**
     * The page refreshes the project every 10 seconds: follow the server
     * only when the form holds no unsaved edit (or right after a save).
     */
    'project.database.backups': {
      deep: true,
      handler(backups, previous) {
        const untouched = JSON.stringify(this.form) === JSON.stringify(formFrom(previous));

        if (untouched || this.resync) {
          this.resync = false;
          this.form = formFrom(backups);
        }
      },
    },
  },
  mounted() {
    this.loadSchedule();
  },
  methods: {
    endpoint() {
      return `/projects/${this.project.uid}/database/backups`;
    },
    hourLabel(hour) {
      return `${String(hour).padStart(2, '0')}:00`;
    },
    async loadSchedule() {
      try {
        this.schedule = await this.$api.get(this.endpoint());
      } catch (error) {
        this.$toast.error(error);
      }
    },
    async save() {
      this.saving = true;
      this.errors = {};

      try {
        this.schedule = await this.$api.put(this.endpoint(), this.form);

        if (this.form.enabled) {
          this.$toast.success(`Scheduled backups on. Next: ${this.$format.dateTime(this.schedule.nextRunAt)}.`);
        } else {
          this.$toast.success('Scheduled backups off. Existing dumps are kept.');
        }

        this.resync = true;
        this.$emit('refresh');
      } catch (error) {
        this.errors = error.fields;
        this.$toast.error(error);
      } finally {
        this.saving = false;
      }
    },
  },
};
</script>
