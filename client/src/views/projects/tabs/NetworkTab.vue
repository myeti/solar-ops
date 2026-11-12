<template>
  <div class="stack-lg">
    <NetworkForm :project="project" @saved="onSaved" @refresh="$emit('refresh')" />

    <div v-if="applyError" class="callout callout-danger">
      <FeatherIcon name="alert-octagon" class="icon" />
      <div class="stack-sm">
        <strong>Saved, but nginx refused the configuration (previous config restored):</strong>
        <pre class="network-error mono">{{ applyError }}</pre>
        <div>
          <button type="button" class="btn btn-sm" @click="reapply">Retry apply</button>
        </div>
      </div>
    </div>

    <template v-if="network.enabled && network.domain">
      <div class="grid-2">
        <CertificatePanel v-if="network.certMethod !== 'none'" :project="project" />
        <DnsCheckPanel :project="project" />
      </div>

      <DnsRecordsPanel :project="project" @refresh="$emit('refresh')" />

      <NginxPreviewPanel :project="project" :version="previewVersion" @reapply="reapply" />
    </template>
  </div>
</template>

<script>
/**
 * Network tab: domain, nginx routing, certificates, DNS check and records.
 */
import CertificatePanel from '../../../components/projects/network/CertificatePanel.vue';
import DnsCheckPanel from '../../../components/projects/network/DnsCheckPanel.vue';
import DnsRecordsPanel from '../../../components/projects/network/DnsRecordsPanel.vue';
import NetworkForm from '../../../components/projects/network/NetworkForm.vue';
import NginxPreviewPanel from '../../../components/projects/network/NginxPreviewPanel.vue';

export default {
  name: 'NetworkTab',
  components: { CertificatePanel, DnsCheckPanel, DnsRecordsPanel, NetworkForm, NginxPreviewPanel },
  props: {
    project: {
      type: Object,
      required: true,
    },
  },
  emits: ['refresh'],
  data() {
    return {
      applyError: null,
      // Bumped after each change: an open nginx preview reloads.
      previewVersion: 0,
    };
  },
  computed: {
    network() {
      return this.project.network;
    },
  },
  methods: {
    onSaved(result) {
      this.applyError = result.applyError;
      this.previewVersion += 1;
    },
    async reapply() {
      try {
        await this.$api.post(`/projects/${this.project.uid}/network/apply`);
        this.applyError = null;
        this.$toast.success('nginx configuration applied.');
        this.previewVersion += 1;
      } catch (error) {
        this.applyError = error.message;
      }
    },
  },
};
</script>

<style>
.network-error {
  margin: 0;
  white-space: pre-wrap;
  font-size: 12px;
  color: #fecdd3;
}
</style>
