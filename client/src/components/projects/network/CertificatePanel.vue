<template>
  <section class="panel">
    <header class="panel-header">
      <span class="panel-icon"><FeatherIcon name="shield" :size="17" /></span>
      <h3>Certificate</h3>
      <span class="spacer"></span>
      <StatusPill :status="certificateStatus" />
    </header>
    <div class="panel-body stack">
      <div v-if="certificate.uncovered && certificate.uncovered.length > 0" class="callout callout-warning">
        <FeatherIcon name="alert-triangle" class="icon" />
        <span>
          The issued certificate does not cover {{ certificate.uncovered.join(', ') }} yet: request it again.
        </span>
      </div>
      <dl v-if="certificate.exists" class="kv">
        <template v-if="certificate.shared">
          <dt>Shared</dt>
          <dd>
            <RouterLink to="/infrastructure/domains">{{ certificate.shared.domains.join(', ') }}</RouterLink>
          </dd>
        </template>
        <dt>Valid until</dt>
        <dd>
          {{ $format.dateTime(certificate.validTo) }} <span class="text-faint">({{ certificate.daysLeft }} days)</span>
        </dd>
        <dt>Domains</dt>
        <dd>
          <span class="row-sm row-wrap">
            <code v-for="domain in certificate.domains" :key="domain">{{ domain }}</code>
          </span>
        </dd>
        <dt>Issuer</dt>
        <dd class="small">
          {{ certificate.issuer }}
          <span v-if="certificate.staging" class="badge badge-amber">staging</span>
        </dd>
      </dl>
      <p v-else-if="certificate.error" class="text-dim small">{{ certificate.error }}</p>
      <p v-else-if="network.certMethod === 'shared'" class="text-dim small">
        The shared certificate is not issued yet: request it (once, for every project using it).
      </p>
      <p v-else class="text-dim small">
        No certificate yet. Make sure the domain points to this server, then request one.
      </p>
      <div class="row row-wrap">
        <button type="button" class="btn btn-primary" :disabled="certBusy" @click="requestCertificate(false)">
          <FeatherIcon name="shield" :size="16" />
          {{ certificateButtonLabel }}
        </button>
        <button
          v-if="certificate.exists"
          type="button"
          class="btn"
          :disabled="certBusy"
          @click="requestCertificate(true)"
        >
          <FeatherIcon name="refresh-cw" :size="16" />
          Force renewal
        </button>
      </div>
      <p v-if="network.certMethod === 'shared'" class="tiny text-faint">
        Renewing a shared certificate reloads every project using it.
      </p>
    </div>
  </section>
</template>

<script>
/**
 * Certificate of a project: status, details, request / renewal (a shared
 * certificate is renewed for every project using it).
 */
export default {
  name: 'CertificatePanel',
  props: {
    project: {
      type: Object,
      required: true,
    },
  },
  data() {
    return {
      certBusy: false,
    };
  },
  computed: {
    network() {
      return this.project.network;
    },
    certificate() {
      return this.project.certificate || { exists: false };
    },
    certificateStatus() {
      if (!this.certificate.exists) {
        return 'missing';
      }

      if (this.certificate.needsRenewal) {
        return 'expiring';
      }

      return 'valid';
    },
    certificateButtonLabel() {
      if (this.certificate.exists) {
        return 'Renew if needed';
      }

      return 'Obtain certificate';
    },
  },
  methods: {
    async requestCertificate(force) {
      this.certBusy = true;

      try {
        const { task } = await this.$api.post(`/projects/${this.project.uid}/network/certificate`, { force });
        this.$tasks.open(task.id);
      } catch (error) {
        this.$toast.error(error);
      } finally {
        this.certBusy = false;
      }
    },
  },
};
</script>
