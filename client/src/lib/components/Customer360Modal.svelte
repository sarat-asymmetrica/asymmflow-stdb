<script lang="ts">
  import { parties, contacts, moneyEvents, pipelines, orders } from '../db';
  import { formatBHD, formatDate, gradeColor, gradeBackground } from '../format';
  import { loadNoteStore, getNotesForEntity, type EntityNote } from '../business/entityNotes';

  // ── Props ─────────────────────────────────────────────────────────────────

  let { open, partyId, onclose }: {
    open: boolean;
    partyId: bigint | null;
    onclose: () => void;
  } = $props();

  // ── Active tab ────────────────────────────────────────────────────────────

  let activeTab = $state<'invoices' | 'payments' | 'pipeline' | 'contacts' | 'notes'>('invoices');

  const tabs = [
    { id: 'invoices',  label: 'Invoices'  },
    { id: 'payments',  label: 'Payments'  },
    { id: 'pipeline',  label: 'Pipeline'  },
    { id: 'contacts',  label: 'Contacts'  },
    { id: 'notes',     label: 'Notes'     },
  ] as const;

  // ── Derived data ──────────────────────────────────────────────────────────

  let party = $derived($parties.find(p => p.id === partyId));

  let partyInvoices = $derived(
    $moneyEvents
      .filter(ev => ev.partyId === partyId && (ev.kind as any)?.tag === 'CustomerInvoice')
      .sort((a, b) => Number(b.id - a.id))
  );

  let partyPayments = $derived(
    $moneyEvents
      .filter(ev => ev.partyId === partyId && (ev.kind as any)?.tag === 'CustomerPayment')
      .sort((a, b) => Number(b.id - a.id))
  );

  let totalInvoicedFils = $derived(partyInvoices.reduce((s, e) => s + e.totalFils, 0n));
  let totalPaidFils     = $derived(partyPayments.reduce((s, e) => s + e.totalFils, 0n));
  let outstandingFils   = $derived(totalInvoicedFils - totalPaidFils);

  let overdueFils = $derived.by(() => {
    const nowMicros = BigInt(Date.now()) * 1000n;
    return partyInvoices
      .filter(ev => ev.dueDate && ev.dueDate.microsSinceUnixEpoch < nowMicros && !ev.paidAt)
      .reduce((s, e) => s + e.totalFils, 0n);
  });

  let partyPipelines = $derived($pipelines.filter(p => p.partyId === partyId));
  let partyContacts  = $derived($contacts.filter(c => c.partyId === partyId));

  let noteStore = $state(loadNoteStore());
  let partyNotes = $derived.by(() => {
    if (!partyId) return [];
    return getNotesForEntity(noteStore, party?.isSupplier ? 'supplier' : 'customer', String(partyId));
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  function isOverdue(ev: (typeof partyInvoices)[0]): boolean {
    if (!ev.dueDate || (ev as any).paidAt) return false;
    const nowMicros = BigInt(Date.now()) * 1000n;
    return ev.dueDate.microsSinceUnixEpoch < nowMicros;
  }

  function invoiceStatus(ev: (typeof partyInvoices)[0]): string {
    if ((ev as any).paidAt) return 'Paid';
    if (isOverdue(ev))       return 'Overdue';
    return 'Open';
  }

  function grade(): string {
    return (party?.grade as any)?.tag ?? '?';
  }

  function pipelineStatus(p: (typeof partyPipelines)[0]): string {
    return (p.status as any)?.tag ?? String(p.status);
  }

  function winProb(p: (typeof partyPipelines)[0]): string {
    const pct = Number((p as any).winProbabilityBps ?? 0) / 100;
    return `${pct.toFixed(0)}%`;
  }

  function followUpDate(p: (typeof partyPipelines)[0]): string {
    const ts = (p as any).nextFollowUp;
    if (!ts) return '—';
    return formatDate(ts);
  }

  // ── Modal close handlers ──────────────────────────────────────────────────

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onclose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }

  // Reset tab when modal opens for a new party
  $effect(() => {
    if (open) activeTab = 'pipeline';
  });
</script>

{#if open && party}
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
      aria-labelledby="c360-title"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >

      <!-- ── Header ──────────────────────────────────────────────────────── -->
      <div class="modal-header">
        <div class="header-main">
          <span
            class="grade-badge"
            style="color:{gradeColor(grade())};background:{gradeBackground(grade())}"
          >
            {grade()}
          </span>
          <div class="header-names">
            <h2 id="c360-title" class="modal-title">{party.name}</h2>
            <div class="header-meta">
              <span class="meta-chip">Net {Number(party.paymentTermsDays)} days</span>
              {#if party.isCreditBlocked}
                <span class="meta-chip meta-chip-blocked">BLOCKED</span>
              {:else}
                <span class="meta-chip meta-chip-active">Active</span>
              {/if}
            </div>
          </div>
        </div>
        <button
          type="button"
          class="close-btn"
          onclick={onclose}
          aria-label="Close"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 2l12 12M14 2L2 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>

      <!-- ── KPI cards ───────────────────────────────────────────────────── -->
      <div class="kpi-row">
        <div class="kpi-card">
          <span class="kpi-label">Total Invoiced</span>
          <span class="kpi-value">{formatBHD(totalInvoicedFils)} <span class="kpi-ccy">BHD</span></span>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">Total Paid</span>
          <span class="kpi-value kpi-value-sage">{formatBHD(totalPaidFils)} <span class="kpi-ccy">BHD</span></span>
        </div>
        <div class="kpi-card" class:kpi-card-warn={outstandingFils > 0n}>
          <span class="kpi-label">Outstanding</span>
          <span class="kpi-value" class:kpi-value-coral={outstandingFils > 0n}>
            {formatBHD(outstandingFils)} <span class="kpi-ccy">BHD</span>
          </span>
        </div>
        <div class="kpi-card" class:kpi-card-warn={overdueFils > 0n}>
          <span class="kpi-label">Overdue</span>
          <span class="kpi-value" class:kpi-value-coral={overdueFils > 0n}>
            {formatBHD(overdueFils)} <span class="kpi-ccy">BHD</span>
          </span>
        </div>
      </div>

      {#if party?.isSupplier && (party.bankIban || party.bankSwift)}
        <div class="bank-details">
          {#if party.bankIban}
            <div class="detail-row">
              <span class="detail-label">IBAN</span>
              <span class="detail-value mono">{party.bankIban}</span>
            </div>
          {/if}
          {#if party.bankSwift}
            <div class="detail-row">
              <span class="detail-label">SWIFT</span>
              <span class="detail-value mono">{party.bankSwift}</span>
            </div>
          {/if}
          {#if party.bankAccountName}
            <div class="detail-row">
              <span class="detail-label">Account</span>
              <span class="detail-value">{party.bankAccountName}</span>
            </div>
          {/if}
        </div>
      {/if}

      <!-- ── Tabs ────────────────────────────────────────────────────────── -->
      <div class="tabs-row">
        {#each tabs as tab}
          <button
            class="tab-btn"
            class:tab-active={activeTab === tab.id}
            onclick={() => (activeTab = tab.id)}
          >
            {tab.label}
            {#if tab.id === 'invoices' && partyInvoices.length > 0}
              <span class="tab-count">{partyInvoices.length}</span>
            {:else if tab.id === 'payments' && partyPayments.length > 0}
              <span class="tab-count">{partyPayments.length}</span>
            {:else if tab.id === 'pipeline' && partyPipelines.length > 0}
              <span class="tab-count">{partyPipelines.length}</span>
            {:else if tab.id === 'contacts' && partyContacts.length > 0}
              <span class="tab-count">{partyContacts.length}</span>
            {:else if tab.id === 'notes' && partyNotes.length > 0}
              <span class="tab-count">{partyNotes.length}</span>
            {/if}
          </button>
        {/each}
      </div>

      <!-- ── Tab content ─────────────────────────────────────────────────── -->
      <div class="tab-content">

        <!-- Invoices -->
        {#if activeTab === 'invoices'}
          {#if partyInvoices.length === 0}
            <div class="empty-state">No invoices for this customer.</div>
          {:else}
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Reference</th>
                    <th class="num-col">Subtotal</th>
                    <th class="num-col">VAT</th>
                    <th class="num-col">Total (BHD)</th>
                    <th>Status</th>
                    <th>Due Date</th>
                  </tr>
                </thead>
                <tbody>
                  {#each partyInvoices as ev (ev.id)}
                    {@const status = invoiceStatus(ev)}
                    <tr class="table-row" class:row-overdue={status === 'Overdue'}>
                      <td class="cell-muted">{formatDate(ev.createdAt)}</td>
                      <td class="cell-ref">{ev.reference || '—'}</td>
                      <td class="num-col cell-mono">{formatBHD(ev.subtotalFils)}</td>
                      <td class="num-col cell-mono cell-muted">{formatBHD(ev.vatFils)}</td>
                      <td class="num-col cell-mono cell-bold">{formatBHD(ev.totalFils)}</td>
                      <td>
                        <span
                          class="status-chip"
                          class:status-paid={status === 'Paid'}
                          class:status-overdue={status === 'Overdue'}
                          class:status-open={status === 'Open'}
                        >
                          {status}
                        </span>
                      </td>
                      <td class="cell-muted">
                        {ev.dueDate ? formatDate(ev.dueDate) : '—'}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        {/if}

        <!-- Payments -->
        {#if activeTab === 'payments'}
          {#if partyPayments.length === 0}
            <div class="empty-state">No payments recorded for this customer.</div>
          {:else}
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Reference</th>
                    <th class="num-col">Amount (BHD)</th>
                    <th>Method</th>
                  </tr>
                </thead>
                <tbody>
                  {#each partyPayments as ev (ev.id)}
                    <tr class="table-row">
                      <td class="cell-muted">{formatDate(ev.createdAt)}</td>
                      <td class="cell-ref">{ev.reference || '—'}</td>
                      <td class="num-col cell-mono cell-bold">{formatBHD(ev.totalFils)}</td>
                      <td class="cell-muted">{(ev as any).paymentMethod ?? '—'}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        {/if}

        <!-- Pipeline -->
        {#if activeTab === 'pipeline'}
          {#if partyPipelines.length === 0}
            <div class="empty-state">No pipeline entries for this customer.</div>
          {:else}
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Status</th>
                    <th class="num-col">Est. Value (BHD)</th>
                    <th class="num-col">Win Prob.</th>
                    <th>Next Follow-up</th>
                    <th>Competitor</th>
                  </tr>
                </thead>
                <tbody>
                  {#each partyPipelines.slice().sort((a, b) => {
                    const aActive = pipelineStatus(a) === 'Active' ? 0 : 1;
                    const bActive = pipelineStatus(b) === 'Active' ? 0 : 1;
                    return aActive - bActive;
                  }) as pl (pl.id)}
                    {@const st = pipelineStatus(pl)}
                    <tr class="table-row">
                      <td class="cell-title">{pl.title}</td>
                      <td>
                        <span
                          class="status-chip"
                          class:status-active={st === 'Active'}
                          class:status-won={st === 'Won'}
                          class:status-lost={st === 'Lost'}
                        >
                          {st}
                        </span>
                      </td>
                      <td class="num-col cell-mono">{pl.estimatedValueFils != null ? formatBHD(pl.estimatedValueFils) : '—'}</td>
                      <td class="num-col cell-muted">{winProb(pl)}</td>
                      <td class="cell-muted">{followUpDate(pl)}</td>
                      <td>
                        {#if (pl as any).competitorPresent}
                          <span class="status-chip status-overdue">Yes</span>
                        {:else}
                          <span class="cell-muted">No</span>
                        {/if}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        {/if}

        <!-- Contacts -->
        {#if activeTab === 'contacts'}
          {#if partyContacts.length === 0}
            <div class="empty-state">No contacts recorded for this customer.</div>
          {:else}
            <div class="contacts-grid">
              {#each partyContacts as c (c.id)}
                <div class="contact-card">
                  <div class="contact-top">
                    <div class="contact-avatar" aria-hidden="true">
                      {c.name.charAt(0).toUpperCase()}
                    </div>
                    <div class="contact-info">
                      <div class="contact-name">{c.name}</div>
                      {#if c.designation}
                        <div class="contact-designation">{c.designation}</div>
                      {/if}
                    </div>
                  </div>
                  <div class="contact-details">
                    {#if c.phone}
                      <div class="contact-row">
                        <span class="contact-row-label">Phone</span>
                        <span class="contact-row-value">{c.phone}</span>
                      </div>
                    {/if}
                    {#if c.email}
                      <div class="contact-row">
                        <span class="contact-row-label">Email</span>
                        <span class="contact-row-value contact-email">{c.email}</span>
                      </div>
                    {/if}
                    {#if c.isWhatsApp && c.phone}
                      <div class="contact-row">
                        <span class="contact-row-label">WhatsApp</span>
                        <span class="whatsapp-badge">{c.phone}</span>
                      </div>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        {/if}

        <!-- Notes -->
        {#if activeTab === 'notes'}
          <div class="notes-section">
            {#if partyNotes.length === 0}
              <div class="empty-notes">
                <p>No notes yet for this {party?.isSupplier ? 'supplier' : 'customer'}.</p>
                <p class="empty-hint">Use the AI chat to add notes: "Remember that {party?.name ?? 'this customer'} prefers..."</p>
              </div>
            {:else}
              {#each partyNotes as note (note.id)}
                <div class="note-card">
                  <div class="note-header">
                    <span class="note-type-badge">{note.noteType}</span>
                    <span class="note-date">{new Date(note.createdAt).toLocaleDateString('en-BH')}</span>
                    {#if note.pinned}
                      <span class="note-pin">pinned</span>
                    {/if}
                  </div>
                  <h4 class="note-title">{note.title}</h4>
                  <p class="note-content">{note.content}</p>
                  <span class="note-author">by {note.createdBy}</span>
                </div>
              {/each}
            {/if}
          </div>
        {/if}

      </div>
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
    max-width: 800px;
    max-height: 90vh;
    background: var(--paper-card);
    border: 1px solid var(--ink-12);
    border-radius: var(--radius-lg);
    padding: var(--sp-34);
    display: flex;
    flex-direction: column;
    gap: var(--sp-21);
    box-shadow: var(--shadow-lg);
    animation: modal-in var(--dur-normal) var(--ease-spring);
    overflow: hidden;
  }

  @keyframes modal-in {
    from { opacity: 0; transform: translateY(12px) scale(0.97); }
    to   { opacity: 1; transform: translateY(0)    scale(1); }
  }

  /* ── Header ───────────────────────────────────────────────────────────── */
  .modal-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--sp-13);
    flex-shrink: 0;
  }

  .header-main {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-13);
  }

  .grade-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    font-family: var(--font-ui);
    font-size: var(--text-md);
    font-weight: 700;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .header-names {
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
  }

  .modal-title {
    font-family: var(--font-display);
    font-size: var(--text-xl);
    font-weight: 400;
    color: var(--ink);
    margin: 0;
    line-height: 1.2;
  }

  .header-meta {
    display: flex;
    gap: var(--sp-5);
    flex-wrap: wrap;
  }

  .meta-chip {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 500;
    padding: var(--sp-1) var(--sp-8);
    border-radius: var(--radius-pill);
    background: var(--ink-06);
    color: var(--ink-60);
  }

  .meta-chip-active {
    background: var(--sage-soft);
    color: var(--sage);
  }

  .meta-chip-blocked {
    background: var(--coral-soft);
    color: var(--coral);
    font-weight: 700;
    letter-spacing: 0.04em;
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
    flex-shrink: 0;
    transition: background var(--dur-fast) var(--ease-out),
                color var(--dur-fast) var(--ease-out);
  }

  .close-btn:hover {
    background: var(--ink-06);
    color: var(--ink);
  }

  /* ── KPI row ──────────────────────────────────────────────────────────── */
  .kpi-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--sp-8);
    flex-shrink: 0;
  }

  .kpi-card {
    background: var(--paper-elevated);
    border: 1px solid var(--ink-06);
    border-radius: var(--radius-md);
    padding: var(--sp-13) var(--sp-13);
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
  }

  .kpi-card-warn {
    border-color: var(--coral-soft);
    background: color-mix(in srgb, var(--coral-soft) 25%, var(--paper-elevated));
  }

  .kpi-label {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--ink-30);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .kpi-value {
    font-family: var(--font-data);
    font-size: var(--text-base);
    font-weight: 700;
    color: var(--ink);
    line-height: 1.2;
  }

  .kpi-value-sage {
    color: var(--sage);
  }

  .kpi-value-coral {
    color: var(--coral);
  }

  .kpi-ccy {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 400;
    color: var(--ink-30);
  }

  /* ── Tabs ─────────────────────────────────────────────────────────────── */
  .tabs-row {
    display: flex;
    gap: var(--sp-1);
    border-bottom: 1px solid var(--ink-12);
    flex-shrink: 0;
  }

  .tab-btn {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--ink-60);
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    padding: var(--sp-8) var(--sp-13);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: var(--sp-5);
    transition: all var(--dur-fast) var(--ease-out);
    margin-bottom: -1px;
    white-space: nowrap;
  }

  .tab-btn:hover {
    color: var(--ink);
    background: var(--ink-06);
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  }

  .tab-active {
    color: var(--gold);
    border-bottom-color: var(--gold);
  }

  .tab-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 var(--sp-3);
    border-radius: var(--radius-pill);
    background: var(--ink-06);
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--ink-60);
  }

  .tab-active .tab-count {
    background: var(--gold-glow);
    color: var(--gold);
  }

  /* ── Tab content area ─────────────────────────────────────────────────── */
  .tab-content {
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }

  /* ── Table ────────────────────────────────────────────────────────────── */
  .table-wrap {
    overflow-x: auto;
    background: var(--paper-card);
    border: 1.5px solid var(--ink-06);
    border-radius: var(--radius-lg);
  }

  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  .data-table thead tr {
    background: var(--paper-elevated);
    border-bottom: 1px solid var(--ink-12);
  }

  .data-table th {
    text-align: left;
    padding: var(--sp-8) var(--sp-13);
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--ink-60);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .num-col {
    text-align: right;
  }

  .table-row {
    border-bottom: 1px solid var(--ink-06);
    transition: background var(--dur-fast) var(--ease-out);
  }

  .table-row:last-child {
    border-bottom: none;
  }

  .table-row:hover {
    background: var(--ink-06);
  }

  .row-overdue {
    background: color-mix(in srgb, var(--coral-soft) 30%, transparent);
  }

  .row-overdue:hover {
    background: color-mix(in srgb, var(--coral-soft) 45%, transparent);
  }

  .data-table td {
    padding: var(--sp-8) var(--sp-13);
    color: var(--ink);
    white-space: nowrap;
  }

  .cell-muted {
    color: var(--ink-60);
    font-size: var(--text-xs);
  }

  .cell-mono {
    font-family: var(--font-data);
  }

  .cell-bold {
    font-weight: 700;
  }

  .cell-ref {
    font-family: var(--font-data);
    font-size: var(--text-xs);
    color: var(--ink-60);
  }

  .cell-title {
    font-weight: 500;
    max-width: 240px;
    white-space: normal;
    line-height: 1.4;
  }

  /* ── Status chips ─────────────────────────────────────────────────────── */
  .status-chip {
    display: inline-flex;
    align-items: center;
    padding: var(--sp-1) var(--sp-8);
    border-radius: var(--radius-pill);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 600;
    background: var(--ink-06);
    color: var(--ink-60);
  }

  .status-paid {
    background: var(--sage-soft);
    color: var(--sage);
  }

  .status-overdue {
    background: var(--coral-soft);
    color: var(--coral);
  }

  .status-open {
    background: var(--blue-soft);
    color: var(--blue);
  }

  .status-active {
    background: var(--blue-soft);
    color: var(--blue);
  }

  .status-won {
    background: var(--sage-soft);
    color: var(--sage);
  }

  .status-lost {
    background: var(--coral-soft);
    color: var(--coral);
  }

  /* ── Contacts grid ────────────────────────────────────────────────────── */
  .contacts-grid {
    display: flex;
    flex-direction: column;
    gap: var(--sp-8);
  }

  .contact-card {
    background: var(--paper-elevated);
    border: 1px solid var(--ink-06);
    border-radius: var(--radius-md);
    padding: var(--sp-13) var(--sp-16);
    display: flex;
    flex-direction: column;
    gap: var(--sp-10);
  }

  .contact-top {
    display: flex;
    align-items: center;
    gap: var(--sp-13);
  }

  .contact-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--gold-glow);
    border: 1.5px solid var(--gold);
    color: var(--gold);
    font-family: var(--font-display);
    font-size: var(--text-md);
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .contact-info {
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
  }

  .contact-name {
    font-family: var(--font-ui);
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--ink);
  }

  .contact-designation {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--ink-60);
  }

  .contact-details {
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
    padding-left: calc(36px + var(--sp-13));
  }

  .contact-row {
    display: flex;
    align-items: baseline;
    gap: var(--sp-8);
  }

  .contact-row-label {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--ink-30);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    min-width: 56px;
    flex-shrink: 0;
  }

  .contact-row-value {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--ink);
  }

  .contact-email {
    color: var(--blue);
    font-size: var(--text-xs);
  }

  .whatsapp-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-3);
    font-family: var(--font-data);
    font-size: var(--text-xs);
    color: var(--sage);
    background: var(--sage-soft);
    padding: var(--sp-1) var(--sp-8);
    border-radius: var(--radius-pill);
  }

  /* ── Empty state ──────────────────────────────────────────────────────── */
  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--sp-24) var(--sp-13);
    color: var(--ink-30);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: center;
  }

  /* ── Responsive ───────────────────────────────────────────────────────── */
  @media (max-width: 640px) {
    .modal-card {
      padding: var(--sp-21);
    }

    .kpi-row {
      grid-template-columns: repeat(2, 1fr);
    }

    .modal-title {
      font-size: var(--text-lg);
    }
  }

  /* ── Bank details ──────────────────────────────────────────────────── */
  .bank-details {
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
    padding: var(--sp-10);
    background: var(--ink-03);
    border-radius: var(--radius-sm);
    margin-top: var(--sp-8);
  }

  .detail-row {
    display: flex;
    gap: var(--sp-13);
    align-items: baseline;
  }

  .detail-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--ink-30);
    min-width: 50px;
  }

  .detail-value {
    font-size: var(--text-sm);
    color: var(--ink);
  }

  /* ── Notes ─────────────────────────────────────────────────────────── */
  .notes-section {
    display: flex;
    flex-direction: column;
    gap: var(--sp-10);
  }

  .empty-notes {
    text-align: center;
    padding: var(--sp-21);
    color: var(--ink-30);
  }

  .empty-hint {
    font-size: var(--text-xs);
    font-style: italic;
    margin-top: var(--sp-5);
  }

  .note-card {
    padding: var(--sp-13);
    background: var(--ink-03);
    border-radius: var(--radius-sm);
  }

  .note-header {
    display: flex;
    gap: var(--sp-8);
    align-items: center;
    margin-bottom: var(--sp-5);
  }

  .note-type-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: var(--radius-pill);
    background: var(--gold-glow);
    color: var(--gold);
    text-transform: capitalize;
  }

  .note-date {
    font-size: var(--text-xs);
    color: var(--ink-30);
  }

  .note-pin {
    font-size: 10px;
    color: var(--coral);
    font-weight: 600;
  }

  .note-title {
    font-size: var(--text-sm);
    font-weight: 600;
    margin: 0 0 var(--sp-3);
  }

  .note-content {
    font-size: var(--text-sm);
    color: var(--ink-60);
    margin: 0;
    line-height: 1.5;
  }

  .note-author {
    font-size: 10px;
    color: var(--ink-30);
    margin-top: var(--sp-5);
    display: block;
  }

  .mono {
    font-family: var(--font-data);
    letter-spacing: 0.02em;
  }
</style>
