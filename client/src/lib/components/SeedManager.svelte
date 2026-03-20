<script lang="ts">
  // SeedManager.svelte — One-time migration tool
  // Loads seed_data.json (extracted from PH Holdings SQLite) and calls
  // existing STDB reducers to populate the database with real production data.
  //
  // Phases:
  //   1. Insert parties (customers + suppliers)
  //   2. Wait for party sync, build name → STDB ID map
  //   3. Insert contacts (using party IDs)
  //   4. Insert money events: CustomerInvoices → CustomerPayments → SupplierInvoices → SupplierPayments
  //
  // All phases use existing reducers with full business logic.
  // The only constraint: invoices must be inserted before payments per party.

  import { getConnection, parties } from '../db';
  import { get } from 'svelte/store';
  import { Timestamp } from 'spacetimedb';

  interface SeedParty {
    legacyId: string;
    name: string;
    isCustomer: boolean;
    isSupplier: boolean;
    grade: string;
    creditLimitFils: number;
    isCreditBlocked: boolean;
    paymentTermsDays: number;
    productTypes: string;
    notes: string;
  }

  interface SeedContact {
    partyIdx: number;
    name: string;
    designation: string;
    phone: string;
    email: string;
  }

  interface SeedMoneyEvent {
    partyIdx: number;
    orderIdx: number | null;
    kind: string;
    status: string;
    subtotalFils: number;
    vatFils: number;
    totalFils: number;
    reference: string;
    dueDate: string | null;
    paidAt: string | null;
    createdAt: string | null;
  }

  interface SeedData {
    parties: SeedParty[];
    contacts: SeedContact[];
    pipelines: unknown[];
    orders: unknown[];
    purchaseOrders: unknown[];
    moneyEvents: SeedMoneyEvent[];
  }

  type Phase =
    | 'idle'
    | 'loading'
    | 'parties'
    | 'waiting-sync'
    | 'contacts'
    | 'invoices'
    | 'payments'
    | 'supplier-invoices'
    | 'supplier-payments'
    | 'done'
    | 'error';

  let phase = $state<Phase>('idle');
  let progress = $state(0);
  let total = $state(0);
  let message = $state('');
  let errorMsg = $state('');
  let seedData = $state<SeedData | null>(null);
  let stats = $state({
    parties: 0,
    contacts: 0,
    customerInvoices: 0,
    customerPayments: 0,
    supplierInvoices: 0,
    supplierPayments: 0,
    errors: 0,
  });

  // Name → STDB ID mapping (built after party sync)
  let partyNameToId = $state(new Map<string, bigint>());

  // Check if already seeded
  let existingPartyCount = $derived(get(parties).length);
  // Re-derive reactively
  let alreadySeeded = $derived(existingPartyCount > 10);

  function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  function isoToTimestamp(iso: string | null): typeof Timestamp.prototype | undefined {
    if (!iso) return undefined;
    try {
      return Timestamp.fromDate(new Date(iso));
    } catch {
      return undefined;
    }
  }

  async function startSeed() {
    const conn = getConnection();
    if (!conn) {
      errorMsg = 'Not connected to SpacetimeDB';
      phase = 'error';
      return;
    }

    // Reset stats
    stats = { parties: 0, contacts: 0, customerInvoices: 0, customerPayments: 0, supplierInvoices: 0, supplierPayments: 0, errors: 0 };
    errorMsg = '';

    // ── Phase: Load JSON ──────────────────────────────────────────
    phase = 'loading';
    message = 'Loading seed data...';
    try {
      const resp = await fetch('/seed_data.json');
      if (!resp.ok) throw new Error(`Failed to fetch: ${resp.status}`);
      seedData = (await resp.json()) as SeedData;
      message = `Loaded ${seedData.parties.length} parties, ${seedData.contacts.length} contacts, ${seedData.moneyEvents.length} money events`;
    } catch (e) {
      errorMsg = `Failed to load seed data: ${e instanceof Error ? e.message : String(e)}`;
      phase = 'error';
      return;
    }

    await sleep(500);

    // ── Phase: Insert Parties ─────────────────────────────────────
    phase = 'parties';
    total = seedData.parties.length;
    progress = 0;
    message = `Inserting ${total} parties...`;

    const BATCH_SIZE = 20;
    const BATCH_DELAY = 100; // ms between batches

    for (let i = 0; i < seedData.parties.length; i += BATCH_SIZE) {
      const batch = seedData.parties.slice(i, i + BATCH_SIZE);
      for (const p of batch) {
        try {
          conn.reducers.upsertParty({
            id: 0n,
            name: p.name,
            isCustomer: p.isCustomer,
            isSupplier: p.isSupplier,
            grade: { tag: p.grade } as any,
            creditLimitFils: BigInt(p.creditLimitFils),
            paymentTermsDays: BigInt(p.paymentTermsDays),
            productTypes: p.productTypes,
            annualGoalFils: 0n,
            notes: p.notes,
          });
          stats.parties++;
        } catch (e) {
          console.warn(`[seed] Party "${p.name}" failed:`, e);
          stats.errors++;
        }
      }
      progress = Math.min(i + BATCH_SIZE, total);
      message = `Parties: ${progress}/${total}`;
      await sleep(BATCH_DELAY);
    }

    // ── Phase: Wait for Party Sync ────────────────────────────────
    phase = 'waiting-sync';
    message = `Waiting for ${total} parties to sync from server...`;

    // Poll until party count matches (with timeout)
    const startWait = Date.now();
    const SYNC_TIMEOUT = 60_000; // 60s max
    while (Date.now() - startWait < SYNC_TIMEOUT) {
      const currentParties = get(parties);
      if (currentParties.length >= seedData.parties.length) {
        // Build name → ID map
        const map = new Map<string, bigint>();
        for (const p of currentParties) {
          // Use lowercase for fuzzy matching
          map.set(p.name.toLowerCase(), p.id);
        }
        partyNameToId = map;
        message = `Synced! ${currentParties.length} parties, built name→ID map`;
        break;
      }
      message = `Waiting for sync... ${currentParties.length}/${seedData.parties.length}`;
      await sleep(1000);
    }

    if (partyNameToId.size === 0) {
      errorMsg = 'Timeout waiting for party sync. Try again.';
      phase = 'error';
      return;
    }

    await sleep(500);

    // ── Phase: Insert Contacts ────────────────────────────────────
    phase = 'contacts';
    total = seedData.contacts.length;
    progress = 0;
    message = `Inserting ${total} contacts...`;

    for (let i = 0; i < seedData.contacts.length; i += BATCH_SIZE) {
      const batch = seedData.contacts.slice(i, i + BATCH_SIZE);
      for (const c of batch) {
        const partyName = seedData.parties[c.partyIdx]?.name;
        const partyId = partyName ? partyNameToId.get(partyName.toLowerCase()) : undefined;
        if (!partyId) {
          stats.errors++;
          continue;
        }
        try {
          conn.reducers.upsertContact({
            id: 0n,
            partyId,
            name: c.name,
            designation: c.designation,
            phone: c.phone,
            email: c.email,
            isWhatsApp: false,
          });
          stats.contacts++;
        } catch (e) {
          console.warn(`[seed] Contact "${c.name}" failed:`, e);
          stats.errors++;
        }
      }
      progress = Math.min(i + BATCH_SIZE, total);
      message = `Contacts: ${progress}/${total}`;
      await sleep(BATCH_DELAY);
    }

    await sleep(300);

    // ── Phase: Insert Customer Invoices ───────────────────────────
    const custInvoices = seedData.moneyEvents.filter((e) => e.kind === 'CustomerInvoice');
    phase = 'invoices';
    total = custInvoices.length;
    progress = 0;
    message = `Inserting ${total} customer invoices...`;

    for (let i = 0; i < custInvoices.length; i += BATCH_SIZE) {
      const batch = custInvoices.slice(i, i + BATCH_SIZE);
      for (const ev of batch) {
        const partyName = seedData.parties[ev.partyIdx]?.name;
        const partyId = partyName ? partyNameToId.get(partyName.toLowerCase()) : undefined;
        if (!partyId) {
          stats.errors++;
          continue;
        }
        try {
          conn.reducers.recordMoneyEvent({
            partyId,
            orderId: undefined,
            deliveryNoteId: undefined,
            kind: { tag: 'CustomerInvoice' } as any,
            subtotalFils: BigInt(ev.subtotalFils),
            reference: ev.reference,
            dueDate: isoToTimestamp(ev.dueDate),
          });
          stats.customerInvoices++;
        } catch (e) {
          console.warn(`[seed] Invoice "${ev.reference}" failed:`, e);
          stats.errors++;
        }
      }
      progress = Math.min(i + BATCH_SIZE, total);
      message = `Customer Invoices: ${progress}/${total}`;
      await sleep(BATCH_DELAY);
    }

    // Wait a moment for invoices to process server-side before inserting payments
    message = 'Waiting for invoices to process before inserting payments...';
    await sleep(3000);

    // ── Phase: Insert Customer Payments ───────────────────────────
    const custPayments = seedData.moneyEvents.filter((e) => e.kind === 'CustomerPayment');
    phase = 'payments';
    total = custPayments.length;
    progress = 0;
    message = `Inserting ${total} customer payments...`;

    for (let i = 0; i < custPayments.length; i += BATCH_SIZE) {
      const batch = custPayments.slice(i, i + BATCH_SIZE);
      for (const ev of batch) {
        const partyName = seedData.parties[ev.partyIdx]?.name;
        const partyId = partyName ? partyNameToId.get(partyName.toLowerCase()) : undefined;
        if (!partyId) {
          stats.errors++;
          continue;
        }
        try {
          conn.reducers.recordMoneyEvent({
            partyId,
            orderId: undefined,
            deliveryNoteId: undefined,
            kind: { tag: 'CustomerPayment' } as any,
            subtotalFils: BigInt(ev.subtotalFils),
            reference: ev.reference,
            dueDate: undefined,
          });
          stats.customerPayments++;
        } catch (e) {
          console.warn(`[seed] Payment "${ev.reference}" failed:`, e);
          stats.errors++;
        }
      }
      progress = Math.min(i + BATCH_SIZE, total);
      message = `Customer Payments: ${progress}/${total}`;
      await sleep(BATCH_DELAY);
    }

    await sleep(300);

    // ── Phase: Insert Supplier Invoices ───────────────────────────
    const suppInvoices = seedData.moneyEvents.filter((e) => e.kind === 'SupplierInvoice');
    phase = 'supplier-invoices';
    total = suppInvoices.length;
    progress = 0;
    message = `Inserting ${total} supplier invoices...`;

    for (let i = 0; i < suppInvoices.length; i += BATCH_SIZE) {
      const batch = suppInvoices.slice(i, i + BATCH_SIZE);
      for (const ev of batch) {
        const partyName = seedData.parties[ev.partyIdx]?.name;
        const partyId = partyName ? partyNameToId.get(partyName.toLowerCase()) : undefined;
        if (!partyId) {
          stats.errors++;
          continue;
        }
        try {
          conn.reducers.recordMoneyEvent({
            partyId,
            orderId: undefined,
            deliveryNoteId: undefined,
            kind: { tag: 'SupplierInvoice' } as any,
            subtotalFils: BigInt(ev.subtotalFils),
            reference: ev.reference,
            dueDate: isoToTimestamp(ev.dueDate),
          });
          stats.supplierInvoices++;
        } catch (e) {
          console.warn(`[seed] Supplier invoice "${ev.reference}" failed:`, e);
          stats.errors++;
        }
      }
      progress = Math.min(i + BATCH_SIZE, total);
      message = `Supplier Invoices: ${progress}/${total}`;
      await sleep(BATCH_DELAY);
    }

    await sleep(300);

    // ── Phase: Insert Supplier Payments ───────────────────────────
    const suppPayments = seedData.moneyEvents.filter((e) => e.kind === 'SupplierPayment');
    phase = 'supplier-payments';
    total = suppPayments.length;
    progress = 0;
    message = `Inserting ${total} supplier payments...`;

    for (let i = 0; i < suppPayments.length; i += BATCH_SIZE) {
      const batch = suppPayments.slice(i, i + BATCH_SIZE);
      for (const ev of batch) {
        const partyName = seedData.parties[ev.partyIdx]?.name;
        const partyId = partyName ? partyNameToId.get(partyName.toLowerCase()) : undefined;
        if (!partyId) {
          stats.errors++;
          continue;
        }
        try {
          conn.reducers.recordMoneyEvent({
            partyId,
            orderId: undefined,
            deliveryNoteId: undefined,
            kind: { tag: 'SupplierPayment' } as any,
            subtotalFils: BigInt(ev.subtotalFils),
            reference: ev.reference,
            dueDate: undefined,
          });
          stats.supplierPayments++;
        } catch (e) {
          console.warn(`[seed] Supplier payment "${ev.reference}" failed:`, e);
          stats.errors++;
        }
      }
      progress = Math.min(i + BATCH_SIZE, total);
      message = `Supplier Payments: ${progress}/${total}`;
      await sleep(BATCH_DELAY);
    }

    // ── Done ──────────────────────────────────────────────────────
    phase = 'done';
    const totalInserted = stats.parties + stats.contacts + stats.customerInvoices +
      stats.customerPayments + stats.supplierInvoices + stats.supplierPayments;
    message = `Seed complete! ${totalInserted} records inserted, ${stats.errors} errors`;
  }

  let progressPercent = $derived(total > 0 ? Math.round((progress / total) * 100) : 0);

  const phaseLabels: Record<Phase, string> = {
    idle: 'Ready',
    loading: 'Loading JSON',
    parties: 'Inserting Parties',
    'waiting-sync': 'Waiting for Sync',
    contacts: 'Inserting Contacts',
    invoices: 'Customer Invoices',
    payments: 'Customer Payments',
    'supplier-invoices': 'Supplier Invoices',
    'supplier-payments': 'Supplier Payments',
    done: 'Complete',
    error: 'Error',
  };
</script>

<div class="seed-panel">
  <div class="seed-header">
    <h3 class="seed-title">Seed from Legacy Data</h3>
    <p class="seed-desc">
      Import 379 parties, 535 contacts, 67 pipelines, 175 orders, 45 purchase orders,
      and 1,615 financial records
      from PH Holdings SQLite database.
    </p>
  </div>

  {#if phase === 'idle'}
    <div class="seed-actions">
      {#if alreadySeeded}
        <p class="seed-warn">Database already has {existingPartyCount} parties. Seeding again will create duplicates.</p>
      {/if}
      <button class="seed-btn" onclick={startSeed}>
        Seed Database
      </button>
    </div>

  {:else if phase === 'error'}
    <div class="seed-error">
      <span class="seed-error-icon">!</span>
      <p>{errorMsg}</p>
      <button class="seed-btn seed-btn-sm" onclick={() => { phase = 'idle'; }}>Try Again</button>
    </div>

  {:else if phase === 'done'}
    <div class="seed-done">
      <span class="seed-done-icon">&#10003;</span>
      <p class="seed-done-msg">{message}</p>
      <div class="seed-stats-grid">
        <div class="stat-item"><span class="stat-val">{stats.parties}</span><span class="stat-lbl">Parties</span></div>
        <div class="stat-item"><span class="stat-val">{stats.contacts}</span><span class="stat-lbl">Contacts</span></div>
        <div class="stat-item"><span class="stat-val">{stats.customerInvoices}</span><span class="stat-lbl">Invoices</span></div>
        <div class="stat-item"><span class="stat-val">{stats.customerPayments}</span><span class="stat-lbl">Payments</span></div>
        <div class="stat-item"><span class="stat-val">{stats.supplierInvoices}</span><span class="stat-lbl">Supp. Inv.</span></div>
        <div class="stat-item"><span class="stat-val">{stats.supplierPayments}</span><span class="stat-lbl">Supp. Pay.</span></div>
        {#if stats.errors > 0}
          <div class="stat-item stat-error"><span class="stat-val">{stats.errors}</span><span class="stat-lbl">Errors</span></div>
        {/if}
      </div>
    </div>

  {:else}
    <!-- Active seeding progress -->
    <div class="seed-progress">
      <div class="progress-phase">
        <span class="phase-label">{phaseLabels[phase]}</span>
        {#if total > 0}
          <span class="phase-count">{progress}/{total} ({progressPercent}%)</span>
        {/if}
      </div>

      <div class="progress-bar-track">
        <div class="progress-bar-fill" style="width: {progressPercent}%"></div>
      </div>

      <p class="progress-msg">{message}</p>

      <div class="seed-stats-row">
        <span>Parties: {stats.parties}</span>
        <span>Contacts: {stats.contacts}</span>
        <span>Inv: {stats.customerInvoices}</span>
        <span>Pay: {stats.customerPayments}</span>
        {#if stats.errors > 0}
          <span class="stat-err">Err: {stats.errors}</span>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .seed-panel {
    background: var(--paper-card);
    border: 1.5px solid var(--ink-06);
    border-radius: var(--radius-lg);
    padding: var(--sp-21);
  }

  .seed-header {
    margin-bottom: var(--sp-16);
  }

  .seed-title {
    font-family: var(--font-display);
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--ink);
    margin: 0 0 var(--sp-5);
  }

  .seed-desc {
    font-family: var(--font-body);
    font-size: var(--text-sm);
    color: var(--ink-60);
    margin: 0;
    line-height: 1.5;
  }

  .seed-actions {
    display: flex;
    flex-direction: column;
    gap: var(--sp-13);
    align-items: flex-start;
  }

  .seed-warn {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--amber);
    margin: 0;
    padding: var(--sp-8) var(--sp-13);
    background: var(--amber-soft);
    border-radius: var(--radius-sm);
    border: 1px solid var(--amber);
  }

  .seed-btn {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 600;
    padding: var(--sp-8) var(--sp-21);
    border-radius: var(--radius-md);
    border: 1.5px solid var(--gold);
    background: var(--gold);
    color: var(--paper);
    cursor: pointer;
    transition: all var(--dur-fast) var(--ease-out);
  }

  .seed-btn:hover {
    background: color-mix(in srgb, var(--gold) 85%, black);
    border-color: color-mix(in srgb, var(--gold) 85%, black);
  }

  .seed-btn-sm {
    font-size: var(--text-xs);
    padding: var(--sp-5) var(--sp-13);
  }

  /* Error */
  .seed-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-13);
    text-align: center;
    color: var(--coral);
  }

  .seed-error-icon {
    font-size: 2rem;
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--coral-soft);
    border-radius: 50%;
    font-weight: 700;
  }

  .seed-error p {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    margin: 0;
  }

  /* Done */
  .seed-done {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-16);
    text-align: center;
  }

  .seed-done-icon {
    font-size: 2rem;
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--sage-soft);
    color: var(--sage);
    border-radius: 50%;
    font-weight: 700;
  }

  .seed-done-msg {
    font-family: var(--font-ui);
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--ink);
    margin: 0;
  }

  .seed-stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
    gap: var(--sp-8);
    width: 100%;
    max-width: 500px;
  }

  .stat-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-2);
    padding: var(--sp-8);
    background: var(--ink-03);
    border-radius: var(--radius-sm);
  }

  .stat-val {
    font-family: var(--font-data);
    font-size: var(--text-lg);
    font-weight: 700;
    color: var(--gold);
  }

  .stat-lbl {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--ink-60);
  }

  .stat-error .stat-val {
    color: var(--coral);
  }

  /* Progress */
  .seed-progress {
    display: flex;
    flex-direction: column;
    gap: var(--sp-13);
  }

  .progress-phase {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .phase-label {
    font-family: var(--font-ui);
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--ink);
  }

  .phase-count {
    font-family: var(--font-data);
    font-size: var(--text-sm);
    color: var(--ink-60);
  }

  .progress-bar-track {
    height: 6px;
    background: var(--ink-06);
    border-radius: 3px;
    overflow: hidden;
  }

  .progress-bar-fill {
    height: 100%;
    background: var(--gold);
    border-radius: 3px;
    transition: width 0.3s var(--ease-out);
  }

  .progress-msg {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--ink-60);
    margin: 0;
  }

  .seed-stats-row {
    display: flex;
    gap: var(--sp-16);
    font-family: var(--font-data);
    font-size: var(--text-xs);
    color: var(--ink-30);
  }

  .stat-err {
    color: var(--coral);
  }
</style>
