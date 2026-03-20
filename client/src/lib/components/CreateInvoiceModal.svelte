<script lang="ts">
  import { Timestamp } from 'spacetimedb';
  import { deliveryNoteItems, deliveryNotes, getConnection, lineItems, orders, parties } from '../db';
  import { toast } from '../stores';
  import type { MoneyEventKind } from '../../module_bindings/types';
  import { formatBHD } from '../format';

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  let selectedPartyId = $state('');
  let selectedOrderId = $state('');
  let selectedDeliveryNoteId = $state('');
  let amountStr = $state('');
  let invoiceRef = $state('');
  let dueDateStr = $state('');
  let submitting = $state(false);
  let fieldError = $state('');

  let customers = $derived($parties.filter((p) => p.isCustomer));

  let orderOptions = $derived.by(() => {
    if (!selectedPartyId) return [];
    return $orders
      .filter((order) => String(order.partyId) === selectedPartyId)
      .sort((a, b) => Number(b.id - a.id));
  });

  let deliveryNoteOptions = $derived.by(() => {
    if (!selectedPartyId || !selectedOrderId) return [];
    return $deliveryNotes
      .filter((note) =>
        String(note.partyId) === selectedPartyId &&
        String(note.orderId) === selectedOrderId &&
        note.status.tag === 'Delivered'
      )
      .sort((a, b) => Number(b.id - a.id));
  });

  let selectedDeliverySubtotal = $derived.by(() => {
    if (!selectedDeliveryNoteId) return 0n;
    let subtotal = 0n;
    for (const dnItem of $deliveryNoteItems) {
      if (String(dnItem.deliveryNoteId) !== selectedDeliveryNoteId) continue;
      const source = $lineItems.find((item) => item.id === dnItem.lineItemId);
      if (!source) continue;
      subtotal += dnItem.quantityDelivered * source.unitPriceFils;
    }
    return subtotal;
  });

  let subtotalFils = $derived.by(() => {
    const parsed = parseFloat(amountStr);
    if (!amountStr || Number.isNaN(parsed) || parsed < 0) return 0n;
    return BigInt(Math.round(parsed * 1000));
  });

  let vatFils = $derived((subtotalFils + 5n) / 10n);
  let totalFils = $derived(subtotalFils + vatFils);
  const todayStr = new Date().toISOString().split('T')[0];

  let canSubmit = $derived(
    selectedPartyId !== '' &&
    selectedOrderId !== '' &&
    selectedDeliveryNoteId !== '' &&
    subtotalFils > 0n &&
    invoiceRef.trim() !== '' &&
    !submitting
  );

  function reset() {
    selectedPartyId = '';
    selectedOrderId = '';
    selectedDeliveryNoteId = '';
    amountStr = '';
    invoiceRef = '';
    dueDateStr = '';
    submitting = false;
    fieldError = '';
  }

  function close() {
    reset();
    onclose();
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    fieldError = '';

    if (!selectedPartyId) { fieldError = 'Customer is required.'; return; }
    if (!selectedOrderId) { fieldError = 'Order is required.'; return; }
    if (!selectedDeliveryNoteId) { fieldError = 'Delivered delivery note is required.'; return; }
    if (!amountStr) { fieldError = 'Amount is required.'; return; }

    const parsed = parseFloat(amountStr);
    if (Number.isNaN(parsed) || parsed <= 0) {
      fieldError = 'Enter a valid positive amount.';
      return;
    }
    if (!invoiceRef.trim()) {
      fieldError = 'Invoice reference is required.';
      return;
    }

    const conn = getConnection();
    if (!conn) {
      toast.danger('Not connected to the database.');
      return;
    }

    submitting = true;
    try {
      conn.reducers.recordMoneyEvent({
        partyId: BigInt(selectedPartyId),
        orderId: BigInt(selectedOrderId),
        deliveryNoteId: BigInt(selectedDeliveryNoteId),
        kind: { tag: 'CustomerInvoice' } as MoneyEventKind,
        subtotalFils: BigInt(Math.round(parsed * 1000)),
        reference: invoiceRef.trim(),
        dueDate: dueDateStr ? Timestamp.fromDate(new Date(dueDateStr)) : undefined,
      });
      toast.success('Invoice created.');
      close();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.danger(`Could not create invoice: ${msg}`);
    } finally {
      submitting = false;
    }
  }

  $effect(() => {
    if (!selectedPartyId) {
      selectedOrderId = '';
      selectedDeliveryNoteId = '';
      amountStr = '';
      return;
    }
    if (!orderOptions.some((order) => String(order.id) === selectedOrderId)) {
      selectedOrderId = '';
      selectedDeliveryNoteId = '';
      amountStr = '';
    }
  });

  $effect(() => {
    if (!selectedOrderId) {
      selectedDeliveryNoteId = '';
      amountStr = '';
      return;
    }
    if (!deliveryNoteOptions.some((note) => String(note.id) === selectedDeliveryNoteId)) {
      selectedDeliveryNoteId = '';
      amountStr = '';
    }
  });

  $effect(() => {
    amountStr = selectedDeliverySubtotal > 0n ? (Number(selectedDeliverySubtotal) / 1000).toFixed(3) : '';
  });
</script>

{#if open}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={handleBackdropClick}
    onkeydown={handleKeydown}
  >
    <div
      class="modal-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invoice-modal-title"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <div class="modal-header">
        <h2 id="invoice-modal-title" class="modal-title">New Customer Invoice</h2>
        <button
          type="button"
          class="close-btn"
          onclick={close}
          aria-label="Close modal"
          disabled={submitting}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 2l12 12M14 2L2 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <form class="modal-form" onsubmit={handleSubmit} novalidate>
        <div class="field">
          <label class="field-label" for="inv-customer">Customer</label>
          <select
            id="inv-customer"
            class="input select-input"
            bind:value={selectedPartyId}
            disabled={submitting}
            required
          >
            <option value="">Select a customer...</option>
            {#each customers as c (String(c.id))}
              <option value={String(c.id)}>{c.name}</option>
            {/each}
          </select>
        </div>

        <div class="field">
          <label class="field-label" for="inv-order">Order</label>
          <select
            id="inv-order"
            class="input select-input"
            bind:value={selectedOrderId}
            disabled={submitting || selectedPartyId === ''}
            required
          >
            <option value="">Select an order...</option>
            {#each orderOptions as order (String(order.id))}
              <option value={String(order.id)}>ORD-{String(order.id).padStart(3, '0')}</option>
            {/each}
          </select>
        </div>

        <div class="field">
          <label class="field-label" for="inv-dn">Delivered Delivery Note</label>
          <select
            id="inv-dn"
            class="input select-input"
            bind:value={selectedDeliveryNoteId}
            disabled={submitting || selectedOrderId === ''}
            required
          >
            <option value="">Select a delivered DN...</option>
            {#each deliveryNoteOptions as note (String(note.id))}
              <option value={String(note.id)}>{note.dnNumber}</option>
            {/each}
          </select>
          <span class="field-hint">Only delivered delivery notes can be invoiced.</span>
        </div>

        <div class="field">
          <label class="field-label" for="inv-amount">Amount (BHD)</label>
          <input
            id="inv-amount"
            class="input amount-input"
            type="number"
            min="0"
            step="0.001"
            placeholder="0.000"
            bind:value={amountStr}
            disabled={true}
            required
          />
          <span class="field-hint">Derived from the selected delivery note.</span>
        </div>

        {#if subtotalFils > 0n}
          <div class="vat-preview" aria-live="polite">
            <div class="vat-row">
              <span class="vat-label">Subtotal</span>
              <span class="vat-value">{formatBHD(subtotalFils)} BHD</span>
            </div>
            <div class="vat-row">
              <span class="vat-label">VAT (10%)</span>
              <span class="vat-value">{formatBHD(vatFils)} BHD</span>
            </div>
            <div class="vat-row vat-total-row">
              <span class="vat-label">Total</span>
              <span class="vat-value vat-total">{formatBHD(totalFils)} BHD</span>
            </div>
          </div>
        {/if}

        <div class="field">
          <label class="field-label" for="inv-ref">Invoice Reference</label>
          <input
            id="inv-ref"
            class="input"
            type="text"
            placeholder="e.g. INV-2026-001"
            maxlength="80"
            bind:value={invoiceRef}
            disabled={submitting}
            required
          />
          <span class="field-hint">Enter a unique invoice reference, e.g. INV-2026-001</span>
        </div>

        <div class="field">
          <label class="field-label" for="inv-due">Due Date <span class="optional">(optional)</span></label>
          <input
            id="inv-due"
            class="input"
            type="date"
            min={todayStr}
            bind:value={dueDateStr}
            disabled={submitting}
          />
        </div>

        {#if fieldError}
          <p class="field-error" role="alert">{fieldError}</p>
        {/if}

        <div class="modal-actions">
          <button
            type="button"
            class="btn btn-ghost"
            onclick={close}
            disabled={submitting}
          >
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
              Creating...
            {:else}
              Create Invoice
            {/if}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
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
    animation: modal-in var(--dur-normal) var(--ease-spring);
  }

  @keyframes modal-in {
    from { opacity: 0; transform: translateY(12px) scale(0.97); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-13);
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
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--ink-60);
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
    flex-shrink: 0;
  }

  .close-btn:hover:not(:disabled) {
    background: var(--ink-06);
    color: var(--ink);
  }

  .close-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .modal-form {
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

  .optional {
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    color: var(--ink-30);
  }

  .amount-input {
    font-family: var(--font-data);
  }

  .field-hint {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--ink-30);
  }

  .select-input {
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%231c1c1c' stroke-opacity='0.4' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right var(--sp-13) center;
    padding-right: var(--sp-34);
    cursor: pointer;
  }

  .vat-preview {
    background: var(--gold-glow);
    border: 1px solid var(--ink-12);
    border-radius: var(--radius-md);
    padding: var(--sp-13) var(--sp-16);
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
  }

  .vat-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .vat-label {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--ink-60);
  }

  .vat-value {
    font-family: var(--font-data);
    font-size: var(--text-sm);
    color: var(--ink);
  }

  .vat-total-row {
    border-top: 1px solid var(--ink-12);
    padding-top: var(--sp-5);
    margin-top: var(--sp-3);
  }

  .vat-total-row .vat-label {
    font-weight: 500;
    color: var(--ink);
  }

  .vat-total {
    font-size: var(--text-base);
    font-weight: 700;
    color: var(--ink);
  }

  .field-error {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--coral);
    margin: 0;
  }

  .modal-actions {
    display: flex;
    gap: var(--sp-8);
    justify-content: flex-end;
    margin-top: var(--sp-5);
  }

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

  @media (max-width: 520px) {
    .modal-card {
      padding: var(--sp-21);
    }

    .modal-actions {
      flex-direction: column-reverse;
    }

    .modal-actions .btn {
      width: 100%;
      justify-content: center;
    }
  }
</style>
