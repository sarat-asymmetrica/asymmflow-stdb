<script lang="ts">
  // CRMHub.svelte — V4 Rams × Neumorphic
  // Customers with grade tabs, card grid, search

  import { parties, contacts, moneyEvents } from '../db';
  import { formatBHD, formatRelative } from '../format';
  import CreatePartyModal from '../components/CreatePartyModal.svelte';
  import Customer360Modal from '../components/Customer360Modal.svelte';
  import { enter } from '$lib/motion/asymm-motion';

  const PAGE_SIZE = 50;

  let showCreateParty  = $state(false);
  let activeTab        = $state('all');
  let selected360Id    = $state<bigint | null>(null);

  let customerSearch   = $state('');
  let customerShowAll  = $state(false);

  const tabs = [
    { id: 'all',  label: 'All' },
    { id: 'A',    label: 'Grade A' },
    { id: 'B',    label: 'Grade B' },
    { id: 'C',    label: 'Grade C' },
  ];

  // ── Demo data (shown when live data is empty) ──────────────

  const DEMO_CUSTOMERS = [
    {
      id: 1n,
      name: 'EWA',
      fullName: 'Electricity & Water Authority',
      grade: 'A',
      category: 'National Reseller',
      totalRevenue: '48,000.000',
      totalRevenueFils: 48000000n,
      outstanding: '30,000.000',
      outstandingFils: 30000000n,
      lastOrder: '2025-12-15',
      contact: 'Yusuf Al-Dosari',
      phone: '+973 1722 5566',
      paymentTerms: 'Net 60',
      creditLimit: '100,000.000',
      creditBlocked: false,
      notes: 'Primary government utility. 81% of annual revenue. Handle with priority.',
    },
    {
      id: 2n,
      name: 'BAPCO',
      fullName: 'Bahrain Petroleum Company',
      grade: 'B',
      category: 'EPC',
      totalRevenue: '15,000.000',
      totalRevenueFils: 15000000n,
      outstanding: '15,000.000',
      outstandingFils: 15000000n,
      lastOrder: '2025-08-01',
      contact: 'Khalid Al-Ghamdi',
      phone: '+973 1770 1234',
      paymentTerms: 'Net 90',
      creditLimit: '50,000.000',
      creditBlocked: false,
      notes: '185 days overdue. Two invoices stuck. Escalate to procurement.',
    },
    {
      id: 3n,
      name: 'ALBA',
      fullName: 'Aluminium Bahrain',
      grade: 'A',
      category: 'EPC',
      totalRevenue: '6,000.000',
      totalRevenueFils: 6000000n,
      outstanding: '6,000.000',
      outstandingFils: 6000000n,
      lastOrder: '2025-09-10',
      contact: 'Faisal Al-Mannai',
      phone: '+973 1783 0083',
      paymentTerms: 'Net 60',
      creditLimit: '80,000.000',
      creditBlocked: false,
      notes: 'Smelter expansion project. Large volume potential H1 2026.',
    },
    {
      id: 4n,
      name: 'Al Ezzel',
      fullName: 'Al Ezzel Power Station',
      grade: 'C',
      category: 'End Customer',
      totalRevenue: '5,500.000',
      totalRevenueFils: 5500000n,
      outstanding: '5,500.000',
      outstandingFils: 5500000n,
      lastOrder: '2025-09-12',
      contact: 'Mohammed Al-Zarooni',
      phone: '+973 1744 8800',
      paymentTerms: 'Net 45',
      creditLimit: '20,000.000',
      creditBlocked: false,
      notes: '112 days overdue. Payment dispute on INV-2025-005.',
    },
    {
      id: 5n,
      name: 'GPIC',
      fullName: 'Gulf Petrochemical Industries',
      grade: 'B',
      category: 'End Customer',
      totalRevenue: '3,000.000',
      totalRevenueFils: 3000000n,
      outstanding: '0.000',
      outstandingFils: 0n,
      lastOrder: '2025-10-05',
      contact: 'Tariq Al-Sabaa',
      phone: '+973 1732 6500',
      paymentTerms: 'Net 45',
      creditLimit: '30,000.000',
      creditBlocked: false,
      notes: 'Reliable payer. Good relationship with procurement team.',
    },
    {
      id: 6n,
      name: 'NOGA',
      fullName: 'National Oil and Gas Authority',
      grade: 'B',
      category: 'National Reseller',
      totalRevenue: '5,000.000',
      totalRevenueFils: 5000000n,
      outstanding: '5,000.000',
      outstandingFils: 5000000n,
      lastOrder: '2025-12-10',
      contact: 'Hamad Al-Khalifa',
      phone: '+973 1754 7800',
      paymentTerms: 'Net 60',
      creditLimit: '60,000.000',
      creditBlocked: false,
      notes: 'New account opened Q3 2025. Tender pipeline strong for 2026.',
    },
    {
      id: 7n,
      name: 'TTSJV',
      fullName: 'Taziz & TAQA JV',
      grade: 'B',
      category: 'EPC',
      totalRevenue: '3,500.000',
      totalRevenueFils: 3500000n,
      outstanding: '3,500.000',
      outstandingFils: 3500000n,
      lastOrder: '2025-12-01',
      contact: 'Aisha Al-Rumaihi',
      phone: '+973 1760 2200',
      paymentTerms: 'Net 30',
      creditLimit: '25,000.000',
      creditBlocked: false,
      notes: 'JV for Muharraq pipeline. Invoice on hold pending PO.',
    },
    {
      id: 8n,
      name: 'Arla',
      fullName: 'Arla Foods Bahrain',
      grade: 'A',
      category: 'End Customer',
      totalRevenue: '9,000.000',
      totalRevenueFils: 9000000n,
      outstanding: '0.000',
      outstandingFils: 0n,
      lastOrder: '2025-11-28',
      contact: 'Sara Lindqvist',
      phone: '+973 1781 5100',
      paymentTerms: 'Net 30',
      creditLimit: '40,000.000',
      creditBlocked: false,
      notes: 'Exemplary payment record. Repeat orders quarterly.',
    },
    {
      id: 9n,
      name: 'Tatweer',
      fullName: 'Tatweer Petroleum',
      grade: 'B',
      category: 'End Customer',
      totalRevenue: '2,000.000',
      totalRevenueFils: 2000000n,
      outstanding: '2,000.000',
      outstandingFils: 2000000n,
      lastOrder: '2025-10-30',
      contact: 'Omar Al-Hasni',
      phone: '+973 1766 3344',
      paymentTerms: 'Net 60',
      creditLimit: '20,000.000',
      creditBlocked: false,
      notes: '138 days overdue. Awaiting budget approval from accounts.',
    },
    {
      id: 10n,
      name: 'SULB',
      fullName: 'Saudi Bahraini Steel Co.',
      grade: 'C',
      category: 'End Customer',
      totalRevenue: '2,500.000',
      totalRevenueFils: 2500000n,
      outstanding: '2,500.000',
      outstandingFils: 2500000n,
      lastOrder: '2025-12-20',
      contact: 'Nasser Al-Bulooshi',
      phone: '+973 1739 0090',
      paymentTerms: 'Net 45',
      creditLimit: '15,000.000',
      creditBlocked: false,
      notes: 'New account. First invoice sent Dec 2025.',
    },
  ];

  // ── Live data ──────────────────────────────────────────

  let allCustomers = $derived.by(() => {
    return $parties.filter(p => p.isCustomer).map(p => {
      const grade = (p.grade as any)?.tag ?? '?';
      const partyContacts = $contacts.filter(c => c.partyId === p.id);
      const primaryContact = partyContacts[0];

      // Compute revenue and outstanding from moneyEvents
      const partyEvents = $moneyEvents.filter(e => e.partyId === p.id);
      const invoiced = partyEvents
        .filter(e => (e.kind as any)?.tag === 'CustomerInvoice')
        .reduce((s, e) => s + e.totalFils, 0n);
      const paid = partyEvents
        .filter(e => (e.kind as any)?.tag === 'CustomerPayment')
        .reduce((s, e) => s + e.totalFils, 0n);
      const outstanding = invoiced > paid ? invoiced - paid : 0n;

      return {
        id: p.id,
        name: p.name,
        fullName: p.name,
        grade,
        category: p.productTypes ?? '',
        totalRevenue: (Number(invoiced) / 1000).toLocaleString('en-BH', { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
        totalRevenueFils: invoiced,
        outstanding: (Number(outstanding) / 1000).toLocaleString('en-BH', { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
        outstandingFils: outstanding,
        lastOrder: '—',
        contact: primaryContact?.name ?? '—',
        phone: primaryContact?.phone ?? '',
        paymentTerms: `Net ${Number(p.paymentTermsDays)}`,
        creditLimit: (Number(p.creditLimitFils) / 1000).toLocaleString('en-BH', { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
        creditBlocked: p.isCreditBlocked,
        notes: p.notes ?? '',
      };
    });
  });

  let useLiveData = $derived(allCustomers.length > 0);

  let displayCustomers = $derived(useLiveData ? allCustomers : DEMO_CUSTOMERS);

  // ── Last activity map (live) ──────────────────────────

  let lastActivityMap = $derived.by(() => {
    const rawMap = new Map<bigint, bigint>();
    for (const ev of $moneyEvents) {
      const ts = ev.createdAt;
      if (!ts) continue;
      const prev = rawMap.get(ev.partyId);
      if (prev === undefined || ts.microsSinceUnixEpoch > prev) {
        rawMap.set(ev.partyId, ts.microsSinceUnixEpoch);
      }
    }
    const result = new Map<bigint, string>();
    rawMap.forEach((micros, partyId) => {
      result.set(partyId, formatRelative({ microsSinceUnixEpoch: micros }));
    });
    return result;
  });

  // ── Filtered customers ────────────────────────────────

  let filteredCustomers = $derived.by(() => {
    const q = customerSearch.trim().toLowerCase();
    const gradeFilter = activeTab === 'all' ? null : activeTab;
    return (displayCustomers as typeof DEMO_CUSTOMERS).filter(c => {
      if (gradeFilter && c.grade !== gradeFilter) return false;
      if (q && !c.name.toLowerCase().includes(q) && !(c.fullName ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  });

  let visibleCustomers = $derived.by(() => {
    if (customerShowAll) return filteredCustomers;
    return filteredCustomers.slice(0, PAGE_SIZE);
  });

  let hasMore = $derived(filteredCustomers.length > PAGE_SIZE && !customerShowAll);

  // ── Grade distribution ────────────────────────────────

  let gradeCounts = $derived.by(() => {
    const counts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
    for (const c of displayCustomers) {
      if (c.grade in counts) counts[c.grade]++;
    }
    return counts;
  });

  // ── Reset pagination on filter change ────────────────

  $effect(() => {
    customerSearch; activeTab;
    customerShowAll = false;
  });

  // ── Helpers ───────────────────────────────────────────

  const gradeColor: Record<string, string> = {
    A: 'sage',
    B: 'blue',
    C: 'amber',
    D: 'coral',
  };
</script>

<div class="hub-page">

  <!-- Header -->
  <header class="hub-header" use:enter={{ index: 0 }}>
    <div class="hub-title-group">
      <h1 class="hub-title">CUSTOMERS</h1>
      <p class="hub-count">{displayCustomers.length} total</p>
    </div>

    <!-- Grade distribution -->
    <div class="grade-dist">
      {#each Object.entries(gradeCounts) as [g, n]}
        {#if n > 0}
          <div class="grade-dist-item card-subtle">
            <span class="grade-badge grade-{gradeColor[g] ?? 'neutral'}">{g}</span>
            <span class="grade-dist-count">{n}</span>
          </div>
        {/if}
      {/each}
    </div>

    <button class="btn btn-gold btn-sm" onclick={() => (showCreateParty = true)}>
      + New Customer
    </button>
  </header>

  <!-- Tabs -->
  <div class="tabs-row" use:enter={{ index: 1 }}>
    {#each tabs as tab}
      <button
        class="tab-btn"
        class:tab-active={activeTab === tab.id}
        onclick={() => (activeTab = tab.id)}
      >
        {tab.label}
        {#if tab.id !== 'all'}
          <span class="tab-count">{gradeCounts[tab.id] ?? 0}</span>
        {/if}
      </button>
    {/each}
  </div>

  <!-- Search -->
  <div class="search-row" use:enter={{ index: 2 }}>
    <div class="search-wrap">
      <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
      </svg>
      <input
        class="search-neu"
        type="search"
        placeholder="Search customers..."
        bind:value={customerSearch}
        aria-label="Search customers"
      />
    </div>
    {#if filteredCustomers.length !== displayCustomers.length}
      <span class="filter-count">{filteredCustomers.length} of {displayCustomers.length}</span>
    {/if}
  </div>

  <!-- Customer grid -->
  <div class="grid-section" use:enter={{ index: 3 }}>
    {#if filteredCustomers.length === 0}
      <div class="empty-state">
        <div class="empty-glyph">&#9675;</div>
        <p class="empty-msg">No customers match your search.</p>
      </div>
    {:else}
      <div class="customer-grid">
        {#each visibleCustomers as c (c.id)}
          {@const hasOutstanding = c.outstandingFils > 0n}
          <div
            class="customer-card card"
            class:card-blocked={c.creditBlocked}
            class:card-overdue={hasOutstanding && c.grade === 'C'}
          >
            <!-- Card header: grade + name + category -->
            <div class="card-head">
              <div class="card-head-left">
                <span class="grade-badge grade-{gradeColor[c.grade] ?? 'neutral'}">{c.grade}</span>
                <div class="card-name-group">
                  <button
                    class="card-name"
                    onclick={() => useLiveData && (selected360Id = c.id)}
                    title={useLiveData ? `Open ${c.name} 360 view` : c.fullName}
                  >
                    {c.name}
                  </button>
                  {#if c.fullName !== c.name}
                    <span class="card-fullname">{c.fullName}</span>
                  {/if}
                </div>
              </div>
              {#if c.creditBlocked}
                <span class="blocked-chip">Blocked</span>
              {/if}
            </div>

            <!-- Category tag -->
            {#if c.category}
              <div class="card-category">
                <span class="label">{c.category}</span>
              </div>
            {/if}

            <!-- Key metrics row -->
            <div class="metrics-row">
              <div class="metric card-inset">
                <span class="metric-label">Revenue</span>
                <span class="metric-value">{c.totalRevenue}</span>
              </div>
              <div class="metric card-inset" class:metric-alert={hasOutstanding}>
                <span class="metric-label">Outstanding</span>
                <span class="metric-value" class:metric-value-outstanding={hasOutstanding}>{c.outstanding}</span>
              </div>
              <div class="metric card-inset">
                <span class="metric-label">Last Order</span>
                <span class="metric-value metric-date">{c.lastOrder}</span>
              </div>
            </div>

            <!-- Contact info -->
            <div class="contact-strip">
              <span class="contact-glyph" aria-hidden="true">&#9687;</span>
              <div class="contact-info">
                <span class="contact-name">{c.contact}</span>
                {#if c.phone}
                  <span class="contact-phone">{c.phone}</span>
                {/if}
              </div>
            </div>

            <!-- Terms + last activity footer -->
            <div class="card-footer">
              <span class="card-terms">{c.paymentTerms}</span>
              {#if useLiveData && lastActivityMap.has(c.id)}
                <span class="card-activity">Last activity: {lastActivityMap.get(c.id)}</span>
              {:else if c.notes}
                <span class="card-activity card-notes">{c.notes}</span>
              {/if}
            </div>
          </div>
        {/each}
      </div>

      {#if hasMore}
        <div class="show-more-row">
          <button class="btn btn-ghost btn-sm" onclick={() => (customerShowAll = true)}>
            Show all {filteredCustomers.length} customers
          </button>
        </div>
      {/if}
    {/if}
  </div>

</div>

<CreatePartyModal open={showCreateParty} onclose={() => (showCreateParty = false)} />
<Customer360Modal open={selected360Id !== null} partyId={selected360Id} onclose={() => (selected360Id = null)} />

<style>
  /* ── Layout ── */
  .hub-page {
    display: flex;
    flex-direction: column;
    gap: var(--sp-21);
    padding: var(--sp-24);
    max-width: 1200px;
    margin: 0 auto;
  }

  .hub-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--sp-16);
  }

  .hub-title-group {
    min-width: 140px;
  }

  .hub-title {
    font-family: var(--font-display);
    font-size: var(--text-2xl);
    font-weight: 700;
    letter-spacing: 0.05em;
    color: var(--ink);
    margin: 0 0 var(--sp-3);
    line-height: 1;
  }

  .hub-count {
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--ink-30);
    margin: 0;
  }

  /* ── Grade distribution ── */
  .grade-dist {
    display: flex;
    gap: var(--sp-8);
    align-items: center;
    flex-wrap: wrap;
    flex: 1;
    justify-content: center;
  }

  .grade-dist-item {
    display: flex;
    align-items: center;
    gap: var(--sp-8);
    padding: var(--sp-8) var(--sp-13);
    border-radius: var(--radius-md);
  }

  .grade-dist-count {
    font-family: var(--font-data);
    font-size: var(--text-xl);
    font-weight: 300;
    letter-spacing: -0.03em;
    color: var(--ink);
    line-height: 1;
  }

  .btn-sm {
    padding: var(--sp-8) var(--sp-13);
    font-size: var(--text-sm);
  }

  /* ── Tabs ── */
  .tabs-row {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--ink-12);
  }

  .tab-btn {
    display: flex;
    align-items: center;
    gap: var(--sp-5);
    font-family: var(--font-ui);
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--ink-30);
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    padding: var(--sp-8) var(--sp-21);
    cursor: pointer;
    transition: color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
    margin-bottom: -1px;
    white-space: nowrap;
  }

  .tab-btn:hover { color: var(--ink); }
  .tab-active { color: var(--gold); border-bottom-color: var(--gold); }

  .tab-count {
    font-size: 10px;
    font-weight: 500;
    color: var(--ink-30);
    background: var(--ink-06);
    border-radius: var(--radius-pill);
    padding: 1px 6px;
  }

  .tab-active .tab-count {
    background: var(--gold-glow);
    color: var(--gold);
  }

  /* ── Search row ── */
  .search-row {
    display: flex;
    align-items: center;
    gap: var(--sp-13);
  }

  .search-wrap {
    position: relative;
    flex: 1;
    max-width: 360px;
  }

  .search-icon {
    position: absolute;
    left: var(--sp-13);
    top: 50%;
    transform: translateY(-50%);
    color: var(--ink-30);
    pointer-events: none;
  }

  .search-neu {
    width: 100%;
    height: 38px;
    background: var(--paper-card);
    box-shadow: var(--shadow-neu-inset);
    border: none;
    border-radius: var(--radius-md);
    padding: 0 var(--sp-13) 0 36px;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--ink);
    outline: none;
    transition: box-shadow var(--dur-fast) var(--ease-out);
  }

  .search-neu:focus {
    box-shadow: var(--shadow-neu-inset), 0 0 0 2px var(--gold-soft);
  }

  .search-neu::placeholder { color: var(--ink-30); }

  .filter-count {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--ink-30);
    white-space: nowrap;
  }

  /* ── Customer grid ── */
  .grid-section { overflow: hidden; }

  .customer-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
    gap: var(--sp-16);
  }

  /* ── Customer card ── */
  .customer-card {
    border-radius: 14px;
    padding: var(--sp-16);
    display: flex;
    flex-direction: column;
    gap: var(--sp-13);
    transition: box-shadow var(--dur-normal) var(--ease-out),
                transform var(--dur-normal) var(--ease-out);
  }

  .customer-card:hover {
    transform: translateY(-2px);
    box-shadow:
      -8px -8px 18px rgba(253, 251, 247, 0.85),
      8px 8px 18px rgba(170, 160, 142, 0.35);
  }

  .card-blocked {
    opacity: 0.65;
  }

  .card-overdue {
    border-top: 2px solid var(--coral);
  }

  /* Card head */
  .card-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--sp-8);
  }

  .card-head-left {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-10);
    flex: 1;
    min-width: 0;
  }

  /* Grade badge (circle) */
  .grade-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    font-size: 12px;
    font-weight: 700;
    flex-shrink: 0;
  }

  .grade-sage   { background: var(--sage-soft);  color: var(--sage); }
  .grade-blue   { background: var(--blue-soft);  color: var(--blue); }
  .grade-amber  { background: var(--amber-soft); color: var(--amber); }
  .grade-coral  { background: var(--coral-soft); color: var(--coral); }
  .grade-neutral { background: var(--ink-06);    color: var(--ink-60); }

  .card-name-group {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .card-name {
    font-family: var(--font-ui);
    font-size: 14px;
    font-weight: 500;
    color: var(--ink);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-align: left;
    line-height: 1.2;
    transition: color var(--dur-fast) var(--ease-out);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .card-name:hover { color: var(--gold); }

  .card-fullname {
    font-size: var(--text-xs);
    color: var(--ink-30);
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .blocked-chip {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 700;
    color: var(--coral);
    background: var(--coral-soft);
    padding: var(--sp-1) var(--sp-5);
    border-radius: var(--radius-pill);
    flex-shrink: 0;
    white-space: nowrap;
  }

  /* Category */
  .card-category {
    margin-top: calc(-1 * var(--sp-8));
  }

  /* Metrics row */
  .metrics-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--sp-8);
  }

  .metric {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    padding: var(--sp-8) var(--sp-10);
    border-radius: var(--radius-sm);
  }

  .metric-label {
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-30);
    white-space: nowrap;
  }

  .metric-value {
    font-family: var(--font-data);
    font-size: var(--text-xs);
    font-weight: 400;
    letter-spacing: -0.01em;
    color: var(--ink);
    white-space: nowrap;
  }

  .metric-value-outstanding { color: var(--coral); }
  .metric-date { color: var(--ink-60); }

  /* Contact strip */
  .contact-strip {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-8);
    padding: var(--sp-8) var(--sp-10);
    background: var(--ink-03);
    border-radius: var(--radius-sm);
  }

  .contact-glyph {
    color: var(--ink-30);
    font-size: 14px;
    line-height: 1.4;
    flex-shrink: 0;
  }

  .contact-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .contact-name {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .contact-phone {
    font-size: var(--text-xs);
    color: var(--ink-60);
  }

  /* Card footer */
  .card-footer {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--sp-8);
    padding-top: var(--sp-8);
    border-top: 1px solid var(--ink-06);
  }

  .card-terms {
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--ink-40);
    white-space: nowrap;
  }

  .card-activity {
    font-size: var(--text-xs);
    color: var(--ink-30);
    text-align: right;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 60%;
  }

  .card-notes {
    font-style: italic;
    font-size: 10px;
    max-width: 55%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ── Show more ── */
  .show-more-row {
    display: flex;
    justify-content: center;
    padding: var(--sp-16) 0 var(--sp-8);
  }

  /* ── Empty state ── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-8);
    padding: var(--sp-55) var(--sp-13);
  }

  .empty-glyph {
    font-size: 32px;
    line-height: 1;
    color: var(--ink-30);
    opacity: 0.4;
  }

  .empty-msg {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--ink-30);
    text-align: center;
    margin: 0;
  }
</style>
