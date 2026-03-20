// ─── Input types (decoupled from STDB store types) ────────────────────────

export interface ReportMoneyEvent {
  id: bigint;
  partyId: bigint;
  kind: { tag: string };
  subtotalFils: bigint;
  totalFils: bigint;
  reference: string;
  dueDate?: { microsSinceUnixEpoch: bigint };
  createdAt: { microsSinceUnixEpoch: bigint };
}

export interface ReportParty {
  id: bigint;
  name: string;
  isCustomer: boolean;
  isSupplier: boolean;
  grade: { tag: string };
}

export interface ReportPipeline {
  id: bigint;
  partyId: bigint;
  title: string;
  status: { tag: string };
  estimatedValueFils: bigint;
  winProbabilityBps: number;
  createdAt: { microsSinceUnixEpoch: bigint };
}

// ─── Report types ─────────────────────────────────────────────────────────

export interface ReportPeriod {
  startDate: string; // ISO YYYY-MM-DD
  endDate: string;
  label: string;
}

export interface SalesReport {
  period: ReportPeriod;
  totalRevenueFils: bigint;
  invoiceCount: number;
  averageInvoiceFils: bigint;
  topCustomers: Array<{
    name: string;
    grade: string;
    revenueFils: bigint;
    invoiceCount: number;
    pctOfTotal: number;
  }>;
  pipelineSummary: {
    activeDeals: number;
    totalValueFils: bigint;
    weightedValueFils: bigint;
    wonDeals: number;
    lostDeals: number;
    winRate: number;
  };
  monthlyBreakdown: Array<{
    month: string;
    revenueFils: bigint;
    invoiceCount: number;
  }>;
}

export interface CollectionsReport {
  period: ReportPeriod;
  totalCollectedFils: bigint;
  paymentCount: number;
  collectionRatePct: number;
  averageDaysToPayment: number;
  byGrade: Array<{
    grade: string;
    collectedFils: bigint;
    outstandingFils: bigint;
    avgDaysToPayment: number;
    customerCount: number;
  }>;
}

export interface PayablesReport {
  period: ReportPeriod;
  totalPayableFils: bigint;
  supplierCount: number;
  topSuppliers: Array<{
    name: string;
    invoicedFils: bigint;
    paidFils: bigint;
    payableFils: bigint;
  }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const MICROS_PER_MS = 1000n;
const MS_PER_DAY = 86_400_000;

function microsToMs(micros: bigint): number {
  return Number(micros / MICROS_PER_MS);
}

function isInPeriod(event: ReportMoneyEvent, period: ReportPeriod): boolean {
  const eventMs = microsToMs(event.createdAt.microsSinceUnixEpoch);
  const startMs = Date.parse(period.startDate);
  const endMs = Date.parse(period.endDate) + MS_PER_DAY - 1; // end of day inclusive
  return eventMs >= startMs && eventMs <= endMs;
}

function eventToYearMonth(event: ReportMoneyEvent): string {
  const d = new Date(microsToMs(event.createdAt.microsSinceUnixEpoch));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function formatBhd(fils: bigint): string {
  const negative = fils < 0n;
  const absFils = negative ? -fils : fils;
  const whole = absFils / 1000n;
  const frac = absFils % 1000n;
  const fracStr = String(frac).padStart(3, '0');
  const wholeStr = whole.toLocaleString('en-US');
  return `${negative ? '-' : ''}BHD ${wholeStr}.${fracStr}`;
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${months[parseInt(m, 10) - 1]} ${y}`;
}

// ─── Generators ───────────────────────────────────────────────────────────

export function generateSalesReport(
  period: ReportPeriod,
  moneyEvents: ReportMoneyEvent[],
  parties: ReportParty[],
  pipelines: ReportPipeline[],
): SalesReport {
  const partyById = new Map<bigint, ReportParty>();
  for (const p of parties) partyById.set(p.id, p);

  // Filter customer invoices in period
  const invoices = moneyEvents.filter(
    (e) => e.kind.tag === 'CustomerInvoice' && isInPeriod(e, period),
  );

  const totalRevenueFils = invoices.reduce((sum, e) => sum + e.totalFils, 0n);
  const invoiceCount = invoices.length;
  const averageInvoiceFils = invoiceCount > 0
    ? totalRevenueFils / BigInt(invoiceCount)
    : 0n;

  // Top customers
  const revenueByParty = new Map<bigint, { revenueFils: bigint; invoiceCount: number }>();
  for (const inv of invoices) {
    const entry = revenueByParty.get(inv.partyId) ?? { revenueFils: 0n, invoiceCount: 0 };
    entry.revenueFils += inv.totalFils;
    entry.invoiceCount += 1;
    revenueByParty.set(inv.partyId, entry);
  }

  const topCustomers = Array.from(revenueByParty.entries())
    .map(([partyId, data]) => {
      const party = partyById.get(partyId);
      return {
        name: party?.name ?? 'Unknown',
        grade: party?.grade.tag ?? 'Unknown',
        revenueFils: data.revenueFils,
        invoiceCount: data.invoiceCount,
        pctOfTotal: totalRevenueFils > 0n
          ? Number((data.revenueFils * 10000n) / totalRevenueFils) / 100
          : 0,
      };
    })
    .sort((a, b) => (b.revenueFils > a.revenueFils ? 1 : b.revenueFils < a.revenueFils ? -1 : 0))
    .slice(0, 5);

  // Pipeline summary
  const activeTags = new Set(['Active', 'InProgress']);
  const wonTags = new Set(['Terminal']);
  const lostTags = new Set(['Cancelled']);

  const activeDeals = pipelines.filter((p) => activeTags.has(p.status.tag));
  const wonDeals = pipelines.filter((p) => wonTags.has(p.status.tag));
  const lostDeals = pipelines.filter((p) => lostTags.has(p.status.tag));

  const totalValueFils = activeDeals.reduce((s, p) => s + p.estimatedValueFils, 0n);
  const weightedValueFils = activeDeals.reduce(
    (s, p) => s + (p.estimatedValueFils * BigInt(p.winProbabilityBps)) / 10000n,
    0n,
  );

  const wonCount = wonDeals.length;
  const lostCount = lostDeals.length;
  const winRate = wonCount + lostCount > 0
    ? Number(((BigInt(wonCount) * 10000n) / BigInt(wonCount + lostCount))) / 100
    : 0;

  // Monthly breakdown
  const monthlyMap = new Map<string, { revenueFils: bigint; invoiceCount: number }>();
  for (const inv of invoices) {
    const ym = eventToYearMonth(inv);
    const entry = monthlyMap.get(ym) ?? { revenueFils: 0n, invoiceCount: 0 };
    entry.revenueFils += inv.totalFils;
    entry.invoiceCount += 1;
    monthlyMap.set(ym, entry);
  }

  const monthlyBreakdown = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({ month, ...data }));

  return {
    period,
    totalRevenueFils,
    invoiceCount,
    averageInvoiceFils,
    topCustomers,
    pipelineSummary: {
      activeDeals: activeDeals.length,
      totalValueFils,
      weightedValueFils,
      wonDeals: wonCount,
      lostDeals: lostCount,
      winRate,
    },
    monthlyBreakdown,
  };
}

export function generateCollectionsReport(
  period: ReportPeriod,
  moneyEvents: ReportMoneyEvent[],
  parties: ReportParty[],
): CollectionsReport {
  const partyById = new Map<bigint, ReportParty>();
  for (const p of parties) partyById.set(p.id, p);

  const periodEvents = moneyEvents.filter((e) => isInPeriod(e, period));
  const invoices = periodEvents.filter((e) => e.kind.tag === 'CustomerInvoice');
  const payments = periodEvents.filter((e) => e.kind.tag === 'CustomerPayment');

  const totalInvoicedFils = invoices.reduce((s, e) => s + e.totalFils, 0n);
  const totalCollectedFils = payments.reduce((s, e) => s + e.totalFils, 0n);
  const paymentCount = payments.length;

  const collectionRatePct = totalInvoicedFils > 0n
    ? Number((totalCollectedFils * 10000n) / totalInvoicedFils) / 100
    : 0;

  // Per-party aggregation for grade breakdown and days-to-payment
  interface PartyAgg {
    invoicedFils: bigint;
    collectedFils: bigint;
    invoiceTimestamps: number[];
    paymentTimestamps: number[];
  }
  const partyAgg = new Map<bigint, PartyAgg>();

  for (const inv of invoices) {
    const agg = partyAgg.get(inv.partyId) ?? {
      invoicedFils: 0n,
      collectedFils: 0n,
      invoiceTimestamps: [],
      paymentTimestamps: [],
    };
    agg.invoicedFils += inv.totalFils;
    agg.invoiceTimestamps.push(microsToMs(inv.createdAt.microsSinceUnixEpoch));
    partyAgg.set(inv.partyId, agg);
  }

  for (const pay of payments) {
    const agg = partyAgg.get(pay.partyId) ?? {
      invoicedFils: 0n,
      collectedFils: 0n,
      invoiceTimestamps: [],
      paymentTimestamps: [],
    };
    agg.collectedFils += pay.totalFils;
    agg.paymentTimestamps.push(microsToMs(pay.createdAt.microsSinceUnixEpoch));
    partyAgg.set(pay.partyId, agg);
  }

  // Compute average days to payment per party
  function avgDaysForParty(agg: PartyAgg): number {
    if (agg.invoiceTimestamps.length === 0 || agg.paymentTimestamps.length === 0) return 0;
    // Pair invoices and payments chronologically
    const invTs = [...agg.invoiceTimestamps].sort((a, b) => a - b);
    const payTs = [...agg.paymentTimestamps].sort((a, b) => a - b);
    const pairs = Math.min(invTs.length, payTs.length);
    let totalDays = 0;
    for (let i = 0; i < pairs; i++) {
      totalDays += (payTs[i] - invTs[i]) / MS_PER_DAY;
    }
    return pairs > 0 ? Math.round(totalDays / pairs) : 0;
  }

  // Group by grade
  const gradeMap = new Map<string, {
    collectedFils: bigint;
    outstandingFils: bigint;
    daysSum: number;
    daysCount: number;
    customerIds: Set<bigint>;
  }>();

  for (const [partyId, agg] of partyAgg) {
    const party = partyById.get(partyId);
    if (!party || !party.isCustomer) continue;
    const grade = party.grade.tag;
    const entry = gradeMap.get(grade) ?? {
      collectedFils: 0n,
      outstandingFils: 0n,
      daysSum: 0,
      daysCount: 0,
      customerIds: new Set<bigint>(),
    };
    entry.collectedFils += agg.collectedFils;
    entry.outstandingFils += agg.invoicedFils - agg.collectedFils;
    const days = avgDaysForParty(agg);
    if (days > 0) {
      entry.daysSum += days;
      entry.daysCount += 1;
    }
    entry.customerIds.add(partyId);
    gradeMap.set(grade, entry);
  }

  const byGrade = Array.from(gradeMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([grade, data]) => ({
      grade,
      collectedFils: data.collectedFils,
      outstandingFils: data.outstandingFils,
      avgDaysToPayment: data.daysCount > 0 ? Math.round(data.daysSum / data.daysCount) : 0,
      customerCount: data.customerIds.size,
    }));

  // Global average days to payment
  let globalDaysSum = 0;
  let globalDaysCount = 0;
  for (const agg of partyAgg.values()) {
    const days = avgDaysForParty(agg);
    if (days > 0) {
      globalDaysSum += days;
      globalDaysCount += 1;
    }
  }
  const averageDaysToPayment = globalDaysCount > 0
    ? Math.round(globalDaysSum / globalDaysCount)
    : 0;

  return {
    period,
    totalCollectedFils,
    paymentCount,
    collectionRatePct,
    averageDaysToPayment,
    byGrade,
  };
}

export function generatePayablesReport(
  period: ReportPeriod,
  moneyEvents: ReportMoneyEvent[],
  parties: ReportParty[],
): PayablesReport {
  const partyById = new Map<bigint, ReportParty>();
  for (const p of parties) partyById.set(p.id, p);

  const periodEvents = moneyEvents.filter((e) => isInPeriod(e, period));
  const supplierInvoices = periodEvents.filter((e) => e.kind.tag === 'SupplierInvoice');
  const supplierPayments = periodEvents.filter((e) => e.kind.tag === 'SupplierPayment');

  // Aggregate per supplier
  const supplierAgg = new Map<bigint, { invoicedFils: bigint; paidFils: bigint }>();

  for (const inv of supplierInvoices) {
    const agg = supplierAgg.get(inv.partyId) ?? { invoicedFils: 0n, paidFils: 0n };
    agg.invoicedFils += inv.totalFils;
    supplierAgg.set(inv.partyId, agg);
  }

  for (const pay of supplierPayments) {
    const agg = supplierAgg.get(pay.partyId) ?? { invoicedFils: 0n, paidFils: 0n };
    agg.paidFils += pay.totalFils;
    supplierAgg.set(pay.partyId, agg);
  }

  let totalPayableFils = 0n;
  const topSuppliers = Array.from(supplierAgg.entries())
    .map(([partyId, agg]) => {
      const party = partyById.get(partyId);
      const payable = agg.invoicedFils - agg.paidFils;
      totalPayableFils += payable;
      return {
        name: party?.name ?? 'Unknown',
        invoicedFils: agg.invoicedFils,
        paidFils: agg.paidFils,
        payableFils: payable,
      };
    })
    .sort((a, b) =>
      b.payableFils > a.payableFils ? 1 : b.payableFils < a.payableFils ? -1 : 0,
    );

  return {
    period,
    totalPayableFils,
    supplierCount: supplierAgg.size,
    topSuppliers,
  };
}

// ─── Formatters ───────────────────────────────────────────────────────────

export function formatSalesReport(report: SalesReport): string {
  const lines: string[] = [];
  const sep = '\u2550'.repeat(50);

  lines.push(`PH TRADING WLL \u2014 SALES REPORT`);
  lines.push(`Period: ${report.period.label} (${report.period.startDate} to ${report.period.endDate})`);
  lines.push(sep);
  lines.push('');

  const avgStr = formatBhd(report.averageInvoiceFils);
  lines.push(
    `Revenue:        ${formatBhd(report.totalRevenueFils)} (${report.invoiceCount} invoices, avg ${avgStr})`,
  );
  lines.push('');

  lines.push('Top Customers:');
  report.topCustomers.forEach((c, i) => {
    const nameCol = c.name.padEnd(14);
    const gradeCol = `Grade ${c.grade}`.padEnd(10);
    const revCol = formatBhd(c.revenueFils).padStart(16);
    lines.push(
      `  ${i + 1}. ${nameCol}${gradeCol}${revCol} (${c.pctOfTotal.toFixed(1)}%)  ${c.invoiceCount} invoices`,
    );
  });
  lines.push('');

  const ps = report.pipelineSummary;
  lines.push('Pipeline:');
  lines.push(
    `  Active deals: ${ps.activeDeals} (${formatBhd(ps.totalValueFils)}, weighted ${formatBhd(ps.weightedValueFils)})`,
  );
  lines.push(
    `  Win rate: ${ps.winRate.toFixed(1)}% (${ps.wonDeals} won / ${ps.lostDeals} lost)`,
  );
  lines.push('');

  lines.push('Monthly Breakdown:');
  for (const m of report.monthlyBreakdown) {
    const label = monthLabel(m.month).padEnd(12);
    lines.push(`  ${label}${formatBhd(m.revenueFils).padStart(16)}  (${m.invoiceCount} invoices)`);
  }

  return lines.join('\n');
}

export function formatCollectionsReport(report: CollectionsReport): string {
  const lines: string[] = [];
  const sep = '\u2550'.repeat(50);

  lines.push(`PH TRADING WLL \u2014 COLLECTIONS REPORT`);
  lines.push(`Period: ${report.period.label} (${report.period.startDate} to ${report.period.endDate})`);
  lines.push(sep);
  lines.push('');

  lines.push(`Total Collected: ${formatBhd(report.totalCollectedFils)} (${report.paymentCount} payments)`);
  lines.push(`Collection Rate: ${report.collectionRatePct.toFixed(1)}%`);
  lines.push(`Avg Days to Payment: ${report.averageDaysToPayment}`);
  lines.push('');

  lines.push('By Grade:');
  for (const g of report.byGrade) {
    lines.push(`  Grade ${g.grade}:`);
    lines.push(`    Collected:   ${formatBhd(g.collectedFils)}`);
    lines.push(`    Outstanding: ${formatBhd(g.outstandingFils)}`);
    lines.push(`    Avg Days:    ${g.avgDaysToPayment}`);
    lines.push(`    Customers:   ${g.customerCount}`);
  }

  return lines.join('\n');
}

export function formatPayablesReport(report: PayablesReport): string {
  const lines: string[] = [];
  const sep = '\u2550'.repeat(50);

  lines.push(`PH TRADING WLL \u2014 ACCOUNTS PAYABLE REPORT`);
  lines.push(`Period: ${report.period.label} (${report.period.startDate} to ${report.period.endDate})`);
  lines.push(sep);
  lines.push('');

  lines.push(`Total Payable: ${formatBhd(report.totalPayableFils)} (${report.supplierCount} suppliers)`);
  lines.push('');

  lines.push('Suppliers:');
  for (const s of report.topSuppliers) {
    const nameCol = s.name.padEnd(20);
    lines.push(`  ${nameCol}Invoiced: ${formatBhd(s.invoicedFils)}  Paid: ${formatBhd(s.paidFils)}  Payable: ${formatBhd(s.payableFils)}`);
  }

  return lines.join('\n');
}
