<template>
  <div>
    <PageHeader
      eyebrow="Infrastructure"
      title="Domains & SSL"
      subtitle="Every exposed domain, its Let's Encrypt certificate, shared certificates and your DNS provider accounts."
    />

    <div class="stack-lg">
      <CertificatesOverview />
      <SharedCertificatesPanel :accounts="accounts" :providers="providers" @changed="loadAccounts" />
      <DnsAccountsPanel :accounts="accounts" :providers="providers" @changed="loadAccounts" />
    </div>
  </div>
</template>

<script>
/**
 * Domains & SSL: certificates overview, shared certificates and DNS
 * provider accounts (loaded here, used by both panels).
 */
import CertificatesOverview from '../../components/domains/CertificatesOverview.vue';
import DnsAccountsPanel from '../../components/domains/DnsAccountsPanel.vue';
import SharedCertificatesPanel from '../../components/domains/SharedCertificatesPanel.vue';

export default {
  name: 'DomainsView',
  components: { CertificatesOverview, DnsAccountsPanel, SharedCertificatesPanel },
  data() {
    return {
      accounts: [],
      providers: [],
    };
  },
  mounted() {
    this.loadAccounts();
  },
  methods: {
    async loadAccounts() {
      try {
        const [accounts, providers] = await Promise.all([
          this.$api.get('/dns-accounts'),
          this.$api.get('/dns-accounts/providers'),
        ]);
        this.accounts = accounts.accounts;
        this.providers = providers.providers;
      } catch (error) {
        this.$toast.error(error);
      }
    },
  },
};
</script>
