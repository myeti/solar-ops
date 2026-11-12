<template>
  <div class="stack-lg">
    <DeploymentForm :project="project" @refresh="$emit('refresh')" />

    <template v-if="project.deployment.enabled">
      <div class="grid-2">
        <DeployPanel :project="project" @launched="loadHistory" />
        <WebhookPanel :project="project" />
      </div>

      <section class="panel">
        <header class="panel-header">
          <span class="panel-icon"><FeatherIcon name="clock" :size="17" /></span>
          <h3>Deployment history</h3>
        </header>
        <div class="panel-body">
          <TaskList :tasks="history" empty-text="No deployment yet. Hit “Deploy now”!" />
        </div>
      </section>
    </template>
  </div>
</template>

<script>
/**
 * Deployment tab: git source, build commands, deploy / pull, webhook and
 * history.
 */
import DeployPanel from '../../../components/projects/deployment/DeployPanel.vue';
import DeploymentForm from '../../../components/projects/deployment/DeploymentForm.vue';
import WebhookPanel from '../../../components/projects/deployment/WebhookPanel.vue';
import TaskList from '../../../components/tasks/TaskList.vue';

export default {
  name: 'DeploymentTab',
  components: { DeployPanel, DeploymentForm, TaskList, WebhookPanel },
  props: {
    project: {
      type: Object,
      required: true,
    },
  },
  emits: ['refresh'],
  data() {
    return {
      history: [],
    };
  },
  watch: {
    'project.lastDeployment.status'() {
      this.loadHistory();
    },
  },
  mounted() {
    this.loadHistory();
  },
  methods: {
    async loadHistory() {
      try {
        const { tasks } = await this.$api.get(`/projects/${this.project.uid}/tasks?type=deploy,pull&limit=15`);
        this.history = tasks;
      } catch (error) {
        this.$toast.error(error);
      }
    },
  },
};
</script>
