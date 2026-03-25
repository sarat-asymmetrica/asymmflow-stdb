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
    nicknameMap,
    bankTransactions as stdbBankTransactions,
  } from '../db';
  import { computeDashboardMetrics } from '../business/dashboardMetrics';
  import { computeCashForecast } from '../business/cashPosition';
  import { computePartyReceivableSnapshots } from '../business/arAging';
  import { evaluateAlerts, sortAlerts, countBySeverity } from '../business/alertSystem';
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
      activityLogs: $activityLogs as never,
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
  let cashPosition = $derived(dashboardMetrics.cashPosition);
  let runwayDays = $derived(dashboardMetrics.cashRunwayDays);
  let followUps = $derived(dashboardMetrics.followUps);

  let cashForecast = $derived(
    computeCashForecast(
      $moneyEvents as never,
      $parties as never,
      ($stdbBankTransactions ?? []) as never,
      nowMicros,
    )
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
  let miniCashPosition = $derived(hasData ? formatBHD(cashPosition) : '8,250');
  let miniRunway = $derived(hasData ? (runwayDays === null ? 'n/a' : `${runwayDays}d`) : '55d');

  let forecastBuckets = $derived(
    cashForecast.buckets.map(b => ({
      label: `${b.horizonDays}d`,
      projected: formatBHD(b.projectedCashFils),
      inflows: formatBHD(b.expectedInflowsFils),
      outflows: formatBHD(b.expectedOutflowsFils),
      isNegative: b.projectedCashFils < 0n,
    }))
  );

  let receivables = $derived(formatBHD(cashForecast.currentPosition.totalReceivablesFils));
  let payables = $derived(formatBHD(cashForecast.currentPosition.totalPayablesFils));
  let workingCapital = $derived(formatBHD(cashForecast.currentPosition.netWorkingCapitalFils));
  let burnRate = $derived(formatBHD(cashForecast.monthlyBurnFils));
  let forecastRunway = $derived(
    cashForecast.runwayDays === null ? 'n/a' : `${cashForecast.runwayDays} days`
  );

  let miniFollowUps = $derived(
    hasData
      ? `${followUps.overdue} overdue | ${followUps.dueToday} today | ${followUps.dueSoon} soon`
      : '1 overdue | 2 today | 3 soon'
  );

  let followUpCards = $derived.by(() => {
    const nowMs = Date.now();
    const nowDate = new Date(nowMs);
    const weekAheadMs = nowMs + 7 * 86_400_000;

    return [...$activityLogs]
      .filter(log => {
        if (!log.followUpDue || log.followUpDone) return false;
        const dueMs = Number(log.followUpDue.microsSinceUnixEpoch / 1000n);
        return dueMs < weekAheadMs;
      })
      .sort((a, b) => {
        const aMs = Number(a.followUpDue!.microsSinceUnixEpoch / 1000n);
        const bMs = Number(b.followUpDue!.microsSinceUnixEpoch / 1000n);
        return aMs - bMs;
      })
      .slice(0, 10)
      .map(log => {
        const dueMs = Number(log.followUpDue!.microsSinceUnixEpoch / 1000n);
        const dueDate = new Date(dueMs);
        const isSameDay =
          dueDate.getUTCFullYear() === nowDate.getUTCFullYear() &&
          dueDate.getUTCMonth() === nowDate.getUTCMonth() &&
          dueDate.getUTCDate() === nowDate.getUTCDate();
        const isOverdue = dueMs < nowMs && !isSameDay;

        return {
          id: log.id,
          entityType: log.entityType,
          entityId: String(log.entityId),
          detail: log.detail || `${log.action} on ${log.entityType}`,
          dueLabel: isSameDay ? 'Today' : isOverdue
            ? `${Math.floor((nowMs - dueMs) / 86_400_000)}d overdue`
            : `in ${Math.ceil((dueMs - nowMs) / 86_400_000)}d`,
          urgency: isOverdue ? 'overdue' : isSameDay ? 'today' : 'upcoming',
          actor: $nicknameMap.get(String(log.actorId)) ?? 'System',
        };
      });
  });

  const DEMO_FOLLOWUPS = [
    { id: 101n, entityType: 'Pipeline', entityId: '5', detail: 'Follow up on BAPCO Cerabar quotation', dueLabel: '2d overdue', urgency: 'overdue', actor: 'Abhie' },
    { id: 102n, entityType: 'MoneyEvent', entityId: '3', detail: 'Chase EWA payment — INV-2025-001', dueLabel: 'Today', urgency: 'today', actor: 'System' },
    { id: 103n, entityType: 'Pipeline', entityId: '8', detail: 'ALBA expansion project — send revised offer', dueLabel: 'Today', urgency: 'today', actor: 'Abhie' },
    { id: 104n, entityType: 'PurchaseOrder', entityId: '2', detail: 'Check E+H delivery status for PO-2026-003', dueLabel: 'in 2d', urgency: 'upcoming', actor: 'Abhie' },
    { id: 105n, entityType: 'Pipeline', entityId: '12', detail: 'GPIC gasket order — confirm specifications', dueLabel: 'in 5d', urgency: 'upcoming', actor: 'System' },
  ] as const;

  let displayFollowUps = $derived(
    followUpCards.length > 0 ? followUpCards : DEMO_FOLLOWUPS as unknown as typeof followUpCards
  );

  let businessAlerts = $derived.by(() => {
    const alerts = evaluateAlerts({
      parties: $parties as never,
      moneyEvents: $moneyEvents as never,
      pipelines: $pipelines as never,
      nowMicros: nowMicros,
    });
    return sortAlerts(alerts);
  });

  let alertCounts = $derived(countBySeverity(businessAlerts));

  let displayAlerts = $derived(
    businessAlerts.length > 0
      ? businessAlerts.slice(0, 8)
      : [
          { id: 'demo-1', severity: 'critical', category: 'finance', title: 'Credit Limit Breach', message: 'EWA outstanding exceeds credit limit by BHD 5,000', actionLabel: 'Review', createdAt: '' },
          { id: 'demo-2', severity: 'warning', category: 'finance', title: 'Overdue > 60 days', message: 'BAPCO has 2 invoices overdue by 67 days', actionLabel: 'Chase', createdAt: '' },
          { id: 'demo-3', severity: 'warning', category: 'crm', title: 'Stale Pipeline', message: 'ALBA expansion follow-up overdue by 18 days', actionLabel: 'Follow Up', createdAt: '' },
          { id: 'demo-4', severity: 'info', category: 'finance', title: 'Payments This Week', message: '3 payments received totalling BHD 12,500', createdAt: '' },
        ] as typeof businessAlerts
  );

  let dashboardHeadline = $derived.by(() => {
    if (!hasData) {
      return {
        title: 'PH operating picture is ready for command review',
        subtitle: 'Seeded commercial, pipeline, and finance history is live. Use the dashboard to decide what needs attention first.',
      };
    }

    if (displayAlerts[0]?.severity === 'critical') {
      return {
        title: 'Critical exceptions are driving today’s operating posture',
        subtitle: displayAlerts[0]?.message ?? 'Review the highest-severity alerts before moving into execution.',
      };
    }

    if (overdueCount > 0) {
      return {
        title: 'Collections pressure is the primary decision surface today',
        subtitle: `${overdueCount} active overdue invoice${overdueCount === 1 ? '' : 's'} are visible across the seeded PH ledger.`,
      };
    }

    if (followUps.overdue > 0) {
      return {
        title: 'Follow-up discipline is the main operating constraint today',
        subtitle: `${followUps.overdue} follow-up item${followUps.overdue === 1 ? '' : 's'} have slipped beyond their due window.`,
      };
    }

    return {
      title: 'Commercial and finance signals are broadly in rhythm',
      subtitle: 'Use the command band to jump into the next operating decision without digging through the hubs.',
    };
  });

  let priorityDeck = $derived.by(() => {
    const actions: Array<{
      title: string;
      detail: string;
      tone: 'coral' | 'gold' | 'sage';
      cta: string;
      view: View;
    }> = [];

    if (displayAlerts[0]) {
      actions.push({
        title: displayAlerts[0].title,
        detail: displayAlerts[0].message,
        tone: displayAlerts[0].severity === 'critical' ? 'coral' : displayAlerts[0].severity === 'warning' ? 'gold' : 'sage',
        cta: displayAlerts[0].actionLabel ?? 'Review',
        view: displayAlerts[0].category === 'finance' ? 'finance' : displayAlerts[0].category === 'crm' ? 'crm' : 'sales',
      });
    }

    if (displayOverdue[0]) {
      actions.push({
        title: `${displayOverdue[0].name} is the top debtor`,
        detail: `${formatBHD(displayOverdue[0].amount)} BHD overdue across ${displayOverdue[0].invoiceCount} invoice${displayOverdue[0].invoiceCount === 1 ? '' : 's'}.`,
        tone: 'coral',
        cta: 'Open Finance',
        view: 'finance',
      });
    }

    if (displayFollowUps[0]) {
      actions.push({
        title: 'Next follow-up to clear',
        detail: `${displayFollowUps[0].detail} · ${displayFollowUps[0].dueLabel}`,
        tone: displayFollowUps[0].urgency === 'overdue' ? 'coral' : displayFollowUps[0].urgency === 'today' ? 'gold' : 'sage',
        cta: 'Open Chat',
        view: 'chat',
      });
    }

    if (actions.length === 0) {
      actions.push({
        title: 'No acute pressure is visible',
        detail: 'Shift attention toward pipeline advancement, relationship development, or proactive finance hygiene.',
        tone: 'sage',
        cta: 'Open Sales',
        view: 'sales',
      });
    }

    return actions.slice(0, 3);
  });

  let commandShortcuts = $derived([
    {
      label: 'Chase Debtors',
      detail: `${displayOverdue.length} accounts flagged`,
      view: 'finance' as View,
    },
    {
      label: 'Push Pipeline',
      detail: `${activePipelineCount} active deals`,
      view: 'sales' as View,
    },
    {
      label: 'Review Customers',
      detail: `${dashboardMetrics.customerCount} customer records`,
      view: 'crm' as View,
    },
    {
      label: 'Ask Butler',
      detail: 'Use seeded context in chat',
      view: 'chat' as View,
    },
  ]);

  let operatingPulse = $derived([
    { label: 'Customers', value: hasData ? String(dashboardMetrics.customerCount) : '391' },
    { label: 'Suppliers', value: hasData ? String(dashboardMetrics.supplierCount) : '34' },
    { label: 'Open Orders', value: hasData ? String(dashboardMetrics.activeOrderCount) : '27' },
    { label: 'Alerts', value: hasData ? String(displayAlerts.length) : '4' },
  ]);
</script>

<div class="dashboard">

  <!-- ── Greeting header ──────────────────────────────────────────────── -->
  <header class="dash-header" use:enter={{ index: 0 }}>
    <div>
      <h1 class="greeting">Good day, {userName}</h1>
      <p class="greeting-date">{today}</p>
    </div>
  </header>

  <section class="command-band" use:enter={{ index: 1 }}>
    <article class="command-hero card">
      <span class="command-kicker">Operating Focus</span>
      <h2 class="command-title">{dashboardHeadline.title}</h2>
      <p class="command-subtitle">{dashboardHeadline.subtitle}</p>

      <div class="command-shortcuts">
        {#each commandShortcuts as shortcut}
          <button class="command-shortcut" type="button" onclick={() => navigateTo(shortcut.view)}>
            <span class="command-shortcut-label">{shortcut.label}</span>
            <span class="command-shortcut-detail">{shortcut.detail}</span>
          </button>
        {/each}
      </div>
    </article>

    <article class="command-panel card">
      <div class="section-header">
        <span class="section-title">PRIORITIES</span>
      </div>

      <div class="priority-list">
        {#each priorityDeck as item}
          <div class="priority-item priority-item--{item.tone}">
            <div class="priority-copy">
              <span class="priority-title">{item.title}</span>
              <span class="priority-detail">{item.detail}</span>
            </div>
            <button class="priority-cta" type="button" onclick={() => navigateTo(item.view)}>
              {item.cta}
            </button>
          </div>
        {/each}
      </div>
    </article>

    <article class="command-panel card">
      <div class="section-header">
        <span class="section-title">SYSTEM PULSE</span>
      </div>

      <div class="pulse-grid">
        {#each operatingPulse as pulse}
          <div class="pulse-item">
            <span class="pulse-label">{pulse.label}</span>
            <span class="pulse-value">{pulse.value}</span>
          </div>
        {/each}
      </div>
    </article>
  </section>

  <!-- ── KPI Strip ─────────────────────────────────────────────────────── -->
  <section class="kpi-strip" use:enter={{ index: 2 }}>

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
  <section class="mini-strip" use:enter={{ index: 3 }}>
    <div class="mini-card">
      <span class="mini-label">Cash Position</span>
      <span class="mini-value">{miniCashPosition} BHD</span>
      <span class="mini-sub">Collected minus supplier payouts</span>
    </div>
    <div class="mini-card">
      <span class="mini-label">Cash Runway</span>
      <span class="mini-value">{miniRunway}</span>
      <span class="mini-sub">Using default monthly burn model</span>
    </div>
    <div class="mini-card">
      <span class="mini-label">Follow-ups</span>
      <span class="mini-value">{miniFollowUps}</span>
      <span class="mini-sub">ActivityLog follow-up due windows</span>
    </div>
  </section>

  <div class="dash-bottom" use:enter={{ index: 4 }}>

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

  <!-- Cash Forecast -->
  <section class="cash-forecast-section" use:enter={{ index: 6 }}>
    <h2 class="section-title">Cash Forecast</h2>
    <div class="cash-forecast-grid">
      <!-- Current position card -->
      <div class="card cash-card">
        <div class="cash-card-header">
          <span class="cash-card-label">Current Position</span>
          <span class="cash-card-value">{hasData ? miniCashPosition : '8,250'} BHD</span>
        </div>
        <div class="cash-card-metrics">
          <div class="cash-metric">
            <span class="cash-metric-label">Receivables</span>
            <span class="cash-metric-value cash-positive">{hasData ? receivables : '31,420'}</span>
          </div>
          <div class="cash-metric">
            <span class="cash-metric-label">Payables</span>
            <span class="cash-metric-value cash-negative">{hasData ? payables : '12,800'}</span>
          </div>
          <div class="cash-metric">
            <span class="cash-metric-label">Working Capital</span>
            <span class="cash-metric-value">{hasData ? workingCapital : '18,620'}</span>
          </div>
        </div>
        <div class="cash-card-footer">
          <span class="cash-footer-label">Monthly burn</span>
          <span class="cash-footer-value">{hasData ? burnRate : '4,500'} BHD</span>
          <span class="cash-footer-sep">&middot;</span>
          <span class="cash-footer-label">Runway</span>
          <span class="cash-footer-value">{hasData ? forecastRunway : '55 days'}</span>
        </div>
      </div>

      <!-- 30/60/90 forecast buckets -->
      {#each hasData ? forecastBuckets : [
        { label: '30d', projected: '12,400', inflows: '8,200', outflows: '4,050', isNegative: false },
        { label: '60d', projected: '16,800', inflows: '14,500', outflows: '5,900', isNegative: false },
        { label: '90d', projected: '21,300', inflows: '19,000', outflows: '5,950', isNegative: false },
      ] as bucket}
        <div class="card cash-bucket" class:cash-bucket-negative={bucket.isNegative}>
          <span class="cash-bucket-horizon">{bucket.label}</span>
          <span class="cash-bucket-projected" class:cash-negative={bucket.isNegative}>
            {bucket.projected}
          </span>
          <div class="cash-bucket-detail">
            <span class="cash-bucket-flow cash-positive">+{bucket.inflows}</span>
            <span class="cash-bucket-flow cash-negative">-{bucket.outflows}</span>
          </div>
        </div>
      {/each}
    </div>
  </section>

  <!-- Follow-Up Tasks -->
  <section class="followup-section" use:enter={{ index: 7 }}>
    <div class="section-header">
      <h2 class="section-title">Follow-Ups</h2>
      <div class="followup-summary-chips">
        {#if followUps.overdue > 0}
          <span class="followup-chip chip-overdue">{followUps.overdue} overdue</span>
        {/if}
        {#if followUps.dueToday > 0}
          <span class="followup-chip chip-today">{followUps.dueToday} today</span>
        {/if}
        {#if followUps.dueSoon > 0}
          <span class="followup-chip chip-upcoming">{followUps.dueSoon} upcoming</span>
        {/if}
      </div>
    </div>

    {#if displayFollowUps.length === 0}
      <div class="followup-empty card">
        <span class="followup-empty-text">No follow-ups due this week</span>
      </div>
    {:else}
      <div class="followup-list">
        {#each displayFollowUps as fu (fu.id)}
          <div class="followup-card card" class:followup-overdue={fu.urgency === 'overdue'} class:followup-today={fu.urgency === 'today'}>
            <div class="followup-left">
              <span class="followup-type-badge"
                class:badge-overdue={fu.urgency === 'overdue'}
                class:badge-today={fu.urgency === 'today'}
                class:badge-upcoming={fu.urgency === 'upcoming'}
              >
                {fu.urgency === 'overdue' ? '!' : fu.urgency === 'today' ? '*' : '○'}
              </span>
              <div class="followup-content">
                <span class="followup-detail">{fu.detail}</span>
                <span class="followup-meta">{fu.actor} · {fu.entityType}</span>
              </div>
            </div>
            <span class="followup-due"
              class:due-overdue={fu.urgency === 'overdue'}
              class:due-today={fu.urgency === 'today'}
            >
              {fu.dueLabel}
            </span>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <!-- Business Alerts -->
  <section class="alerts-section" use:enter={{ index: 8 }}>
    <div class="section-header">
      <h2 class="section-title">Alerts</h2>
      <div class="alert-count-chips">
        {#if alertCounts.critical > 0}
          <span class="alert-chip chip-critical">{alertCounts.critical} critical</span>
        {/if}
        {#if alertCounts.warning > 0}
          <span class="alert-chip chip-warning">{alertCounts.warning} warning</span>
        {/if}
        {#if alertCounts.info > 0}
          <span class="alert-chip chip-info">{alertCounts.info} info</span>
        {/if}
      </div>
    </div>

    <div class="alert-list">
      {#each displayAlerts as alert (alert.id)}
        <div class="alert-item" class:alert-critical={alert.severity === 'critical'} class:alert-warning={alert.severity === 'warning'} class:alert-info={alert.severity === 'info'}>
          <span class="alert-severity-dot"
            class:dot-critical={alert.severity === 'critical'}
            class:dot-warning={alert.severity === 'warning'}
            class:dot-info={alert.severity === 'info'}
          ></span>
          <div class="alert-content">
            <span class="alert-title">{alert.title}</span>
            <span class="alert-message">{alert.message}</span>
          </div>
          {#if alert.actionLabel}
            <span class="alert-action">{alert.actionLabel}</span>
          {/if}
        </div>
      {/each}
    </div>
  </section>

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

  .command-band {
    display: grid;
    grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr) minmax(0, 0.72fr);
    gap: var(--sp-16);
    align-items: stretch;
  }

  .command-hero,
  .command-panel {
    min-height: 100%;
    padding: var(--sp-21);
  }

  .command-hero {
    display: flex;
    flex-direction: column;
    gap: var(--sp-13);
    background:
      radial-gradient(circle at top left, rgba(214, 183, 111, 0.16), transparent 42%),
      linear-gradient(135deg, rgba(122, 159, 128, 0.08), rgba(255, 255, 255, 0.5)),
      var(--paper-card);
  }

  .command-kicker {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--gold);
  }

  .command-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(1.5rem, 1.2vw + 1.2rem, 2.5rem);
    line-height: 1.02;
    color: var(--ink);
    max-width: 14ch;
  }

  .command-subtitle {
    margin: 0;
    max-width: 58ch;
    font-size: var(--text-sm);
    line-height: 1.55;
    color: var(--ink-40);
  }

  .command-shortcuts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--sp-10);
    margin-top: auto;
  }

  .command-shortcut {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: var(--sp-13);
    border: 1px solid rgba(28, 28, 28, 0.06);
    border-radius: var(--radius-md);
    background: rgba(255, 255, 255, 0.55);
    cursor: pointer;
    text-align: left;
    transition: transform var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
  }

  .command-shortcut:hover {
    transform: translateY(-1px);
    border-color: rgba(214, 183, 111, 0.28);
  }

  .command-shortcut-label {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
  }

  .command-shortcut-detail {
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-30);
  }

  .priority-list {
    display: flex;
    flex-direction: column;
    gap: var(--sp-10);
    margin-top: var(--sp-13);
  }

  .priority-item {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--sp-10);
    padding: var(--sp-13);
    border-radius: var(--radius-md);
    background: var(--ink-03);
    border-left: 3px solid transparent;
  }

  .priority-item--coral { border-left-color: var(--coral); }
  .priority-item--gold { border-left-color: var(--gold); }
  .priority-item--sage { border-left-color: var(--sage); }

  .priority-copy {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .priority-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
  }

  .priority-detail {
    font-size: var(--text-xs);
    line-height: 1.45;
    color: var(--ink-40);
  }

  .priority-cta {
    align-self: center;
    padding: var(--sp-5) var(--sp-10);
    border: none;
    border-radius: var(--radius-pill);
    background: var(--paper);
    color: var(--ink);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    cursor: pointer;
    white-space: nowrap;
  }

  .pulse-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--sp-10);
    margin-top: var(--sp-13);
  }

  .pulse-item {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: var(--sp-13);
    border-radius: var(--radius-md);
    background: linear-gradient(180deg, rgba(255,255,255,0.6), rgba(28,28,28,0.02));
  }

  .pulse-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-30);
  }

  .pulse-value {
    font-family: var(--font-data);
    font-size: var(--text-lg);
    color: var(--ink);
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

  .mini-strip {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--sp-16);
  }

  .mini-card {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    padding: var(--sp-16);
    border-radius: 14px;
    background: var(--paper-card);
    box-shadow:
      -5px -5px 12px rgba(253, 251, 247, 0.68),
       5px  5px 12px rgba(170, 160, 142, 0.22);
  }

  .mini-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-40);
  }

  .mini-value {
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--ink);
  }

  .mini-sub {
    font-size: 11px;
    color: var(--ink-40);
  }

  @media (max-width: 900px) {
    .command-band { grid-template-columns: 1fr; }
    .command-shortcuts { grid-template-columns: 1fr 1fr; }
    .pulse-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .kpi-strip { grid-template-columns: repeat(2, 1fr); }
    .mini-strip { grid-template-columns: 1fr; }
  }

  @media (max-width: 500px) {
    .command-shortcuts { grid-template-columns: 1fr; }
    .pulse-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .priority-item {
      flex-direction: column;
      align-items: stretch;
    }
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

  /* ── Cash Forecast ──────────────────────────────────────────────────── */

  .cash-forecast-section {
    grid-column: 1 / -1;
  }

  .cash-forecast-grid {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr 1fr;
    gap: var(--sp-13);
  }

  .cash-card {
    padding: var(--sp-16);
    display: flex;
    flex-direction: column;
    gap: var(--sp-13);
  }

  .cash-card-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .cash-card-label {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--ink-40);
  }

  .cash-card-value {
    font-family: var(--font-data);
    font-size: var(--text-xl);
    font-weight: 500;
    color: var(--ink);
  }

  .cash-card-metrics {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--sp-8);
  }

  .cash-metric {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--sp-8);
    background: var(--ink-03);
    border-radius: var(--radius-sm);
  }

  .cash-metric-label {
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-30);
  }

  .cash-metric-value {
    font-family: var(--font-data);
    font-size: var(--text-sm);
    color: var(--ink);
  }

  .cash-positive { color: var(--sage); }
  .cash-negative { color: var(--coral); }

  .cash-card-footer {
    display: flex;
    align-items: baseline;
    gap: var(--sp-8);
    padding-top: var(--sp-8);
    border-top: 1px solid var(--ink-06);
  }

  .cash-footer-label {
    font-size: var(--text-xs);
    color: var(--ink-30);
  }

  .cash-footer-value {
    font-family: var(--font-data);
    font-size: var(--text-sm);
    color: var(--ink);
  }

  .cash-footer-sep {
    color: var(--ink-12);
  }

  .cash-bucket {
    padding: var(--sp-13);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-8);
    text-align: center;
  }

  .cash-bucket-negative {
    border-top: 2px solid var(--coral);
  }

  .cash-bucket-horizon {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--ink-40);
  }

  .cash-bucket-projected {
    font-family: var(--font-data);
    font-size: var(--text-lg);
    font-weight: 500;
    color: var(--ink);
  }

  .cash-bucket-detail {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-family: var(--font-data);
    font-size: var(--text-xs);
  }

  .cash-bucket-flow {
    white-space: nowrap;
  }

  /* ── Follow-Up Tasks ─────────────────────────────────────────────────── */

  .followup-section {
    grid-column: 1 / -1;
  }

  .followup-summary-chips {
    display: flex;
    gap: var(--sp-5);
  }

  .followup-chip {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .chip-overdue { background: var(--coral-soft); color: var(--coral); }
  .chip-today { background: var(--gold-glow); color: var(--gold); }
  .chip-upcoming { background: var(--sage-soft); color: var(--sage); }

  .followup-list {
    display: flex;
    flex-direction: column;
    gap: var(--sp-8);
  }

  .followup-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-13) var(--sp-16);
    border-radius: var(--radius-md);
    transition: transform var(--dur-fast) var(--ease-out);
  }

  .followup-card:hover {
    transform: translateX(2px);
  }

  .followup-overdue {
    border-left: 3px solid var(--coral);
  }

  .followup-today {
    border-left: 3px solid var(--gold);
  }

  .followup-left {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-10);
    flex: 1;
    min-width: 0;
  }

  .followup-type-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    font-size: 12px;
    font-weight: 700;
    flex-shrink: 0;
    background: var(--ink-06);
    color: var(--ink-40);
  }

  .badge-overdue { background: var(--coral-soft); color: var(--coral); }
  .badge-today { background: var(--gold-glow); color: var(--gold); }
  .badge-upcoming { background: var(--sage-soft); color: var(--sage); }

  .followup-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .followup-detail {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .followup-meta {
    font-size: 10px;
    color: var(--ink-30);
  }

  .followup-due {
    font-family: var(--font-data);
    font-size: var(--text-xs);
    color: var(--ink-40);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .due-overdue { color: var(--coral); font-weight: 600; }
  .due-today { color: var(--gold); font-weight: 600; }

  .followup-empty {
    padding: var(--sp-21);
    text-align: center;
  }

  .followup-empty-text {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--ink-30);
  }

  /* ── Business Alerts ──────────────────────────────────────────────────── */

  .alerts-section {
    grid-column: 1 / -1;
  }

  .alert-count-chips {
    display: flex;
    gap: var(--sp-5);
  }

  .alert-chip {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .chip-critical { background: var(--coral-soft); color: var(--coral); }
  .chip-warning { background: var(--gold-glow); color: var(--gold); }
  .chip-info { background: var(--sage-soft); color: var(--sage); }

  .alert-list {
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
  }

  .alert-item {
    display: flex;
    align-items: center;
    gap: var(--sp-10);
    padding: var(--sp-10) var(--sp-13);
    border-radius: var(--radius-sm);
    background: var(--paper-card);
    transition: transform var(--dur-fast) var(--ease-out);
  }

  .alert-item:hover {
    transform: translateX(2px);
  }

  .alert-critical { border-left: 3px solid var(--coral); }
  .alert-warning { border-left: 3px solid var(--gold); }
  .alert-info { border-left: 3px solid var(--sage); }

  .alert-severity-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .dot-critical { background: var(--coral); }
  .dot-warning { background: var(--gold); }
  .dot-info { background: var(--sage); }

  .alert-content {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    min-width: 0;
  }

  .alert-title {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
  }

  .alert-message {
    font-size: var(--text-xs);
    color: var(--ink-40);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .alert-action {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 600;
    color: var(--gold);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .alert-action:hover {
    color: var(--ink);
  }
</style>
