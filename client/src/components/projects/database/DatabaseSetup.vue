<template>
  <div class="stack-lg">
    <div class="choice-grid">
      <button type="button" class="choice" :class="{ selected: mode === 'create' }" @click="mode = 'create'">
        <FeatherIcon name="plus-circle" class="choice-icon" />
        <div>
          <strong>Create a new database</strong>
          <span>SolarOps creates a dedicated database and role, with a generated password.</span>
        </div>
      </button>
      <button type="button" class="choice" :class="{ selected: mode === 'link' }" @click="mode = 'link'">
        <FeatherIcon name="link" class="choice-icon" />
        <div>
          <strong>Link an existing database</strong>
          <span>Already created and running: SolarOps verifies the credentials and changes nothing.</span>
        </div>
      </button>
    </div>

    <section v-if="mode === 'create'" class="panel">
      <div class="panel-body database-cta">
        <div class="database-cta-icon">
          <FeatherIcon name="database" :size="24" />
        </div>
        <div class="stack">
          <h3>Give this project its own PostgreSQL database</h3>
          <p class="text-dim">
            SolarOps creates a database and a role named <code>{{ sqlName }}</code> with a generated password. Other
            projects cannot connect to it. The connection is given to the project at startup:
          </p>
          <div class="row row-wrap">
            <code v-for="variable in variableNames" :key="variable">{{ variable }}</code>
          </div>
          <div v-if="defaultNameTaken" class="callout callout-warning">
            <FeatherIcon name="alert-triangle" class="icon" />
            <span>
              A {{ takenDescription }} named <code>{{ sqlName }}</code> already exists on the server. SolarOps will not
              modify it.
              <button type="button" class="btn btn-sm inline-action" @click="startLinking(sqlName)">
                Link it instead
              </button>
            </span>
          </div>
          <div>
            <button type="button" class="btn btn-primary" :disabled="busy || defaultNameTaken" @click="enable">
              <span v-if="busy" class="spinner"></span>
              <FeatherIcon v-else name="plus-circle" :size="16" />
              Create the database
            </button>
          </div>
        </div>
      </div>
    </section>

    <form v-else class="panel" @submit.prevent="linkDatabase">
      <header class="panel-header">
        <span class="panel-icon"><FeatherIcon name="link" :size="17" /></span>
        <h3>Link an existing database</h3>
      </header>
      <div class="panel-body stack">
        <p class="text-dim small">
          SolarOps connects with these credentials to verify them. It never changes the roles, permissions or data of a
          linked database on its own, and never wipes or drops it.
        </p>

        <FormField
          label="Paste a connection URL"
          hint="E.g. the DATABASE_URL of the application: it fills the fields below."
          optional
        >
          <input
            v-model="linkUrl"
            class="input mono"
            placeholder="postgres://user:password@127.0.0.1:5432/database"
            spellcheck="false"
            autocomplete="off"
            @input="parseLinkUrl"
          />
        </FormField>
        <div v-if="urlWarning" class="callout callout-warning">
          <FeatherIcon name="alert-triangle" class="icon" />
          <span>{{ urlWarning }}</span>
        </div>

        <div class="form-grid">
          <FormField label="Database" :error="linkErrors.name" :hint="candidatesHint">
            <input
              v-model="link.name"
              class="input mono"
              list="database-candidates"
              spellcheck="false"
              autocomplete="off"
              @change="onCandidatePicked"
            />
            <datalist id="database-candidates">
              <option v-for="candidate in candidates" :key="candidate.name" :value="candidate.name">
                {{ candidateLabel(candidate) }}
              </option>
            </datalist>
          </FormField>
          <FormField label="Role (user)" :error="linkErrors.user" hint="The role the application connects with.">
            <input v-model="link.user" class="input mono" spellcheck="false" autocomplete="off" />
          </FormField>
          <FormField class="full" label="Password" :error="linkErrors.password" :hint="passwordHint">
            <input
              v-model="link.password"
              class="input"
              type="password"
              autocomplete="new-password"
              :disabled="link.resetPassword"
            />
          </FormField>
          <div class="full">
            <ToggleSwitch
              v-model="link.resetPassword"
              label="I don't know the password: set a new one"
              hint="Changes the role's password on the server (SolarOps's admin role must be allowed to). Applications still using the old one lose access until they use the new one."
            />
          </div>
        </div>

        <div v-if="candidatesError" class="callout">
          <FeatherIcon name="info" class="icon" />
          <span>Existing databases could not be listed ({{ candidatesError }}). You can still type the name.</span>
        </div>
      </div>
      <footer class="panel-footer">
        <button type="submit" class="btn btn-primary" :disabled="linking || !canLink">
          <span v-if="linking" class="spinner"></span>
          <FeatherIcon v-else name="link" :size="16" />
          Verify &amp; link
        </button>
      </footer>
    </form>
  </div>
</template>

<script>
/**
 * No database yet: create a dedicated one, or link an existing one.
 */
import { suggestRestart } from './restartHint.js';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];

function emptyLinkForm() {
  return { name: '', user: '', password: '', resetPassword: false };
}

export default {
  name: 'DatabaseSetup',
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
  emits: ['refresh'],
  data() {
    return {
      busy: false,
      variableNames: ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DATABASE_URL'],
      mode: 'create',
      defaultNameStatus: null,
      candidates: [],
      candidatesError: null,
      link: emptyLinkForm(),
      linkUrl: '',
      urlWarning: '',
      linkErrors: {},
      linking: false,
    };
  },
  computed: {
    sqlName() {
      return this.project.uid.replace(/-/g, '_');
    },
    defaultNameTaken() {
      const status = this.defaultNameStatus;

      return Boolean(status && (status.databaseExists || status.roleExists));
    },
    takenDescription() {
      const status = this.defaultNameStatus;

      if (status.databaseExists && status.roleExists) {
        return 'database and a role';
      }

      if (status.databaseExists) {
        return 'database';
      }

      return 'role';
    },
    candidatesHint() {
      if (this.candidates.length > 0) {
        return `${this.candidates.length} unlinked database(s) on the server: start typing to pick one.`;
      }

      return 'Name of the database on the configured PostgreSQL server.';
    },
    passwordHint() {
      if (this.link.resetPassword) {
        return 'A new password will be generated.';
      }

      return 'Stored encrypted, never shown again unless you reveal it.';
    },
    canLink() {
      const form = this.link;

      return form.name !== '' && form.user !== '' && (form.password !== '' || form.resetPassword);
    },
    hostLabel() {
      if (!this.postgres) {
        return '…';
      }

      return `${this.postgres.host}:${this.postgres.port}`;
    },
  },
  mounted() {
    this.loadCandidates();
  },
  methods: {
    endpoint(path) {
      return `/projects/${this.project.uid}/database${path}`;
    },
    /**
     * Does the default name already exist, and which databases can be linked?
     * When the default name is taken, switch to linking it directly.
     */
    async loadCandidates() {
      try {
        const result = await this.$api.get(this.endpoint('/candidates'));
        this.defaultNameStatus = result.defaultNameStatus;
        this.candidates = result.candidates;
        this.candidatesError = result.error;

        if (this.defaultNameTaken) {
          this.startLinking(this.sqlName);
        }
      } catch (error) {
        this.candidatesError = error.message;
      }
    },
    candidateLabel(candidate) {
      return `owner ${candidate.owner} · ${this.$format.bytes(candidate.sizeBytes)}`;
    },
    /**
     * Switch to the link form, pre-filled with an existing database.
     */
    startLinking(name) {
      this.mode = 'link';
      this.link.name = name;
      this.onCandidatePicked();
    },
    /** Suggest the database owner as the role. */
    onCandidatePicked() {
      const candidate = this.candidates.find((entry) => entry.name === this.link.name);

      if (candidate && this.link.user === '') {
        this.link.user = candidate.owner;
      }

      if (!candidate && this.defaultNameStatus && this.link.name === this.sqlName && this.link.user === '') {
        this.link.user = this.sqlName;
      }
    },
    /**
     * Fill the link form from a postgres:// URL.
     */
    parseLinkUrl() {
      this.urlWarning = '';
      let url;

      try {
        url = new URL(this.linkUrl.trim());
      } catch {
        return;
      }

      if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
        this.urlWarning = 'Only postgres:// or postgresql:// URLs are understood.';
        return;
      }

      this.link.user = decodeURIComponent(url.username);
      this.link.password = decodeURIComponent(url.password);
      this.link.name = decodeURIComponent(url.pathname.replace(/^\//, ''));

      const knownHosts = [...LOCAL_HOSTS];

      if (this.postgres) {
        knownHosts.push(this.postgres.host);
      }

      if (url.hostname && !knownHosts.includes(url.hostname)) {
        this.urlWarning = `This URL points to ${url.hostname}: SolarOps will connect to the configured server (${this.hostLabel}).`;
      }
    },
    async enable() {
      this.busy = true;

      try {
        await this.$api.post(this.endpoint('/enable'));
        this.$toast.success('Database ready.');
        suggestRestart(this);
        this.$emit('refresh');
      } catch (error) {
        this.$toast.error(error);
      } finally {
        this.busy = false;
      }
    },
    async linkDatabase() {
      if (this.link.resetPassword) {
        const confirmed = await this.$confirm({
          title: `Set a new password for ${this.link.user}?`,
          message: 'Every application connecting with this role must use the new password afterwards.',
          confirmText: 'Set a new password',
          danger: true,
          icon: 'key',
        });

        if (!confirmed) {
          return;
        }
      }

      this.linking = true;
      this.linkErrors = {};

      try {
        const { info } = await this.$api.post(this.endpoint('/link'), this.link);
        this.$toast.success(
          `Linked ${this.link.name}: ${info.tableCount} table(s), ${this.$format.bytes(info.sizeBytes)}.`,
        );

        if (!info.ownedByUser) {
          this.$toast.warning(
            `${this.link.name} is owned by ${info.owner}, not by ${this.link.user}: dumps and restores may lack permissions.`,
          );
        }

        suggestRestart(this);
        this.link = emptyLinkForm();
        this.linkUrl = '';
        this.$emit('refresh');
      } catch (error) {
        this.linkErrors = error.fields;
        this.$toast.error(error);
      } finally {
        this.linking = false;
      }
    },
  },
};
</script>

<style>
.database-cta {
  display: flex;
  gap: 28px;
  align-items: flex-start;
  padding: 32px;
}

.database-cta-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 56px;
  height: 56px;
  border-radius: 14px;
  color: var(--accent-strong);
  background: var(--accent-soft);
  border: 1px solid rgba(129, 140, 248, 0.3);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

@media (max-width: 760px) {
  .database-cta {
    flex-direction: column;
  }
}
</style>
