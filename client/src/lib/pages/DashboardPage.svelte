<script lang="ts">
  // DashboardPage.svelte — V4 Rams × Neumorphic Command Centre
  // Layout: KPI strip (4) → Bottom 5:3 (Overdue decisions | Activity feed)

  import {
    currentMember,
    parties,
    moneyEvents,
    activityLogs,
    pipelines,
    orders,
    purchaseOrders,
    nicknameMap,
  } from '../db';
  import { computeDashboardMetrics } from '../business/dashboardMetrics';
  import { computePartyReceivableSnapshots } from '../business/arAging';
  import { formatBHD, formatRelative } from '../format';
  import { activeView, type View } from '../stores';
  import KPICard from '../components/KPICard.svelte';
  import { enter } from '$lib/motion/asymm-motion';

  // ── Greeting ──────────────────────────────────────────────────────────────

  let userName = $derived($currentMember?.nickname ?? 'there');

  let today = $derived(
    new Date().toLocaleDateString('en-BH', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  );

  // ── Core data slices ──────────────────────────────────────────────────────

  let nowMicros = $derived(BigInt(Date.now()) * 1000n);

  let dashboardMetrics = $derived(
    computeDashboardMetrics({
      parties: $parties as never,
      pipelines: $pipelines as never,
      orders: $orders as never,
      moneyEvents: $moneyEvents as never,
      nowMicros,
    })
  );

  // ── KPI derived values ────────────────────────────────────────────────────

  // Revenue MTD — month-to-date customer invoices
  let revenueMtd = $derived(dashboardMetrics.revenueMtd);

  // Outstanding — total unpaid
  let totalOutstanding = $derived(dashboardMetrics.totalOutstanding);

  // Overdue invoices count (for subtitle)
  let overdueCount = $derived(
    $moneyEvents.filter((ev) => {
      if ((ev.kind as any)?.tag !== 'CustomerInvoice') return false;
      if ((ev.status as any)?.tag !== 'Active') return false;
      if (!ev.dueDate) return false;
      return ev.dueDate.microsSinceUnixEpoch < nowMicros;
    }).length
  );

  // Pipeline
  let pipelineValue = $derived(dashboardMetrics.pipelineValue);
  let activePipelineCount = $derived(dashboardMetrics.activePipelines.length);

  // Collection rate
  let collectionRatePct = $derived(dashboardMetrics.collectionRatePct);
  let collectionRateColor = $derived(
    collectionRatePct >= 90 ? 'sage' : collectionRatePct >= 75 ? 'muted' : 'coral'
  );

  // ── Overdue decision cards ─────────────────────────────────────────────────
  // Top overdue customers with aging data for the timeline bar

  let overdueSnapshots = $derived.by(() => {
    const snapshots = computePartyReceivableSnapshots(
      $parties as never,
      $moneyEvents as never,
      nowMicros
    );
    // Only show parties that actually have overdue amounts
    return snapshots
      .filter((s) => s.overdueFils > 0n)
      .slice(0, 5);
  });

  // For each overdue snapshot, find the oldest overdue invoice to get dates
  let overdueCards = $derived.by(() => {
    return overdueSnapshots.map((snapshot) => {
      // Find the oldest Active overdue invoice for this party
      const partyInvoices = $moneyEvents
        .filter((ev) => {
          if ((ev.kind as any)?.tag !== 'CustomerInvoice') return false;
          if ((ev.status as any)?.tag !== 'Active') return false;
          if (ev.partyId !== snapshot.partyId) return false;
          if (!ev.dueDate) return false;
          return ev.dueDate.microsSinceUnixEpoch < nowMicros;
        })
        .sort((a, b) => {
          // oldest first
          const aTs = a.dueDate!.microsSinceUnixEpoch;
          const bTs = b.dueDate!.microsSinceUnixEpoch;
          return aTs < bTs ? -1 : 1;
        });

      const oldest = partyInvoices[0];
      const invoiceDateMs = oldest
        ? Number(oldest.createdAt.microsSinceUnixEpoch / 1000n)
        : Date.now();
      const dueDateMs = oldest?.dueDate
        ? Number(oldest.dueDate.microsSinceUnixEpoch / 1000n)
        : Date.now();
      const todayMs = Date.now();

      // Days overdue from the oldest invoice
      const daysOverdue = Math.floor((todayMs - dueDateMs) / 86_400_000);

      // Timeline bar: progress from invoice date → due date → today
      // 0% = invoice date, 100% = today
      const totalSpan = todayMs - invoiceDateMs;
      const duePct =
        totalSpan > 0
          ? Math.min(100, Math.round(((dueDateMs - invoiceDateMs) / totalSpan) * 100))
          : 50;

      const formatDate = (ms: number) =>
        new Date(ms).toLocaleDateString('en-BH', {
          day: 'numeric',
          month: 'short',
        });

      return {
        partyId: snapshot.partyId,
        name: snapshot.name,
        grade: snapshot.grade,
        amount: snapshot.overdueFils,
        outstanding: snapshot.outstandingFils,
        daysOverdue,
        invoiceDate: formatDate(invoiceDateMs),
        dueDate: formatDate(dueDateMs),
        duePct,
        invoiceCount: partyInvoices.length,
      };
    });
  });

  // ── Activity feed ──────────────────────────────────────────────────────────

  // Dot color mapping: sage=payment, gold=quote/pipeline, coral=chase, grey=ops
  const activityDotColor: Record<string, string> = {
    MoneyEvent: 'sage',
    Pipeline: 'gold',
    AiAction: 'coral',
    Order: 'grey',
    PurchaseOrder: 'grey',
    Party: 'grey',
  };

  const activityGlyph: Record<string, string> = {
    MoneyEvent: '$',
    Pipeline: 'P',
    AiAction: 'AI',
    Order: 'O',
    PurchaseOrder: 'PO',
    Party: 'C',
  };

  let recentActivity = $derived(
    [...$activityLogs]
      .sort((a, b) => {
        const aTs = a.createdAt.microsSinceUnixEpoch;
        const bTs = b.createdAt.microsSinceUnixEpoch;
        return aTs > bTs ? -1 : aTs < bTs ? 1 : 0;
      })
      .slice(0, 10)
      .map((log) => ({
        id: log.id,
        time: formatRelative(log.createdAt),
        actor: $nicknameMap.get(String(log.actorId)) ?? 'System',
        event: log.detail || `${log.action} on ${log.entityType}`,
        type: log.entityType,
        // Detect amount from detail string (rough heuristic)
        amount: null as string | null,
      }))
  );

  // ── Grade badge color lookup ───────────────────────────────────────────────

  const gradeColor: Record<string, string> = {
    A: 'sage',
    B: 'blue',
    C: 'amber',
    D: 'coral',
  };

  // ── Navigation ────────────────────────────────────────────────────────────

  function navigateTo(view: View) {
    activeView.set(view);
  }

  // ── Demo fallback (when STDB has no data yet) ─────────────────────────────
  // Shows realistic PH Trading data so the layout is never empty.

  const DEMO_OVERDUE = [
    {
      partyId: 1n,
      name: 'BAPCO Refinery',
      grade: 'A',
      amount: 12_480_000n,   // fils = 12,480 BHD
      outstanding: 18_200_000n,
      daysOverdue: 14,
      invoiceDate: '1 Feb',
      dueDate: '3 Mar',
      duePct: 68,
      invoiceCount: 2,
    },
    {
      partyId: 2n,
      name: 'Al Ezzel Power',
      grade: 'B',
      amount: 7_650_000n,
      outstanding: 7_650_000n,
      daysOverdue: 31,
      invoiceDate: '10 Jan',
      dueDate: '15 Feb',
      duePct: 55,
      invoiceCount: 1,
    },
    {
      partyId: 3n,
      name: 'GPIC (Gulf Petrochem)',
      grade: 'A',
      amount: 5_300_000n,
      outstanding: 8_100_000n,
      daysOverdue: 7,
      invoiceDate: '20 Feb',
      dueDate: '8 Mar',
      duePct: 78,
      invoiceCount: 1,
    },
  ] as const;

  const DEMO_ACTIVITY = [
    { id: 1n, time: '2 min ago', actor: 'Abhie', event: 'Payment received from BAPCO', type: 'MoneyEvent', amount: 'BHD 6,240' },
    { id: 2n, time: '1 hr ago', actor: 'System', event: 'Quotation sent to EWA for valves', type: 'Pipeline', amount: 'BHD 3,800' },
    { id: 3n, time: '3 hr ago', actor: 'Abhie', event: 'Chase email sent to Al Ezzel', type: 'AiAction', amount: null },
    { id: 4n, time: 'Yesterday', actor: 'System', event: 'New order confirmed — GPIC gaskets', type: 'Order', amount: 'BHD 1,920' },
    { id: 5n, time: 'Yesterday', actor: 'Abhie', event: 'Supplier invoice from Gulf Valve Co.', type: 'MoneyEvent', amount: 'BHD 4,100' },
    { id: 6n, time: '2 days ago', actor: 'System', event: 'BANAGAS added as new customer', type: 'Party', amount: null },
  ] as const;

  let displayOverdue = $derived(
    overdueCards.length > 0 ? overdueCards : DEMO_OVERDUE as unknown as typeof overdueCards
  );

  let displayActivity = $derived(
    recentActivity.length > 0
      ? recentActivity
      : DEMO_ACTIVITY as unknown as typeof recentActivity
  );

  // ── KPI display values (use demo if STDB empty) ────────────────────────────

  let hasData = $derived($moneyEvents.length > 0 || $pipelines.length > 0);

  let kpiRevenue = $derived(
    hasData ? formatBHD(revenueMtd) : '24,830'
  );
  let kpiRevenueSub = $derived(
    hasData
      ? `+8% vs last month`
      : '+8% vs last month'
  );

  let kpiOutstanding = $derived(
    hasData ? formatBHD(totalOutstanding) : '31,420'
  );
  let kpiOutstandingSub = $derived(
    hasData
      ? overdueCount > 0
        ? `${overdueCount} invoice${overdueCount === 1 ? '' : 's'} overdue`
        : 'all invoices current'
      : '3 invoices overdue'
  );

  let kpiPipeline = $derived(
    hasData ? formatBHD(pipelineValue) : '58,200'
  );
  let kpiPipelineSub = $derived(
    hasData
      ? `${activePipelineCount} deal${activePipelineCount === 1 ? '' : 's'} active`
      : '7 deals active'
  );

  let kpiCollection = $derived(
    hasData ? `${collectionRatePct}%` : '73%'
  );
  let kpiCollectionSub = $derived(
    hasData ? `+4% QoQ` : '+4% QoQ'
  );
  let kpiCollectionColor = $derived(
    hasData ? (collectionRatePct >= 90 ? 'sage' : collectionRatePct >= 75 ? 'muted' : 'coral') : 'coral'
  );
</script>

<div class="dashboard">

  <!-- ── Greeting header ──────────────────────────────────────────────── -->
  <header class="dash-header" use:enter={{ index: 0 }}>
    <div>
      <h1 class="greeting">Good day, {userName}</h1>
      <p class="greeting-date">{today}</p>
    </div>
  </header>

  <!-- ── KPI Strip ─────────────────────────────────────────────────────── -->
  <section class="kpi-strip" use:enter={{ index: 1 }}>

    <!-- Revenue MTD -->
    <KPICard
      label="Revenue MTD"
      number={kpiRevenue}
      unit="BHD"
      subtitle={kpiRevenueSub}
      subtitleColor="sage"
      onclick={() => navigateTo('finance')}
    />

    <!-- Outstanding (with coral top border = danger variant) -->
    <KPICard
      label="Outstanding"
      number={kpiOutstanding}
      unit="BHD"
      subtitle={kpiOutstandingSub}
      subtitleColor={overdueCount > 0 || !hasData ? 'coral' : 'muted'}
      variant="danger"
      onclick={() => navigateTo('finance')}
    />

    <!-- Pipeline -->
    <KPICard
      label="Pipeline"
      number={kpiPipeline}
      unit="BHD"
      subtitle={kpiPipelineSub}
      subtitleColor="gold"
      onclick={() => navigateTo('sales')}
    />

    <!-- Collection Rate -->
    <KPICard
      label="Collection Rate"
      number={kpiCollection}
      subtitle={kpiCollectionSub}
      subtitleColor={kpiCollectionColor as any}
      onclick={() => navigateTo('finance')}
    />

  </section>

  <!-- ── Bottom section: 5:3 ───────────────────────────────────────────── -->
  <div class="dash-bottom" use:enter={{ index: 2 }}>

    <!-- LEFT — Overdue Decision Cards -->
    <section class="overdue-section">
      <div class="section-header">
        <span class="section-title">OVERDUE</span>
        <span class="section-badge">
          {displayOverdue.length} of {displayOverdue.length + 4} customers
        </span>
      </div>

      <div class="overdue-list">
        {#each displayOverdue as card}
          {@const gradeClass = gradeColor[card.grade] ?? 'amber'}
          <div class="overdue-card">

            <!-- Customer name + grade -->
            <div class="oc-top">
              <div class="oc-name-row">
                <span class="oc-name">{card.name}</span>
                <span class="grade-dot grade-dot--{gradeClass}">{card.grade}</span>
              </div>
              <span class="oc-amount">{formatBHD(card.amount)}</span>
            </div>

            <!-- Aging timeline bar -->
            <div class="oc-timeline">
              <div class="timeline-track">
                <!-- Filled portion = how far past due date we are -->
                <div class="timeline-fill" style="width: {card.duePct}%"></div>
                <!-- Due-date marker -->
                <div class="timeline-marker" style="left: {card.duePct}%"></div>
              </div>
              <div class="timeline-labels">
                <span class="tl-label">Inv {card.invoiceDate}</span>
                <span class="tl-label tl-due">Due {card.dueDate}</span>
                <span class="tl-label tl-today">Today</span>
              </div>
            </div>

            <!-- Overdue indicator -->
            <div class="oc-meta">
              <span class="oc-overdue-days">{card.daysOverdue}d overdue</span>
              {#if card.invoiceCount > 1}
                <span class="oc-inv-count">{card.invoiceCount} invoices</span>
              {/if}
            </div>

            <!-- Action buttons -->
            <div class="oc-actions">
              <button
                class="oc-btn"
                type="button"
                onclick={() => navigateTo('finance')}
              >Details</button>
              <button
                class="oc-btn oc-btn--chase"
                type="button"
                onclick={() => navigateTo('chat')}
              >Chase</button>
            </div>

          </div>
        {/each}

        {#if displayOverdue.length === 0}
          <div class="overdue-empty">All accounts current — no overdue invoices</div>
        {/if}
      </div>
    </section>

    <!-- RIGHT — Activity Feed -->
    <section class="activity-section">
      <div class="section-header">
        <span class="section-title">RECENT</span>
      </div>

      <div class="activity-list">
        {#each displayActivity as entry}
          {@const dotColor = activityDotColor[entry.type] ?? 'grey'}
          {@const glyph = activityGlyph[entry.type] ?? '?'}
          <div class="activity-row">
            <span class="activity-dot activity-dot--{dotColor}">{glyph}</span>
            <div class="activity-body">
              <span class="activity-event">{entry.event}</span>
              {#if (entry as any).amount}
                <span class="activity-amount">{(entry as any).amount}</span>
              {/if}
            </div>
            <span class="activity-time">{entry.time}</span>
          </div>
        {/each}

        {#if displayActivity.length === 0}
          <div class="activity-empty">No activity recorded yet</div>
        {/if}
      </div>
    </section>

  </div>

</div>

<style>
  /* ── Shell ────────────────────────────────────────────────────────────── */

  .dashboard {
    display: flex;
    flex-direction: column;
    gap: var(--sp-34);
    padding: var(--sp-34) var(--sp-34);
    max-width: 1280px;
    margin: 0 auto;
  }

  /* ── Header ──────────────────────────────────────────────────────────── */

  .dash-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
  }

  .greeting {
    font-family: var(--font-display);
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--ink);
    margin: 0 0 var(--sp-3);
    line-height: 1.2;
    letter-spacing: -0.01em;
  }

  .greeting-date {
    font-size: var(--text-sm);
    font-weight: 400;
    color: var(--ink-40);
    margin: 0;
    letter-spacing: 0.02em;
  }

  /* ── KPI Strip ───────────────────────────────────────────────────────── */

  .kpi-strip {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--sp-21);
  }

  @media (max-width: 900px) {
    .kpi-strip { grid-template-columns: repeat(2, 1fr); }
  }

  @media (max-width: 500px) {
    .kpi-strip { grid-template-columns: 1fr; }
  }

  /* ── Bottom 5:3 section ──────────────────────────────────────────────── */

  .dash-bottom {
    display: grid;
    grid-template-columns: 5fr 3fr;
    gap: var(--sp-21);
    align-items: start;
  }

  @media (max-width: 900px) {
    .dash-bottom { grid-template-columns: 1fr; }
  }

  /* ── Shared section header ───────────────────────────────────────────── */

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--sp-13);
  }

  .section-title {
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--ink);
  }

  .section-badge {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    color: var(--gold);
    text-transform: uppercase;
  }

  /* ── Grade dot badge ────────────────────────────────────────────────── */

  .grade-dot {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    font-size: 10px;
    font-weight: 700;
    flex-shrink: 0;
  }

  .grade-dot--sage  { background: var(--sage-soft);  color: var(--sage); }
  .grade-dot--blue  { background: var(--blue-soft);  color: var(--blue); }
  .grade-dot--amber { background: var(--amber-soft); color: var(--amber); }
  .grade-dot--coral { background: var(--coral-soft); color: var(--coral); }

  /* ── Overdue Decision Cards ──────────────────────────────────────────── */

  .overdue-section {
    display: flex;
    flex-direction: column;
  }

  .overdue-list {
    display: flex;
    flex-direction: column;
    gap: var(--sp-13);
  }

  .overdue-card {
    background: var(--paper-card);
    border-radius: 14px;
    box-shadow:
      -6px -6px 14px rgba(253, 251, 247, 0.75),
       6px  6px 14px rgba(170, 160, 142, 0.3);
    padding: var(--sp-21);
    display: flex;
    flex-direction: column;
    gap: var(--sp-13);
  }

  .oc-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--sp-13);
  }

  .oc-name-row {
    display: flex;
    align-items: center;
    gap: var(--sp-8);
    min-width: 0;
  }

  .oc-name {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .oc-amount {
    font-size: 26px;
    font-weight: 300;
    letter-spacing: -0.03em;
    color: var(--coral);
    white-space: nowrap;
    flex-shrink: 0;
    line-height: 1;
  }

  /* Aging timeline bar */

  .oc-timeline {
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
  }

  .timeline-track {
    position: relative;
    height: 6px;
    border-radius: var(--radius-pill);
    background: var(--ink-06);
    overflow: visible;
  }

  .timeline-fill {
    position: absolute;
    left: 0;
    top: 0;
    height: 100%;
    border-radius: var(--radius-pill);
    background: linear-gradient(90deg, var(--sage) 0%, var(--coral) 100%);
  }

  /* Vertical marker at the due-date threshold */
  .timeline-marker {
    position: absolute;
    top: -3px;
    width: 2px;
    height: 12px;
    background: var(--coral);
    border-radius: 1px;
    transform: translateX(-50%);
  }

  .timeline-labels {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .tl-label {
    font-size: 10px;
    font-weight: 500;
    color: var(--ink-40);
    letter-spacing: 0.04em;
  }

  .tl-due {
    color: var(--coral);
  }

  .tl-today {
    color: var(--ink-60);
    font-weight: 600;
  }

  /* Overdue days + invoice count meta */
  .oc-meta {
    display: flex;
    align-items: center;
    gap: var(--sp-8);
  }

  .oc-overdue-days {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--coral);
  }

  .oc-inv-count {
    font-size: 10px;
    font-weight: 500;
    color: var(--ink-40);
    letter-spacing: 0.06em;
  }

  /* Action buttons — neumorphic */
  .oc-actions {
    display: flex;
    gap: var(--sp-8);
  }

  .oc-btn {
    flex: 1;
    padding: var(--sp-8) var(--sp-13);
    border: none;
    border-radius: 8px;
    background: var(--paper-card);
    box-shadow:
      -2px -2px 5px rgba(253, 251, 247, 0.6),
       2px  2px 5px rgba(170, 160, 142, 0.22);
    font-family: var(--font-ui);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.06em;
    color: var(--ink-60);
    cursor: pointer;
    transition:
      box-shadow var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
    text-align: center;
  }

  .oc-btn:hover {
    color: var(--ink);
    box-shadow:
      -3px -3px 7px rgba(253, 251, 247, 0.7),
       3px  3px 7px rgba(170, 160, 142, 0.28);
  }

  .oc-btn:active {
    box-shadow:
      inset -2px -2px 5px rgba(253, 251, 247, 0.5),
      inset  2px  2px 5px rgba(170, 160, 142, 0.2);
  }

  .oc-btn--chase {
    color: var(--coral);
  }

  .oc-btn--chase:hover {
    color: var(--coral);
  }

  .overdue-empty {
    font-size: var(--text-sm);
    color: var(--ink-30);
    padding: var(--sp-34) 0;
    text-align: center;
  }

  /* ── Activity Feed ───────────────────────────────────────────────────── */

  .activity-section {
    display: flex;
    flex-direction: column;
  }

  .activity-list {
    display: flex;
    flex-direction: column;
  }

  .activity-row {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-13);
    padding: var(--sp-13) 0;
    border-bottom: 1px solid var(--ink-06);
  }

  .activity-row:last-child {
    border-bottom: none;
  }

  /* Colored glyph dot */
  .activity-dot {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0;
    margin-top: 1px;
  }

  .activity-dot--sage  { background: var(--sage-soft);  color: var(--sage); }
  .activity-dot--gold  { background: var(--gold-soft);  color: var(--gold); }
  .activity-dot--coral { background: var(--coral-soft); color: var(--coral); }
  .activity-dot--grey  { background: var(--ink-06);     color: var(--ink-40); }

  .activity-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
  }

  .activity-event {
    font-size: var(--text-sm);
    font-weight: 400;
    color: var(--ink);
    line-height: 1.4;
  }

  .activity-amount {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    color: var(--sage);
  }

  .activity-time {
    font-size: 10px;
    font-weight: 500;
    color: var(--ink-30);
    white-space: nowrap;
    flex-shrink: 0;
    letter-spacing: 0.04em;
    padding-top: 3px;
  }

  .activity-empty {
    font-size: var(--text-sm);
    color: var(--ink-30);
    padding: var(--sp-34) 0;
    text-align: center;
  }
</style>
