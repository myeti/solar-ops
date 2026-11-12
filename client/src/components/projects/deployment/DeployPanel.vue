<template>
  <section class="panel">
    <header class="panel-header">
      <span class="panel-icon"><FeatherIcon name="upload-cloud" :size="17" /></span>
      <h3>Deploy</h3>
    </header>
    <div class="panel-body stack">
      <div v-if="commit" class="commit-card">
        <FeatherIcon name="git-commit" class="text-faint" />
        <div class="stack-sm commit-text">
          <strong class="truncate">{{ commit.subject }}</strong>
          <span class="tiny text-faint">
            <span class="mono">{{ commit.shortHash }}</span> · {{ commit.author }} · {{ $format.timeAgo(commit.date) }}
          </span>
        </div>
      </div>
      <p v-else class="text-dim small">Nothing deployed yet: the first deployment clones the repository.</p>
      <div class="row row-wrap">
        <button type="button" class="btn btn-primary" :disabled="launching" @click="launch('deploy')">
          <FeatherIcon name="upload-cloud" :size="16" />
          Deploy now
        </button>
        <button
          type="button"
          class="btn"
          :disabled="launching || pullBlocked"
          :title="pullTitle"
          @click="launch('pull')"
        >
          <FeatherIcon name="download-cloud" :size="16" />
          Pull only
        </button>
      </div>
      <p v-if="pullBlocked" class="tiny text-warning">
        Pull only is disabled while {{ project.name }} is running: stop it first (Deploy now pulls, builds and restarts
        it).
      </p>
      <p class="tiny text-faint">
        {{ deployExplanation }} Pull only updates the sources. Nothing local is lost: changes to tracked files in
        <code>repo/</code> go to a git stash, unpushed commits to a <code>solarops/backup-…</code> branch.
      </p>
    </div>
  </section>
</template>

<script>
/**
 * Deployed commit and the Deploy / Pull buttons. Pulling only is refused
 * while the application runs (its sources would change under it).
 * Emits `launched` once a task is queued.
 */
export default {
  name: 'DeployPanel',
  props: {
    project: {
      type: Object,
      required: true,
    },
  },
  emits: ['launched'],
  data() {
    return {
      commit: null,
      launching: false,
    };
  },
  computed: {
    deployExplanation() {
      if (this.project.type === 'static') {
        return 'Deploy = pull, install and build: the new files are live immediately.';
      }

      return 'Deploy = pull, install, build and restart.';
    },
    /** A running application must be stopped before a pull only. */
    pullBlocked() {
      const processInfo = this.project.process;

      return this.project.type === 'app' && Boolean(processInfo && processInfo.running);
    },
    pullTitle() {
      if (this.pullBlocked) {
        return 'Stop the project first';
      }

      return 'Update the sources only';
    },
  },
  watch: {
    'project.lastDeployment.status'() {
      this.loadCommit();
    },
  },
  mounted() {
    this.loadCommit();
  },
  methods: {
    async loadCommit() {
      try {
        const { commit } = await this.$api.get(`/projects/${this.project.uid}/deployment/commit`);
        this.commit = commit;
      } catch {
        this.commit = null;
      }
    },
    async launch(kind) {
      this.launching = true;

      try {
        const { task } = await this.$api.post(`/projects/${this.project.uid}/deployment/${kind}`);
        this.$tasks.open(task.id);
        this.$emit('launched');
      } catch (error) {
        this.$toast.error(error);
      } finally {
        this.launching = false;
      }
    },
  },
};
</script>

<style>
.commit-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border-radius: 12px;
  background: var(--surface-sunken);
  border: 1px solid var(--border);
}

.commit-text {
  min-width: 0;
  gap: 2px;
}
</style>
