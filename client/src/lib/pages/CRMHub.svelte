<script lang="ts">
  // CRMHub.svelte — V4 Rams × Neumorphic
  // Customers with grade tabs, card grid, search

  import { parties, contacts, moneyEvents } from '../db';
  import { formatBHD, formatRelative } from '../format';
  import CreatePartyModal from '../components/CreatePartyModal.svelte';
  import Customer360Modal from '../components/Customer360Modal.svelte';
  import { enter } from '$lib/motion/asymm-motion';

  const PAGE_SIZE = 50;

  let viewMode         = $state<'customers' | 'suppliers'>('customers');
  let showCreateParty  = $state(false);
  let activeTab        = $state('all');
  let selected360Id    = $state<bigint | null>(null);

  let customerSearch   = $state('');
  let customerShowAll  = $state(false);

  let supplierSearch   = $state('');
  let supplierShowAll  = $state(false);

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

  const DEMO_SUPPLIERS = [
    {
      id: 101n,
      name: 'Endress+Hauser',
      fullName: 'Endress+Hauser AG',
      productTypes: 'E+H Flow, E+H Level, E+H Pressure, E+H Temperature',
      totalSpend: '85,000.000',
      totalSpendFils: 85000000n,
      payable: '12,500.000',
      payableFils: 12500000n,
      contact: 'Hans Mueller',
      phone: '+41 61 715 7575',
      paymentTerms: 'Net 60',
      notes: 'Primary OEM. Basel office. Quarterly pricing review.',
      bankIban: 'CH93 0076 2011 6238 5295 7',
      bankSwift: 'UBSWCHZH80A',
      bankAccountName: 'Endress+Hauser AG',
      hasBankDetails: true,
    },
    {
      id: 102n,
      name: 'Servomex',
      fullName: 'Servomex Group Ltd',
      productTypes: 'Gas Analysers',
      totalSpend: '22,000.000',
      totalSpendFils: 22000000n,
      payable: '3,200.000',
      payableFils: 3200000n,
      contact: 'James Wright',
      phone: '+44 1onal 732800',
      paymentTerms: 'Net 45',
      notes: 'UK supplier. 25% margin products. Annual contract renewal.',
      bankIban: 'GB29 NWBK 6016 1331 9268 19',
      bankSwift: 'NWBKGB2L',
      bankAccountName: 'Servomex Group Ltd',
      hasBankDetails: true,
    },
    {
      id: 103n,
      name: 'GIC India',
      fullName: 'Gujarat Industrial Corporation',
      productTypes: 'Chemicals, Industrial Supplies',
      totalSpend: '8,500.000',
      totalSpendFils: 8500000n,
      payable: '0.000',
      payableFils: 0n,
      contact: 'Rajan Patel',
      phone: '+91 79 2658 3124',
      paymentTerms: 'Advance',
      notes: 'High margin (35-50%). Advance payment only.',
      bankIban: '',
      bankSwift: '',
      bankAccountName: '',
      hasBankDetails: false,
    },
    {
      id: 104n,
      name: 'Iskraemeco',
      fullName: 'Iskraemeco d.d.',
      productTypes: 'Energy Meters',
      totalSpend: '14,000.000',
      totalSpendFils: 14000000n,
      payable: '5,800.000',
      payableFils: 5800000n,
      contact: 'Ana Kovac',
      phone: '+386 4 206 1000',
      paymentTerms: 'Net 90',
      notes: 'Slovenian meter manufacturer. Lead time 8-12 weeks.',
      bankIban: '',
      bankSwift: '',
      bankAccountName: '',
      hasBankDetails: false,
    },
    {
      id: 105n,
      name: 'Landis+Gyr',
      fullName: 'Landis+Gyr AG',
      productTypes: 'Smart Meters, Grid Solutions',
      totalSpend: '11,000.000',
      totalSpendFils: 11000000n,
      payable: '2,200.000',
      payableFils: 2200000n,
      contact: 'Stefan Berger',
      phone: '+41 41 935 6000',
      paymentTerms: 'Net 60',
      notes: 'Swiss HQ. Metering projects with EWA.',
      bankIban: '',
      bankSwift: '',
      bankAccountName: '',
      hasBankDetails: false,
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

  // ── Supplier live data ──────────────────────────────────

  let allSuppliers = $derived.by(() => {
    return $parties.filter(p => p.isSupplier).map(p => {
      const partyContacts = $contacts.filter(c => c.partyId === p.id);
      const primaryContact = partyContacts[0];

      // Compute spend from SupplierInvoice and SupplierPayment events
      const partyEvents = $moneyEvents.filter(e => e.partyId === p.id);
      const invoiced = partyEvents
        .filter(e => (e.kind as any)?.tag === 'SupplierInvoice')
        .reduce((s, e) => s + e.totalFils, 0n);
      const paid = partyEvents
        .filter(e => (e.kind as any)?.tag === 'SupplierPayment')
        .reduce((s, e) => s + e.totalFils, 0n);
      const payable = invoiced > paid ? invoiced - paid : 0n;

      return {
        id: p.id,
        name: p.name,
        fullName: p.name,
        productTypes: p.productTypes ?? '',
        totalSpend: (Number(invoiced) / 1000).toLocaleString('en-BH', { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
        totalSpendFils: invoiced,
        payable: (Number(payable) / 1000).toLocaleString('en-BH', { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
        payableFils: payable,
        contact: primaryContact?.name ?? '—',
        phone: primaryContact?.phone ?? '',
        paymentTerms: `Net ${Number(p.paymentTermsDays)}`,
        notes: p.notes ?? '',
        bankIban: p.bankIban ?? '',
        bankSwift: p.bankSwift ?? '',
        bankAccountName: p.bankAccountName ?? '',
        hasBankDetails: !!(p.bankIban || p.bankSwift),
      };
    });
  });

  let displaySuppliers = $derived(allSuppliers.length > 0 ? allSuppliers : DEMO_SUPPLIERS);
  let useLiveSupplierData = $derived(allSuppliers.length > 0);

  let filteredSuppliers = $derived.by(() => {
    const q = supplierSearch.trim().toLowerCase();
    return (displaySuppliers as typeof DEMO_SUPPLIERS).filter(s => {
      if (q && !s.name.toLowerCase().includes(q) && !s.productTypes.toLowerCase().includes(q)) return false;
      return true;
    });
  });

  let visibleSuppliers = $derived.by(() => {
    if (supplierShowAll) return filteredSuppliers;
    return filteredSuppliers.slice(0, PAGE_SIZE);
  });

  let hasMoreSuppliers = $derived(filteredSuppliers.length > PAGE_SIZE && !supplierShowAll);

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
      <h1 class="hub-title">{viewMode === 'customers' ? 'CUSTOMERS' : 'SUPPLIERS'}</h1>
      <p class="hub-count">{viewMode === 'customers' ? displayCustomers.length : displaySuppliers.length} total</p>
    </div>

    <!-- View toggle -->
    <div class="view-toggle">
      <button class="toggle-btn" class:toggle-active={viewMode === 'customers'} onclick={() => (viewMode = 'customers')}>
        Customers
      </button>
      <button class="toggle-btn" class:toggle-active={viewMode === 'suppliers'} onclick={() => (viewMode = 'suppliers')}>
        Suppliers
      </button>
    </div>

    <!-- Grade distribution (customers only) -->
    {#if viewMode === 'customers'}
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
    {/if}

    <button class="btn btn-gold btn-sm" onclick={() => (showCreateParty = true)}>
      + {viewMode === 'customers' ? 'New Customer' : 'New Supplier'}
    </button>
  </header>

  {#if viewMode === 'customers'}
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

  {:else}
    <!-- Supplier search -->
    <div class="search-row" use:enter={{ index: 1 }}>
      <div class="search-wrap">
        <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
        </svg>
        <input
          class="search-neu"
          type="search"
          placeholder="Search suppliers or product types..."
          bind:value={supplierSearch}
          aria-label="Search suppliers"
        />
      </div>
      {#if filteredSuppliers.length !== displaySuppliers.length}
        <span class="filter-count">{filteredSuppliers.length} of {displaySuppliers.length}</span>
      {/if}
    </div>

    <!-- Supplier grid -->
    <div class="grid-section" use:enter={{ index: 2 }}>
      {#if filteredSuppliers.length === 0}
        <div class="empty-state">
          <div class="empty-glyph">&#9675;</div>
          <p class="empty-msg">No suppliers match your search.</p>
        </div>
      {:else}
        <div class="customer-grid">
          {#each visibleSuppliers as s (s.id)}
            {@const hasPayable = s.payableFils > 0n}
            <div class="customer-card card">
              <!-- Card header: name -->
              <div class="card-head">
                <div class="card-head-left">
                  <div class="card-name-group">
                    <span class="card-name" title={s.fullName}>
                      {s.name}
                    </span>
                    {#if s.fullName !== s.name}
                      <span class="card-fullname">{s.fullName}</span>
                    {/if}
                  </div>
                </div>
              </div>

              <!-- Product type tags -->
              {#if s.productTypes}
                <div class="supplier-type-tags">
                  {#each s.productTypes.split(', ') as tag}
                    <span class="supplier-type-tag">{tag}</span>
                  {/each}
                </div>
              {/if}

              <!-- Key metrics row -->
              <div class="metrics-row">
                <div class="metric card-inset">
                  <span class="metric-label">Total Spend</span>
                  <span class="metric-value">{s.totalSpend}</span>
                </div>
                <div class="metric card-inset" class:metric-alert={hasPayable}>
                  <span class="metric-label">Payable</span>
                  <span class="metric-value" class:metric-value-outstanding={hasPayable}>{s.payable}</span>
                </div>
                <div class="metric card-inset">
                  <span class="metric-label">Terms</span>
                  <span class="metric-value">{s.paymentTerms}</span>
                </div>
              </div>

              <!-- Contact info -->
              <div class="contact-strip">
                <span class="contact-glyph" aria-hidden="true">&#9687;</span>
                <div class="contact-info">
                  <span class="contact-name">{s.contact}</span>
                  {#if s.phone}
                    <span class="contact-phone">{s.phone}</span>
                  {/if}
                </div>
              </div>

              <!-- Bank details -->
              {#if s.hasBankDetails}
                <div class="supplier-bank-strip">
                  {#if s.bankIban}
                    <div class="bank-field">
                      <span class="bank-field-label">IBAN</span>
                      <span class="bank-field-value">{s.bankIban}</span>
                    </div>
                  {/if}
                  {#if s.bankSwift}
                    <div class="bank-field">
                      <span class="bank-field-label">SWIFT</span>
                      <span class="bank-field-value">{s.bankSwift}</span>
                    </div>
                  {/if}
                </div>
              {/if}

              <!-- Footer with notes -->
              {#if s.notes}
                <div class="card-footer">
                  <span class="card-activity card-notes" style="max-width: 100%">{s.notes}</span>
                </div>
              {/if}
            </div>
          {/each}
        </div>

        {#if hasMoreSuppliers}
          <div class="show-more-row">
            <button class="btn btn-ghost btn-sm" onclick={() => (supplierShowAll = true)}>
              Show all {filteredSuppliers.length} suppliers
            </button>
          </div>
        {/if}
      {/if}
    </div>
  {/if}

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

  /* ── View toggle ── */
  .view-toggle {
    display: flex;
    background: var(--ink-06);
    border-radius: var(--radius-pill);
    padding: 2px;
    gap: 0;
  }

  .toggle-btn {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 600;
    padding: var(--sp-5) var(--sp-16);
    border: none;
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--ink-40);
    cursor: pointer;
    transition: all var(--dur-fast) var(--ease-out);
  }

  .toggle-active {
    background: var(--paper-card);
    color: var(--ink);
    box-shadow: var(--shadow-neu-sm);
  }

  /* ── Supplier type tags ── */
  .supplier-type-tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-3);
  }

  .supplier-type-tag {
    font-size: 10px;
    font-weight: 500;
    color: var(--ink-40);
    background: var(--ink-06);
    padding: 1px 6px;
    border-radius: var(--radius-pill);
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

  /* ── Supplier bank details ── */
  .supplier-bank-strip {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: var(--sp-8) var(--sp-10);
    background: var(--ink-03);
    border-radius: var(--radius-sm);
    border-left: 2px solid var(--gold-soft);
  }

  .bank-field {
    display: flex;
    gap: var(--sp-8);
    align-items: baseline;
  }

  .bank-field-label {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--ink-30);
    min-width: 40px;
  }

  .bank-field-value {
    font-family: var(--font-data);
    font-size: var(--text-xs);
    color: var(--ink-60);
    letter-spacing: 0.02em;
  }
</style>
