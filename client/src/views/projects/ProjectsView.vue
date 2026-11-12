<template>
  <div>
    <PageHeader title="Projects" subtitle="Every project orbiting this server.">
      <template #actions>
        <div class="input-prefix projects-search">
          <FeatherIcon name="search" :size="15" class="prefix" />
          <input v-model="search" class="input" placeholder="Search projects…" />
        </div>
        <RouterLink to="/projects/new" class="btn btn-primary">
          <FeatherIcon name="plus" />
          New project
        </RouterLink>
      </template>
    </PageHeader>

    <OrbitLoader v-if="loading && projects.length === 0" label="Loading projects…" />

    <template v-else>
      <div v-if="processError" class="callout callout-warning projects-warning">
        <FeatherIcon name="alert-triangle" class="icon" />
        <span><strong>pm2 is unreachable:</strong> {{ processError }}</span>
      </div>

      <div v-if="projects.length === 0" class="panel">
        <EmptyState icon="globe" title="No project yet">
          Each project gets its own folder, process, and optionally a git deployment, a database, a mail relay and a
          domain with HTTPS.
          <template #actions>
            <RouterLink to="/projects/new" class="btn btn-primary">
              <FeatherIcon name="plus" />
              Create the first one
            </RouterLink>
          </template>
        </EmptyState>
      </div>

      <div v-else-if="filteredProjects.length === 0" class="panel">
        <EmptyState icon="search" title="Nothing matches">No project matches “{{ search }}”.</EmptyState>
      </div>

      <div v-else class="grid-auto">
        <ProjectCard v-for="project in filteredProjects" :key="project.id" :project="project" class="fade-up" />
      </div>
    </template>
  </div>
</template>

<script>
/**
 * List of every project, with search.
 */
import ProjectCard from '../../components/projects/ProjectCard.vue';

export default {
  name: 'ProjectsView',
  components: { ProjectCard },
  data() {
    return {
      projects: [],
      processError: null,
      loading: true,
      search: '',
    };
  },
  computed: {
    filteredProjects() {
      const query = this.search.trim().toLowerCase();

      if (query === '') {
        return this.projects;
      }

      return this.projects.filter((project) => {
        const haystack = [project.name, project.uid, project.network.domain].join(' ').toLowerCase();
        return haystack.includes(query);
      });
    },
  },
  mounted() {
    this.load();
  },
  methods: {
    async load() {
      this.loading = true;

      try {
        const result = await this.$api.get('/projects');
        this.projects = result.projects;
        this.processError = result.processError;
      } catch (error) {
        this.$toast.error(error);
      } finally {
        this.loading = false;
      }
    },
  },
};
</script>

<style>
.projects-search {
  width: 260px;
}

.projects-search .input {
  padding-left: 38px;
}

.projects-warning {
  margin-bottom: 20px;
}
</style>
