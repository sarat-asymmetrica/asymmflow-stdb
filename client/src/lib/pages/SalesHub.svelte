<script lang="ts">
  // SalesHub.svelte — V4 Rams × Neumorphic
  // Pipeline | Won | Lost with summary strip, neumorphic cards, competitor flags

  import { parties, pipelines, orders, nicknameMap } from '../db';
  import { formatBHD, formatBHDCompact } from '../format';
  import { generateQuotationPdf, downloadQuotationPdf } from '../documents/quotationGenerator';
  import type { QuotationItem } from '../documents/quotationGenerator';
  import { enter } from '$lib/motion/asymm-motion';
  import { loadRFQStore, computeRFQDashboard, type RFQDashboard } from '../business/rfqManagement';
  import { activeView, type View } from '../stores';

  let activeTab = $state<'pipeline' | 'won' | 'lost' | 'rfqs'>('pipeline');

  function navigateTo(view: View) {
    activeView.set(view);
  }

  function setSalesTab(tab: typeof activeTab) {
    activeTab = tab;
  }

  // ── RFQ state ───────────────────────────────────────────────────────────
  let rfqStore = $state(loadRFQStore());
  let rfqDashboard = $derived(computeRFQDashboard(
    rfqStore,
    $pipelines as never,
    new Date().toISOString().slice(0, 10),
  ));

  const DEMO_RFQS = [
    { pipelineId: '1', rfqReference: 'RFQ-BAPCO-2026-041', receivedDate: '2026-03-10', responseDeadline: '2026-03-22', status: 'costing' as const, source: 'email', notes: 'Coriolis meter upgrade project' },
    { pipelineId: '2', rfqReference: 'RFQ-ALBA-2026-015', receivedDate: '2026-03-15', responseDeadline: '2026-03-25', status: 'reviewing' as const, source: 'portal', notes: 'RTD sensor replacement' },
    { pipelineId: '5', rfqReference: 'RFQ-EWA-2026-088', receivedDate: '2026-03-18', responseDeadline: '2026-03-28', status: 'received' as const, source: 'tender', notes: 'Metering infrastructure upgrade' },
    { pipelineId: '3', rfqReference: 'RFQ-GPIC-2026-007', receivedDate: '2026-03-01', responseDeadline: '2026-03-10', status: 'quoted' as const, source: 'email', notes: 'Gasket procurement' },
  ] as const;

  let displayRfqs = $derived(rfqStore.entries.length > 0 ? rfqStore.entries : DEMO_RFQS);

  // ── Demo data (used when STDB is empty) ───────────────────────────────────

  const DEMO: Array<{
    id: number;
    title: string;
    customer: string;
    grade: string;
    stage: string;
    isWon: boolean;
    isLost: boolean;
    valueFils: bigint;
    marginBps: number;
    competitorPresent: boolean;
    owner: string;
    nextFollowUp: string;
    lossReason: string | null;
  }> = [
    {
      id: 1,
      title: 'Coriolis flow meter upgrade',
      customer: 'BAPCO',
      grade: 'B',
      stage: 'Active',
      isWon: false,
      isLost: false,
      valueFils: 309_000_000n,
      marginBps: 2200,
      competitorPresent: true,
      owner: 'Ebin',
      nextFollowUp: '24 Mar 2026',
      lossReason: null,
    },
    {
      id: 2,
      title: 'RTD sensor replacement',
      customer: 'ALBA',
      grade: 'A',
      stage: 'InProgress',
      isWon: false,
      isLost: false,
      valueFils: 45_000_000n,
      marginBps: 3100,
      competitorPresent: false,
      owner: 'Sundar',
      nextFollowUp: '20 Mar 2026',
      lossReason: null,
    },
    {
      id: 3,
      title: 'Pressure transmitter expansion',
      customer: 'GPIC',
      grade: 'B',
      stage: 'Draft',
      isWon: false,
      isLost: false,
      valueFils: 28_000_000n,
      marginBps: 1800,
      competitorPresent: false,
      owner: 'Ramya',
      nextFollowUp: '18 Mar 2026',
      lossReason: null,
    },
    {
      id: 4,
      title: 'Commissioning service',
      customer: 'Tatweer',
      grade: 'A',
      stage: 'Active',
      isWon: false,
      isLost: false,
      valueFils: 15_000_000n,
      marginBps: 4200,
      competitorPresent: false,
      owner: 'Ebin',
      nextFollowUp: '19 Mar 2026',
      lossReason: null,
    },
    {
      id: 5,
      title: 'Gas analyzer installation',
      customer: 'Aldur',
      grade: 'C',
      stage: 'Draft',
      isWon: false,
      isLost: false,
      valueFils: 273_000_000n,
      marginBps: 900,
      competitorPresent: true,
      owner: '—',
      nextFollowUp: '—',
      lossReason: null,
    },
    {
      id: 6,
      title: 'Level transmitter supply',
      customer: 'BAPCO',
      grade: 'B',
      stage: 'Terminal',
      isWon: true,
      isLost: false,
      valueFils: 62_000_000n,
      marginBps: 2600,
      competitorPresent: false,
      owner: 'Ebin',
      nextFollowUp: '—',
      lossReason: null,
    },
    {
      id: 7,
      title: 'Valve actuator overhaul',
      customer: 'ALBA',
      grade: 'A',
      stage: 'Terminal',
      isWon: true,
      isLost: false,
      valueFils: 38_500_000n,
      marginBps: 3400,
      competitorPresent: false,
      owner: 'Sundar',
      nextFollowUp: '—',
      lossReason: null,
    },
    {
      id: 8,
      title: 'DCS migration project',
      customer: 'Gulf Petrochem',
      grade: 'C',
      stage: 'Terminal',
      isWon: false,
      isLost: true,
      valueFils: 480_000_000n,
      marginBps: 1200,
      competitorPresent: true,
      owner: 'Peri',
      nextFollowUp: '—',
      lossReason: 'Price — ABB came in 18% lower',
    },
    {
      id: 9,
      title: 'Safety system upgrade',
      customer: 'Tatweer',
      grade: 'A',
      stage: 'Terminal',
      isWon: false,
      isLost: true,
      valueFils: 195_000_000n,
      marginBps: 1500,
      competitorPresent: true,
      owner: 'Ebin',
      nextFollowUp: '—',
      lossReason: 'Price — budget freeze, ABB nominated',
    },
    {
      id: 10,
      title: 'Calibration service contract',
      customer: 'GPIC',
      grade: 'B',
      stage: 'Terminal',
      isWon: false,
      isLost: true,
      valueFils: 22_000_000n,
      marginBps: 800,
      competitorPresent: false,
      owner: 'Ramya',
      nextFollowUp: '—',
      lossReason: 'Relationship — existing supplier renewed',
    },
  ];

  // ── Derived rows from STDB (fall back to demo when empty) ─────────────────

  let partyMap = $derived.by(() => new Map($parties.map(p => [p.id, p])));

  type RowShape = {
    id: number | bigint;
    title: string;
    customer: string;
    grade: string;
    stage: string;
    isWon: boolean;
    isLost: boolean;
    valueFils: bigint;
    marginBps: number;
    competitorPresent: boolean;
    owner: string;
    nextFollowUp: string;
    lossReason: string | null;
  };

  let stdbRows = $derived.by((): RowShape[] =>
    $pipelines.map(p => {
      const party = partyMap.get(p.partyId);
      const grade = (party?.grade as any)?.tag ?? '?';
      const status = (p.status as any)?.tag ?? 'Draft';
      const isWon  = status === 'Terminal' && !p.lossReason;
      const isLost = status === 'Terminal' && !!p.lossReason;
      const owner  = $nicknameMap.get(String(p.ownerId)) ?? '—';
      return {
        id: p.id,
        title: p.title,
        customer: party?.name ?? '—',
        grade,
        stage: status,
        isWon,
        isLost,
        valueFils: p.estimatedValueFils,
        marginBps: Number(p.markupBps ?? 0),
        competitorPresent: p.competitorPresent,
        owner,
        nextFollowUp: p.nextFollowUp
          ? new Date(Number(p.nextFollowUp.microsSinceUnixEpoch / 1000n)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
          : '—',
        lossReason: p.lossReason ?? null,
      };
    })
  );

  // Use STDB when populated, else demo
  let allRows = $derived.by((): RowShape[] =>
    stdbRows.length > 0 ? stdbRows : DEMO
  );

  // Sorted by value descending
  let activeRows = $derived.by(() =>
    allRows
      .filter(r => r.stage !== 'Terminal')
      .slice()
      .sort((a, b) => (b.valueFils > a.valueFils ? 1 : b.valueFils < a.valueFils ? -1 : 0))
  );

  let wonRows = $derived.by(() =>
    allRows
      .filter(r => r.isWon)
      .slice()
      .sort((a, b) => (b.valueFils > a.valueFils ? 1 : b.valueFils < a.valueFils ? -1 : 0))
  );

  let lostRows = $derived.by(() =>
    allRows
      .filter(r => r.isLost)
      .slice()
      .sort((a, b) => (b.valueFils > a.valueFils ? 1 : b.valueFils < a.valueFils ? -1 : 0))
  );

  // ── Summary stats ─────────────────────────────────────────────────────────

  let totalPipelineFils = $derived(activeRows.reduce((s, r) => s + r.valueFils, 0n));
  let totalWonFils      = $derived(wonRows.reduce((s, r) => s + r.valueFils, 0n));
  let totalLostFils     = $derived(lostRows.reduce((s, r) => s + r.valueFils, 0n));

  let avgDealFils = $derived.by(() => {
    const rows = activeTab === 'won' ? wonRows : activeTab === 'lost' ? lostRows : activeRows;
    if (rows.length === 0) return 0n;
    return rows.reduce((s, r) => s + r.valueFils, 0n) / BigInt(rows.length);
  });

  let avgMargin = $derived.by(() => {
    const rows = activeTab === 'won' ? wonRows : activeTab === 'lost' ? lostRows : activeRows;
    if (rows.length === 0) return 0;
    return rows.reduce((s, r) => s + r.marginBps, 0) / rows.length / 100;
  });

  // Win rate across all terminal deals
  let winRate = $derived.by(() => {
    const terminal = wonRows.length + lostRows.length;
    if (terminal === 0) return 0;
    return Math.round((wonRows.length / terminal) * 100);
  });

  // Current tab rows
  let currentRows = $derived.by(() =>
    activeTab === 'won' ? wonRows : activeTab === 'lost' ? lostRows : activeTab === 'pipeline' ? activeRows : []
  );

  let currentTotalFils = $derived(currentRows.reduce((s, r) => s + r.valueFils, 0n));

  // Lost analysis — price losses
  let priceLossCount = $derived(
    lostRows.filter(r => r.lossReason?.toLowerCase().includes('price')).length
  );
  let priceLossPct = $derived.by(() => {
    if (lostRows.length === 0) return 0;
    return Math.round((priceLossCount / lostRows.length) * 100);
  });

  // Unassigned flag (no owner on active deals)
  let unassignedCount = $derived(activeRows.filter(r => r.owner === '—').length);

  let topPipelineDeal = $derived(activeRows[0] ?? null);
  let urgentFollowUpDeal = $derived.by(() => {
    const withFollowUp = activeRows.filter(row => row.nextFollowUp !== '—');
    return withFollowUp[0] ?? topPipelineDeal;
  });
  let topWonDeal = $derived(wonRows[0] ?? null);
  let topLostDeal = $derived(lostRows[0] ?? null);
  let priceLossDeals = $derived(lostRows.filter(r => r.lossReason?.toLowerCase().includes('price')));
  let overdueRfqs = $derived(rfqDashboard.overdue);
  let dueSoonRfqs = $derived(rfqDashboard.dueSoon);

  let salesHeadline = $derived.by(() => {
    if (activeTab === 'rfqs') {
      if (overdueRfqs.length > 0) {
        return {
          eyebrow: 'Commercial Pressure',
          title: `${overdueRfqs.length} RFQ${overdueRfqs.length === 1 ? '' : 's'} need an immediate response`,
          subtitle: `Keep proposal work moving. ${dueSoonRfqs.length} more are due inside the next window.`,
        };
      }
      return {
        eyebrow: 'Commercial Pressure',
        title: `${displayRfqs.length} RFQs are in motion across the desk`,
        subtitle: `Use this lane to clear costing, reviews, and quoted follow-through without losing handoff context.`,
      };
    }
    if (topPipelineDeal) {
      return {
        eyebrow: 'Commercial Pressure',
        title: `${topPipelineDeal.customer} anchors the current active book`,
        subtitle: `${topPipelineDeal.title} is the largest live opportunity at ${formatBHDCompact(topPipelineDeal.valueFils)} BHD with ${unassignedCount} deal${unassignedCount === 1 ? '' : 's'} still unassigned.`,
      };
    }
    return {
      eyebrow: 'Commercial Pressure',
      title: 'The sales surface is ready for the next opportunity wave',
      subtitle: 'As quotes and RFQs arrive, this hub will surface ownership, follow-ups, and learning loops automatically.',
    };
  });

  let salesPriorityDeck = $derived.by(() => {
    const items: Array<{
      label: string;
      title: string;
      detail: string;
      tone: 'gold' | 'coral' | 'sage';
      cta: string;
      action: () => void;
    }> = [];

    if (urgentFollowUpDeal) {
      items.push({
        label: 'Follow-Up',
        title: urgentFollowUpDeal.title,
        detail: `${urgentFollowUpDeal.customer} · ${formatBHDCompact(urgentFollowUpDeal.valueFils)} BHD · next touch ${urgentFollowUpDeal.nextFollowUp}`,
        tone: 'gold',
        cta: 'View Pipeline',
        action: () => setSalesTab('pipeline'),
      });
    }

    if (unassignedCount > 0) {
      items.push({
        label: 'Coverage',
        title: `${unassignedCount} active deal${unassignedCount === 1 ? '' : 's'} need an owner`,
        detail: `Assignment clarity matters now while the live book is worth ${formatBHDCompact(totalPipelineFils)} BHD.`,
        tone: 'coral',
        cta: 'Review Pipeline',
        action: () => setSalesTab('pipeline'),
      });
    }

    if (priceLossDeals.length > 0) {
      items.push({
        label: 'Learning Loop',
        title: `${priceLossPct}% of losses were price-led`,
        detail: topLostDeal
          ? `${topLostDeal.customer} lost ${formatBHDCompact(topLostDeal.valueFils)} BHD. Tighten positioning before the next similar bid.`
          : 'Recent closed-lost deals point to pricing pressure in the market.',
        tone: 'coral',
        cta: 'Review Losses',
        action: () => setSalesTab('lost'),
      });
    }

    if (topWonDeal) {
      items.push({
        label: 'Momentum',
        title: `${topWonDeal.customer} is the strongest recent conversion`,
        detail: `${topWonDeal.title} closed at ${formatBHDCompact(topWonDeal.valueFils)} BHD with ${(topWonDeal.marginBps / 100).toFixed(1)}% markup.`,
        tone: 'sage',
        cta: 'Open Won',
        action: () => setSalesTab('won'),
      });
    }

    if (overdueRfqs.length > 0 || dueSoonRfqs.length > 0) {
      items.push({
        label: 'RFQ Desk',
        title: overdueRfqs.length > 0
          ? `${overdueRfqs.length} RFQ${overdueRfqs.length === 1 ? '' : 's'} are overdue`
          : `${dueSoonRfqs.length} RFQ${dueSoonRfqs.length === 1 ? '' : 's'} are due soon`,
        detail: `Stay on top of ${rfqDashboard.total || displayRfqs.length} inbound requests to protect conversion throughput.`,
        tone: overdueRfqs.length > 0 ? 'coral' : 'gold',
        cta: 'Open RFQs',
        action: () => setSalesTab('rfqs'),
      });
    }

    return items.slice(0, 4);
  });

  let commandShortcuts = $derived([
    {
      label: 'Quote Desk',
      hint: topPipelineDeal ? `${topPipelineDeal.customer} · ${formatBHDCompact(topPipelineDeal.valueFils)} BHD` : 'Prepare and issue quotation packs',
      action: () => {
        if (topPipelineDeal) {
          openQuoteModal(topPipelineDeal);
        } else {
          setSalesTab('pipeline');
        }
      },
    },
    {
      label: 'RFQ Queue',
      hint: `${rfqDashboard.total || displayRfqs.length} active requests`,
      action: () => setSalesTab('rfqs'),
    },
    {
      label: 'Won Deals',
      hint: `${wonRows.length} closed-won opportunities`,
      action: () => setSalesTab('won'),
    },
    {
      label: 'CRM Context',
      hint: 'Jump into relationship history',
      action: () => navigateTo('crm'),
    },
  ]);

  let commercialPulse = $derived([
    {
      label: 'Pipeline Coverage',
      value: `${activeRows.length} live`,
      detail: formatBHDCompact(totalPipelineFils) + ' BHD',
    },
    {
      label: 'RFQ Throughput',
      value: `${rfqDashboard.winRate.toFixed(0)}%`,
      detail: `${rfqDashboard.total || displayRfqs.length} tracked RFQs`,
    },
    {
      label: 'Price Pressure',
      value: `${priceLossPct}%`,
      detail: `${priceLossCount} price-led losses`,
    },
    {
      label: 'Cross-Team Hand-Off',
      value: `${unassignedCount}`,
      detail: unassignedCount > 0 ? 'deals need ownership' : 'all active deals assigned',
    },
  ]);

  // ── Color helpers ─────────────────────────────────────────────────────────

  const stageLabel: Record<string, string> = {
    Draft: 'Draft',
    Active: 'Active',
    InProgress: 'In Progress',
    Terminal: 'Closed',
  };

  // ── Quote modal (preserved from original) ─────────────────────────────────

  interface QuoteItemDraft {
    description: string;
    quantity: number;
    unitPriceBHD: string;
  }

  let showQuoteModal = $state(false);
  let quoteParty     = $state<any>(null);
  let quotePipeline  = $state<any>(null);
  let quoteItems     = $state<QuoteItemDraft[]>([]);
  let quoteNotes     = $state('');
  let quoteValidity  = $state(30);

  let quoteSubtotalFils = $derived.by(() =>
    quoteItems.reduce((sum, item) => {
      const priceVal = parseFloat(item.unitPriceBHD);
      if (isNaN(priceVal) || priceVal < 0) return sum;
      const fils = BigInt(Math.round(priceVal * 1000));
      const qty  = BigInt(Math.max(1, Math.floor(item.quantity)));
      return sum + fils * qty;
    }, 0n)
  );

  let quoteVatFils       = $derived(BigInt(Math.round(Number(quoteSubtotalFils) * 10 / 100)));
  let quoteGrandTotalFils = $derived(quoteSubtotalFils + quoteVatFils);

  function openQuoteModal(row: RowShape) {
    const pipeline = $pipelines.find(p => p.id === row.id);
    if (!pipeline) {
      // Demo mode — synthesize a party-like object
      quoteParty = { name: row.customer, id: row.id };
      quotePipeline = null;
      const estimatedBHD = (Number(row.valueFils) / 1000).toFixed(3);
      quoteItems = [{ description: row.title, quantity: 1, unitPriceBHD: estimatedBHD }];
      quoteNotes = '';
      quoteValidity = 30;
      showQuoteModal = true;
      return;
    }
    const partyObj = partyMap.get(pipeline.partyId);
    if (!partyObj) return;
    quoteParty    = partyObj;
    quotePipeline = pipeline;
    quoteNotes    = '';
    quoteValidity = 30;
    const estimatedBHD = (Number(pipeline.estimatedValueFils) / 1000).toFixed(3);
    quoteItems = [{ description: pipeline.title, quantity: 1, unitPriceBHD: estimatedBHD }];
    showQuoteModal = true;
  }

  function closeQuoteModal() {
    showQuoteModal = false;
    quoteParty     = null;
    quotePipeline  = null;
    quoteItems     = [];
  }

  function addQuoteItem() {
    quoteItems = [...quoteItems, { description: '', quantity: 1, unitPriceBHD: '0.000' }];
  }

  function removeQuoteItem(idx: number) {
    quoteItems = quoteItems.filter((_, i) => i !== idx);
  }

  function updateQuoteItem(idx: number, field: keyof QuoteItemDraft, value: string | number) {
    quoteItems = quoteItems.map((item, i) =>
      i === idx ? { ...item, [field]: value } : item
    );
  }

  function handleDownloadPdf() {
    if (!quoteParty) return;
    const items: QuotationItem[] = quoteItems
      .filter(item => item.description.trim().length > 0)
      .map(item => {
        const priceVal = parseFloat(item.unitPriceBHD);
        const fils = BigInt(Math.round((isNaN(priceVal) ? 0 : priceVal) * 1000));
        return {
          description: item.description.trim(),
          quantity: Math.max(1, Math.floor(item.quantity)),
          unit: 'EA',
          unitPriceFils: fils,
        };
      });
    if (items.length === 0) {
      alert('Please add at least one line item with a description.');
      return;
    }
    downloadQuotationPdf({ party: quoteParty, items, validityDays: quoteValidity, notes: quoteNotes.trim() || undefined });
    closeQuoteModal();
  }
</script>

<!-- ═══════════════════════════════════════════════════════════════ PAGE ══ -->
<div class="page" use:enter={{ index: 0 }}>

  <!-- ── Header ─────────────────────────────────────────────────────────── -->
  <header class="page-header">
    <div class="header-left">
      <p class="section-label">Sales</p>
      <div class="header-kpis">
        <div class="kpi-card card">
          <span class="kpi-label">Pipeline</span>
          <span class="kpi-value">{formatBHDCompact(totalPipelineFils)}</span>
          <span class="kpi-unit">BHD</span>
        </div>
        <div class="kpi-card card">
          <span class="kpi-label">Win Rate</span>
          <span class="kpi-value kpi-value--sage">{winRate}%</span>
          <span class="kpi-unit">{wonRows.length} of {wonRows.length + lostRows.length}</span>
        </div>
        <div class="kpi-card card">
          <span class="kpi-label">Active Deals</span>
          <span class="kpi-value">{activeRows.length}</span>
          {#if unassignedCount > 0}
            <span class="kpi-unit kpi-unit--warn">{unassignedCount} unassigned</span>
          {:else}
            <span class="kpi-unit">all assigned</span>
          {/if}
        </div>
        <div class="kpi-card card">
          <span class="kpi-label">Won Value</span>
          <span class="kpi-value kpi-value--gold">{formatBHDCompact(totalWonFils)}</span>
          <span class="kpi-unit">BHD</span>
        </div>
      </div>
    </div>
  </header>

  <section class="command-band" use:enter={{ index: 1 }}>
    <div class="command-hero card">
      <div class="command-copy">
        <p class="command-eyebrow">{salesHeadline.eyebrow}</p>
        <h2 class="command-title">{salesHeadline.title}</h2>
        <p class="command-subtitle">{salesHeadline.subtitle}</p>
      </div>
      <div class="command-shortcuts">
        {#each commandShortcuts as shortcut}
          <button class="command-shortcut" type="button" onclick={shortcut.action}>
            <span class="command-shortcut-label">{shortcut.label}</span>
            <span class="command-shortcut-hint">{shortcut.hint}</span>
          </button>
        {/each}
      </div>
    </div>

    <div class="command-panel card">
      <div class="panel-header">
        <p class="panel-eyebrow">Priority Deck</p>
        <span class="panel-caption">What to act on next</span>
      </div>
      <div class="priority-list">
        {#each salesPriorityDeck as item}
          <article class={`priority-item priority-item--${item.tone}`}>
            <div class="priority-copy">
              <p class="priority-label">{item.label}</p>
              <h3 class="priority-title">{item.title}</h3>
              <p class="priority-detail">{item.detail}</p>
            </div>
            <button class="priority-cta" type="button" onclick={item.action}>
              {item.cta}
            </button>
          </article>
        {/each}
      </div>
    </div>

    <div class="command-panel card">
      <div class="panel-header">
        <p class="panel-eyebrow">Commercial Pulse</p>
        <span class="panel-caption">Seeded system status</span>
      </div>
      <div class="pulse-grid">
        {#each commercialPulse as pulse}
          <article class="pulse-card">
            <span class="pulse-label">{pulse.label}</span>
            <strong class="pulse-value">{pulse.value}</strong>
            <span class="pulse-detail">{pulse.detail}</span>
          </article>
        {/each}
      </div>
    </div>
  </section>

  <!-- ── Tabs ───────────────────────────────────────────────────────────── -->
  <nav class="tabs" aria-label="Sales view">
    <button
      class="tab-pill"
      class:tab-pill--active={activeTab === 'pipeline'}
      onclick={() => (activeTab = 'pipeline')}
    >
      Pipeline
      <span class="tab-count">{activeRows.length}</span>
    </button>
    <button
      class="tab-pill"
      class:tab-pill--active={activeTab === 'won'}
      onclick={() => (activeTab = 'won')}
    >
      Won
      <span class="tab-count tab-count--sage">{wonRows.length}</span>
    </button>
    <button
      class="tab-pill"
      class:tab-pill--active={activeTab === 'lost'}
      onclick={() => (activeTab = 'lost')}
    >
      Lost
      <span class="tab-count tab-count--coral">{lostRows.length}</span>
    </button>
    <button
      class="tab-pill"
      class:tab-pill--active={activeTab === 'rfqs'}
      onclick={() => (activeTab = 'rfqs')}
    >
      RFQs
      {#if rfqDashboard.overdue.length > 0}
        <span class="tab-badge tab-badge-overdue">{rfqDashboard.overdue.length}</span>
      {/if}
    </button>
  </nav>

  <!-- ── Summary strip ──────────────────────────────────────────────────── -->
  <div class="summary-strip">
    {#if activeTab === 'pipeline'}
      <div class="stat-card card-subtle">
        <span class="stat-label">Total Value</span>
        <span class="stat-number">{formatBHD(totalPipelineFils)}</span>
        <span class="stat-currency">BHD</span>
      </div>
      <div class="stat-card card-subtle">
        <span class="stat-label">Active Deals</span>
        <span class="stat-number">{activeRows.length}</span>
        <span class="stat-currency">deals</span>
      </div>
      <div class="stat-card card-subtle">
        <span class="stat-label">Avg Deal Size</span>
        <span class="stat-number">{formatBHDCompact(avgDealFils)}</span>
        <span class="stat-currency">BHD</span>
      </div>
      <div class="stat-card card-subtle">
        <span class="stat-label">Avg Margin</span>
        <span class="stat-number">{avgMargin.toFixed(1)}%</span>
        <span class="stat-currency">markup</span>
      </div>
    {:else if activeTab === 'won'}
      <div class="stat-card card-subtle stat-card--sage">
        <span class="stat-label">Won Value</span>
        <span class="stat-number stat-number--sage">{formatBHD(totalWonFils)}</span>
        <span class="stat-currency">BHD</span>
      </div>
      <div class="stat-card card-subtle">
        <span class="stat-label">Deals Won</span>
        <span class="stat-number">{wonRows.length}</span>
        <span class="stat-currency">closed</span>
      </div>
      <div class="stat-card card-subtle">
        <span class="stat-label">Avg Deal</span>
        <span class="stat-number">{formatBHDCompact(avgDealFils)}</span>
        <span class="stat-currency">BHD</span>
      </div>
      <div class="stat-card card-subtle">
        <span class="stat-label">Avg Margin</span>
        <span class="stat-number">{avgMargin.toFixed(1)}%</span>
        <span class="stat-currency">markup</span>
      </div>
    {:else if activeTab === 'lost'}
      <div class="stat-card card-subtle stat-card--coral">
        <span class="stat-label">Lost Value</span>
        <span class="stat-number stat-number--coral">{formatBHD(totalLostFils)}</span>
        <span class="stat-currency">BHD</span>
      </div>
      <div class="stat-card card-subtle">
        <span class="stat-label">Deals Lost</span>
        <span class="stat-number">{lostRows.length}</span>
        <span class="stat-currency">closed</span>
      </div>
      <div class="stat-card card-subtle">
        <span class="stat-label">Avg Lost Size</span>
        <span class="stat-number stat-number--coral">{formatBHDCompact(avgDealFils)}</span>
        <span class="stat-currency">BHD</span>
      </div>
      <div class="stat-card card-subtle">
        <span class="stat-label">Price Losses</span>
        <span class="stat-number stat-number--coral">{priceLossPct}%</span>
        <span class="stat-currency">of lost</span>
      </div>
    {:else}
      <div class="stat-card card-subtle">
        <span class="stat-label">Tracked RFQs</span>
        <span class="stat-number">{rfqDashboard.total || displayRfqs.length}</span>
        <span class="stat-currency">requests</span>
      </div>
      <div class="stat-card card-subtle stat-card--coral">
        <span class="stat-label">Overdue</span>
        <span class="stat-number stat-number--coral">{rfqDashboard.overdue.length}</span>
        <span class="stat-currency">needs response</span>
      </div>
      <div class="stat-card card-subtle">
        <span class="stat-label">Due Soon</span>
        <span class="stat-number">{rfqDashboard.dueSoon.length}</span>
        <span class="stat-currency">next window</span>
      </div>
      <div class="stat-card card-subtle stat-card--sage">
        <span class="stat-label">Win Rate</span>
        <span class="stat-number stat-number--sage">{rfqDashboard.winRate.toFixed(0)}%</span>
        <span class="stat-currency">quoted to won</span>
      </div>
    {/if}
  </div>

  <!-- ── Lost analysis banner ───────────────────────────────────────────── -->
  {#if activeTab === 'lost' && lostRows.length > 0}
    <div class="loss-banner">
      <span class="loss-banner-label">Analysis</span>
      <span class="loss-banner-text">
        {priceLossPct}% of losses driven by price — lost deals average
        {formatBHDCompact(avgDealFils)} BHD vs
        {wonRows.length > 0 ? formatBHDCompact(wonRows.reduce((s,r) => s + r.valueFils, 0n) / BigInt(wonRows.length)) : '0'} BHD on wins.
        {lostRows.filter(r => r.competitorPresent).length} had a named competitor (ABB).
      </span>
    </div>
  {/if}

  <!-- ── Table ──────────────────────────────────────────────────────────── -->
  {#if activeTab !== 'rfqs' && currentRows.length === 0}
    <div class="empty">
      <p class="empty-text">
        {#if activeTab === 'won'}No won deals yet{:else if activeTab === 'lost'}No lost deals yet{:else}No active pipeline items{/if}
      </p>
    </div>
  {:else if activeTab !== 'rfqs'}
    <div class="table-shell card">
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th class="col-customer">Customer</th>
              <th class="col-title">Opportunity</th>
              <th class="col-value num-col">Value (BHD)</th>
              <th class="col-margin num-col">Margin</th>
              <th class="col-stage">Stage</th>
              <th class="col-owner">Owner</th>
              {#if activeTab === 'pipeline'}
                <th class="col-followup">Next Follow-up</th>
              {/if}
              {#if activeTab === 'lost'}
                <th class="col-loss">Loss Reason</th>
              {/if}
              {#if activeTab !== 'lost'}
                <th class="col-action"></th>
              {/if}
            </tr>
          </thead>
          <tbody>
            {#each currentRows as row (row.id)}
              <tr class="data-row">

                <!-- Customer + grade badge -->
                <td class="col-customer">
                  <div class="customer-cell">
                    <span class="grade-badge grade-{row.grade.toLowerCase()}">{row.grade}</span>
                    <span class="customer-name">{row.customer}</span>
                    {#if row.competitorPresent}
                      <span class="competitor-dot" title="Competitor present (ABB)"></span>
                    {/if}
                  </div>
                </td>

                <!-- Title -->
                <td class="col-title">
                  <span class="deal-title">{row.title}</span>
                  {#if row.owner === '—' && activeTab === 'pipeline'}
                    <span class="unassigned-flag">unassigned</span>
                  {/if}
                </td>

                <!-- Value -->
                <td class="col-value num-col">
                  <span class="deal-value">{formatBHD(row.valueFils)}</span>
                </td>

                <!-- Margin -->
                <td class="col-margin num-col">
                  <span class="margin-num">{(row.marginBps / 100).toFixed(1)}%</span>
                </td>

                <!-- Stage badge -->
                <td class="col-stage">
                  {#if activeTab === 'won'}
                    <span class="stage-badge stage-won">Won</span>
                  {:else if activeTab === 'lost'}
                    <span class="stage-badge stage-lost">Lost</span>
                  {:else}
                    <span class="stage-badge stage-{row.stage.toLowerCase()}">
                      {stageLabel[row.stage] ?? row.stage}
                    </span>
                  {/if}
                </td>

                <!-- Owner -->
                <td class="col-owner">
                  <span class="owner-name">{row.owner}</span>
                </td>

                <!-- Follow-up (pipeline only) -->
                {#if activeTab === 'pipeline'}
                  <td class="col-followup">
                    <span class="followup-date">{row.nextFollowUp}</span>
                  </td>
                {/if}

                <!-- Loss reason (lost only) -->
                {#if activeTab === 'lost'}
                  <td class="col-loss">
                    <span class="loss-reason">{row.lossReason ?? '—'}</span>
                  </td>
                {/if}

                <!-- Action (pipeline + won) -->
                {#if activeTab !== 'lost'}
                  <td class="col-action">
                    <button class="quote-btn" onclick={() => openQuoteModal(row)}>Quote</button>
                  </td>
                {/if}

              </tr>
            {/each}
          </tbody>
          <tfoot>
            <tr class="table-foot">
              <td colspan={activeTab === 'pipeline' ? 2 : activeTab === 'won' ? 2 : 2} class="foot-label">
                {activeTab === 'won' ? 'Total won' : activeTab === 'lost' ? 'Total lost' : 'Total pipeline'}
              </td>
              <td class="num-col foot-total">{formatBHD(currentTotalFils)}</td>
              <td colspan={activeTab === 'pipeline' ? 6 : activeTab === 'lost' ? 4 : 4}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  {/if}

  <!-- ── RFQ Tab Content ─────────────────────────────────────────────────── -->
  {#if activeTab === 'rfqs'}
    <section class="rfq-section" use:enter={{ index: 3 }}>
      <!-- RFQ Summary Strip -->
      <div class="rfq-summary-strip">
        <div class="rfq-stat card-inset">
          <span class="rfq-stat-value">{rfqDashboard.total || displayRfqs.length}</span>
          <span class="rfq-stat-label">Total RFQs</span>
        </div>
        <div class="rfq-stat card-inset">
          <span class="rfq-stat-value rfq-overdue">{rfqDashboard.overdue.length}</span>
          <span class="rfq-stat-label">Overdue</span>
        </div>
        <div class="rfq-stat card-inset">
          <span class="rfq-stat-value rfq-due-soon">{rfqDashboard.dueSoon.length}</span>
          <span class="rfq-stat-label">Due Soon</span>
        </div>
        <div class="rfq-stat card-inset">
          <span class="rfq-stat-value">{rfqDashboard.winRate.toFixed(0)}%</span>
          <span class="rfq-stat-label">Win Rate</span>
        </div>
      </div>

      <!-- RFQ Cards -->
      <div class="rfq-grid">
        {#each displayRfqs as rfq (rfq.pipelineId)}
          {@const isOverdue = new Date(rfq.responseDeadline) < new Date() && rfq.status !== 'quoted' && rfq.status !== 'won' && rfq.status !== 'lost'}
          {@const isDueSoon = !isOverdue && (new Date(rfq.responseDeadline).getTime() - Date.now()) < 3 * 86_400_000 && rfq.status !== 'quoted' && rfq.status !== 'won' && rfq.status !== 'lost'}
          <div class="rfq-card card" class:rfq-card-overdue={isOverdue} class:rfq-card-due-soon={isDueSoon}>
            <div class="rfq-card-header">
              <span class="rfq-ref mono">{rfq.rfqReference}</span>
              <span class="rfq-status rfq-status-{rfq.status}">{rfq.status}</span>
            </div>
            <p class="rfq-notes">{rfq.notes}</p>
            <div class="rfq-card-footer">
              <span class="rfq-source">{rfq.source}</span>
              <span class="rfq-deadline" class:rfq-overdue={isOverdue} class:rfq-due-soon={isDueSoon}>
                Due: {rfq.responseDeadline}
              </span>
            </div>
          </div>
        {/each}
      </div>
    </section>
  {/if}

</div>

<!-- ═══════════════════════════════════════════════════════ QUOTE MODAL ══ -->
{#if showQuoteModal}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={closeQuoteModal}></div>

  <div class="modal-panel" role="dialog" aria-modal="true" aria-label="Build Quotation">
    <div class="modal-header">
      <div>
        <p class="modal-eyebrow">New Quotation</p>
        {#if quoteParty}
          <h2 class="modal-title">{quoteParty.name}</h2>
        {/if}
      </div>
      <button class="modal-close" onclick={closeQuoteModal} aria-label="Close">&#x2715;</button>
    </div>

    <div class="modal-body">
      <div class="items-wrap">
        <table class="items-table">
          <thead>
            <tr>
              <th class="col-desc">Description</th>
              <th class="col-qty">Qty</th>
              <th class="col-price">Unit Price (BHD)</th>
              <th class="col-linetotal">Line Total</th>
              <th class="col-remove"></th>
            </tr>
          </thead>
          <tbody>
            {#each quoteItems as item, idx}
              {@const priceVal = parseFloat(item.unitPriceBHD)}
              {@const priceFils = BigInt(Math.round((isNaN(priceVal) || priceVal < 0 ? 0 : priceVal) * 1000))}
              {@const qty = BigInt(Math.max(1, Math.floor(item.quantity)))}
              {@const lineTotal = priceFils * qty}
              <tr class="item-row">
                <td class="col-desc">
                  <input class="item-input item-desc" type="text"
                    placeholder="e.g. Pressure Transmitter PT-200"
                    value={item.description}
                    oninput={(e) => updateQuoteItem(idx, 'description', (e.target as HTMLInputElement).value)}
                  />
                </td>
                <td class="col-qty">
                  <input class="item-input item-qty" type="number" min="1" step="1"
                    value={item.quantity}
                    oninput={(e) => updateQuoteItem(idx, 'quantity', parseInt((e.target as HTMLInputElement).value) || 1)}
                  />
                </td>
                <td class="col-price">
                  <input class="item-input item-price" type="number" min="0" step="0.001"
                    placeholder="0.000"
                    value={item.unitPriceBHD}
                    oninput={(e) => updateQuoteItem(idx, 'unitPriceBHD', (e.target as HTMLInputElement).value)}
                  />
                </td>
                <td class="col-linetotal">{formatBHD(lineTotal)}</td>
                <td class="col-remove">
                  {#if quoteItems.length > 1}
                    <button class="remove-btn" onclick={() => removeQuoteItem(idx)} aria-label="Remove">&#x2212;</button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <button class="add-item-btn" onclick={addQuoteItem}>+ Add Line Item</button>

      <div class="totals-block">
        <div class="total-row">
          <span class="total-label">Subtotal</span>
          <span class="total-value">{formatBHD(quoteSubtotalFils)} BHD</span>
        </div>
        <div class="total-row">
          <span class="total-label">VAT (10%)</span>
          <span class="total-value">{formatBHD(quoteVatFils)} BHD</span>
        </div>
        <div class="total-row total-row--grand">
          <span class="total-label total-label--grand">Grand Total</span>
          <span class="total-value total-value--grand">{formatBHD(quoteGrandTotalFils)} BHD</span>
        </div>
      </div>

      <div class="opt-row">
        <label class="opt-field">
          <span class="opt-label">Validity (days)</span>
          <input class="item-input opt-narrow" type="number" min="1" step="1"
            value={quoteValidity}
            oninput={(e) => { quoteValidity = parseInt((e.target as HTMLInputElement).value) || 30; }}
          />
        </label>
        <label class="opt-field opt-field--grow">
          <span class="opt-label">Notes (terms)</span>
          <input class="item-input" type="text" placeholder="Optional terms or notes"
            value={quoteNotes}
            oninput={(e) => { quoteNotes = (e.target as HTMLInputElement).value; }}
          />
        </label>
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn-cancel" onclick={closeQuoteModal}>Cancel</button>
      <button class="btn-generate" onclick={handleDownloadPdf}>Generate PDF</button>
    </div>
  </div>
{/if}

<style>
  /* ── Page shell ─────────────────────────────────────────────────────────── */
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--sp-16);
    padding: var(--sp-21) var(--sp-24);
    max-width: 1200px;
    margin: 0 auto;
  }

  /* ── Header ─────────────────────────────────────────────────────────────── */
  .page-header {
    display: flex;
    flex-direction: column;
    gap: var(--sp-13);
  }

  .command-band {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(300px, 1fr) minmax(260px, 0.88fr);
    gap: var(--sp-13);
    align-items: stretch;
  }

  .command-hero {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: var(--sp-16);
    padding: var(--sp-18);
    min-height: 100%;
    background:
      radial-gradient(circle at top right, rgba(197, 160, 89, 0.18), transparent 36%),
      linear-gradient(140deg, rgba(255, 255, 255, 0.88), rgba(249, 244, 236, 0.96));
  }

  .command-copy {
    display: flex;
    flex-direction: column;
    gap: var(--sp-8);
  }

  .command-eyebrow,
  .panel-eyebrow {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--ink-40);
  }

  .command-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(1.7rem, 2.2vw, 2.4rem);
    line-height: 0.98;
    letter-spacing: -0.04em;
    color: var(--ink);
    max-width: 12ch;
  }

  .command-subtitle {
    margin: 0;
    max-width: 58ch;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    line-height: 1.6;
    color: var(--ink-60);
  }

  .command-shortcuts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--sp-8);
  }

  .command-shortcut {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    align-items: flex-start;
    padding: var(--sp-13);
    border: 1px solid rgba(17, 24, 39, 0.08);
    border-radius: var(--radius-md);
    background: rgba(255, 255, 255, 0.72);
    cursor: pointer;
    text-align: left;
    transition: transform var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }

  .command-shortcut:hover {
    transform: translateY(-1px);
    box-shadow: var(--shadow-neu-raised);
    border-color: rgba(197, 160, 89, 0.22);
  }

  .command-shortcut-label {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
  }

  .command-shortcut-hint {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    line-height: 1.45;
    color: var(--ink-40);
  }

  .command-panel {
    display: flex;
    flex-direction: column;
    gap: var(--sp-13);
    padding: var(--sp-16);
  }

  .panel-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--sp-8);
  }

  .panel-caption {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--ink-40);
  }

  .priority-list {
    display: flex;
    flex-direction: column;
    gap: var(--sp-8);
  }

  .priority-item {
    display: flex;
    flex-direction: column;
    gap: var(--sp-10);
    padding: var(--sp-13);
    border-radius: var(--radius-md);
    border: 1px solid rgba(17, 24, 39, 0.06);
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(249, 247, 242, 0.82));
  }

  .priority-item--gold {
    box-shadow: inset 3px 0 0 rgba(197, 160, 89, 0.55);
  }

  .priority-item--coral {
    box-shadow: inset 3px 0 0 rgba(210, 102, 93, 0.55);
  }

  .priority-item--sage {
    box-shadow: inset 3px 0 0 rgba(95, 140, 110, 0.55);
  }

  .priority-copy {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
  }

  .priority-label {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-40);
  }

  .priority-title {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--ink);
  }

  .priority-detail {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    line-height: 1.55;
    color: var(--ink-60);
  }

  .priority-cta {
    align-self: flex-start;
    height: 34px;
    padding: 0 var(--sp-13);
    border: none;
    border-radius: var(--radius-pill);
    background: var(--paper-card);
    box-shadow: var(--shadow-neu-btn);
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--gold);
    cursor: pointer;
  }

  .pulse-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--sp-8);
  }

  .pulse-card {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    padding: var(--sp-10);
    border-radius: var(--radius-md);
    background: var(--paper-elevated);
    box-shadow: inset 0 0 0 1px rgba(17, 24, 39, 0.04);
  }

  .pulse-label {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-40);
  }

  .pulse-value {
    font-family: var(--font-data);
    font-size: var(--text-lg);
    font-weight: 500;
    color: var(--ink);
    letter-spacing: -0.03em;
  }

  .pulse-detail {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    line-height: 1.45;
    color: var(--ink-40);
  }

  .section-label {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--ink-40);
    margin: 0 0 var(--sp-8);
  }

  .header-kpis {
    display: flex;
    gap: var(--sp-13);
    flex-wrap: wrap;
  }

  .kpi-card {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    padding: var(--sp-13) var(--sp-16);
    min-width: 130px;
    flex: 1;
    max-width: 200px;
  }

  .kpi-label {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--ink-40);
  }

  .kpi-value {
    font-family: var(--font-data);
    font-size: var(--text-xl);
    font-weight: 300;
    letter-spacing: -0.03em;
    color: var(--ink);
    line-height: 1;
  }

  .kpi-value--gold { color: var(--gold); }
  .kpi-value--sage { color: var(--sage); }

  .kpi-unit {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 400;
    color: var(--ink-40);
  }

  .kpi-unit--warn {
    color: var(--coral);
    font-weight: 500;
  }

  /* ── Neumorphic pill tabs ─────────────────────────────────────────────── */
  .tabs {
    display: flex;
    gap: var(--sp-8);
    flex-wrap: wrap;
  }

  .tab-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-5);
    height: 34px;
    padding: 0 var(--sp-16);
    border: none;
    border-radius: var(--radius-pill);
    background: var(--paper-card);
    box-shadow: var(--shadow-neu-btn);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--ink-60);
    cursor: pointer;
    transition: box-shadow var(--dur-fast) var(--ease-out),
                color var(--dur-fast) var(--ease-out);
  }

  .tab-pill:hover:not(.tab-pill--active) {
    color: var(--ink);
    box-shadow: var(--shadow-neu-raised);
  }

  /* Active tab = inset shadow (pressed into the surface) */
  .tab-pill--active {
    color: var(--gold);
    font-weight: 700;
    box-shadow: var(--shadow-neu-inset);
  }

  .tab-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 16px;
    padding: 0 var(--sp-3);
    border-radius: var(--radius-pill);
    background: var(--ink-06);
    color: var(--ink-60);
    font-size: 10px;
    font-weight: 700;
  }

  .tab-pill--active .tab-count {
    background: rgba(197, 160, 89, 0.15);
    color: var(--gold);
  }

  .tab-count--sage { background: var(--sage-soft); color: var(--sage); }
  .tab-count--coral { background: var(--coral-soft); color: var(--coral); }

  /* ── Summary strip ───────────────────────────────────────────────────── */
  .summary-strip {
    display: flex;
    gap: var(--sp-8);
    flex-wrap: wrap;
  }

  .stat-card {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    padding: var(--sp-13) var(--sp-16);
    flex: 1;
    min-width: 130px;
    max-width: 220px;
  }

  .stat-card--sage { border-left: 2px solid var(--sage); }
  .stat-card--coral { border-left: 2px solid var(--coral); }

  .stat-label {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--ink-40);
  }

  .stat-number {
    font-family: var(--font-data);
    font-size: var(--text-lg);
    font-weight: 300;
    letter-spacing: -0.03em;
    color: var(--ink);
    line-height: 1;
  }

  .stat-number--sage  { color: var(--sage); }
  .stat-number--coral { color: var(--coral); }

  .stat-currency {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--ink-40);
  }

  /* ── Loss banner ──────────────────────────────────────────────────────── */
  .loss-banner {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-13);
    padding: var(--sp-8) var(--sp-13);
    background: var(--coral-soft);
    border-radius: var(--radius-sm);
    border-left: 2px solid var(--coral);
  }

  .loss-banner-label {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--coral);
    white-space: nowrap;
    padding-top: 1px;
  }

  .loss-banner-text {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--ink-60);
    line-height: 1.5;
  }

  /* ── Table ───────────────────────────────────────────────────────────── */
  .table-shell {
    overflow: hidden;
  }

  .table-scroll {
    overflow-x: auto;
  }

  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  .data-table thead tr {
    border-bottom: 1px solid var(--ink-12);
  }

  .data-table th {
    padding: var(--sp-8) var(--sp-13);
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--ink-40);
    text-align: left;
    white-space: nowrap;
  }

  .num-col { text-align: right; }

  .data-row {
    border-bottom: 1px solid var(--ink-06);
    transition: background var(--dur-fast) var(--ease-out);
  }

  .data-row:last-child { border-bottom: none; }

  .data-row:hover { background: var(--ink-03); }

  .data-table td {
    padding: var(--sp-8) var(--sp-13);
    white-space: nowrap;
  }

  /* Customer cell */
  .customer-cell {
    display: flex;
    align-items: center;
    gap: var(--sp-5);
  }

  .grade-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    font-size: 10px;
    font-weight: 700;
    flex-shrink: 0;
    box-shadow: var(--shadow-neu-btn);
  }

  .grade-a { background: var(--sage-soft);  color: var(--sage); }
  .grade-b { background: var(--blue-soft);  color: var(--blue); }
  .grade-c { background: var(--amber-soft); color: var(--amber); }
  .grade-d { background: var(--coral-soft); color: var(--coral); }

  .customer-name {
    color: var(--ink);
    font-weight: 500;
  }

  /* Competitor dot — coral indicator */
  .competitor-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--coral);
    flex-shrink: 0;
    box-shadow: 0 0 0 2px var(--coral-soft);
  }

  /* Deal title */
  .deal-title {
    color: var(--ink);
    max-width: 260px;
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .unassigned-flag {
    display: inline-block;
    margin-left: var(--sp-5);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--coral);
  }

  /* Value */
  .deal-value {
    font-family: var(--font-data);
    font-size: var(--text-sm);
    font-weight: 400;
    color: var(--ink);
    letter-spacing: -0.01em;
  }

  /* Margin */
  .margin-num {
    font-family: var(--font-data);
    font-size: var(--text-sm);
    font-weight: 400;
    color: var(--ink-60);
  }

  /* Stage badges */
  .stage-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px var(--sp-8);
    border-radius: var(--radius-pill);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .stage-draft      { background: var(--ink-06);    color: var(--ink-60); }
  .stage-active     { background: var(--gold-soft);  color: var(--gold); }
  .stage-inprogress { background: var(--sage-soft);  color: var(--sage); }
  .stage-terminal   { background: var(--ink-06);     color: var(--ink-60); }
  .stage-won        { background: var(--sage-soft);  color: var(--sage); }
  .stage-lost       { background: var(--coral-soft); color: var(--coral); }

  /* Owner */
  .owner-name {
    color: var(--ink-60);
    font-size: var(--text-sm);
  }

  /* Follow-up date */
  .followup-date {
    color: var(--ink-60);
    font-size: var(--text-xs);
  }

  /* Loss reason */
  .loss-reason {
    color: var(--ink-60);
    font-size: var(--text-xs);
    font-style: italic;
    max-width: 220px;
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Quote button */
  .quote-btn {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--gold);
    background: transparent;
    border: 1px solid rgba(197, 160, 89, 0.4);
    border-radius: var(--radius-sm);
    padding: var(--sp-3) var(--sp-8);
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease-out),
                border-color var(--dur-fast) var(--ease-out);
    white-space: nowrap;
  }

  .quote-btn:hover {
    background: var(--gold-glow);
    border-color: var(--gold);
  }

  /* Table footer */
  .table-foot {
    background: var(--paper-elevated);
    border-top: 1px solid var(--ink-12);
  }

  .foot-label {
    padding: var(--sp-8) var(--sp-13);
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--ink-40);
    text-align: right;
  }

  .foot-total {
    padding: var(--sp-8) var(--sp-13);
    font-family: var(--font-data);
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--gold);
    text-align: right;
    letter-spacing: -0.02em;
  }

  /* ── Empty ───────────────────────────────────────────────────────────── */
  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--sp-55) var(--sp-21);
  }

  .empty-text {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--ink-30);
    margin: 0;
  }

  @media (max-width: 1120px) {
    .command-band {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 820px) {
    .command-shortcuts,
    .pulse-grid {
      grid-template-columns: 1fr;
    }
  }

  /* ── Column widths ───────────────────────────────────────────────────── */
  .col-customer  { min-width: 150px; }
  .col-title     { min-width: 200px; }
  .col-value     { min-width: 120px; }
  .col-margin    { min-width: 80px; }
  .col-stage     { min-width: 100px; }
  .col-owner     { min-width: 80px; }
  .col-followup  { min-width: 120px; }
  .col-loss      { min-width: 200px; }
  .col-action    { min-width: 60px; text-align: center; }

  /* ═══════════════════════════════════════════ QUOTE MODAL ════════════════ */

  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(42, 39, 34, 0.5);
    z-index: var(--z-modal);
  }

  .modal-panel {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: calc(var(--z-modal) + 1);
    background: var(--paper-card);
    border-radius: var(--radius-lg);
    width: min(820px, calc(100vw - var(--sp-21)));
    max-height: calc(100vh - 64px);
    display: flex;
    flex-direction: column;
    box-shadow: -12px -12px 28px rgba(253, 251, 247, 0.7),
                12px 12px 28px rgba(170, 160, 142, 0.35),
                0 32px 64px rgba(42, 39, 34, 0.25);
  }

  .modal-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: var(--sp-16) var(--sp-21);
    border-bottom: 1px solid var(--ink-06);
    flex-shrink: 0;
  }

  .modal-eyebrow {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--ink-40);
    margin: 0 0 var(--sp-3);
  }

  .modal-title {
    font-family: var(--font-display);
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--ink);
    margin: 0;
  }

  .modal-close {
    background: transparent;
    border: none;
    font-size: var(--text-md);
    color: var(--ink-40);
    cursor: pointer;
    padding: var(--sp-3);
    border-radius: var(--radius-sm);
    line-height: 1;
    transition: color var(--dur-fast) var(--ease-out);
  }

  .modal-close:hover { color: var(--ink); }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: var(--sp-16) var(--sp-21);
    display: flex;
    flex-direction: column;
    gap: var(--sp-13);
  }

  /* Items table */
  .items-wrap {
    overflow-x: auto;
    border: 1px solid var(--ink-06);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-neu-inset);
  }

  .items-table {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  .items-table thead tr {
    border-bottom: 1px solid var(--ink-06);
  }

  .items-table th {
    padding: var(--sp-5) var(--sp-8);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--ink-40);
    text-align: left;
  }

  .item-row { border-bottom: 1px solid var(--ink-06); }
  .item-row:last-child { border-bottom: none; }

  .items-table td { padding: var(--sp-5) var(--sp-8); vertical-align: middle; }

  .col-desc      { width: auto; min-width: 200px; }
  .col-qty       { width: 72px; }
  .col-price     { width: 130px; }
  .col-linetotal {
    width: 120px; text-align: right;
    font-family: var(--font-data); color: var(--ink-60);
  }
  .col-remove { width: 36px; text-align: center; }

  .item-input {
    width: 100%;
    background: transparent;
    border: 1px solid var(--ink-06);
    border-radius: var(--radius-sm);
    padding: var(--sp-3) var(--sp-5);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--ink);
    box-sizing: border-box;
    transition: border-color var(--dur-fast) var(--ease-out);
  }

  .item-input:focus {
    outline: none;
    border-color: var(--gold);
  }

  .item-qty   { text-align: center; }
  .item-price { font-family: var(--font-data); }

  .remove-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    background: transparent;
    border: 1px solid var(--ink-06);
    border-radius: var(--radius-sm);
    color: var(--ink-40);
    font-size: var(--text-md);
    cursor: pointer;
    line-height: 1;
    transition: all var(--dur-fast) var(--ease-out);
  }

  .remove-btn:hover {
    border-color: var(--coral);
    color: var(--coral);
    background: var(--coral-soft);
  }

  .add-item-btn {
    align-self: flex-start;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--gold);
    background: transparent;
    border: 1px dashed rgba(197, 160, 89, 0.5);
    border-radius: var(--radius-sm);
    padding: var(--sp-5) var(--sp-13);
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .add-item-btn:hover { background: var(--gold-glow); }

  /* Totals */
  .totals-block {
    align-self: flex-end;
    min-width: 300px;
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
    background: var(--paper-elevated);
    border-radius: var(--radius-md);
    padding: var(--sp-13) var(--sp-16);
    box-shadow: var(--shadow-neu-subtle);
  }

  .total-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--sp-21);
  }

  .total-row--grand {
    border-top: 1px solid var(--ink-12);
    padding-top: var(--sp-5);
    margin-top: var(--sp-3);
  }

  .total-label {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--ink-60);
  }

  .total-label--grand {
    font-weight: 700;
    color: var(--ink);
  }

  .total-value {
    font-family: var(--font-data);
    font-size: var(--text-sm);
    color: var(--ink);
  }

  .total-value--grand {
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--gold);
  }

  /* Optional fields */
  .opt-row {
    display: flex;
    gap: var(--sp-13);
    flex-wrap: wrap;
  }

  .opt-field {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
  }

  .opt-field--grow { flex: 1; min-width: 200px; }

  .opt-label {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-40);
  }

  .opt-narrow { width: 80px; }

  /* Modal footer */
  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-8);
    padding: var(--sp-13) var(--sp-21);
    border-top: 1px solid var(--ink-06);
    flex-shrink: 0;
  }

  .btn-cancel {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink-60);
    background: var(--paper-card);
    border: none;
    border-radius: var(--radius-md);
    padding: var(--sp-8) var(--sp-16);
    cursor: pointer;
    box-shadow: var(--shadow-neu-btn);
    transition: box-shadow var(--dur-fast) var(--ease-out);
  }

  .btn-cancel:hover { box-shadow: var(--shadow-neu-raised); }

  .btn-generate {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--paper);
    background: var(--gold);
    border: none;
    border-radius: var(--radius-md);
    padding: var(--sp-8) var(--sp-21);
    cursor: pointer;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .btn-generate:hover { opacity: 0.88; }

  /* ═══════════════════════════════════════════ RFQ TAB ════════════════════ */

  .rfq-section {
    display: flex;
    flex-direction: column;
    gap: var(--sp-16);
  }

  .rfq-summary-strip {
    display: flex;
    gap: var(--sp-10);
    flex-wrap: wrap;
  }

  .rfq-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--sp-10) var(--sp-21);
    border-radius: var(--radius-md);
    min-width: 80px;
  }

  .rfq-stat-value {
    font-family: var(--font-data);
    font-size: var(--text-xl);
    font-weight: 500;
    color: var(--ink);
  }

  .rfq-stat-label {
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--ink-30);
  }

  .rfq-overdue { color: var(--coral); }
  .rfq-due-soon { color: var(--gold); }

  .rfq-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: var(--sp-13);
  }

  .rfq-card {
    padding: var(--sp-13);
    border-radius: var(--radius-md);
    display: flex;
    flex-direction: column;
    gap: var(--sp-8);
  }

  .rfq-card-overdue { border-left: 3px solid var(--coral); }
  .rfq-card-due-soon { border-left: 3px solid var(--gold); }

  .rfq-card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .rfq-ref {
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .rfq-status {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    text-transform: capitalize;
  }

  .rfq-status-received { background: var(--blue-soft); color: var(--blue); }
  .rfq-status-reviewing { background: var(--gold-glow); color: var(--gold); }
  .rfq-status-costing { background: var(--sage-soft); color: var(--sage); }
  .rfq-status-quoted { background: var(--ink-06); color: var(--ink-40); }
  .rfq-status-won { background: var(--sage-soft); color: var(--sage); }
  .rfq-status-lost { background: var(--coral-soft); color: var(--coral); }
  .rfq-status-expired { background: var(--ink-06); color: var(--ink-30); }

  .rfq-notes {
    font-size: var(--text-sm);
    color: var(--ink-60);
    margin: 0;
  }

  .rfq-card-footer {
    display: flex;
    justify-content: space-between;
    font-size: var(--text-xs);
    color: var(--ink-30);
  }

  .rfq-source { text-transform: capitalize; }

  .tab-badge {
    font-size: 10px;
    font-weight: 700;
    padding: 0 5px;
    border-radius: var(--radius-pill);
    margin-left: var(--sp-3);
  }

  .tab-badge-overdue {
    background: var(--coral-soft);
    color: var(--coral);
  }
</style>
