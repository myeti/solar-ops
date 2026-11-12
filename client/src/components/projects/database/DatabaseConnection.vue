<template>
  <section class="panel">
    <header class="panel-header">
      <span class="panel-icon"><FeatherIcon name="key" :size="17" /></span>
      <h3>Connection</h3>
      <span class="spacer"></span>
      <span v-if="database.adopted" class="badge badge-cyan">linked</span>
      <StatusPill :status="enabledStatus" />
    </header>
    <div class="panel-body">
      <dl class="kv">
        <dt>Host</dt>
        <dd>
          <code>{{ hostLabel }}</code>
        </dd>
        <dt>Database</dt>
        <dd class="row-sm">
          <code>{{ database.name }}</code
          ><CopyButton :value="database.name" />
        </dd>
        <dt>User</dt>
        <dd class="row-sm">
          <code>{{ database.user }}</code
          ><CopyButton :value="database.user" />
        </dd>
        <dt>Password</dt>
        <dd><SecretValue :value="revealedPassword" :loading="revealing" @reveal="reveal" /></dd>
        <dt>URL</dt>
        <dd><SecretValue :value="revealedUrl" :loading="revealing" @reveal="reveal" /></dd>
        <dt>{{ dateLabel }}</dt>
        <dd>{{ $format.dateTime(dateValue) }}</dd>
      </dl>
    </div>
  </section>
</template>

<script>
/**
 * Connection details of the project database (password revealed on demand).
 * The parent calls forget() when the credentials change.
 */
export default {
  name: 'DatabaseConnection',
  props: {
    project: {
      type: Object,
      required: true,
    },
    /** PostgreSQL server settings (host, port), null while loading. */
    postgres: {
      type: Object,
      default: null,
    },
  },
  data() {
    return {
      credentials: null,
      revealing: false,
    };
  },
  computed: {
    database() {
      return this.project.database;
    },
    enabledStatus() {
      if (this.database.enabled) {
        return 'enabled';
      }

      return 'disabled';
    },
    dateLabel() {
      if (this.database.adopted) {
        return 'Linked';
      }

      return 'Created';
    },
    dateValue() {
      if (this.database.adopted) {
        return this.database.linkedAt;
      }

      return this.database.provisionedAt;
    },
    hostLabel() {
      if (!this.postgres) {
        return '…';
      }

      return `${this.postgres.host}:${this.postgres.port}`;
    },
    revealedPassword() {
      if (this.credentials) {
        return this.credentials.password;
      }

      return null;
    },
    revealedUrl() {
      if (this.credentials) {
        return this.credentials.url;
      }

      return null;
    },
  },
  methods: {
    async reveal() {
      this.revealing = true;

      try {
        this.credentials = await this.$api.get(`/projects/${this.project.uid}/database/credentials`);
      } catch (error) {
        this.$toast.error(error);
      } finally {
        this.revealing = false;
      }
    },
    /** Hide revealed credentials (they changed, or are gone). */
    forget() {
      this.credentials = null;
    },
  },
};
</script>
