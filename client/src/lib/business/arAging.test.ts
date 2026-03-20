import assert from 'node:assert/strict';
import { computeARAgingRows, computeARAgingTotals } from './arAging';

function ts(microsSinceUnixEpoch: bigint) {
  return { microsSinceUnixEpoch };
}

const now = 1_800_000_000_000_000n;
const dayMicros = 86_400_000_000n;

const parties = [
  {
    id: 1n,
    name: 'Acme',
    isCustomer: true,
    isSupplier: false,
    grade: { tag: 'B' },
    creditLimitFils: 0n,
    isCreditBlocked: false,
    paymentTermsDays: 90n,
    productTypes: '',
    annualGoalFils: 0n,
    notes: '',
    createdAt: ts(1n),
    updatedAt: ts(1n),
  },
];

const moneyEvents = [
  {
    id: 1n,
    partyId: 1n,
    orderId: null,
    kind: { tag: 'CustomerInvoice' },
    status: { tag: 'Active' },
    subtotalFils: 10_000n,
    vatFils: 1_000n,
    totalFils: 11_000n,
    reference: 'INV-1',
    dueDate: ts(now - (5n * dayMicros)),
    paidAt: null,
    createdBy: 'user-1',
    createdAt: ts(1n),
    updatedAt: ts(1n),
  },
  {
    id: 2n,
    partyId: 1n,
    orderId: null,
    kind: { tag: 'CustomerInvoice' },
    status: { tag: 'Active' },
    subtotalFils: 20_000n,
    vatFils: 2_000n,
    totalFils: 22_000n,
    reference: 'INV-2',
    dueDate: ts(now - (25n * dayMicros)),
    paidAt: null,
    createdBy: 'user-1',
    createdAt: ts(1n),
    updatedAt: ts(1n),
  },
  {
    id: 3n,
    partyId: 1n,
    orderId: null,
    kind: { tag: 'CustomerInvoice' },
    status: { tag: 'Active' },
    subtotalFils: 30_000n,
    vatFils: 3_000n,
    totalFils: 33_000n,
    reference: 'INV-3',
    dueDate: ts(now - (45n * dayMicros)),
    paidAt: null,
    createdBy: 'user-1',
    createdAt: ts(1n),
    updatedAt: ts(1n),
  },
  {
    id: 4n,
    partyId: 1n,
    orderId: null,
    kind: { tag: 'CustomerInvoice' },
    status: { tag: 'Active' },
    subtotalFils: 40_000n,
    vatFils: 4_000n,
    totalFils: 44_000n,
    reference: 'INV-4',
    dueDate: ts(now - (75n * dayMicros)),
    paidAt: null,
    createdBy: 'user-1',
    createdAt: ts(1n),
    updatedAt: ts(1n),
  },
  {
    id: 5n,
    partyId: 1n,
    orderId: null,
    kind: { tag: 'CustomerInvoice' },
    status: { tag: 'Active' },
    subtotalFils: 50_000n,
    vatFils: 5_000n,
    totalFils: 55_000n,
    reference: 'INV-5',
    dueDate: ts(now - (120n * dayMicros)),
    paidAt: null,
    createdBy: 'user-1',
    createdAt: ts(1n),
    updatedAt: ts(1n),
  },
  {
    id: 6n,
    partyId: 1n,
    orderId: null,
    kind: { tag: 'CustomerPayment' },
    status: { tag: 'Terminal' },
    subtotalFils: 0n,
    vatFils: 0n,
    totalFils: 15_000n,
    reference: 'PAY-1',
    dueDate: null,
    paidAt: ts(1n),
    createdBy: 'user-1',
    createdAt: ts(1n),
    updatedAt: ts(1n),
  },
];

const cases: Array<{ name: string; fn: () => void }> = [];
function test(name: string, fn: () => void) {
  cases.push({ name, fn });
}

test('computeARAgingRows buckets outstanding into 0-15, 16-30, 31-60, 61-90, 90+', () => {
  const rows = computeARAgingRows(parties as never, moneyEvents as never, now);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.d15Fils, 0n);
  assert.equal(row.d30Fils, 18_000n);
  assert.equal(row.d60Fils, 33_000n);
  assert.equal(row.d90Fils, 44_000n);
  assert.equal(row.d90plusFils, 55_000n);
  assert.equal(row.outstandingFils, 150_000n);
});

test('computeARAgingTotals matches row outstanding totals', () => {
  const rows = computeARAgingRows(parties as never, moneyEvents as never, now);
  const totals = computeARAgingTotals(rows);
  assert.equal(totals.d15, 0n);
  assert.equal(totals.d30, 18_000n);
  assert.equal(totals.d60, 33_000n);
  assert.equal(totals.d90, 44_000n);
  assert.equal(totals.d90plus, 55_000n);
  assert.equal(totals.total, 150_000n);
});

test('computeARAgingRows applies payments FIFO to the oldest invoices first', () => {
  const fifoRows = computeARAgingRows(
    parties as never,
    [
      {
        id: 10n,
        partyId: 1n,
        orderId: null,
        kind: { tag: 'CustomerInvoice' },
        status: { tag: 'Active' },
        subtotalFils: 10_000n,
        vatFils: 0n,
        totalFils: 10_000n,
        reference: 'INV-OLD',
        dueDate: ts(now - (91n * dayMicros)),
        paidAt: null,
        createdBy: 'user-1',
        createdAt: ts(now - (120n * dayMicros)),
        updatedAt: ts(1n),
      },
      {
        id: 11n,
        partyId: 1n,
        orderId: null,
        kind: { tag: 'CustomerInvoice' },
        status: { tag: 'Active' },
        subtotalFils: 10_000n,
        vatFils: 0n,
        totalFils: 10_000n,
        reference: 'INV-NEW',
        dueDate: ts(now - (5n * dayMicros)),
        paidAt: null,
        createdBy: 'user-1',
        createdAt: ts(now - (10n * dayMicros)),
        updatedAt: ts(1n),
      },
      {
        id: 12n,
        partyId: 1n,
        orderId: null,
        kind: { tag: 'CustomerPayment' },
        status: { tag: 'Terminal' },
        subtotalFils: 0n,
        vatFils: 0n,
        totalFils: 10_000n,
        reference: 'PAY-FIFO',
        dueDate: null,
        paidAt: ts(1n),
        createdBy: 'user-1',
        createdAt: ts(1n),
        updatedAt: ts(1n),
      },
    ] as never,
    now,
  );

  assert.equal(fifoRows[0]?.d90plusFils, 0n);
  assert.equal(fifoRows[0]?.d15Fils, 10_000n);
  assert.equal(fifoRows[0]?.outstandingFils, 10_000n);
});

test('computeARAgingRows keeps partially paid old invoices in the 90+ bucket', () => {
  const fifoRows = computeARAgingRows(
    parties as never,
    [
      {
        id: 20n,
        partyId: 1n,
        orderId: null,
        kind: { tag: 'CustomerInvoice' },
        status: { tag: 'Active' },
        subtotalFils: 10_000n,
        vatFils: 0n,
        totalFils: 10_000n,
        reference: 'INV-OLD',
        dueDate: ts(now - (100n * dayMicros)),
        paidAt: null,
        createdBy: 'user-1',
        createdAt: ts(now - (110n * dayMicros)),
        updatedAt: ts(1n),
      },
      {
        id: 21n,
        partyId: 1n,
        orderId: null,
        kind: { tag: 'CustomerPayment' },
        status: { tag: 'Terminal' },
        subtotalFils: 0n,
        vatFils: 0n,
        totalFils: 8_000n,
        reference: 'PAY-PARTIAL',
        dueDate: null,
        paidAt: ts(1n),
        createdBy: 'user-1',
        createdAt: ts(1n),
        updatedAt: ts(1n),
      },
    ] as never,
    now,
  );

  assert.equal(fifoRows[0]?.d90plusFils, 2_000n);
  assert.equal(fifoRows[0]?.outstandingFils, 2_000n);
});

let failures = 0;
for (const testCase of cases) {
  try {
    testCase.fn();
    console.log(`PASS | ${testCase.name}`);
  } catch (error) {
    failures += 1;
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(`FAIL | ${testCase.name}`);
    console.error(message);
  }
}

process.exit(failures);
