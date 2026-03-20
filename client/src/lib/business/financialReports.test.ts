import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateSalesReport,
  generateCollectionsReport,
  generatePayablesReport,
  formatSalesReport,
  formatCollectionsReport,
} from './financialReports';
import type {
  ReportMoneyEvent,
  ReportParty,
  ReportPipeline,
  ReportPeriod,
} from './financialReports';

// ─── Helpers ──────────────────────────────────────────────────────────────

let nextId = 1n;

function ts(iso: string) {
  return { microsSinceUnixEpoch: BigInt(Date.parse(iso)) * 1000n };
}

function makeEvent(
  partyId: bigint,
  tag: string,
  totalFils: bigint,
  createdIso: string,
  opts?: { reference?: string; dueIso?: string },
): ReportMoneyEvent {
  return {
    id: nextId++,
    partyId,
    kind: { tag },
    subtotalFils: totalFils,
    totalFils,
    reference: opts?.reference ?? `REF-${nextId}`,
    dueDate: opts?.dueIso ? ts(opts.dueIso) : undefined,
    createdAt: ts(createdIso),
  };
}

function makeParty(
  id: bigint,
  name: string,
  opts: { isCustomer?: boolean; isSupplier?: boolean; grade?: string } = {},
): ReportParty {
  return {
    id,
    name,
    isCustomer: opts.isCustomer ?? false,
    isSupplier: opts.isSupplier ?? false,
    grade: { tag: opts.grade ?? 'A' },
  };
}

function makePipeline(
  partyId: bigint,
  status: string,
  valueFils: bigint,
  winBps: number,
): ReportPipeline {
  return {
    id: nextId++,
    partyId,
    title: `Deal-${nextId}`,
    status: { tag: status },
    estimatedValueFils: valueFils,
    winProbabilityBps: winBps,
    createdAt: ts('2026-02-01'),
  };
}

const Q1_2026: ReportPeriod = {
  startDate: '2026-01-01',
  endDate: '2026-03-31',
  label: 'Q1 2026',
};

// ─── generateSalesReport ──────────────────────────────────────────────────

describe('generateSalesReport', () => {
  it('empty period returns zero values', () => {
    const report = generateSalesReport(Q1_2026, [], [], []);
    assert.equal(report.totalRevenueFils, 0n);
    assert.equal(report.invoiceCount, 0);
    assert.equal(report.averageInvoiceFils, 0n);
    assert.equal(report.topCustomers.length, 0);
    assert.equal(report.pipelineSummary.activeDeals, 0);
    assert.equal(report.pipelineSummary.winRate, 0);
    assert.equal(report.monthlyBreakdown.length, 0);
  });

  it('computes correct revenue and top customers from known events', () => {
    const c1 = makeParty(1n, 'EWA', { isCustomer: true, grade: 'A' });
    const c2 = makeParty(2n, 'BAPCO', { isCustomer: true, grade: 'B' });

    const events: ReportMoneyEvent[] = [
      makeEvent(1n, 'CustomerInvoice', 10_000_000n, '2026-01-15'),
      makeEvent(1n, 'CustomerInvoice', 8_000_000n, '2026-02-10'),
      makeEvent(2n, 'CustomerInvoice', 5_000_000n, '2026-01-20'),
      // Outside period — should be excluded
      makeEvent(2n, 'CustomerInvoice', 99_000_000n, '2025-12-31'),
      // Payment — not an invoice, should be excluded from revenue
      makeEvent(1n, 'CustomerPayment', 10_000_000n, '2026-02-15'),
    ];

    const report = generateSalesReport(Q1_2026, events, [c1, c2], []);

    assert.equal(report.totalRevenueFils, 23_000_000n);
    assert.equal(report.invoiceCount, 3);
    assert.equal(report.averageInvoiceFils, 23_000_000n / 3n);

    assert.equal(report.topCustomers.length, 2);
    assert.equal(report.topCustomers[0].name, 'EWA');
    assert.equal(report.topCustomers[0].revenueFils, 18_000_000n);
    assert.equal(report.topCustomers[0].invoiceCount, 2);
    assert.equal(report.topCustomers[1].name, 'BAPCO');
    assert.equal(report.topCustomers[1].revenueFils, 5_000_000n);
  });

  it('computes pipeline summary with mixed statuses', () => {
    const pipelines: ReportPipeline[] = [
      makePipeline(1n, 'Active', 20_000_000n, 5000),
      makePipeline(1n, 'InProgress', 10_000_000n, 8000),
      makePipeline(2n, 'Terminal', 15_000_000n, 10000),
      makePipeline(2n, 'Terminal', 12_000_000n, 10000),
      makePipeline(3n, 'Cancelled', 8_000_000n, 0),
    ];

    const report = generateSalesReport(Q1_2026, [], [], pipelines);
    const ps = report.pipelineSummary;

    assert.equal(ps.activeDeals, 2);
    assert.equal(ps.totalValueFils, 30_000_000n);
    // weighted: 20M * 0.5 + 10M * 0.8 = 10M + 8M = 18M
    assert.equal(ps.weightedValueFils, 18_000_000n);
    assert.equal(ps.wonDeals, 2);
    assert.equal(ps.lostDeals, 1);
    // winRate = 2/(2+1)*100 = 66.66...
    assert.ok(ps.winRate > 66.6 && ps.winRate < 66.7);
  });

  it('groups monthly breakdown correctly', () => {
    const events: ReportMoneyEvent[] = [
      makeEvent(1n, 'CustomerInvoice', 5_000_000n, '2026-01-05'),
      makeEvent(1n, 'CustomerInvoice', 3_000_000n, '2026-01-25'),
      makeEvent(1n, 'CustomerInvoice', 7_000_000n, '2026-02-15'),
      makeEvent(1n, 'CustomerInvoice', 4_000_000n, '2026-03-10'),
    ];

    const report = generateSalesReport(Q1_2026, events, [], []);

    assert.equal(report.monthlyBreakdown.length, 3);
    assert.equal(report.monthlyBreakdown[0].month, '2026-01');
    assert.equal(report.monthlyBreakdown[0].revenueFils, 8_000_000n);
    assert.equal(report.monthlyBreakdown[0].invoiceCount, 2);
    assert.equal(report.monthlyBreakdown[1].month, '2026-02');
    assert.equal(report.monthlyBreakdown[1].revenueFils, 7_000_000n);
    assert.equal(report.monthlyBreakdown[2].month, '2026-03');
    assert.equal(report.monthlyBreakdown[2].revenueFils, 4_000_000n);
  });
});

// ─── generateCollectionsReport ────────────────────────────────────────────

describe('generateCollectionsReport', () => {
  it('computes correct collection rate and grade breakdown', () => {
    const c1 = makeParty(10n, 'ALBA', { isCustomer: true, grade: 'A' });
    const c2 = makeParty(11n, 'GPIC', { isCustomer: true, grade: 'B' });

    const events: ReportMoneyEvent[] = [
      // ALBA: invoiced 20k, paid 15k
      makeEvent(10n, 'CustomerInvoice', 20_000_000n, '2026-01-10'),
      makeEvent(10n, 'CustomerPayment', 15_000_000n, '2026-02-10'),
      // GPIC: invoiced 10k, paid 10k
      makeEvent(11n, 'CustomerInvoice', 10_000_000n, '2026-01-15'),
      makeEvent(11n, 'CustomerPayment', 10_000_000n, '2026-02-15'),
    ];

    const report = generateCollectionsReport(Q1_2026, events, [c1, c2]);

    assert.equal(report.totalCollectedFils, 25_000_000n);
    assert.equal(report.paymentCount, 2);
    // collection rate = 25M / 30M * 100 = 83.33
    assert.ok(report.collectionRatePct > 83.3 && report.collectionRatePct < 83.4);

    // Grade A (ALBA): collected 15M, outstanding 5M
    const gradeA = report.byGrade.find((g) => g.grade === 'A');
    assert.ok(gradeA);
    assert.equal(gradeA.collectedFils, 15_000_000n);
    assert.equal(gradeA.outstandingFils, 5_000_000n);
    assert.equal(gradeA.customerCount, 1);
    // ~31 days between Jan 10 and Feb 10
    assert.equal(gradeA.avgDaysToPayment, 31);

    // Grade B (GPIC): collected 10M, outstanding 0
    const gradeB = report.byGrade.find((g) => g.grade === 'B');
    assert.ok(gradeB);
    assert.equal(gradeB.collectedFils, 10_000_000n);
    assert.equal(gradeB.outstandingFils, 0n);
    assert.equal(gradeB.customerCount, 1);
  });
});

// ─── generatePayablesReport ──────────────────────────────────────────────

describe('generatePayablesReport', () => {
  it('computes correct supplier payables', () => {
    const s1 = makeParty(20n, 'Steel Corp', { isSupplier: true });
    const s2 = makeParty(21n, 'Cable Co', { isSupplier: true });

    const events: ReportMoneyEvent[] = [
      makeEvent(20n, 'SupplierInvoice', 30_000_000n, '2026-01-05'),
      makeEvent(20n, 'SupplierPayment', 10_000_000n, '2026-02-05'),
      makeEvent(21n, 'SupplierInvoice', 15_000_000n, '2026-02-10'),
      // Outside period
      makeEvent(21n, 'SupplierInvoice', 50_000_000n, '2025-11-01'),
    ];

    const report = generatePayablesReport(Q1_2026, events, [s1, s2]);

    assert.equal(report.supplierCount, 2);
    // Steel Corp: 30M invoiced - 10M paid = 20M payable
    // Cable Co: 15M invoiced - 0 paid = 15M payable
    assert.equal(report.totalPayableFils, 35_000_000n);

    // Sorted by payable descending
    assert.equal(report.topSuppliers[0].name, 'Steel Corp');
    assert.equal(report.topSuppliers[0].payableFils, 20_000_000n);
    assert.equal(report.topSuppliers[0].invoicedFils, 30_000_000n);
    assert.equal(report.topSuppliers[0].paidFils, 10_000_000n);

    assert.equal(report.topSuppliers[1].name, 'Cable Co');
    assert.equal(report.topSuppliers[1].payableFils, 15_000_000n);
  });
});

// ─── formatSalesReport ───────────────────────────────────────────────────

describe('formatSalesReport', () => {
  it('contains expected sections', () => {
    const report = generateSalesReport(
      Q1_2026,
      [
        makeEvent(1n, 'CustomerInvoice', 10_000_000n, '2026-01-15'),
        makeEvent(2n, 'CustomerInvoice', 5_000_000n, '2026-02-15'),
      ],
      [
        makeParty(1n, 'EWA', { isCustomer: true, grade: 'A' }),
        makeParty(2n, 'BAPCO', { isCustomer: true, grade: 'B' }),
      ],
      [
        makePipeline(1n, 'Active', 20_000_000n, 7500),
      ],
    );

    const text = formatSalesReport(report);

    assert.ok(text.includes('PH TRADING WLL'));
    assert.ok(text.includes('SALES REPORT'));
    assert.ok(text.includes('Q1 2026'));
    assert.ok(text.includes('Revenue:'));
    assert.ok(text.includes('BHD 15,000.000'));
    assert.ok(text.includes('Top Customers:'));
    assert.ok(text.includes('EWA'));
    assert.ok(text.includes('Pipeline:'));
    assert.ok(text.includes('Active deals: 1'));
    assert.ok(text.includes('Monthly Breakdown:'));
    assert.ok(text.includes('Jan 2026'));
    assert.ok(text.includes('Feb 2026'));
  });
});

// ─── formatCollectionsReport ─────────────────────────────────────────────

describe('formatCollectionsReport', () => {
  it('contains expected sections', () => {
    const report = generateCollectionsReport(
      Q1_2026,
      [
        makeEvent(10n, 'CustomerInvoice', 20_000_000n, '2026-01-10'),
        makeEvent(10n, 'CustomerPayment', 15_000_000n, '2026-02-10'),
      ],
      [makeParty(10n, 'ALBA', { isCustomer: true, grade: 'A' })],
    );

    const text = formatCollectionsReport(report);

    assert.ok(text.includes('PH TRADING WLL'));
    assert.ok(text.includes('COLLECTIONS REPORT'));
    assert.ok(text.includes('Q1 2026'));
    assert.ok(text.includes('Total Collected:'));
    assert.ok(text.includes('BHD 15,000.000'));
    assert.ok(text.includes('Collection Rate:'));
    assert.ok(text.includes('By Grade:'));
    assert.ok(text.includes('Grade A'));
  });
});
