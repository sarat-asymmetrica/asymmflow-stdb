export type RiskTier = 'low' | 'medium' | 'high' | 'critical';

export interface RiskMoneyEvent {
  partyId: bigint;
  kind: { tag: string };
  totalFils: bigint;
  dueDate?: { microsSinceUnixEpoch: bigint };
  createdAt: { microsSinceUnixEpoch: bigint };
}

export interface RiskParty {
  id: bigint;
  name: string;
  isCustomer: boolean;
  grade: { tag: string };
  creditLimitFils: bigint;
  paymentTermsDays: bigint | number;
}

export interface CustomerRiskScore {
  partyId: bigint;
  name: string;
  grade: string;
  /** Composite risk score 0-100 (100 = highest risk) */
  riskScore: number;
  /** Risk tier derived from score */
  tier: RiskTier;
  /** Individual risk factors that contributed */
  factors: RiskFactor[];
  /** Outstanding balance in fils */
  outstandingFils: bigint;
  /** Credit utilization percentage */
  creditUtilizationPct: number;
  /** Average days to payment (from history) */
  avgDaysToPayment: number;
  /** Maximum overdue days currently */
  maxOverdueDays: number;
  /** Recommended action */
  recommendation: string;
}

export interface RiskFactor {
  name: string;
  weight: number;
  value: string;
  severity: RiskTier;
}

export interface RiskPortfolioSummary {
  totalCustomers: number;
  byTier: Record<RiskTier, number>;
  totalExposureFils: bigint;
  highRiskExposureFils: bigint;
  averageRiskScore: number;
  topRisks: CustomerRiskScore[];
}

const DAY_MICROS = 86_400_000_000n;

function microsToDay(micros: bigint): number {
  return Number(micros / DAY_MICROS);
}

function toNumber(v: bigint | number): number {
  return typeof v === 'bigint' ? Number(v) : v;
}

export function scoreToTier(score: number): RiskTier {
  if (score <= 25) return 'low';
  if (score <= 50) return 'medium';
  if (score <= 75) return 'high';
  return 'critical';
}

function severityForWeight(w: number): RiskTier {
  if (w <= 5) return 'low';
  if (w <= 10) return 'medium';
  if (w <= 15) return 'high';
  return 'critical';
}

function computePaymentBehaviorFactor(
  avgDaysLate: number,
): RiskFactor {
  let weight: number;
  if (avgDaysLate <= 0) weight = 0;
  else if (avgDaysLate <= 15) weight = 5;
  else if (avgDaysLate <= 30) weight = 10;
  else if (avgDaysLate <= 60) weight = 15;
  else weight = 20;

  return {
    name: 'Payment behavior',
    weight,
    value: avgDaysLate <= 0 ? 'On time or early' : `Avg ${Math.round(avgDaysLate)} days late`,
    severity: severityForWeight(weight),
  };
}

function computeCreditUtilizationFactor(
  outstandingFils: bigint,
  creditLimitFils: bigint,
): { factor: RiskFactor; pct: number } {
  if (creditLimitFils <= 0n) {
    const pct = outstandingFils > 0n ? 100 : 0;
    const weight = outstandingFils > 0n ? 20 : 0;
    return {
      factor: {
        name: 'Credit utilization',
        weight,
        value: outstandingFils > 0n ? 'No credit limit set (over limit)' : 'No exposure',
        severity: severityForWeight(weight),
      },
      pct,
    };
  }

  const pct = Number(outstandingFils * 10000n / creditLimitFils) / 100;
  let weight: number;
  if (pct < 50) weight = 0;
  else if (pct <= 75) weight = 5;
  else if (pct <= 90) weight = 10;
  else if (pct <= 100) weight = 15;
  else weight = 20;

  return {
    factor: {
      name: 'Credit utilization',
      weight,
      value: `${pct.toFixed(1)}%`,
      severity: severityForWeight(weight),
    },
    pct,
  };
}

function computeOverdueSeverityFactor(maxOverdueDays: number): RiskFactor {
  let weight: number;
  if (maxOverdueDays <= 0) weight = 0;
  else if (maxOverdueDays <= 15) weight = 5;
  else if (maxOverdueDays <= 30) weight = 8;
  else if (maxOverdueDays <= 60) weight = 12;
  else if (maxOverdueDays <= 90) weight = 16;
  else weight = 20;

  return {
    name: 'Overdue severity',
    weight,
    value: maxOverdueDays <= 0 ? 'No overdue' : `${maxOverdueDays} days overdue`,
    severity: severityForWeight(weight),
  };
}

function computeGradeFactor(grade: string): RiskFactor {
  let weight: number;
  switch (grade.toUpperCase()) {
    case 'A': weight = 0; break;
    case 'B': weight = 5; break;
    case 'C': weight = 12; break;
    default: weight = 20; break;
  }

  return {
    name: 'Grade factor',
    weight,
    value: `Grade ${grade}`,
    severity: severityForWeight(weight),
  };
}

function computeConcentrationFactor(
  partyOutstanding: bigint,
  totalAR: bigint,
): RiskFactor {
  if (totalAR <= 0n) {
    return {
      name: 'Concentration risk',
      weight: 0,
      value: 'No AR exposure',
      severity: 'low',
    };
  }

  const pct = Number(partyOutstanding * 10000n / totalAR) / 100;
  let weight: number;
  if (pct < 10) weight = 0;
  else if (pct <= 25) weight = 5;
  else if (pct <= 50) weight = 10;
  else if (pct <= 75) weight = 15;
  else weight = 20;

  return {
    name: 'Concentration risk',
    weight,
    value: `${pct.toFixed(1)}% of total AR`,
    severity: severityForWeight(weight),
  };
}

export function generateRecommendation(score: CustomerRiskScore): string {
  switch (score.tier) {
    case 'low':
      return 'Continue standard terms. Review at next quarterly assessment.';
    case 'medium':
      return 'Monitor payment patterns. Consider reducing credit limit if trend continues.';
    case 'high':
      return 'Restrict new orders. Initiate formal payment chase. Review grade downgrade.';
    case 'critical':
      return 'Block new credit. Escalate to management. Consider legal action for overdue amounts.';
  }
}

function computePartyOutstanding(
  partyEvents: RiskMoneyEvent[],
): bigint {
  let invoiced = 0n;
  let paid = 0n;
  for (const ev of partyEvents) {
    const tag = ev.kind.tag;
    if (tag === 'CustomerInvoice') {
      invoiced += ev.totalFils;
    } else if (tag === 'CustomerPayment' || tag === 'CustomerReceipt') {
      paid += ev.totalFils;
    }
  }
  const outstanding = invoiced - paid;
  return outstanding > 0n ? outstanding : 0n;
}

function computeAvgDaysToPayment(
  partyEvents: RiskMoneyEvent[],
  paymentTermsDays: number,
): number {
  const invoices = partyEvents.filter(e => e.kind.tag === 'CustomerInvoice');
  const payments = partyEvents.filter(
    e => e.kind.tag === 'CustomerPayment' || e.kind.tag === 'CustomerReceipt',
  );

  if (payments.length === 0) {
    // No payment history: use payment terms as fallback (assume they'd pay at limit)
    return invoices.length > 0 ? paymentTermsDays : 0;
  }

  // Sort both by creation date
  const sortedInvoices = [...invoices].sort(
    (a, b) => Number(a.createdAt.microsSinceUnixEpoch - b.createdAt.microsSinceUnixEpoch),
  );
  const sortedPayments = [...payments].sort(
    (a, b) => Number(a.createdAt.microsSinceUnixEpoch - b.createdAt.microsSinceUnixEpoch),
  );

  // Match payments to invoices in order; compute days between invoice creation and payment
  let totalDays = 0;
  const count = Math.min(sortedInvoices.length, sortedPayments.length);
  for (let i = 0; i < count; i++) {
    const invMicros = sortedInvoices[i].createdAt.microsSinceUnixEpoch;
    const payMicros = sortedPayments[i].createdAt.microsSinceUnixEpoch;
    const diffMicros = payMicros - invMicros;
    totalDays += diffMicros > 0n ? microsToDay(diffMicros) : 0;
  }

  return count > 0 ? totalDays / count : 0;
}

function computeMaxOverdueDays(
  partyEvents: RiskMoneyEvent[],
  nowMicros: bigint,
): number {
  let maxOverdue = 0;
  const invoices = partyEvents.filter(e => e.kind.tag === 'CustomerInvoice');
  const payments = partyEvents.filter(
    e => e.kind.tag === 'CustomerPayment' || e.kind.tag === 'CustomerReceipt',
  );

  // Total paid amount
  let totalPaid = 0n;
  for (const p of payments) totalPaid += p.totalFils;

  // Sort invoices oldest first, consume payments FIFO
  const sortedInvoices = [...invoices].sort(
    (a, b) => Number(a.createdAt.microsSinceUnixEpoch - b.createdAt.microsSinceUnixEpoch),
  );

  let remainingPaid = totalPaid;
  for (const inv of sortedInvoices) {
    if (remainingPaid >= inv.totalFils) {
      remainingPaid -= inv.totalFils;
      continue; // fully paid
    }
    // Partially or fully unpaid — check if overdue
    remainingPaid = 0n;
    if (inv.dueDate) {
      const dueMicros = inv.dueDate.microsSinceUnixEpoch;
      if (nowMicros > dueMicros) {
        const overdueDays = microsToDay(nowMicros - dueMicros);
        if (overdueDays > maxOverdue) maxOverdue = overdueDays;
      }
    }
  }

  return maxOverdue;
}

function computeTotalAR(
  parties: RiskParty[],
  eventsByParty: Map<bigint, RiskMoneyEvent[]>,
): bigint {
  let total = 0n;
  for (const p of parties) {
    if (!p.isCustomer) continue;
    const events = eventsByParty.get(p.id) ?? [];
    total += computePartyOutstanding(events);
  }
  return total;
}

export function scoreCustomerRisk(
  party: RiskParty,
  moneyEvents: RiskMoneyEvent[],
  nowMicros: bigint,
  totalAR?: bigint,
): CustomerRiskScore {
  const partyEvents = moneyEvents.filter(e => e.partyId === party.id);
  const paymentTermsDays = toNumber(party.paymentTermsDays);
  const outstandingFils = computePartyOutstanding(partyEvents);

  // If totalAR not provided, compute from this party's events alone (single-customer call)
  const effectiveTotalAR = totalAR ?? outstandingFils;

  const avgDaysToPayment = computeAvgDaysToPayment(partyEvents, paymentTermsDays);
  const avgDaysLate = avgDaysToPayment - paymentTermsDays;
  const maxOverdueDays = computeMaxOverdueDays(partyEvents, nowMicros);

  const paymentFactor = computePaymentBehaviorFactor(avgDaysLate);
  const { factor: creditFactor, pct: creditUtilizationPct } = computeCreditUtilizationFactor(
    outstandingFils,
    party.creditLimitFils,
  );
  const overdueFactor = computeOverdueSeverityFactor(maxOverdueDays);
  const gradeFactor = computeGradeFactor(party.grade.tag);
  const concentrationFactor = computeConcentrationFactor(outstandingFils, effectiveTotalAR);

  const factors: RiskFactor[] = [
    paymentFactor,
    creditFactor,
    overdueFactor,
    gradeFactor,
    concentrationFactor,
  ];

  const riskScore = Math.min(
    100,
    Math.max(0, factors.reduce((sum, f) => sum + f.weight, 0)),
  );

  const tier = scoreToTier(riskScore);

  const partial: CustomerRiskScore = {
    partyId: party.id,
    name: party.name,
    grade: party.grade.tag,
    riskScore,
    tier,
    factors,
    outstandingFils,
    creditUtilizationPct,
    avgDaysToPayment,
    maxOverdueDays,
    recommendation: '', // placeholder
  };

  partial.recommendation = generateRecommendation(partial);
  return partial;
}

export function evaluatePortfolioRisk(
  parties: RiskParty[],
  moneyEvents: RiskMoneyEvent[],
  nowMicros: bigint,
): RiskPortfolioSummary {
  const customers = parties.filter(p => p.isCustomer);

  // Group events by party
  const eventsByParty = new Map<bigint, RiskMoneyEvent[]>();
  for (const ev of moneyEvents) {
    let list = eventsByParty.get(ev.partyId);
    if (!list) {
      list = [];
      eventsByParty.set(ev.partyId, list);
    }
    list.push(ev);
  }

  const totalAR = computeTotalAR(customers, eventsByParty);

  const scores: CustomerRiskScore[] = customers.map(p =>
    scoreCustomerRisk(p, moneyEvents, nowMicros, totalAR),
  );

  const byTier: Record<RiskTier, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  let totalScore = 0;
  let highRiskExposureFils = 0n;

  for (const s of scores) {
    byTier[s.tier]++;
    totalScore += s.riskScore;
    if (s.tier === 'high' || s.tier === 'critical') {
      highRiskExposureFils += s.outstandingFils;
    }
  }

  // Top risks: sorted by riskScore descending, take top 5
  const topRisks = [...scores]
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 5);

  return {
    totalCustomers: customers.length,
    byTier,
    totalExposureFils: totalAR,
    highRiskExposureFils,
    averageRiskScore: customers.length > 0 ? totalScore / customers.length : 0,
    topRisks,
  };
}
