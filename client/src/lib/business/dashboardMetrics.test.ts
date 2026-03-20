import assert from 'node:assert/strict';

import {
  computeCashRunwayDays,
  computeDashboardMetrics,
  computeUpcomingFollowUps,
  isSameUtcMonth,
} from './dashboardMetrics';

const failures: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}

function ts(iso: string) {
  return { microsSinceUnixEpoch: BigInt(Date.parse(iso)) * 1000n };
}

test('isSameUtcMonth compares timestamps at month granularity', () => {
  assert.equal(
    isSameUtcMonth(ts('2026-03-10T12:00:00Z').microsSinceUnixEpoch, ts('2026-03-01T00:00:00Z').microsSinceUnixEpoch),
    true,
  );
  assert.equal(
    isSameUtcMonth(ts('2026-03-10T12:00:00Z').microsSinceUnixEpoch, ts('2026-02-28T23:59:59Z').microsSinceUnixEpoch),
    false,
  );
});

test('computeDashboardMetrics matches manual KPI totals', () => {
  const metrics = computeDashboardMetrics({
    parties: [
      { id: 1n, name: 'BAPCO', isCustomer: true, isSupplier: false, grade: { tag: 'B' } },
      { id: 2n, name: 'ALBA', isCustomer: true, isSupplier: false, grade: { tag: 'A' } },
      { id: 3n, name: 'E+H', isCustomer: false, isSupplier: true, grade: { tag: 'C' } },
    ],
    pipelines: [
      { id: 1n, partyId: 1n, title: 'Open', status: { tag: 'Active' }, estimatedValueFils: 5_000_000n },
      { id: 2n, partyId: 2n, title: 'Won', status: { tag: 'Terminal' }, estimatedValueFils: 2_000_000n },
      { id: 3n, partyId: 2n, title: 'Warm', status: { tag: 'Draft' }, estimatedValueFils: 3_000_000n },
    ],
    orders: [
      { status: { tag: 'Active' } },
      { status: { tag: 'InProgress' } },
      { status: { tag: 'Terminal' } },
    ],
    moneyEvents: [
      {
        partyId: 1n,
        kind: { tag: 'CustomerInvoice' },
        status: { tag: 'Active' },
        totalFils: 1_100_000n,
        dueDate: ts('2026-03-05T00:00:00Z'),
        createdAt: ts('2026-03-01T00:00:00Z'),
      },
      {
        partyId: 2n,
        kind: { tag: 'CustomerInvoice' },
        status: { tag: 'Active' },
        totalFils: 2_200_000n,
        dueDate: ts('2026-04-01T00:00:00Z'),
        createdAt: ts('2026-03-02T00:00:00Z'),
      },
      {
        partyId: 2n,
        kind: { tag: 'CustomerInvoice' },
        status: { tag: 'Terminal' },
        totalFils: 3_300_000n,
        dueDate: ts('2026-02-10T00:00:00Z'),
        paidAt: ts('2026-02-11T00:00:00Z'),
        createdAt: ts('2026-02-01T00:00:00Z'),
      },
      {
        partyId: 1n,
        kind: { tag: 'CustomerPayment' },
        status: { tag: 'Terminal' },
        totalFils: 400_000n,
        createdAt: ts('2026-03-03T00:00:00Z'),
      },
      {
        partyId: 3n,
        kind: { tag: 'SupplierPayment' },
        status: { tag: 'Terminal' },
        totalFils: 125_000n,
        createdAt: ts('2026-03-04T00:00:00Z'),
      },
    ],
    activityLogs: [
      { followUpDue: ts('2026-03-10T08:00:00Z'), followUpDone: false },
      { followUpDue: ts('2026-03-12T08:00:00Z'), followUpDone: false },
      { followUpDue: ts('2026-03-08T08:00:00Z'), followUpDone: false },
    ],
    nowMicros: ts('2026-03-10T00:00:00Z').microsSinceUnixEpoch,
  });

  assert.equal(metrics.revenueMtd, 3_300_000n);
  assert.equal(metrics.totalOutstanding, 6_200_000n);
  assert.equal(metrics.overdueAmount, 700_000n);
  assert.equal(metrics.pipelineValue, 8_000_000n);
  assert.equal(metrics.cashPosition, 275_000n);
  assert.equal(metrics.activeOrderCount, 2);
  assert.equal(metrics.customerCount, 2);
  assert.equal(metrics.supplierCount, 1);
  assert.equal(metrics.collectionRatePct, 6);
  assert.equal(metrics.cashRunwayDays, 1);
  assert.deepEqual(metrics.followUps, { dueToday: 1, dueSoon: 1, overdue: 1 });
  assert.equal(metrics.topCustomers[0]?.name, 'ALBA');
});

test('computeDashboardMetrics subtracts partial payments from overdue exposure', () => {
  const metrics = computeDashboardMetrics({
    parties: [
      { id: 1n, name: 'Acme', isCustomer: true, isSupplier: false, grade: { tag: 'B' } },
    ],
    pipelines: [],
    orders: [],
    moneyEvents: [
      {
        partyId: 1n,
        kind: { tag: 'CustomerInvoice' },
        status: { tag: 'Active' },
        totalFils: 1_000n,
        dueDate: ts('2026-01-01T00:00:00Z'),
        createdAt: ts('2025-12-01T00:00:00Z'),
      },
      {
        partyId: 1n,
        kind: { tag: 'CustomerPayment' },
        status: { tag: 'Terminal' },
        totalFils: 400n,
        createdAt: ts('2026-01-05T00:00:00Z'),
      },
    ],
    nowMicros: ts('2026-03-10T00:00:00Z').microsSinceUnixEpoch,
  });

  assert.equal(metrics.overdueAmount, 600n);
});

test('computeUpcomingFollowUps buckets due dates relative to now', () => {
  const buckets = computeUpcomingFollowUps(
    [
      { followUpDue: ts('2026-03-20T09:00:00Z'), followUpDone: false },
      { followUpDue: ts('2026-03-24T09:00:00Z'), followUpDone: false },
      { followUpDue: ts('2026-03-19T09:00:00Z'), followUpDone: false },
      { followUpDue: ts('2026-03-22T09:00:00Z'), followUpDone: true },
    ],
    ts('2026-03-20T00:00:00Z').microsSinceUnixEpoch,
  );

  assert.deepEqual(buckets, { dueToday: 1, dueSoon: 1, overdue: 1 });
});

test('computeCashRunwayDays returns zero for negative cash and null for zero burn', () => {
  assert.equal(computeCashRunwayDays(-1_000n), 0);
  assert.equal(computeCashRunwayDays(10_000n, 0n), null);
});

if (failures.length > 0) {
  process.exitCode = 1;
}
