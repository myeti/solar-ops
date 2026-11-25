<template>
  <OrbitLoader v-if="!state" label="Loading…" />

  <div v-else class="stack-lg">
    <div v-if="!state.program" class="callout callout-warning">
      <FeatherIcon name="alert-triangle" class="icon" />
      <span>
        Redis is not installed on this server: run <code>npm run update</code> (or <code>npm run setup</code>) in the
        SolarOps folder, it installs it.
      </span>
    </div>

    <!-- Off: turn it on (data kept from a previous instance is served again). -->
    <section v-if="!redis.enabled" class="panel">
      <header class="panel-header">
        <span class="panel-icon"><FeatherIcon name="zap" :size="17" /></span>
        <h3>Redis</h3>
      </header>
      <div class="panel-body stack">
        <p class="text-dim small">
          A Redis instance for {{ project.name }} only: its own process (pm2 <code>{{ processName }}</code
          >), started and stopped with the project, listening on this server only, with a generated password. The
          project receives <code>REDIS_HOST</code>, <code>REDIS_PORT</code>, <code>REDIS_PASSWORD</code> and
          <code>REDIS_URL</code>; its data lives in <code>{{ project.path }}/redis</code>.
        </p>
        <div v-if="redis.hasData" class="callout">
          <FeatherIcon name="database" class="icon" />
          <span>The data of its previous instance is kept: turning Redis on serves it again.</span>
        </div>
      </div>
      <footer class="panel-footer">
        <button
          v-if="redis.hasData"
          type="button"
          class="btn btn-ghost text-danger"
          :disabled="busy"
          @click="deleteData"
        >
          <FeatherIcon name="trash-2" :size="16" />
          Delete its data
        </button>
        <span class="spacer"></span>
        <button type="button" class="btn btn-primary" :disabled="busy || !state.program" @click="run('enable')">
          <span v-if="busy" class="spinner"></span>
          <FeatherIcon v-else name="zap" :size="16" />
          Turn Redis on
        </button>
      </footer>
    </section>

    <template v-else>
      <div v-if="state.redis.error" class="callout callout-danger">
        <FeatherIcon name="x-circle" class="icon" />
        <span>{{ state.redis.error }}</span>
      </div>

      <div class="grid-2">
        <section class="panel">
          <header class="panel-header">
            <span class="panel-icon"><FeatherIcon name="key" :size="17" /></span>
            <h3>Connection</h3>
            <span class="spacer"></span>
            <StatusPill :status="processStatus" />
          </header>
          <div class="panel-body">
            <dl class="kv">
              <dt>Host</dt>
              <dd><code>127.0.0.1</code> <span class="tiny text-faint">this server only</span></dd>
              <dt>Port</dt>
              <dd>
                <code>{{ redis.port }}</code>
              </dd>
              <dt>Password</dt>
              <dd><SecretValue :value="revealed && revealed.password" :loading="revealing" @reveal="reveal" /></dd>
              <dt>URL</dt>
              <dd><SecretValue :value="revealed && revealed.url" :loading="revealing" @reveal="reveal" /></dd>
              <dt>Process</dt>
              <dd>
                <code>{{ processName }}</code> <span class="tiny text-faint">pm2, with the project</span>
              </dd>
              <dt>Variables</dt>
              <dd class="tiny text-dim">REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_URL</dd>
            </dl>
          </div>
        </section>

        <section class="panel">
          <header class="panel-header">
            <span class="panel-icon"><FeatherIcon name="activity" :size="17" /></span>
            <h3>Usage</h3>
            <span class="spacer"></span>
            <button type="button" class="btn btn-ghost btn-sm" title="Refresh" @click="load">
              <FeatherIcon name="refresh-cw" :size="14" />
            </button>
          </header>
          <div class="panel-body">
            <p v-if="!info" class="small text-faint">{{ usageEmpty }}</p>
            <dl v-else class="kv">
              <dt>Memory</dt>
              <dd>
                {{ $format.bytes(info.usedMemory) }} / {{ redis.maxMemoryMb }} MB
                <span class="redis-meter"><span :style="{ width: `${memoryPercent}%` }"></span></span>
              </dd>
              <dt>Keys</dt>
              <dd>{{ info.keys.toLocaleString() }}</dd>
              <dt>Clients</dt>
              <dd>{{ info.clients }}</dd>
              <dt>Last save</dt>
              <dd>
                <template v-if="info.lastSaveAt">{{ $format.timeAgo(info.lastSaveAt) }}</template>
                <template v-else>—</template>
                <span v-if="!info.lastSaveOk" class="tiny text-danger">the last save failed (logs/redis.log)</span>
              </dd>
              <dt>Uptime</dt>
              <dd>{{ $format.duration(info.uptimeSeconds * 1000) }}</dd>
              <dt>Version</dt>
              <dd>
                {{ info.version }} <span class="tiny text-faint">{{ state.program && state.program.name }}</span>
              </dd>
            </dl>
          </div>
        </section>
      </div>

      <form class="panel" @submit.prevent="saveSettings">
        <header class="panel-header">
          <span class="panel-icon"><FeatherIcon name="sliders" :size="17" /></span>
          <h3>Settings</h3>
        </header>
        <div class="panel-body">
          <div class="form-grid redis-settings">
            <FormField label="Memory limit (MB)" :error="errors.maxMemoryMb" hint="maxmemory: 16 to 8192 MB.">
              <input v-model.number="form.maxMemoryMb" class="input mono" type="number" min="16" max="8192" />
            </FormField>
            <FormField label="When full" :error="errors.policy" :hint="policyHint">
              <select v-model="form.policy" class="select">
                <option value="noeviction">Data: refuse new writes (noeviction)</option>
                <option value="allkeys-lru">Cache: evict the oldest keys (allkeys-lru)</option>
              </select>
            </FormField>
            <FormField label="Persistence" :error="errors.persistence" :hint="persistenceHint">
              <select v-model="form.persistence" class="select">
                <option value="rdb">Snapshots (RDB)</option>
                <option value="aof">Every write (AOF + snapshots)</option>
                <option value="none">None: memory only</option>
              </select>
            </FormField>
          </div>
        </div>
        <footer class="panel-footer">
          <span class="tiny text-faint">Applied live, without restarting Redis.</span>
          <span class="spacer"></span>
          <button type="submit" class="btn btn-primary" :disabled="busy || !settingsDirty">
            <span v-if="busy" class="spinner"></span>
            <FeatherIcon v-else name="save" :size="16" />
            Save
          </button>
        </footer>
      </form>

      <section class="panel">
        <header class="panel-header">
          <span class="panel-icon"><FeatherIcon name="tool" :size="17" /></span>
          <h3>Operations</h3>
        </header>
        <div class="panel-body">
          <div class="row row-wrap">
            <button type="button" class="btn" :disabled="busy" @click="run('restart')">
              <FeatherIcon name="refresh-cw" :size="16" />
              Restart Redis
            </button>
            <button type="button" class="btn" :disabled="busy" @click="rotate">
              <FeatherIcon name="key" :size="16" />
              New password
            </button>
            <button type="button" class="btn btn-danger" :disabled="busy || processStatus !== 'online'" @click="flush">
              <FeatherIcon name="trash" :size="16" />
              Empty (FLUSHALL)
            </button>
            <span class="spacer"></span>
            <button type="button" class="btn btn-ghost" :disabled="busy" @click="turnOff">
              <FeatherIcon name="power" :size="16" />
              Turn off
            </button>
          </div>
          <p class="tiny text-faint redis-operations-hint">
            Turning Redis off removes its process and its variables; its data stays in <code>redis/</code> for the next
            time.
          </p>
        </div>
      </section>
    </template>
  </div>
</template>

<script>
/**
 * Redis tab: the project's own Redis instance (server/services/redis.js),
 * turned on on demand, started and stopped with the project.
 */
export default {
  name: 'RedisTab',
  props: {
    project: {
      type: Object,
      required: true,
    },
  },
  emits: ['refresh'],
  data() {
    return {
      state: null,
      busy: false,
      revealed: null,
      revealing: false,
      form: { maxMemoryMb: 64, policy: 'noeviction', persistence: 'rdb' },
      errors: {},
    };
  },
  computed: {
    redis() {
      return this.state.redis;
    },
    info() {
      return this.state.redis.info;
    },
    processName() {
      return `${this.project.uid}__redis`;
    },
    processStatus() {
      const processInfo = this.state.redis.process;

      if (!processInfo) {
        return 'offline';
      }

      return processInfo.status;
    },
    usageEmpty() {
      if (!this.project.active) {
        return 'The project is inactive: Redis is stopped with it.';
      }

      return 'Redis is not running.';
    },
    memoryPercent() {
      return Math.min(100, Math.round((this.info.usedMemory / (this.redis.maxMemoryMb * 1024 * 1024)) * 100));
    },
    settingsDirty() {
      const redis = this.redis;

      return (
        this.form.maxMemoryMb !== redis.maxMemoryMb ||
        this.form.policy !== redis.policy ||
        this.form.persistence !== redis.persistence
      );
    },
    policyHint() {
      if (this.form.policy === 'allkeys-lru') {
        return 'For caches: nothing is refused, old keys are deleted.';
      }

      return 'For sessions and queues: nothing is lost, writes fail once full.';
    },
    persistenceHint() {
      if (this.form.persistence === 'aof') {
        return 'Every write logged: at most a second lost on a crash.';
      }

      if (this.form.persistence === 'none') {
        return 'Emptied at every restart.';
      }

      return 'Saved every minute to every hour, depending on the writes.';
    },
  },
  mounted() {
    this.load();
  },
  methods: {
    applyState(state) {
      this.state = state;
      this.form = {
        maxMemoryMb: state.redis.maxMemoryMb,
        policy: state.redis.policy,
        persistence: state.redis.persistence,
      };
    },
    async load() {
      try {
        this.applyState(await this.$api.get(`/projects/${this.project.uid}/redis`));
      } catch (error) {
        this.$toast.error(error);
      }
    },
    async run(name, body = {}) {
      this.busy = true;
      this.errors = {};

      try {
        this.applyState(await this.$api.post(`/projects/${this.project.uid}/redis/${name}`, body));
        this.revealed = null;
        this.$emit('refresh');
        return true;
      } catch (error) {
        this.$toast.error(error);
        return false;
      } finally {
        this.busy = false;
      }
    },
    async reveal() {
      this.revealing = true;

      try {
        this.revealed = await this.$api.get(`/projects/${this.project.uid}/redis/credentials`);
      } catch (error) {
        this.$toast.error(error);
      } finally {
        this.revealing = false;
      }
    },
    async saveSettings() {
      this.busy = true;
      this.errors = {};

      try {
        this.applyState(await this.$api.put(`/projects/${this.project.uid}/redis`, this.form));
        this.$toast.success('Redis settings saved and applied.');
      } catch (error) {
        this.errors = error.fields || {};
        this.$toast.error(error);
      } finally {
        this.busy = false;
      }
    },
    async rotate() {
      if (await this.run('rotate-password')) {
        this.$toast.info('New password set: restart the project to give it the new REDIS_PASSWORD.');
      }
    },
    async flush() {
      const confirmed = await this.$confirm({
        title: 'Empty Redis?',
        message: `Every key of ${this.project.name}'s Redis is deleted (FLUSHALL).`,
        confirmText: 'Empty',
        danger: true,
        requireText: this.project.uid,
        icon: 'trash',
      });

      if (confirmed && (await this.run('flush', { confirm: this.project.uid }))) {
        this.$toast.success('Redis emptied.');
      }
    },
    async turnOff() {
      const confirmed = await this.$confirm({
        title: 'Turn Redis off?',
        message: `Its process stops and ${this.project.name} no longer receives REDIS_* (restart it). The data stays in redis/.`,
        confirmText: 'Turn off',
        icon: 'power',
      });

      if (confirmed) {
        await this.run('disable');
      }
    },
    async deleteData() {
      const confirmed = await this.$confirm({
        title: 'Delete the Redis data?',
        message: `Everything in ${this.project.path}/redis is deleted for good.`,
        confirmText: 'Delete',
        danger: true,
        requireText: this.project.uid,
        icon: 'trash-2',
      });

      if (confirmed) {
        await this.run('delete-data', { confirm: this.project.uid });
      }
    },
  },
};
</script>

<style>
.redis-meter {
  display: block;
  width: 160px;
  height: 4px;
  margin-top: 6px;
  border-radius: 2px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
}

.redis-meter span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
}

.redis-settings {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

@media (max-width: 900px) {
  .redis-settings {
    grid-template-columns: minmax(0, 1fr);
  }
}

.redis-operations-hint {
  margin-top: 12px;
}
</style>
