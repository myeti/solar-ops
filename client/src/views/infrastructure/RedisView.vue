<template>
  <div>
    <PageHeader
      eyebrow="Infrastructure"
      title="Redis"
      subtitle="One Redis instance per project that wants one, run with pm2 next to it."
    >
      <template #actions>
        <button type="button" class="btn" :disabled="loading" @click="load">
          <FeatherIcon name="refresh-cw" :size="16" />
          Refresh
        </button>
      </template>
    </PageHeader>

    <OrbitLoader v-if="!state" label="Loading…" />

    <div v-else class="stack-lg fade-up">
      <section class="panel">
        <header class="panel-header">
          <span class="panel-icon"><FeatherIcon name="zap" :size="17" /></span>
          <h3>Program</h3>
        </header>
        <div class="panel-body">
          <div v-if="!state.program" class="callout callout-warning">
            <FeatherIcon name="alert-triangle" class="icon" />
            <span>
              Redis is not installed: run <code>npm run update</code> (or <code>npm run setup</code>) in the SolarOps
              folder, it installs it.
            </span>
          </div>
          <dl v-else class="kv">
            <dt>Program</dt>
            <dd>
              <code>{{ state.program.name }}</code> {{ state.program.version }}
              <span class="tiny text-faint">{{ state.program.path }}</span>
            </dd>
            <dt>How</dt>
            <dd class="small text-dim">
              Each project turns its own instance on in its Redis tab: a pm2 process named
              <code>&lt;project&gt;__redis</code>, listening on this server only (port 6400 and up), with its data in
              the project folder. The system <code>redis-server</code> service is not used.
            </dd>
          </dl>
        </div>
      </section>

      <section class="panel">
        <header class="panel-header">
          <span class="panel-icon"><FeatherIcon name="layers" :size="17" /></span>
          <h3>Projects using Redis</h3>
        </header>
        <div v-if="state.instances.length === 0" class="panel-body">
          <EmptyState icon="zap" title="No project uses Redis yet">
            Turn it on in the Redis tab of a project.
          </EmptyState>
        </div>
        <div v-else class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Status</th>
                <th>Port</th>
                <th>Memory</th>
                <th>Keys</th>
                <th>Settings</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="instance in state.instances" :key="instance.project.uid">
                <td>
                  <RouterLink :to="`/projects/${instance.project.uid}/redis`" class="row-sm">
                    <PlanetAvatar :seed="instance.project.uid" :size="22" :dim="!instance.project.active" />
                    {{ instance.project.name }}
                  </RouterLink>
                </td>
                <td>
                  <StatusPill :status="statusOf(instance)" />
                </td>
                <td class="mono small">{{ instance.port || '—' }}</td>
                <td class="small">
                  <template v-if="instance.info">
                    {{ $format.bytes(instance.info.usedMemory) }}
                    <span class="text-faint">/ {{ instance.maxMemoryMb }} MB</span>
                  </template>
                  <span v-else class="text-faint">— / {{ instance.maxMemoryMb }} MB</span>
                </td>
                <td class="small">
                  <template v-if="instance.info">{{ instance.info.keys.toLocaleString() }}</template>
                  <span v-else class="text-faint">—</span>
                </td>
                <td class="tiny text-dim">{{ policyLabel(instance.policy) }} · {{ persistenceLabel(instance) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
</template>

<script>
/**
 * Infrastructure › Redis: the program, and every project's instance
 * (server/routes/redis.js).
 */
const POLICY_LABELS = { noeviction: 'Data', 'allkeys-lru': 'Cache' };
const PERSISTENCE_LABELS = { rdb: 'snapshots', aof: 'AOF', none: 'memory only' };

export default {
  name: 'RedisView',
  data() {
    return {
      state: null,
      loading: false,
    };
  },
  mounted() {
    this.load();
  },
  methods: {
    async load() {
      this.loading = true;

      try {
        this.state = await this.$api.get('/redis');
      } catch (error) {
        this.$toast.error(error);
      } finally {
        this.loading = false;
      }
    },
    statusOf(instance) {
      if (!instance.enabled) {
        return 'disabled';
      }

      if (instance.process) {
        return instance.process.status;
      }

      return 'offline';
    },
    policyLabel(policy) {
      return POLICY_LABELS[policy] || policy;
    },
    persistenceLabel(instance) {
      return PERSISTENCE_LABELS[instance.persistence] || instance.persistence;
    },
  },
};
</script>
