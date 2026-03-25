<script lang="ts">
  import { getConnection } from '../db';
  import { toast } from '../stores';
  import type { CustomerGrade } from '../../module_bindings/types';

  // ── Props ─────────────────────────────────────────────────────────────────

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  // ── Local state ───────────────────────────────────────────────────────────

  let name        = $state('');
  let isCustomer  = $state(true);
  let isSupplier  = $state(false);
  let gradeTag    = $state('A');
  let trn         = $state('');
  let productTypes = $state('');
  let notes       = $state('');
  let submitting  = $state(false);
  let fieldError  = $state('');

  // ── Grade options ─────────────────────────────────────────────────────────

  const gradeOptions = [
    { value: 'A', label: 'A — Premium (45d, 7% disc)' },
    { value: 'B', label: 'B — Standard (90d, 3% disc)' },
    { value: 'C', label: 'C — Irregular (60d, 0% disc)' },
    { value: 'D', label: 'D — Advance only' },
  ];

  // ── Keyboard handler ──────────────────────────────────────────────────────

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    fieldError = '';

    const trimmedName = name.trim();
    if (!trimmedName) { fieldError = 'Name is required.'; return; }
    if (!isCustomer && !isSupplier) {
      fieldError = 'At least one of Customer or Supplier must be selected.';
      return;
    }

    const conn = getConnection();
    if (!conn) {
      toast.danger('Not connected to the database yet.');
      return;
    }

    submitting = true;
    try {
      conn.reducers.upsertParty({
        id: 0n,
        name: trimmedName,
        code: undefined,
        category: undefined,
        isCustomer,
        isSupplier,
        grade: { tag: gradeTag } as CustomerGrade,
        creditLimitFils: 0n,
        paymentTermsDays: 0n,
        productTypes: productTypes.trim(),
        annualGoalFils: 0n,
        city: undefined,
        country: undefined,
        phone: undefined,
        email: undefined,
        source: 'manual_ui',
        active2024: undefined,
        active2025: undefined,
        active2026: undefined,
        // TRN is stored in notes with a structured prefix so it can be
        // parsed later. Format: "TRN:<value>\n<rest of notes>".
        // When TRN is blank the notes field is stored as-is.
        notes: trn.trim()
          ? `TRN:${trn.trim()}\n${notes.trim()}`.trimEnd()
          : notes.trim(),
        bankIban: '',
        bankSwift: '',
        bankAccountName: '',
      });
      toast.success(`Party "${trimmedName}" created.`);
      // Reset form
      name = '';
      isCustomer = true;
      isSupplier = false;
      gradeTag = 'A';
      trn = '';
      productTypes = '';
      notes = '';
      onclose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.danger(`Could not create party: ${msg}`);
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- Backdrop -->
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={onclose}
  >
    <!-- Card — stop propagation so clicks inside don't close the modal -->
    <div
      class="modal-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >

      <!-- Header -->
      <div class="modal-header">
        <h2 id="modal-title" class="modal-title">New Party</h2>
        <button
          class="close-btn"
          type="button"
          onclick={onclose}
          aria-label="Close"
          disabled={submitting}
        >
          &#x2715;
        </button>
      </div>

      <!-- Form -->
      <form class="modal-form" onsubmit={handleSubmit} novalidate>

        <!-- Name -->
        <div class="field">
          <label class="field-label" for="cp-name">Name</label>
          <input
            id="cp-name"
            class="input"
            type="text"
            bind:value={name}
            placeholder="e.g. Al Zain Trading"
            maxlength="120"
            disabled={submitting}
            required
          />
        </div>

        <!-- Role toggles -->
        <div class="field">
          <span class="field-label">Type</span>
          <div class="checkbox-row">
            <label class="checkbox-label">
              <input
                type="checkbox"
                class="checkbox"
                bind:checked={isCustomer}
                disabled={submitting}
              />
              Customer
            </label>
            <label class="checkbox-label">
              <input
                type="checkbox"
                class="checkbox"
                bind:checked={isSupplier}
                disabled={submitting}
              />
              Supplier
            </label>
          </div>
        </div>

        <!-- Grade (only when isCustomer) -->
        {#if isCustomer}
          <div class="field">
            <label class="field-label" for="cp-grade">Customer Grade</label>
            <select
              id="cp-grade"
              class="input select-input"
              bind:value={gradeTag}
              disabled={submitting}
            >
              {#each gradeOptions as opt (opt.value)}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
          </div>
        {/if}

        <!-- TRN (Tax Registration Number) — optional, required on Bahrain VAT invoices -->
        <div class="field">
          <label class="field-label" for="cp-trn">
            Tax Registration Number (TRN)
            <span class="optional">(optional)</span>
          </label>
          <input
            id="cp-trn"
            class="input"
            type="text"
            bind:value={trn}
            placeholder="e.g. 123456789012345"
            maxlength="20"
            disabled={submitting}
          />
          <span class="field-hint">Bahrain VAT TRN — must appear on tax invoices for VAT-registered buyers.</span>
        </div>

        <!-- Product Types -->
        <div class="field">
          <label class="field-label" for="cp-products">Product Types</label>
          <input
            id="cp-products"
            class="input"
            type="text"
            bind:value={productTypes}
            placeholder="e.g. Flow meters, Pressure transmitters"
            disabled={submitting}
          />
          <span class="field-hint">Comma-separated</span>
        </div>

        <!-- Notes -->
        <div class="field">
          <label class="field-label" for="cp-notes">Notes</label>
          <textarea
            id="cp-notes"
            class="input textarea"
            bind:value={notes}
            placeholder="Any additional context..."
            rows="3"
            disabled={submitting}
          ></textarea>
        </div>

        <!-- Field error -->
        {#if fieldError}
          <p class="field-error" role="alert">{fieldError}</p>
        {/if}

        <!-- Actions -->
        <div class="modal-actions">
          <button
            type="button"
            class="btn btn-ghost"
            onclick={onclose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            class="btn btn-gold"
            disabled={submitting}
            aria-busy={submitting}
          >
            {#if submitting}
              <span class="spinner" aria-hidden="true"></span>
              Creating…
            {:else}
              Create Party
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
    background: rgba(28, 28, 28, 0.48);
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
    width: 28px;
    height: 28px;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--ink-60);
    font-size: var(--text-base);
    cursor: pointer;
    flex-shrink: 0;
    transition: background var(--dur-fast) var(--ease-out),
                color var(--dur-fast) var(--ease-out);
  }

  .close-btn:hover:not(:disabled) {
    background: var(--ink-06);
    color: var(--ink);
  }

  .close-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
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

  .optional {
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    color: var(--ink-30);
  }

  /* ── Checkbox row ─────────────────────────────────────────────────────── */
  .checkbox-row {
    display: flex;
    gap: var(--sp-21);
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: var(--sp-8);
    font-family: var(--font-ui);
    font-size: var(--text-base);
    color: var(--ink);
    cursor: pointer;
    user-select: none;
  }

  .checkbox {
    width: 16px;
    height: 16px;
    accent-color: var(--gold);
    cursor: pointer;
    flex-shrink: 0;
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

  /* ── Textarea ─────────────────────────────────────────────────────────── */
  .textarea {
    resize: vertical;
    min-height: 72px;
    font-family: var(--font-ui);
    line-height: 1.5;
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
    justify-content: flex-end;
    gap: var(--sp-8);
    margin-top: var(--sp-5);
  }

  /* ── Ghost button ─────────────────────────────────────────────────────── */
  .btn-ghost {
    background: none;
    border: 1px solid var(--ink-12);
    color: var(--ink-60);
    font-family: var(--font-ui);
    font-size: var(--text-base);
    padding: var(--sp-8) var(--sp-16);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease-out),
                color var(--dur-fast) var(--ease-out);
  }

  .btn-ghost:hover:not(:disabled) {
    background: var(--ink-06);
    color: var(--ink);
  }

  .btn-ghost:disabled {
    opacity: 0.4;
    cursor: not-allowed;
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
  @media (max-width: 540px) {
    .modal-card {
      padding: var(--sp-21);
      border-radius: var(--radius-md);
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
