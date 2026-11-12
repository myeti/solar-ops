<template>
  <div class="grid-2">
    <form class="panel fade-up" @submit.prevent="changePassword">
      <header class="panel-header">
        <span class="panel-icon"><FeatherIcon name="key" :size="17" /></span>
        <h3>Password</h3>
      </header>
      <div class="panel-body stack">
        <FormField label="E-mail" hint="Ask another admin to change it.">
          <input :value="$session.admin.email" class="input" disabled />
        </FormField>
        <FormField label="Current password" :error="passwordErrors.currentPassword">
          <input v-model="passwords.currentPassword" class="input" type="password" autocomplete="current-password" />
        </FormField>
        <FormField
          label="New password"
          :error="passwordErrors.newPassword"
          hint="At least 12 characters, mixing letters, digits or symbols."
        >
          <input v-model="passwords.newPassword" class="input" type="password" autocomplete="new-password" />
        </FormField>
        <FormField label="Confirm the new password" :error="confirmError">
          <input v-model="passwords.confirmation" class="input" type="password" autocomplete="new-password" />
        </FormField>
      </div>
      <footer class="panel-footer">
        <span class="tiny text-faint">Your other sessions will be closed.</span>
        <span class="spacer"></span>
        <button type="submit" class="btn btn-primary" :disabled="savingPassword || !canChangePassword">
          <span v-if="savingPassword" class="spinner"></span>
          Change password
        </button>
      </footer>
    </form>

    <section class="panel fade-up span-2">
      <header class="panel-header">
        <span class="panel-icon"><FeatherIcon name="log-out" :size="17" /></span>
        <h3>Sessions</h3>
      </header>
      <div class="panel-body row-between row-wrap">
        <p class="text-dim small">
          Signed in on a shared computer, or lost a device? Close every session of your account, including this one.
        </p>
        <button type="button" class="btn btn-danger" @click="logoutEverywhere">
          <FeatherIcon name="power" :size="16" />
          Sign out everywhere
        </button>
      </div>
    </section>
  </div>
</template>

<script>
/**
 * The current admin's own account.
 */
export default {
  name: 'AccountSettings',
  data() {
    return {
      passwords: { currentPassword: '', newPassword: '', confirmation: '' },
      passwordErrors: {},
      savingPassword: false,
    };
  },
  computed: {
    confirmError() {
      const { newPassword, confirmation } = this.passwords;

      if (confirmation !== '' && confirmation !== newPassword) {
        return 'The passwords do not match.';
      }

      return '';
    },
    canChangePassword() {
      const { currentPassword, newPassword, confirmation } = this.passwords;

      return currentPassword !== '' && newPassword !== '' && newPassword === confirmation;
    },
  },
  methods: {
    async changePassword() {
      this.savingPassword = true;
      this.passwordErrors = {};

      try {
        await this.$api.post('/auth/password', {
          currentPassword: this.passwords.currentPassword,
          newPassword: this.passwords.newPassword,
        });
        this.passwords = { currentPassword: '', newPassword: '', confirmation: '' };
        this.$toast.success('Password changed. Other sessions were closed.');
      } catch (error) {
        this.passwordErrors = error.fields;
        this.$toast.error(error);
      } finally {
        this.savingPassword = false;
      }
    },
    async logoutEverywhere() {
      const confirmed = await this.$confirm({
        title: 'Sign out everywhere?',
        message: 'Every session of your account is closed, including this one.',
        confirmText: 'Sign out everywhere',
        danger: true,
        icon: 'power',
      });

      if (!confirmed) {
        return;
      }

      try {
        await this.$api.post('/auth/logout-everywhere');
      } finally {
        this.$session.clear();
        this.$router.push({ name: 'login' });
      }
    },
  },
};
</script>
