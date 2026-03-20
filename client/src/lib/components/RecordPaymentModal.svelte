<script lang="ts">
  import { getConnection, parties, moneyEvents } from '../db';
  import { toast } from '../stores';
  import { formatBHD } from '../format';
  import type { MoneyEventKind } from '../../module_bindings/types';

  // ── Props ─────────────────────────────────────────────────────────────────

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  // ── Local state ───────────────────────────────────────────────────────────

  let selectedPartyId = $state('');
  let amount          = $state('');
  let paymentRef      = $state('');
  let paymentMethod   = $state('Bank Transfer');
  let submitting      = $state(false);
  let fieldError      = $state('');

  // STORM-12: available payment methods for Bahrain SMB context
  const paymentMethods = [
    'Bank Transfer',
    'Cheque',
    'Cash',
    'EFTS',
  ];

  // ── Derived ───────────────────────────────────────────────────────────────

  const customers = $derived($parties.filter((p) => p.isCustomer));

  const outstanding = $derived.by(() => {
    if (!selectedPartyId) return 0n;
    const pid = BigInt(selectedPartyId);
    let invoiced = 0n;
    let paid     = 0n;
    for (const evt of $moneyEvents) {
      if (evt.partyId !== pid) continue;
      const tag = (evt.kind as any)?.tag;
      if (tag === 'CustomerInvoice') invoiced += evt.totalFils;
      if (tag === 'CustomerPayment') paid     += evt.totalFils;
    }
    return invoiced > paid ? invoiced - paid : 0n;
  });

  const amountFils = $derived.by(() => {
    const parsed = parseFloat(amount);
    if (!amount || isNaN(parsed) || parsed <= 0) return 0n;
    return BigInt(Math.round(parsed * 1000));
  });

  const exceedsOutstanding = $derived(
    outstanding > 0n && amountFils > outstanding
  );

  const canSubmit = $derived(
    selectedPartyId !== '' &&
    amountFils > 0n &&
    paymentRef.trim() !== '' &&
    !exceedsOutstanding &&
    !submitting
  );

  // ── Helpers ───────────────────────────────────────────────────────────────

  function reset() {
    selectedPartyId = '';
    amount          = '';
    paymentRef      = '';
    paymentMethod   = 'Bank Transfer';
    fieldError      = '';
    submitting      = false;
  }

  function handleClose() {
    reset();
    onclose();
  }

  function handleBackdropClick(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains('modal-backdrop')) {
      handleClose();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') handleClose();
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    fieldError = '';

    if (!selectedPartyId) { fieldError = 'Select a customer.'; return; }
    if (amountFils <= 0n)  { fieldError = 'Enter a valid amount.'; return; }
    if (!paymentRef.trim()) { fieldError = 'Payment reference is required.'; return; }
    if (exceedsOutstanding) { fieldError = 'Amount exceeds outstanding balance.'; return; }

    const conn = getConnection();
    if (!conn) {
      toast.danger('Not connected to the database.');
      return;
    }

    submitting = true;
    try {
      // RC-5 fix: CustomerPayment events are VAT-exempt — the customer has already paid
      // the VAT-inclusive total. subtotalFils here = totalFils = actual cash received.
      // The server MUST NOT apply additional VAT to payment events.
      // STORM-12: Encode payment method as a structured prefix on the reference
      // field so it survives to audit logs without requiring a schema change.
      // Format: "[Bank Transfer] CHQ-1042" or "[Cash] RCPT-00042"
      const ref = paymentRef.trim();
      const encodedRef = ref ? `[${paymentMethod}] ${ref}` : `[${paymentMethod}]`;

      conn.reducers.recordMoneyEvent({
        partyId:      BigInt(selectedPartyId),
        orderId:      undefined,
        deliveryNoteId: undefined,
        kind:         { tag: 'CustomerPayment' } as MoneyEventKind,
        subtotalFils: amountFils,   // actual amount received, VAT-inclusive, no further VAT applied
        reference:    encodedRef,
        dueDate:      undefined,
      });
      toast.success('Payment recorded!');
      handleClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.danger(`Could not record payment: ${msg}`);
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
<div class="modal-backdrop" role="presentation" onclick={handleBackdropClick} onkeydown={handleKeydown}>
  <div
    class="modal-card"
    role="dialog"
    aria-modal="true"
    aria-labelledby="rp-title"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
  >

    <!-- Header -->
    <div class="modal-header">
      <h2 id="rp-title" class="modal-title">Record Payment</h2>
      <button type="button" class="close-btn" onclick={handleClose} aria-label="Close">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <line x1="2" y1="2" x2="14" y2="14" />
          <line x1="14" y1="2" x2="2" y2="14" />
        </svg>
      </button>
    </div>

    <!-- Form -->
    <form class="modal-form" onsubmit={handleSubmit} novalidate>

      <!-- Customer -->
      <div class="field">
        <label class="field-label" for="rp-customer">Customer</label>
        <select
          id="rp-customer"
          class="input select-input"
          bind:value={selectedPartyId}
          disabled={submitting}
        >
          <option value="">Select a customer…</option>
          {#each customers as party (party.id)}
            <option value={String(party.id)}>{party.name}</option>
          {/each}
        </select>
      </div>

      <!-- Outstanding balance -->
      {#if selectedPartyId}
        <div class="balance-row" class:balance-positive={outstanding > 0n} class:balance-zero={outstanding === 0n}>
          <span class="balance-label">Outstanding</span>
          <span class="balance-amount">{formatBHD(outstanding)} BHD</span>
        </div>
      {/if}

      <!-- Amount — RC-5: label makes clear this is the VAT-inclusive total received -->
      <div class="field">
        <label class="field-label" for="rp-amount">Amount Received (BHD, VAT-inclusive)</label>
        <input
          id="rp-amount"
          class="input amount-input"
          type="number"
          min="0.001"
          step="0.001"
          placeholder="0.000"
          bind:value={amount}
          disabled={submitting}
          required
        />
        {#if exceedsOutstanding}
          <p class="amount-warning" role="alert">Exceeds outstanding balance of {formatBHD(outstanding)} BHD</p>
        {/if}
      </div>

      <!-- Payment Method — STORM-12 -->
      <div class="field">
        <label class="field-label" for="rp-method">Payment Method</label>
        <select
          id="rp-method"
          class="input select-input"
          bind:value={paymentMethod}
          disabled={submitting}
        >
          {#each paymentMethods as method (method)}
            <option value={method}>{method}</option>
          {/each}
        </select>
      </div>

      <!-- Payment Reference -->
      <div class="field">
        <label class="field-label" for="rp-ref">Payment Reference</label>
        <input
          id="rp-ref"
          class="input"
          type="text"
          placeholder="e.g. CHQ-1042, TRF-20260309"
          bind:value={paymentRef}
          maxlength="80"
          disabled={submitting}
          required
        />
        <span class="field-hint">Cheque number, transfer reference, or receipt ID</span>
      </div>

      <!-- Field error -->
      {#if fieldError}
        <p class="field-error" role="alert">{fieldError}</p>
      {/if}

      <!-- Actions -->
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick={handleClose} disabled={submitting}>
          Cancel
        </button>
        <button
          type="submit"
          class="btn btn-gold"
          disabled={!canSubmit}
          aria-busy={submitting}
        >
          {#if submitting}
            <span class="spinner" aria-hidden="true"></span>
            Recording…
          {:else}
            Record Payment
          {/if}
        </button>
      </div>

    </form>
  </div>
</div>
{/if}

<style>
  /* ── Backdrop ─────────────────────────────────────────────────────────── */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(28, 28, 28, 0.45);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    z-index: var(--z-modal);
    padding: var(--sp-21);
  }

  /* ── Card ─────────────────────────────────────────────────────────────── */
  .modal-card {
    width: 100%;
    max-width: 480px;
    background: var(--paper-card);
    border: 1px solid var(--ink-12);
    border-radius: var(--radius-lg);
    padding: var(--sp-34);
    display: flex;
    flex-direction: column;
    gap: var(--sp-21);
    box-shadow: var(--shadow-lg);
  }

  /* ── Header ───────────────────────────────────────────────────────────── */
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .modal-title {
    font-family: var(--font-display);
    font-size: var(--text-lg);
    font-weight: 400;
    color: var(--ink);
    margin: 0;
    line-height: 1.2;
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    background: transparent;
    color: var(--ink-60);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease-out),
                color var(--dur-fast) var(--ease-out);
  }

  .close-btn:hover {
    background: var(--ink-06);
    color: var(--ink);
  }

  /* ── Form ─────────────────────────────────────────────────────────────── */
  .modal-form {
    display: flex;
    flex-direction: column;
    gap: var(--sp-16);
  }

  /* ── Field ────────────────────────────────────────────────────────────── */
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

  .field-hint {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--ink-30);
  }

  /* ── Amount input: monospaced for numbers ─────────────────────────────── */
  .amount-input {
    font-family: var(--font-data);
    letter-spacing: 0.02em;
  }

  .amount-warning {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--coral);
    margin: 0;
  }

  /* ── Select ───────────────────────────────────────────────────────────── */
  .select-input {
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%231c1c1c' stroke-opacity='0.4' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right var(--sp-13) center;
    padding-right: var(--sp-34);
    cursor: pointer;
  }

  /* ── Outstanding balance ──────────────────────────────────────────────── */
  .balance-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-13) var(--sp-16);
    border-radius: var(--radius-sm);
    border: 1px solid var(--ink-12);
  }

  .balance-label {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 500;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  .balance-amount {
    font-family: var(--font-data);
    font-size: var(--text-md);
    font-weight: 700;
    letter-spacing: 0.02em;
  }

  .balance-positive {
    background: var(--coral-soft);
    border-color: rgba(220, 38, 38, 0.2);
  }

  .balance-positive .balance-label,
  .balance-positive .balance-amount {
    color: var(--coral);
  }

  .balance-zero {
    background: var(--sage-soft);
    border-color: rgba(5, 150, 105, 0.2);
  }

  .balance-zero .balance-label,
  .balance-zero .balance-amount {
    color: var(--sage);
  }

  /* ── Field error ──────────────────────────────────────────────────────── */
  .field-error {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--coral);
    margin: 0;
  }

  /* ── Actions ──────────────────────────────────────────────────────────── */
  .modal-actions {
    display: flex;
    gap: var(--sp-8);
    justify-content: flex-end;
    margin-top: var(--sp-5);
  }

  /* ── Spinner ──────────────────────────────────────────────────────────── */
  .spinner {
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255, 255, 255, 0.35);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.65s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* ── Responsive ───────────────────────────────────────────────────────── */
  @media (max-width: 480px) {
    .modal-card {
      padding: var(--sp-21);
    }

    .modal-actions {
      flex-direction: column-reverse;
    }

    .modal-actions .btn {
      width: 100%;
    }
  }
</style>
