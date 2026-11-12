<template>
  <section class="panel">
    <header class="panel-header">
      <span class="panel-icon"><FeatherIcon name="hard-drive" :size="17" /></span>
      <h3>On the server</h3>
    </header>
    <div v-if="project.system" class="panel-body">
      <dl class="kv">
        <dt>Service</dt>
        <dd><code>solarops.service</code> <span class="tiny text-faint">(systemd)</span></dd>
        <dt>Logs</dt>
        <dd class="row-sm">
          <code>journalctl -u solarops -f</code>
          <CopyButton value="journalctl -u solarops -f" />
        </dd>
        <dt>Restart</dt>
        <dd class="row-sm">
          <code>sudo systemctl restart solarops</code>
          <CopyButton value="sudo systemctl restart solarops" />
        </dd>
        <dt>nginx &amp; certificates</dt>
        <dd class="row-sm">
          <code>{{ project.path }}/etc</code>
          <CopyButton :value="`${project.path}/etc`" />
        </dd>
        <dt>Locked out?</dt>
        <dd class="row-sm">
          <code>sudo solarops domain:reset</code>
          <CopyButton value="sudo solarops domain:reset" />
          <span class="tiny text-faint">then reach SolarOps through an SSH tunnel</span>
        </dd>
      </dl>
    </div>
    <div v-else class="panel-body">
      <dl class="kv">
        <dt>Folder</dt>
        <dd class="row-sm">
          <code>{{ project.path }}</code>
          <CopyButton :value="project.path" />
        </dd>
        <template v-if="project.type === 'app'">
          <dt>Port</dt>
          <dd>
            <code>{{ project.port }}</code> <span class="tiny text-faint">given as PORT</span>
          </dd>
          <dt>Start command</dt>
          <dd>
            <code>{{ project.startCommand }}</code> <span class="tiny text-faint">in repo/</span>
          </dd>
          <dt>pm2 process</dt>
          <dd>
            <code>{{ project.uid }}</code>
          </dd>
          <dt>Emergency start</dt>
          <dd class="row-sm">
            <code>{{ emergencyCommand }}</code>
            <CopyButton :value="emergencyCommand" />
          </dd>
        </template>
        <template v-else>
          <dt>Type</dt>
          <dd>Static site <span class="tiny text-faint">— no process, nginx serves the files</span></dd>
          <dt>Served files</dt>
          <dd>
            <code>{{ project.path }}/repo/{{ project.network.publicFolder }}</code>
          </dd>
        </template>
        <dt>Created</dt>
        <dd>{{ $format.dateTime(project.createdAt) }}</dd>
      </dl>

      <EnvVarsDetails :project="project" />
    </div>
  </section>
</template>

<script>
/**
 * Where a project lives on the server (folder, port, pm2 process...) and
 * its environment; for SolarOps itself, how to operate the service.
 */
import EnvVarsDetails from './EnvVarsDetails.vue';

export default {
  name: 'ServerPanel',
  components: { EnvVarsDetails },
  props: {
    project: {
      type: Object,
      required: true,
    },
  },
  computed: {
    emergencyCommand() {
      return `pm2 start ${this.project.path}/etc/pm2.json`;
    },
  },
};
</script>
