import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  collectionProbability,
  computeCashForecast,
  computeCashPosition,
} from './cashPosition';
import type {
  CashBankTransaction,
  CashMoneyEvent,
  CashParty,
} from './cashPosition';

function ts(iso: string) {
  return { microsSinceUnixEpoch: BigInt(Date.parse(iso)) * 1000n };
}

// ─── Helpers to build test data ────────────────────────────────────────────

function customerInvoice(partyId: bigint, totalFils: bigint, dueIso: string, createdIso: string): CashMoneyEvent {
  return {
    partyId,
    kind: { tag: 'CustomerInvoice' },
    totalFils,
    dueDate: ts(dueIso),
    createdAt: ts(createdIso),
  };
}

function customerPayment(partyId: bigint, totalFils: bigint, createdIso: string): CashMoneyEvent {
  return {
    partyId,
    kind: { tag: 'CustomerPayment' },
    totalFils,
    createdAt: ts(createdIso),
  };
}

function supplierInvoice(partyId: bigint, totalFils: bigint, dueIso: string, createdIso: string): CashMoneyEvent {
  return {
    partyId,
    kind: { tag: 'SupplierInvoice' },
    totalFils,
    dueDate: ts(dueIso),
    createdAt: ts(createdIso),
  };
}

function supplierPayment(partyId: bigint, totalFils: bigint, createdIso: string): CashMoneyEvent {
  return {
    partyId,
    kind: { tag: 'SupplierPayment' },
    totalFils,
    createdAt: ts(createdIso),
  };
}

function matchedBankTxn(amountFils: bigint, isCredit: boolean): CashBankTransaction {
  return { amountFils, matchStatus: { tag: 'Matched' }, isCredit };
}

function unmatchedBankTxn(amountFils: bigint, isCredit: boolean): CashBankTransaction {
  return { amountFils, matchStatus: { tag: 'Unmatched' }, isCredit };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('computeCashPosition', () => {
  it('returns zeros and null bank balance for empty state', () => {
    const snapshot = computeCashPosition([], []);

    assert.equal(snapshot.netCashFils, 0n);
    assert.equal(snapshot.totalCustomerPaymentsFils, 0n);
    assert.equal(snapshot.totalSupplierPaymentsFils, 0n);
    assert.equal(snapshot.reconciledBankBalanceFils, null);
    assert.equal(snapshot.unreconciledDifferenceFils, null);
    assert.equal(snapshot.totalReceivablesFils, 0n);
    assert.equal(snapshot.totalPayablesFils, 0n);
    assert.equal(snapshot.netWorkingCapitalFils, 0n);
  });

  it('computes correct net cash from customer and supplier payments', () => {
    const events: CashMoneyEvent[] = [
      customerPayment(1n, 5_000_000n, '2026-03-01T00:00:00Z'),
      customerPayment(2n, 3_000_000n, '2026-03-05T00:00:00Z'),
      supplierPayment(3n, 2_000_000n, '2026-03-02T00:00:00Z'),
      supplierPayment(4n, 1_500_000n, '2026-03-06T00:00:00Z'),
    ];

    const snapshot = computeCashPosition(events, []);

    assert.equal(snapshot.totalCustomerPaymentsFils, 8_000_000n);
    assert.equal(snapshot.totalSupplierPaymentsFils, 3_500_000n);
    assert.equal(snapshot.netCashFils, 4_500_000n);
  });

  it('computes outstanding receivables and payables from invoices minus payments', () => {
    const events: CashMoneyEvent[] = [
      customerInvoice(1n, 10_000_000n, '2026-04-01T00:00:00Z', '2026-03-01T00:00:00Z'),
      customerPayment(1n, 3_000_000n, '2026-03-10T00:00:00Z'),
      supplierInvoice(2n, 6_000_000n, '2026-04-15T00:00:00Z', '2026-03-01T00:00:00Z'),
      supplierPayment(2n, 1_000_000n, '2026-03-10T00:00:00Z'),
    ];

    const snapshot = computeCashPosition(events, []);

    // Receivables: 10M invoiced - 3M paid = 7M
    assert.equal(snapshot.totalReceivablesFils, 7_000_000n);
    // Payables: 6M invoiced - 1M paid = 5M
    assert.equal(snapshot.totalPayablesFils, 5_000_000n);
    // Working capital: 7M - 5M = 2M
    assert.equal(snapshot.netWorkingCapitalFils, 2_000_000n);
  });

  it('floors receivables and payables at zero when overpaid', () => {
    const events: CashMoneyEvent[] = [
      customerInvoice(1n, 1_000_000n, '2026-04-01T00:00:00Z', '2026-03-01T00:00:00Z'),
      customerPayment(1n, 2_000_000n, '2026-03-10T00:00:00Z'),
    ];

    const snapshot = computeCashPosition(events, []);
    assert.equal(snapshot.totalReceivablesFils, 0n);
  });

  it('computes reconciled bank balance from matched transactions', () => {
    const bankTxns: CashBankTransaction[] = [
      matchedBankTxn(5_000_000n, true),   // credit +5M
      matchedBankTxn(2_000_000n, false),   // debit -2M
      matchedBankTxn(1_000_000n, true),    // credit +1M
      unmatchedBankTxn(500_000n, true),    // unmatched — excluded
    ];

    const events: CashMoneyEvent[] = [
      customerPayment(1n, 6_000_000n, '2026-03-01T00:00:00Z'),
      supplierPayment(2n, 2_000_000n, '2026-03-02T00:00:00Z'),
    ];

    const snapshot = computeCashPosition(events, bankTxns);

    // Matched bank balance: +5M - 2M + 1M = 4M
    assert.equal(snapshot.reconciledBankBalanceFils, 4_000_000n);
    // Net cash: 6M - 2M = 4M; unreconciled = 4M - 4M = 0
    assert.equal(snapshot.netCashFils, 4_000_000n);
    assert.equal(snapshot.unreconciledDifferenceFils, 0n);
  });

  it('returns non-zero unreconciled difference when bank and book differ', () => {
    const bankTxns: CashBankTransaction[] = [
      matchedBankTxn(3_000_000n, true),
    ];

    const events: CashMoneyEvent[] = [
      customerPayment(1n, 5_000_000n, '2026-03-01T00:00:00Z'),
    ];

    const snapshot = computeCashPosition(events, bankTxns);

    assert.equal(snapshot.netCashFils, 5_000_000n);
    assert.equal(snapshot.reconciledBankBalanceFils, 3_000_000n);
    assert.equal(snapshot.unreconciledDifferenceFils, 2_000_000n);
  });
});

describe('collectionProbability', () => {
  it('returns correct rates for Grade A at various overdue levels', () => {
    assert.equal(collectionProbability('A', 15), 0.95);   // not overdue
    assert.equal(collectionProbability('A', 0), 0.95);    // due today
    assert.equal(collectionProbability('A', -1), 0.95);   // 1 day overdue (<=30)
    assert.equal(collectionProbability('A', -30), 0.95);  // exactly 30 days overdue
    assert.equal(collectionProbability('A', -31), 0.80);  // 31 days overdue
    assert.equal(collectionProbability('A', -90), 0.80);  // 90 days overdue
    assert.equal(collectionProbability('A', -91), 0.60);  // 91 days overdue
  });

  it('returns correct rates for Grade B at various overdue levels', () => {
    assert.equal(collectionProbability('B', 10), 0.85);
    assert.equal(collectionProbability('B', -31), 0.65);
    assert.equal(collectionProbability('B', -91), 0.40);
  });

  it('returns correct rates for Grade C', () => {
    assert.equal(collectionProbability('C', 5), 0.50);
    assert.equal(collectionProbability('C', -31), 0.30);
  });

  it('returns correct rates for Grade D', () => {
    assert.equal(collectionProbability('D', 5), 0.20);
    assert.equal(collectionProbability('D', -1), 0.10);
  });

  it('returns 0.50 for unknown grades', () => {
    assert.equal(collectionProbability('X', 10), 0.50);
    assert.equal(collectionProbability('', 10), 0.50);
  });
});

describe('computeCashForecast', () => {
  const nowMicros = ts('2026-03-15T00:00:00Z').microsSinceUnixEpoch;

  it('returns empty forecast for no data with default burn rate', () => {
    const forecast = computeCashForecast([], [], [], nowMicros);

    assert.equal(forecast.currentPosition.netCashFils, 0n);
    assert.equal(forecast.buckets.length, 3);
    assert.equal(forecast.buckets[0].horizonDays, 30);
    assert.equal(forecast.buckets[1].horizonDays, 60);
    assert.equal(forecast.buckets[2].horizonDays, 90);
    assert.equal(forecast.buckets[0].expectedInflowsFils, 0n);
    assert.equal(forecast.buckets[0].expectedOutflowsFils, 0n);
    assert.equal(forecast.buckets[0].projectedCashFils, 0n);
    assert.equal(forecast.monthlyBurnFils, 4_500_000n);
    assert.equal(forecast.runwayDays, 0); // zero cash, positive burn = 0
  });

  it('computes 30/60/90 day projections with known events', () => {
    const parties: CashParty[] = [
      { id: 1n, isCustomer: true, isSupplier: false, grade: { tag: 'A' }, paymentTermsDays: 30 },
      { id: 10n, isCustomer: true, isSupplier: false, grade: { tag: 'A' }, paymentTermsDays: 30 },
      { id: 2n, isCustomer: false, isSupplier: true, grade: { tag: 'C' }, paymentTermsDays: 30 },
    ];

    const events: CashMoneyEvent[] = [
      // Cash from a different customer (party 10) so it doesn't pay off party 1's invoice
      customerPayment(10n, 10_000_000n, '2026-03-01T00:00:00Z'),
      supplierPayment(2n, 3_000_000n, '2026-03-01T00:00:00Z'),

      // Outstanding customer invoice for party 1, due in 20 days (within 30-day horizon)
      // No payments against party 1, so fully outstanding
      // Grade A, not overdue => 95% probability
      customerInvoice(1n, 2_000_000n, '2026-04-04T00:00:00Z', '2026-03-05T00:00:00Z'),

      // Outstanding supplier invoice (5M) for party 2, only 3M paid => 2M outstanding
      // Due in 25 days (within 30-day horizon)
      supplierInvoice(2n, 5_000_000n, '2026-04-09T00:00:00Z', '2026-03-10T00:00:00Z'),
    ];

    const forecast = computeCashForecast(events, parties, [], nowMicros);

    // Net cash: 10M customer - 3M supplier = 7M
    assert.equal(forecast.currentPosition.netCashFils, 7_000_000n);

    // 30-day bucket:
    // Inflow: 2M * 0.95 = 1,900,000 fils
    // Outflow: 5M invoiced - 3M paid = 2M outstanding
    // Projected: 7M + 1.9M - 2M = 6,900,000
    assert.equal(forecast.buckets[0].expectedInflowsFils, 1_900_000n);
    assert.equal(forecast.buckets[0].expectedOutflowsFils, 2_000_000n);
    assert.equal(forecast.buckets[0].projectedCashFils, 6_900_000n);

    // 60 and 90 day buckets include the same invoices (all due within 30 days)
    assert.equal(forecast.buckets[1].expectedInflowsFils, 1_900_000n);
    assert.equal(forecast.buckets[2].expectedInflowsFils, 1_900_000n);
  });

  it('excludes paid invoices from forecast projections', () => {
    const parties: CashParty[] = [
      { id: 1n, isCustomer: true, isSupplier: false, grade: { tag: 'A' }, paymentTermsDays: 30 },
    ];

    const events: CashMoneyEvent[] = [
      customerInvoice(1n, 5_000_000n, '2026-04-01T00:00:00Z', '2026-03-01T00:00:00Z'),
      customerPayment(1n, 5_000_000n, '2026-03-10T00:00:00Z'),
    ];

    const forecast = computeCashForecast(events, parties, [], nowMicros);

    // Invoice fully paid — no expected inflows
    assert.equal(forecast.buckets[0].expectedInflowsFils, 0n);
    // Net cash = 5M payment - 0 supplier = 5M
    assert.equal(forecast.currentPosition.netCashFils, 5_000_000n);
  });

  it('weights overdue customer invoices with lower probability', () => {
    const parties: CashParty[] = [
      { id: 1n, isCustomer: true, isSupplier: false, grade: { tag: 'B' }, paymentTermsDays: 30 },
    ];

    // Invoice due 2026-02-01, now is 2026-03-15 => ~42 days overdue => Grade B >30 days overdue = 65%
    const events: CashMoneyEvent[] = [
      customerInvoice(1n, 1_000_000n, '2026-02-01T00:00:00Z', '2026-01-01T00:00:00Z'),
    ];

    const forecast = computeCashForecast(events, parties, [], nowMicros);

    // Due date is in the past (< nowMicros), so it falls within all horizons
    // Grade B, ~42 days overdue => 65%
    // 1M * 0.65 = 650,000
    assert.equal(forecast.buckets[0].expectedInflowsFils, 650_000n);
  });

  it('computes monthly burn rate from last 3 months of supplier payments', () => {
    const parties: CashParty[] = [];

    // Supplier payments across 3 months before the current month (March 2026)
    const events: CashMoneyEvent[] = [
      supplierPayment(1n, 3_000_000n, '2025-12-15T00:00:00Z'), // Dec: 3M
      supplierPayment(1n, 4_000_000n, '2026-01-15T00:00:00Z'), // Jan: 4M
      supplierPayment(1n, 5_000_000n, '2026-02-15T00:00:00Z'), // Feb: 5M
      supplierPayment(1n, 1_000_000n, '2026-03-10T00:00:00Z'), // Current month — excluded
    ];

    const forecast = computeCashForecast(events, parties, [], nowMicros);

    // Average of Dec+Jan+Feb: (3M + 4M + 5M) / 3 = 4M
    assert.equal(forecast.monthlyBurnFils, 4_000_000n);
  });

  it('computes cash runway from position and burn rate', () => {
    const parties: CashParty[] = [];

    // Net cash: 15M customer payments - 6M supplier payments = 9M
    // Burn rate from prior months: Jan=3M, Feb=3M => average 3M/month
    const events: CashMoneyEvent[] = [
      customerPayment(1n, 15_000_000n, '2026-03-01T00:00:00Z'),
      supplierPayment(2n, 3_000_000n, '2026-01-15T00:00:00Z'),
      supplierPayment(2n, 3_000_000n, '2026-02-15T00:00:00Z'),
    ];

    const forecast = computeCashForecast(events, parties, [], nowMicros);

    assert.equal(forecast.monthlyBurnFils, 3_000_000n);
    // Net cash: 15M - 6M = 9M
    assert.equal(forecast.currentPosition.netCashFils, 9_000_000n);
    // Daily burn: 3M / 30 = 100,000 fils/day
    // Runway: 9M / 100,000 = 90 days
    assert.equal(forecast.runwayDays, 90);
  });

  it('returns runway 0 when cash position is negative', () => {
    const parties: CashParty[] = [];

    const events: CashMoneyEvent[] = [
      supplierPayment(1n, 5_000_000n, '2026-02-15T00:00:00Z'),
    ];

    const forecast = computeCashForecast(events, parties, [], nowMicros);

    // Net cash: 0 - 5M = -5M
    assert.equal(forecast.currentPosition.netCashFils, -5_000_000n);
    assert.equal(forecast.runwayDays, 0);
  });

  it('uses default burn rate when no supplier payment history exists', () => {
    const parties: CashParty[] = [];
    const events: CashMoneyEvent[] = [
      customerPayment(1n, 10_000_000n, '2026-03-01T00:00:00Z'),
    ];

    const forecast = computeCashForecast(events, parties, [], nowMicros);

    assert.equal(forecast.monthlyBurnFils, 4_500_000n);
    // Runway: 10M / (4.5M/30) = 10M / 150,000 = 66 days
    assert.equal(forecast.runwayDays, 66);
  });
});
