import assert from 'node:assert/strict';

import { buildSeedDashboardSnapshot, loadSeedData, summarizeSeedData } from './seedVerification';

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

test('summarizeSeedData matches the extracted PH legacy dataset counts', () => {
  const seed = loadSeedData();
  const summary = summarizeSeedData(seed);

  assert.equal(summary.parties, 379);
  assert.equal(summary.contacts, 535);
  assert.equal(summary.pipelines, 67);
  assert.equal(summary.orders, 175);
  assert.equal(summary.purchaseOrders, 45);
  assert.equal(summary.moneyEvents, 1615);
  assert.equal(summary.customerInvoices, 468);
  assert.equal(summary.customerPayments, 93);
  assert.equal(summary.customerInvoiceTotalFils, 8_975_509_147n);
  assert.equal(summary.customerPaymentTotalFils, 487_335_988n);
});

test('buildSeedDashboardSnapshot derives KPI totals and debtor ranking from seed data', () => {
  const seed = loadSeedData();
  const snapshot = buildSeedDashboardSnapshot(seed, BigInt(Date.parse('2026-03-10T00:00:00Z')) * 1000n);

  assert.equal(snapshot.metrics.pipelineValue, 130_401_645n);
  assert.equal(snapshot.metrics.totalOutstanding, 8_488_173_159n);
  assert.equal(snapshot.metrics.cashPosition, -2_807_634_051n);
  assert.equal(snapshot.metrics.customerCount, 348);
  assert.equal(snapshot.metrics.supplierCount, 34);
  assert.equal(snapshot.topDebtors.length, 5);
  assert.equal(snapshot.topDebtors[0]?.name, 'Electricity & Water Authority (EWA)');
  assert.equal(snapshot.topDebtors[0]?.outstanding, 7_319_765_904n);
});

if (failures.length > 0) {
  process.exitCode = 1;
}
