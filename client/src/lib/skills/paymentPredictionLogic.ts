import { suggestGrade } from '../business/invariants';
import type { MoneyEvent, Party } from '../db';

const DAY_MS = 86_400_000;
const GRADE_RANK: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };

type TimestampLike = { microsSinceUnixEpoch: bigint } | null | undefined;

interface SettledInvoiceSample {
  invoiceId: bigint;
  settledAtMs: number;
  settledDays: number;
  onTime: boolean;
}

interface TargetInvoiceProjection {
  invoiceId: bigint;
  reference: string;
  issueDateIso: string;
  estimatedPaymentDateIso: string;
  estimatedDaysFromToday: number;
  isOverdueToday: boolean;
}

export interface PaymentPredictionSnapshot {
  customerId: string;
  customerName: string;
  currentGrade: string;
  suggestedGrade: string;
  confidence: string;
  confidenceScore: number;
  estimatedDays: number;
  historicalAverageDays: number;
  basedOnInvoices: number;
  paymentTermsDays: number;
  onTimeRatio: number;
  reason: string;
  riskFactors: string[];
  targetInvoice?: TargetInvoiceProjection;
}

function toMs(ts: TimestampLike): number {
  if (!ts) return 0;
  return Number(ts.microsSinceUnixEpoch / 1000n);
}

function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function isCustomerInvoice(event: MoneyEvent): boolean {
  return (event.kind as { tag?: string } | null)?.tag === 'CustomerInvoice';
}

function isCustomerPayment(event: MoneyEvent): boolean {
  return (event.kind as { tag?: string } | null)?.tag === 'CustomerPayment';
}

function gradeBaselineDays(grade: string): number {
  switch (grade) {
    case 'A':
      return 45;
    case 'B':
      return 90;
    case 'C':
      return 120;
    default:
      return 180;
  }
}

function confidenceScore(label: string, sampleCount: number): number {
  const base = label === 'high' ? 0.85 : label === 'medium' ? 0.68 : 0.45;
  const historyBoost = Math.min(0.1, sampleCount * 0.01);
  return Math.min(0.95, Number((base + historyBoost).toFixed(2)));
}

function buildSettledInvoiceSamples(events: MoneyEvent[]): SettledInvoiceSample[] {
  const invoices = events
    .filter(isCustomerInvoice)
    .map((event) => ({
      invoiceId: event.id,
      issuedAtMs: toMs(event.createdAt),
      dueAtMs: toMs(event.dueDate),
      remainingFils: event.totalFils,
    }))
    .sort((left, right) => left.issuedAtMs - right.issuedAtMs);

  const payments = events
    .filter(isCustomerPayment)
    .map((event) => ({
      appliedAtMs: toMs(event.paidAt) || toMs(event.createdAt),
      totalFils: event.totalFils,
    }))
    .sort((left, right) => left.appliedAtMs - right.appliedAtMs);

  const openInvoices = invoices.map((invoice) => ({ ...invoice }));
  const samples: SettledInvoiceSample[] = [];

  for (const payment of payments) {
    let remainingPayment = payment.totalFils;
    while (remainingPayment > 0n && openInvoices.length > 0) {
      const current = openInvoices[0];
      const applied = remainingPayment < current.remainingFils ? remainingPayment : current.remainingFils;
      current.remainingFils -= applied;
      remainingPayment -= applied;
      if (current.remainingFils === 0n) {
        const settledDays = Math.max(0, Math.round((payment.appliedAtMs - current.issuedAtMs) / DAY_MS));
        const onTime = current.dueAtMs > 0 ? payment.appliedAtMs <= current.dueAtMs : true;
        samples.push({
          invoiceId: current.invoiceId,
          settledAtMs: payment.appliedAtMs,
          settledDays,
          onTime,
        });
        openInvoices.shift();
      }
    }
  }

  return samples;
}

export function buildPaymentPredictionSnapshot(input: {
  customer: Party;
  moneyEvents: MoneyEvent[];
  nowMicros: bigint;
  invoiceId?: bigint;
}): PaymentPredictionSnapshot {
  const nowMs = Number(input.nowMicros / 1000n);
  const customerEvents = input.moneyEvents
    .filter((event) => event.partyId === input.customer.id)
    .sort((left, right) => toMs(left.createdAt) - toMs(right.createdAt));

  const targetInvoice =
    input.invoiceId == null
      ? undefined
      : customerEvents.find((event) => event.id === input.invoiceId && isCustomerInvoice(event));

  const settledSamples = buildSettledInvoiceSamples(customerEvents).filter(
    (sample) => sample.invoiceId !== input.invoiceId,
  );

  const paymentTermsDays =
    input.customer.paymentTermsDays != null && input.customer.paymentTermsDays > 0n
      ? Number(input.customer.paymentTermsDays)
      : 30;
  const historicalAverageDays =
    settledSamples.length === 0
      ? paymentTermsDays
      : Math.round(
          settledSamples.reduce((sum, sample) => sum + sample.settledDays, 0) / settledSamples.length,
        );
  const onTimeRatio =
    settledSamples.length === 0
      ? 0.5
      : settledSamples.filter((sample) => sample.onTime).length / settledSamples.length;

  const suggested = suggestGrade(historicalAverageDays, onTimeRatio, settledSamples.length);
  const baselineDays = gradeBaselineDays(suggested.suggestedGrade);
  const estimatedDays =
    settledSamples.length === 0
      ? paymentTermsDays
      : settledSamples.length < 3
        ? Math.round((historicalAverageDays * 2 + baselineDays) / 3)
        : Math.round((historicalAverageDays * 3 + baselineDays) / 4);

  const riskFactors: string[] = [];
  if (settledSamples.length === 0) {
    riskFactors.push('Limited payment history; using customer payment terms as baseline.');
  }
  if (onTimeRatio < 0.7) {
    riskFactors.push('Customer often settles after the agreed due date.');
  }
  if (historicalAverageDays > paymentTermsDays) {
    riskFactors.push(
      `Historical settlement runs about ${historicalAverageDays - paymentTermsDays} day(s) slower than agreed terms.`,
    );
  }
  const currentGradeTag = (input.customer.grade as { tag?: string } | null)?.tag ?? 'C';
  const currentRank = GRADE_RANK[currentGradeTag] ?? 2;
  const suggestedRank = GRADE_RANK[suggested.suggestedGrade] ?? 2;
  if (suggestedRank > currentRank) {
    riskFactors.push('Predicted payment behaviour is weaker than the current assigned grade.');
  }

  const snapshot: PaymentPredictionSnapshot = {
    customerId: String(input.customer.id),
    customerName: input.customer.name,
    currentGrade: currentGradeTag,
    suggestedGrade: suggested.suggestedGrade,
    confidence: suggested.confidence,
    confidenceScore: confidenceScore(suggested.confidence, settledSamples.length),
    estimatedDays,
    historicalAverageDays,
    basedOnInvoices: settledSamples.length,
    paymentTermsDays,
    onTimeRatio: Number(onTimeRatio.toFixed(2)),
    reason: suggested.reason,
    riskFactors,
  };

  if (targetInvoice) {
    const issueMs = toMs(targetInvoice.createdAt);
    const projectedMs = issueMs + estimatedDays * DAY_MS;
    const daysFromToday = Math.max(0, Math.ceil((projectedMs - nowMs) / DAY_MS));
    snapshot.targetInvoice = {
      invoiceId: targetInvoice.id,
      reference: targetInvoice.reference,
      issueDateIso: toIsoDate(issueMs),
      estimatedPaymentDateIso: toIsoDate(projectedMs),
      estimatedDaysFromToday: daysFromToday,
      isOverdueToday: toMs(targetInvoice.dueDate) > 0 && toMs(targetInvoice.dueDate) < nowMs,
    };
  }

  return snapshot;
}
