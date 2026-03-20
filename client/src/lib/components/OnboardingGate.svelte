<script lang="ts">
  import { getConnection, members } from '../db';
  import { toast } from '../stores';

  let accessKey = $state('');
  let nickname = $state('');
  let fullName = $state('');
  let email = $state('');
  let submitting = $state(false);
  let fieldError = $state('');

  const needsBootstrap = $derived($members.length === 0);

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    fieldError = '';

    const key = accessKey.trim().toUpperCase();
    const nick = nickname.trim();
    const full = fullName.trim();
    const mail = email.trim().toLowerCase();

    if (!nick) { fieldError = 'Nickname is required.'; return; }
    if (!full) { fieldError = 'Full name is required.'; return; }
    if (!mail || !mail.includes('@')) { fieldError = 'A valid email is required.'; return; }
    if (!needsBootstrap && !key) { fieldError = 'Access key is required.'; return; }

    const conn = getConnection();
    if (!conn) {
      toast.danger('Not connected to the database yet.');
      return;
    }

    submitting = true;
    try {
      if (needsBootstrap) {
        conn.reducers.bootstrapAdmin({
          nickname: nick,
          fullName: full,
          email: mail,
        });
        toast.success('Bootstrap admin created.');
      } else {
        conn.reducers.redeemAccessKey({
          key,
          nickname: nick,
          fullName: full,
          email: mail,
        });
        toast.success('Access key redeemed. Welcome aboard.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.danger(`Could not complete sign-in: ${msg}`);
    } finally {
      submitting = false;
    }
  }
</script>

<div class="onboarding-backdrop">
  <div class="onboarding-card" role="main" aria-labelledby="onboarding-title">
    <div class="brand-row">
      <span class="brand-hex" aria-hidden="true">[]</span>
      <span class="brand-name">AsymmFlow</span>
    </div>

    <div class="heading-block">
      <h1 id="onboarding-title" class="heading">Welcome to AsymmFlow</h1>
      <p class="subheading">Your AI-powered business assistant for managing invoices, customers, orders, and payments.</p>
      <p class="subheading subheading-secondary">
        {needsBootstrap
          ? 'Create the first admin account to bootstrap the workspace.'
          : 'Enter your issued access key to register this browser identity.'}
      </p>
    </div>

    <form class="onboarding-form" onsubmit={handleSubmit} novalidate>
      {#if !needsBootstrap}
        <div class="field">
          <label class="field-label" for="ob-access-key">Access Key</label>
          <input
            id="ob-access-key"
            class="input"
            type="text"
            bind:value={accessKey}
            placeholder="PH-MGR-A1B2C3"
            autocomplete="one-time-code"
            maxlength="32"
            disabled={submitting}
            required
          />
        </div>
      {/if}

      <div class="field">
        <label class="field-label" for="ob-nickname">Nickname</label>
        <input
          id="ob-nickname"
          class="input"
          type="text"
          bind:value={nickname}
          placeholder="e.g. sarat"
          autocomplete="nickname"
          maxlength="32"
          disabled={submitting}
          required
        />
      </div>

      <div class="field">
        <label class="field-label" for="ob-fullname">Full Name</label>
        <input
          id="ob-fullname"
          class="input"
          type="text"
          bind:value={fullName}
          placeholder="e.g. Sarat Chandra"
          autocomplete="name"
          maxlength="80"
          disabled={submitting}
          required
        />
      </div>

      <div class="field">
        <label class="field-label" for="ob-email">Email</label>
        <input
          id="ob-email"
          class="input"
          type="email"
          bind:value={email}
          placeholder="you@company.com"
          autocomplete="email"
          maxlength="120"
          disabled={submitting}
          required
        />
      </div>

      {#if fieldError}
        <p class="field-error" role="alert">{fieldError}</p>
      {/if}

      <button
        type="submit"
        class="btn btn-gold submit-btn"
        disabled={submitting}
        aria-busy={submitting}
      >
        {#if submitting}
          <span class="spinner" aria-hidden="true"></span>
          Signing in...
        {:else}
          {needsBootstrap ? 'Create Admin Account' : 'Redeem Access Key'}
        {/if}
      </button>
    </form>
  </div>
</div>

<style>
  .onboarding-backdrop {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--paper);
    z-index: 100;
    padding: var(--sp-21);
  }

  .onboarding-card {
    width: 100%;
    max-width: 420px;
    background: var(--paper-card);
    border: 1px solid var(--ink-12);
    border-radius: var(--radius-lg);
    padding: var(--sp-40) var(--sp-34);
    display: flex;
    flex-direction: column;
    gap: var(--sp-21);
    box-shadow: var(--shadow-lg);
  }

  .brand-row {
    display: flex;
    align-items: center;
    gap: var(--sp-8);
  }

  .brand-hex {
    font-size: 1.5rem;
    color: var(--gold);
    line-height: 1;
  }

  .brand-name {
    font-family: var(--font-display);
    font-size: var(--text-md);
    font-weight: 500;
    letter-spacing: 0.04em;
    color: var(--ink);
  }

  .heading-block {
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
  }

  .heading {
    font-family: var(--font-display);
    font-size: var(--text-xl);
    font-weight: 400;
    color: var(--ink);
    margin: 0;
    line-height: 1.2;
  }

  .subheading {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--ink-60);
    margin: 0;
  }

  .subheading-secondary {
    font-size: var(--text-xs);
    color: var(--ink-30);
    margin-top: var(--sp-3);
  }

  .onboarding-form {
    display: flex;
    flex-direction: column;
    gap: var(--sp-16);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
  }

  .field-label {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--ink-60);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .input {
    width: 100%;
  }

  .field-error {
    margin: 0;
    color: var(--coral);
    font-size: var(--text-xs);
  }

  .submit-btn {
    width: 100%;
    justify-content: center;
  }

  .spinner {
    width: 1rem;
    height: 1rem;
    border-radius: 999px;
    border: 2px solid rgba(255, 255, 255, 0.35);
    border-top-color: white;
    animation: spin 0.75s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
