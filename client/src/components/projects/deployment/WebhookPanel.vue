<template>
  <section class="panel">
    <header class="panel-header">
      <span class="panel-icon"><FeatherIcon name="rss" :size="17" /></span>
      <h3>Webhook</h3>
    </header>
    <div v-if="!project.deployment.webhookEnabled" class="panel-body">
      <p class="text-dim small">Enable “Deploy on push” above to get a webhook URL and secret.</p>
    </div>
    <div v-else class="panel-body stack">
      <dl class="kv">
        <dt>URL</dt>
        <dd class="row-sm">
          <code class="truncate">{{ webhookUrl }}</code>
          <CopyButton :value="webhookUrl" />
        </dd>
        <dt>Secret</dt>
        <dd>
          <SecretValue :value="webhookSecret" :loading="revealing" @reveal="revealWebhook" />
        </dd>
      </dl>
      <div class="row row-wrap">
        <button type="button" class="btn btn-sm" @click="showHelp = true">
          <FeatherIcon name="book-open" :size="14" />
          Setup guide
        </button>
        <button type="button" class="btn btn-sm btn-ghost" @click="rotateSecret">
          <FeatherIcon name="refresh-cw" :size="14" />
          Rotate secret
        </button>
      </div>
    </div>

    <ModalDialog :open="showHelp" title="Webhook setup" icon="rss" width="lg" @close="showHelp = false">
      <div class="stack">
        <div class="stack-sm">
          <h4 class="row-sm"><FeatherIcon name="github" :size="16" /> GitHub</h4>
          <p class="small text-dim">
            Repository › Settings › Webhooks › Add webhook. Payload URL: the URL above, content type
            <code>application/json</code>, secret: the webhook secret, event: “Just the push event”.
          </p>
        </div>
        <div class="stack-sm">
          <h4 class="row-sm"><FeatherIcon name="gitlab" :size="16" /> GitLab</h4>
          <p class="small text-dim">
            Project › Settings › Webhooks. URL: the URL above, Secret token: the webhook secret, trigger: Push events.
          </p>
        </div>
        <div class="stack-sm">
          <h4 class="row-sm"><FeatherIcon name="box" :size="16" /> Bitbucket Cloud</h4>
          <p class="small text-dim">
            Repository settings › Webhooks › Add webhook. URL: the URL above, Secret: the webhook secret, trigger:
            Repository push.
          </p>
        </div>
        <div class="stack-sm">
          <h4 class="row-sm"><FeatherIcon name="terminal" :size="16" /> GitHub Actions, CI or curl</h4>
          <p class="small text-dim">
            Store the secret as <code>SOLAROPS_SECRET</code> and call the URL with a bearer token, e.g. after your tests
            pass:
          </p>
          <div class="terminal">
            <pre class="terminal-body">{{ curlExample }}</pre>
          </div>
        </div>
        <p class="tiny text-faint">
          Only pushes on <code>{{ project.deployment.branch }}</code> deploy. Other branches, tags, deleted branches and
          other events (releases, pull requests…) are acknowledged and ignored; the reply tells why.
        </p>
      </div>
    </ModalDialog>
  </section>
</template>

<script>
/**
 * Webhook of a project: URL, secret (revealed on demand), rotation and a
 * setup guide for GitHub, GitLab, Bitbucket and CI.
 */
export default {
  name: 'WebhookPanel',
  props: {
    project: {
      type: Object,
      required: true,
    },
  },
  data() {
    return {
      webhook: null,
      revealing: false,
      showHelp: false,
    };
  },
  computed: {
    webhookSecret() {
      if (this.webhook) {
        return this.webhook.secret;
      }

      return null;
    },
    webhookUrl() {
      if (this.webhook) {
        return this.webhook.url;
      }

      return `${window.location.origin}/hooks/${this.project.uid}`;
    },
    curlExample() {
      return `curl -fsS -X POST \\\n  -H "Authorization: Bearer $SOLAROPS_SECRET" \\\n  ${this.webhookUrl}`;
    },
  },
  methods: {
    async revealWebhook() {
      this.revealing = true;

      try {
        this.webhook = await this.$api.get(`/projects/${this.project.uid}/deployment/webhook`);
      } catch (error) {
        this.$toast.error(error);
      } finally {
        this.revealing = false;
      }
    },
    async rotateSecret() {
      const confirmed = await this.$confirm({
        title: 'Rotate the webhook secret?',
        message: 'The current secret stops working immediately: update it in GitHub / GitLab / your CI.',
        confirmText: 'Rotate',
        icon: 'refresh-cw',
      });

      if (!confirmed) {
        return;
      }

      try {
        const { secret } = await this.$api.post(`/projects/${this.project.uid}/deployment/webhook/rotate`);
        this.webhook = { url: this.webhookUrl, secret, enabled: true };
        this.$toast.success('New secret generated.');
      } catch (error) {
        this.$toast.error(error);
      }
    },
  },
};
</script>
