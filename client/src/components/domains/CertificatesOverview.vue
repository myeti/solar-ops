<template>
  <section class="panel fade-up">
    <header class="panel-header">
      <span class="panel-icon"><FeatherIcon name="shield" :size="17" /></span>
      <h3>Certificates</h3>
      <span class="spacer"></span>
      <button type="button" class="btn btn-ghost btn-sm" @click="loadCertificates">
        <FeatherIcon name="refresh-cw" :size="14" />
      </button>
    </header>
    <OrbitLoader v-if="loadingCertificates" inline label="Reading certificates…" class="panel-body" />
    <div v-else-if="certificates.length === 0" class="panel-body">
      <EmptyState icon="globe" title="No domain exposed yet">
        Configure a domain in the Network tab of a project to see it here.
      </EmptyState>
    </div>
    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Project</th>
            <th>Domains</th>
            <th>Method</th>
            <th>Status</th>
            <th>Expires</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in certificates" :key="entry.project.uid">
            <td>
              <RouterLink :to="`/projects/${entry.project.uid}/network`" class="row-sm">
                <PlanetAvatar :seed="entry.project.uid" :size="22" :dim="!entry.project.active" />
                {{ entry.project.name }}
                <span v-if="entry.project.system" class="badge badge-violet">system</span>
              </RouterLink>
            </td>
            <td>
              <div class="mono small">{{ entry.domain }}</div>
              <div v-if="entry.aliases.length > 0" class="tiny text-faint">+ {{ entry.aliases.join(', ') }}</div>
            </td>
            <td>
              <span class="badge" :class="methodBadge(entry.certMethod)">{{ methodLabel(entry.certMethod) }}</span>
              <div v-if="entry.certificate.shared" class="tiny text-faint">
                {{ entry.certificate.shared.domains.join(', ') }}
              </div>
            </td>
            <td>
              <StatusPill :status="certificateStatus(entry)" />
              <span v-if="entry.certificate.staging" class="badge badge-amber cert-staging">staging</span>
            </td>
            <td class="small">
              <template v-if="entry.certificate.exists">
                {{ $format.date(entry.certificate.validTo) }}
                <span class="text-faint">· {{ entry.certificate.daysLeft }}d</span>
                <div class="tiny text-faint">{{ autoRenewLabel(entry) }}</div>
              </template>
              <span v-else class="text-faint">—</span>
            </td>
            <td class="actions">
              <button
                v-if="entry.certMethod !== 'none'"
                type="button"
                class="btn btn-sm"
                :disabled="!entry.project.active"
                @click="renew(entry)"
              >
                <FeatherIcon name="refresh-cw" :size="14" />
                {{ renewLabel(entry) }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script>
/**
 * Every exposed domain with its certificate status (project or shared).
 */
const METHOD_LABELS = {
  none: 'HTTP only',
  http: 'HTTP-01',
  dns: 'DNS-01',
  shared: 'Shared',
};

const METHOD_BADGES = {
  http: 'badge-cyan',
  dns: 'badge-cyan',
  shared: 'badge-violet',
};

export default {
  name: 'CertificatesOverview',
  data() {
    return {
      certificates: [],
      loadingCertificates: true,
    };
  },
  mounted() {
    this.loadCertificates();
    this.unsubscribe = this.$tasks.onFinished((task) => {
      if (task.type === 'certificate') {
        this.loadCertificates();
      }
    });
  },
  beforeUnmount() {
    this.unsubscribe();
  },
  methods: {
    async loadCertificates() {
      try {
        const { certificates } = await this.$api.get('/certificates');
        this.certificates = certificates;
      } catch (error) {
        this.$toast.error(error);
      } finally {
        this.loadingCertificates = false;
      }
    },
    methodLabel(method) {
      return METHOD_LABELS[method] || method;
    },
    methodBadge(method) {
      return METHOD_BADGES[method] || '';
    },
    certificateStatus(entry) {
      if (entry.certMethod === 'none') {
        return 'disabled';
      }

      if (!entry.certificate.exists) {
        return 'missing';
      }

      if (entry.certificate.needsRenewal) {
        return 'expiring';
      }

      return 'valid';
    },
    autoRenewLabel(entry) {
      if (entry.autoRenew) {
        return 'auto-renew on';
      }

      return 'auto-renew off';
    },
    renewLabel(entry) {
      if (entry.certificate.exists) {
        return 'Renew';
      }

      return 'Obtain';
    },
    async renew(entry) {
      try {
        const { task } = await this.$api.post(`/projects/${entry.project.uid}/network/certificate`, { force: false });
        this.$tasks.open(task.id);
      } catch (error) {
        this.$toast.error(error);
      }
    },
  },
};
</script>

<style>
.cert-staging {
  margin-left: 6px;
}
</style>
