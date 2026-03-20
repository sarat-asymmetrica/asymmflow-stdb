// ─── Types ────────────────────────────────────────────────────────────────

export type AlertSeverity = 'critical' | 'warning' | 'info';
export type AlertCategory = 'finance' | 'operations' | 'crm' | 'compliance';

export interface BusinessAlert {
  id: string;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  actionLabel?: string;
  createdAt: string;
}

export interface AlertInput {
  parties: AlertParty[];
  moneyEvents: AlertMoneyEvent[];
  pipelines: AlertPipeline[];
  nowMicros: bigint;
}

export interface AlertParty {
  id: bigint;
  name: string;
  isCustomer: boolean;
  isSupplier: boolean;
  grade: { tag: string };
  creditLimitFils: bigint;
  isCreditBlocked: boolean;
}

export interface AlertMoneyEvent {
  id: bigint;
  partyId: bigint;
  kind: { tag: string };
  totalFils: bigint;
  dueDate?: { microsSinceUnixEpoch: bigint };
  createdAt: { microsSinceUnixEpoch: bigint };
}

export interface AlertPipeline {
  id: bigint;
  partyId: bigint;
  title: string;
  status: { tag: string };
  estimatedValueFils: bigint;
  nextFollowUp?: { microsSinceUnixEpoch: bigint };
}

// ─── Constants ────────────────────────────────────────────────────────────

const MICROS_PER_MS = 1000n;
const MICROS_PER_DAY = 86_400_000_000n;
const FILS_PER_BHD = 1000n;

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatBhd(fils: bigint): string {
  const sign = fils < 0n ? '-' : '';
  const abs = fils < 0n ? -fils : fils;
  const whole = abs / FILS_PER_BHD;
  return `BHD ${sign}${whole.toLocaleString('en-US')}`;
}

function daysBetweenMicros(fromMicros: bigint, toMicros: bigint): number {
  return Number((toMicros - fromMicros) / MICROS_PER_DAY);
}

function isoFromMicros(micros: bigint): string {
  return new Date(Number(micros / MICROS_PER_MS)).toISOString();
}

function partyById(parties: AlertParty[], id: bigint): AlertParty | undefined {
  return parties.find((p) => p.id === id);
}

// ─── Per-party outstanding computation ────────────────────────────────────

interface PartyOutstanding {
  partyId: bigint;
  outstandingFils: bigint;
  invoices: AlertMoneyEvent[];
}

function computeCustomerOutstanding(
  parties: AlertParty[],
  moneyEvents: AlertMoneyEvent[],
): PartyOutstanding[] {
  const customers = parties.filter((p) => p.isCustomer);
  return customers.map((c) => {
    const events = moneyEvents.filter((e) => e.partyId === c.id);
    const invoiced = events
      .filter((e) => e.kind.tag === 'CustomerInvoice')
      .reduce((sum, e) => sum + e.totalFils, 0n);
    const paid = events
      .filter((e) => e.kind.tag === 'CustomerPayment')
      .reduce((sum, e) => sum + e.totalFils, 0n);
    const invoices = events.filter((e) => e.kind.tag === 'CustomerInvoice');
    return { partyId: c.id, outstandingFils: invoiced - paid, invoices };
  });
}

// ─── Rule 1: Credit limit breach (CRITICAL) ──────────────────────────────

function ruleCreditLimitBreach(input: AlertInput): BusinessAlert[] {
  const alerts: BusinessAlert[] = [];
  const outstandings = computeCustomerOutstanding(input.parties, input.moneyEvents);

  for (const o of outstandings) {
    const party = partyById(input.parties, o.partyId);
    if (!party || party.creditLimitFils <= 0n) continue;
    if (o.outstandingFils > party.creditLimitFils) {
      alerts.push({
        id: `alert-credit-breach-${party.id}`,
        severity: 'critical',
        category: 'finance',
        title: 'Credit limit breach',
        message: `${party.name} outstanding (${formatBhd(o.outstandingFils)}) exceeds credit limit (${formatBhd(party.creditLimitFils)})`,
        entityType: 'Party',
        entityId: String(party.id),
        actionLabel: 'Chase Payment',
        createdAt: isoFromMicros(input.nowMicros),
      });
    }
  }
  return alerts;
}

// ─── Rule 2: Severely overdue >90 days (CRITICAL) ────────────────────────

function ruleSeverelyOverdue(input: AlertInput): BusinessAlert[] {
  const alerts: BusinessAlert[] = [];
  const seen = new Set<string>();

  for (const event of input.moneyEvents) {
    if (event.kind.tag !== 'CustomerInvoice') continue;
    if (!event.dueDate) continue;
    const overdueDays = daysBetweenMicros(event.dueDate.microsSinceUnixEpoch, input.nowMicros);
    if (overdueDays <= 90) continue;

    const party = partyById(input.parties, event.partyId);
    if (!party) continue;

    const key = String(party.id);
    if (seen.has(key)) continue;
    seen.add(key);

    // Sum all severely overdue invoices for this party
    const overdueTotal = input.moneyEvents
      .filter(
        (e) =>
          e.kind.tag === 'CustomerInvoice' &&
          e.partyId === party.id &&
          e.dueDate &&
          daysBetweenMicros(e.dueDate.microsSinceUnixEpoch, input.nowMicros) > 90,
      )
      .reduce((sum, e) => sum + e.totalFils, 0n);

    alerts.push({
      id: `alert-severe-overdue-${party.id}`,
      severity: 'critical',
      category: 'finance',
      title: 'Severely overdue invoices',
      message: `${party.name} has invoices >90 days overdue (${formatBhd(overdueTotal)})`,
      entityType: 'Party',
      entityId: String(party.id),
      actionLabel: 'Chase Payment',
      createdAt: isoFromMicros(input.nowMicros),
    });
  }
  return alerts;
}

// ─── Rule 3: Cash position negative (CRITICAL) ───────────────────────────

function ruleCashNegative(input: AlertInput): BusinessAlert[] {
  const customerPayments = input.moneyEvents
    .filter((e) => e.kind.tag === 'CustomerPayment')
    .reduce((sum, e) => sum + e.totalFils, 0n);
  const supplierPayments = input.moneyEvents
    .filter((e) => e.kind.tag === 'SupplierPayment')
    .reduce((sum, e) => sum + e.totalFils, 0n);
  const netCash = customerPayments - supplierPayments;

  if (netCash < 0n) {
    return [
      {
        id: 'alert-cash-negative',
        severity: 'critical',
        category: 'finance',
        title: 'Negative cash position',
        message: `Cash position is negative (${formatBhd(netCash)})`,
        actionLabel: 'Review Cash Flow',
        createdAt: isoFromMicros(input.nowMicros),
      },
    ];
  }
  return [];
}

// ─── Rule 4: Approaching credit limit >80% (WARNING) ─────────────────────

function ruleApproachingCreditLimit(input: AlertInput): BusinessAlert[] {
  const alerts: BusinessAlert[] = [];
  const outstandings = computeCustomerOutstanding(input.parties, input.moneyEvents);

  for (const o of outstandings) {
    const party = partyById(input.parties, o.partyId);
    if (!party || party.creditLimitFils <= 0n) continue;
    // Skip if already breached (rule 1 covers that)
    if (o.outstandingFils > party.creditLimitFils) continue;
    const pct = (o.outstandingFils * 100n) / party.creditLimitFils;
    if (pct > 80n) {
      alerts.push({
        id: `alert-credit-approaching-${party.id}`,
        severity: 'warning',
        category: 'finance',
        title: 'Approaching credit limit',
        message: `${party.name} at ${pct}% of credit limit`,
        entityType: 'Party',
        entityId: String(party.id),
        actionLabel: 'Review Credit',
        createdAt: isoFromMicros(input.nowMicros),
      });
    }
  }
  return alerts;
}

// ─── Rule 5: Overdue invoices 30-90 days (WARNING) ────────────────────────

function ruleModeratelyOverdue(input: AlertInput): BusinessAlert[] {
  const alerts: BusinessAlert[] = [];
  const seen = new Set<string>();

  for (const event of input.moneyEvents) {
    if (event.kind.tag !== 'CustomerInvoice') continue;
    if (!event.dueDate) continue;
    const overdueDays = daysBetweenMicros(event.dueDate.microsSinceUnixEpoch, input.nowMicros);
    if (overdueDays < 30 || overdueDays > 90) continue;

    const party = partyById(input.parties, event.partyId);
    if (!party) continue;

    const key = String(party.id);
    if (seen.has(key)) continue;
    seen.add(key);

    alerts.push({
      id: `alert-moderate-overdue-${party.id}`,
      severity: 'warning',
      category: 'finance',
      title: 'Overdue invoices',
      message: `${party.name} has invoices 30-90 days overdue`,
      entityType: 'Party',
      entityId: String(party.id),
      actionLabel: 'Chase Payment',
      createdAt: isoFromMicros(input.nowMicros),
    });
  }
  return alerts;
}

// ─── Rule 6: Stale pipeline >14 days (WARNING) ───────────────────────────

function ruleStalePipeline(input: AlertInput): BusinessAlert[] {
  const alerts: BusinessAlert[] = [];
  const activeTags = new Set(['Active', 'Quoted', 'Negotiation', 'Proposal']);

  for (const pipeline of input.pipelines) {
    if (!activeTags.has(pipeline.status.tag)) continue;
    if (!pipeline.nextFollowUp) continue;

    const overdueDays = daysBetweenMicros(
      pipeline.nextFollowUp.microsSinceUnixEpoch,
      input.nowMicros,
    );
    if (overdueDays <= 14) continue;

    alerts.push({
      id: `alert-stale-pipeline-${pipeline.id}`,
      severity: 'warning',
      category: 'crm',
      title: 'Stale pipeline',
      message: `Pipeline '${pipeline.title}' follow-up overdue by ${overdueDays} days`,
      entityType: 'Pipeline',
      entityId: String(pipeline.id),
      actionLabel: 'Schedule Follow-up',
      createdAt: isoFromMicros(input.nowMicros),
    });
  }
  return alerts;
}

// ─── Rule 7: Grade D customer with open invoices (WARNING) ────────────────

function ruleGradeDWithInvoices(input: AlertInput): BusinessAlert[] {
  const alerts: BusinessAlert[] = [];
  const outstandings = computeCustomerOutstanding(input.parties, input.moneyEvents);

  for (const o of outstandings) {
    if (o.outstandingFils <= 0n) continue;
    const party = partyById(input.parties, o.partyId);
    if (!party) continue;
    if (party.grade.tag !== 'D') continue;

    alerts.push({
      id: `alert-grade-d-${party.id}`,
      severity: 'warning',
      category: 'compliance',
      title: 'Grade D customer with open invoices',
      message: `Grade D customer ${party.name} has open invoices — advance payment policy`,
      entityType: 'Party',
      entityId: String(party.id),
      actionLabel: 'Review Grade',
      createdAt: isoFromMicros(input.nowMicros),
    });
  }
  return alerts;
}

// ─── Rule 8: New invoices this week (INFO) ────────────────────────────────

function ruleNewInvoicesThisWeek(input: AlertInput): BusinessAlert[] {
  const sevenDaysAgo = input.nowMicros - 7n * MICROS_PER_DAY;
  const recent = input.moneyEvents.filter(
    (e) =>
      e.kind.tag === 'CustomerInvoice' &&
      e.createdAt.microsSinceUnixEpoch >= sevenDaysAgo,
  );
  if (recent.length === 0) return [];

  return [
    {
      id: 'alert-new-invoices-week',
      severity: 'info',
      category: 'finance',
      title: 'New invoices this week',
      message: `${recent.length} new invoice${recent.length === 1 ? '' : 's'} created this week`,
      createdAt: isoFromMicros(input.nowMicros),
    },
  ];
}

// ─── Rule 9: Payments received this week (INFO) ──────────────────────────

function rulePaymentsReceivedThisWeek(input: AlertInput): BusinessAlert[] {
  const sevenDaysAgo = input.nowMicros - 7n * MICROS_PER_DAY;
  const recent = input.moneyEvents.filter(
    (e) =>
      e.kind.tag === 'CustomerPayment' &&
      e.createdAt.microsSinceUnixEpoch >= sevenDaysAgo,
  );
  if (recent.length === 0) return [];

  const totalFils = recent.reduce((sum, e) => sum + e.totalFils, 0n);

  return [
    {
      id: 'alert-payments-week',
      severity: 'info',
      category: 'finance',
      title: 'Payments received this week',
      message: `${recent.length} payment${recent.length === 1 ? '' : 's'} received this week (${formatBhd(totalFils)})`,
      createdAt: isoFromMicros(input.nowMicros),
    },
  ];
}

// ─── Rule 10: Pipeline deals nearing follow-up (INFO) ────────────────────

function rulePipelineFollowUpSoon(input: AlertInput): BusinessAlert[] {
  const alerts: BusinessAlert[] = [];
  const threeDaysFromNow = input.nowMicros + 3n * MICROS_PER_DAY;
  const activeTags = new Set(['Active', 'Quoted', 'Negotiation', 'Proposal']);

  for (const pipeline of input.pipelines) {
    if (!activeTags.has(pipeline.status.tag)) continue;
    if (!pipeline.nextFollowUp) continue;

    const followUpMicros = pipeline.nextFollowUp.microsSinceUnixEpoch;
    // Follow-up is in the future but within 3 days
    if (followUpMicros >= input.nowMicros && followUpMicros <= threeDaysFromNow) {
      alerts.push({
        id: `alert-followup-soon-${pipeline.id}`,
        severity: 'info',
        category: 'crm',
        title: 'Follow-up due soon',
        message: `Follow-up due soon: ${pipeline.title}`,
        entityType: 'Pipeline',
        entityId: String(pipeline.id),
        actionLabel: 'Prepare Follow-up',
        createdAt: isoFromMicros(input.nowMicros),
      });
    }
  }
  return alerts;
}

// ─── Public API ───────────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/** Evaluate all business conditions and generate alerts */
export function evaluateAlerts(input: AlertInput): BusinessAlert[] {
  return [
    ...ruleCreditLimitBreach(input),
    ...ruleSeverelyOverdue(input),
    ...ruleCashNegative(input),
    ...ruleApproachingCreditLimit(input),
    ...ruleModeratelyOverdue(input),
    ...ruleStalePipeline(input),
    ...ruleGradeDWithInvoices(input),
    ...ruleNewInvoicesThisWeek(input),
    ...rulePaymentsReceivedThisWeek(input),
    ...rulePipelineFollowUpSoon(input),
  ];
}

/** Filter alerts by severity */
export function filterBySeverity(
  alerts: BusinessAlert[],
  severity: AlertSeverity,
): BusinessAlert[] {
  return alerts.filter((a) => a.severity === severity);
}

/** Filter alerts by category */
export function filterByCategory(
  alerts: BusinessAlert[],
  category: AlertCategory,
): BusinessAlert[] {
  return alerts.filter((a) => a.category === category);
}

/** Sort alerts: critical first, then warning, then info */
export function sortAlerts(alerts: BusinessAlert[]): BusinessAlert[] {
  return [...alerts].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}

/** Count alerts by severity */
export function countBySeverity(
  alerts: BusinessAlert[],
): Record<AlertSeverity, number> {
  const counts: Record<AlertSeverity, number> = { critical: 0, warning: 0, info: 0 };
  for (const a of alerts) {
    counts[a.severity]++;
  }
  return counts;
}

/** Format alert summary */
export function formatAlertSummary(alerts: BusinessAlert[]): string {
  const counts = countBySeverity(alerts);
  const parts: string[] = [];
  if (counts.critical > 0) parts.push(`${counts.critical} critical`);
  if (counts.warning > 0) parts.push(`${counts.warning} warning`);
  if (counts.info > 0) parts.push(`${counts.info} info`);
  if (parts.length === 0) return 'No alerts';
  return `${alerts.length} alert${alerts.length === 1 ? '' : 's'}: ${parts.join(', ')}`;
}
