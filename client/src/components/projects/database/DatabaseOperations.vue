<template>
  <section class="panel">
    <header class="panel-header">
      <span class="panel-icon"><FeatherIcon name="tool" :size="17" /></span>
      <h3>Operations</h3>
    </header>
    <div class="panel-body stack">
      <div class="database-action">
        <div>
          <strong>Dump</strong>
          <p class="small text-dim">Snapshot into <code>db/</code> (pg_dump custom format).</p>
        </div>
        <button type="button" class="btn" :disabled="!database.enabled" @click="dump">
          <FeatherIcon name="archive" :size="16" />
          Dump now
        </button>
      </div>
      <div class="database-action">
        <div>
          <strong>Rotate password</strong>
          <p class="small text-dim">New password for the role. Restart the project afterwards.</p>
        </div>
        <button type="button" class="btn" :disabled="!database.enabled" @click="rotatePassword">
          <FeatherIcon name="refresh-cw" :size="16" />
          Rotate
        </button>
      </div>
      <div v-if="database.enabled" class="database-action">
        <div>
          <strong>Disable</strong>
          <p class="small text-dim">Stop providing DB_* variables. Data is kept.</p>
        </div>
        <button type="button" class="btn" @click="disable">
          <FeatherIcon name="pause" :size="16" />
          Disable
        </button>
      </div>
      <div class="divider"></div>
      <div v-if="database.adopted" class="database-action">
        <div>
          <strong>Unlink</strong>
          <p class="small text-dim">Forget the credentials. The database, its role and data stay on the server.</p>
        </div>
        <button type="button" class="btn" @click="unlink">
          <FeatherIcon name="scissors" :size="16" />
          Unlink
        </button>
      </div>
      <template v-else>
        <div class="database-action">
          <div>
            <strong class="text-danger">Wipe</strong>
            <p class="small text-dim">Drop and re-create the database, empty.</p>
          </div>
          <button type="button" class="btn btn-danger" :disabled="!database.enabled" @click="wipe">
            <FeatherIcon name="trash" :size="16" />
            Wipe
          </button>
        </div>
        <div class="database-action">
          <div>
            <strong class="text-danger">Drop</strong>
            <p class="small text-dim">Delete the database and its role for good.</p>
          </div>
          <button type="button" class="btn btn-danger" @click="drop">
            <FeatherIcon name="trash-2" :size="16" />
            Drop
          </button>
        </div>
      </template>
    </div>
  </section>
</template>

<script>
/**
 * Operations on the project database: dump, password rotation, disable,
 * and unlink (linked databases) or wipe / drop (databases SolarOps created).
 * Emits `credentials-changed` when revealed credentials become stale.
 */
import { suggestRestart } from './restartHint.js';

export default {
  name: 'DatabaseOperations',
  props: {
    project: {
      type: Object,
      required: true,
    },
  },
  emits: ['refresh', 'credentials-changed'],
  computed: {
    database() {
      return this.project.database;
    },
  },
  methods: {
    endpoint(path) {
      return `/projects/${this.project.uid}/database${path}`;
    },
    async unlink() {
      const confirmed = await this.$confirm({
        title: `Unlink ${this.database.name}?`,
        message:
          'SolarOps forgets the credentials and stops providing DB_* variables. The database, its role and data stay on the server.',
        confirmText: 'Unlink',
        icon: 'scissors',
      });

      if (!confirmed) {
        return;
      }

      try {
        await this.$api.post(this.endpoint('/unlink'));
        this.$emit('credentials-changed');
        this.$toast.success('Database unlinked. It is still on the server.');
        suggestRestart(this);
        this.$emit('refresh');
      } catch (error) {
        this.$toast.error(error);
      }
    },
    async disable() {
      try {
        await this.$api.post(this.endpoint('/disable'));
        this.$toast.success('Database variables disabled. The data is kept.');
        suggestRestart(this);
        this.$emit('refresh');
      } catch (error) {
        this.$toast.error(error);
      }
    },
    async dump() {
      try {
        const { task } = await this.$api.post(this.endpoint('/dumps'));
        this.$tasks.open(task.id);
      } catch (error) {
        this.$toast.error(error);
      }
    },
    async rotatePassword() {
      let message = 'The project keeps the old password until it restarts.';

      if (this.database.adopted) {
        message = `Every application connecting as ${this.database.user} (not only this project) must use the new password afterwards.`;
      }

      const confirmed = await this.$confirm({
        title: 'Rotate the database password?',
        message,
        confirmText: 'Rotate',
        icon: 'key',
      });

      if (!confirmed) {
        return;
      }

      try {
        await this.$api.post(this.endpoint('/rotate-password'));
        this.$emit('credentials-changed');
        this.$toast.success('Password rotated.');
        suggestRestart(this);
      } catch (error) {
        this.$toast.error(error);
      }
    },
    async wipe() {
      const confirmed = await this.$confirm({
        title: 'Wipe the database?',
        message: `Every table and row of ${this.database.name} will be deleted. Consider dumping it first.`,
        confirmText: 'Wipe everything',
        danger: true,
        requireText: this.project.uid,
        icon: 'trash',
      });

      if (!confirmed) {
        return;
      }

      try {
        const { task } = await this.$api.post(this.endpoint('/wipe'), { confirm: this.project.uid });
        this.$tasks.open(task.id);
      } catch (error) {
        this.$toast.error(error);
      }
    },
    async drop() {
      const confirmed = await this.$confirm({
        title: 'Drop the database and its role?',
        message: `${this.database.name} and the role ${this.database.user} will be deleted for good. Dumps in db/ are kept.`,
        confirmText: 'Drop',
        danger: true,
        requireText: this.project.uid,
        icon: 'trash-2',
      });

      if (!confirmed) {
        return;
      }

      try {
        await this.$api.post(this.endpoint('/drop'), { confirm: this.project.uid });
        this.$emit('credentials-changed');
        this.$toast.success('Database dropped.');
        this.$emit('refresh');
      } catch (error) {
        this.$toast.error(error);
      }
    },
  },
};
</script>

<style>
.database-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
</style>
