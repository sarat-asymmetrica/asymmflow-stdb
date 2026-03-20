import assert from 'node:assert/strict';

import { buildPaymentPredictionSnapshot } from './paymentPredictionLogic';

const cases: Array<{ name: string; fn: () => void }> = [];

function test(name: string, fn: () => void): void {
  cases.push({ name, fn });
}

const dayMicros = (days: number): bigint => BigInt(days) * 86_400_000_000n;
const ts = (days: number) => ({ microsSinceUnixEpoch: dayMicros(days) });

const baseCustomer = {
  id: 1n,
  name: 'BAPCO',
  isCustomer: true,
  isSupplier: false,
  grade: { tag: 'B' },
  creditLimitFils: 0n,
  isCreditBlocked: false,
  paymentTermsDays: 90n,
  productTypes: '',
  annualGoalFils: 0n,
  notes: '',
  createdAt: ts(0),
  updatedAt: ts(0),
};

test('buildPaymentPredictionSnapshot uses settled customer history for invoice projections', () => {
  const snapshot = buildPaymentPredictionSnapshot({
    customer: baseCustomer as never,
    moneyEvents: [
      {
        id: 10n,
        partyId: 1n,
        orderId: 1n,
        deliveryNoteId: null,
        kind: { tag: 'CustomerInvoice' },
        status: { tag: 'Active' },
        subtotalFils: 10_000n,
        vatFils: 1_000n,
        totalFils: 11_000n,
        reference: 'INV-10',
        dueDate: ts(90),
        paidAt: null,
        createdBy: 'user-1',
        createdAt: ts(0),
        updatedAt: ts(0),
      },
      {
        id: 11n,
        partyId: 1n,
        orderId: 2n,
        deliveryNoteId: null,
        kind: { tag: 'CustomerInvoice' },
        status: { tag: 'Active' },
        subtotalFils: 10_000n,
        vatFils: 1_000n,
        totalFils: 11_000n,
        reference: 'INV-11',
        dueDate: ts(130),
        paidAt: null,
        createdBy: 'user-1',
        createdAt: ts(40),
        updatedAt: ts(40),
      },
      {
        id: 12n,
        partyId: 1n,
        orderId: 3n,
        deliveryNoteId: null,
        kind: { tag: 'CustomerInvoice' },
        status: { tag: 'Active' },
        subtotalFils: 10_000n,
        vatFils: 1_000n,
        totalFils: 11_000n,
        reference: 'INV-12',
        dueDate: ts(170),
        paidAt: null,
        createdBy: 'user-1',
        createdAt: ts(80),
        updatedAt: ts(80),
      },
      {
        id: 20n,
        partyId: 1n,
        orderId: null,
        deliveryNoteId: null,
        kind: { tag: 'CustomerPayment' },
        status: { tag: 'Terminal' },
        subtotalFils: 11_000n,
        vatFils: 0n,
        totalFils: 11_000n,
        reference: 'PAY-1',
        dueDate: null,
        paidAt: ts(45),
        createdBy: 'user-1',
        createdAt: ts(45),
        updatedAt: ts(45),
      },
      {
        id: 21n,
        partyId: 1n,
        orderId: null,
        deliveryNoteId: null,
        kind: { tag: 'CustomerPayment' },
        status: { tag: 'Terminal' },
        subtotalFils: 11_000n,
        vatFils: 0n,
        totalFils: 11_000n,
        reference: 'PAY-2',
        dueDate: null,
        paidAt: ts(90),
        createdBy: 'user-1',
        createdAt: ts(90),
        updatedAt: ts(90),
      },
    ] as never,
    nowMicros: dayMicros(100),
    invoiceId: 12n,
  });

  assert.equal(snapshot.estimatedDays, 62);
  assert.equal(snapshot.basedOnInvoices, 2);
  assert.equal(snapshot.suggestedGrade, 'B');
  assert.equal(snapshot.confidence, 'low');
  assert.equal(snapshot.targetInvoice?.estimatedPaymentDateIso, '1970-05-23');
});

test('buildPaymentPredictionSnapshot falls back to payment terms when there is no settled history', () => {
  const snapshot = buildPaymentPredictionSnapshot({
    customer: baseCustomer as never,
    moneyEvents: [
      {
        id: 30n,
        partyId: 1n,
        orderId: 5n,
        deliveryNoteId: null,
        kind: { tag: 'CustomerInvoice' },
        status: { tag: 'Active' },
        subtotalFils: 5_000n,
        vatFils: 500n,
        totalFils: 5_500n,
        reference: 'INV-30',
        dueDate: ts(95),
        paidAt: null,
        createdBy: 'user-1',
        createdAt: ts(5),
        updatedAt: ts(5),
      },
    ] as never,
    nowMicros: dayMicros(20),
  });

  assert.equal(snapshot.estimatedDays, 90);
  assert.equal(snapshot.basedOnInvoices, 0);
  assert.equal(snapshot.confidence, 'low');
  assert.match(snapshot.riskFactors[0], /Limited payment history/);
});

test('buildPaymentPredictionSnapshot treats zero-day terms as a 30-day fallback baseline', () => {
  const snapshot = buildPaymentPredictionSnapshot({
    customer: {
      ...baseCustomer,
      paymentTermsDays: 0n,
    } as never,
    moneyEvents: [
      {
        id: 31n,
        partyId: 1n,
        orderId: 5n,
        deliveryNoteId: null,
        kind: { tag: 'CustomerInvoice' },
        status: { tag: 'Active' },
        subtotalFils: 5_000n,
        vatFils: 500n,
        totalFils: 5_500n,
        reference: 'INV-31',
        dueDate: ts(30),
        paidAt: null,
        createdBy: 'user-1',
        createdAt: ts(5),
        updatedAt: ts(5),
      },
    ] as never,
    nowMicros: dayMicros(20),
  });

  assert.equal(snapshot.paymentTermsDays, 30);
  assert.equal(snapshot.estimatedDays, 30);
});

test('buildPaymentPredictionSnapshot flags weak payment discipline from late history', () => {
  const snapshot = buildPaymentPredictionSnapshot({
    customer: baseCustomer as never,
    moneyEvents: [
      {
        id: 40n,
        partyId: 1n,
        orderId: 7n,
        deliveryNoteId: null,
        kind: { tag: 'CustomerInvoice' },
        status: { tag: 'Active' },
        subtotalFils: 12_000n,
        vatFils: 1_200n,
        totalFils: 13_200n,
        reference: 'INV-40',
        dueDate: ts(60),
        paidAt: null,
        createdBy: 'user-1',
        createdAt: ts(0),
        updatedAt: ts(0),
      },
      {
        id: 41n,
        partyId: 1n,
        orderId: 8n,
        deliveryNoteId: null,
        kind: { tag: 'CustomerInvoice' },
        status: { tag: 'Active' },
        subtotalFils: 12_000n,
        vatFils: 1_200n,
        totalFils: 13_200n,
        reference: 'INV-41',
        dueDate: ts(90),
        paidAt: null,
        createdBy: 'user-1',
        createdAt: ts(20),
        updatedAt: ts(20),
      },
      {
        id: 50n,
        partyId: 1n,
        orderId: null,
        deliveryNoteId: null,
        kind: { tag: 'CustomerPayment' },
        status: { tag: 'Terminal' },
        subtotalFils: 13_200n,
        vatFils: 0n,
        totalFils: 13_200n,
        reference: 'PAY-40',
        dueDate: null,
        paidAt: ts(110),
        createdBy: 'user-1',
        createdAt: ts(110),
        updatedAt: ts(110),
      },
      {
        id: 51n,
        partyId: 1n,
        orderId: null,
        deliveryNoteId: null,
        kind: { tag: 'CustomerPayment' },
        status: { tag: 'Terminal' },
        subtotalFils: 13_200n,
        vatFils: 0n,
        totalFils: 13_200n,
        reference: 'PAY-41',
        dueDate: null,
        paidAt: ts(150),
        createdBy: 'user-1',
        createdAt: ts(150),
        updatedAt: ts(150),
      },
    ] as never,
    nowMicros: dayMicros(160),
  });

  assert.equal(snapshot.suggestedGrade, 'C');
  assert.equal(snapshot.estimatedDays, 120);
  assert.equal(snapshot.onTimeRatio, 0);
  assert.equal(snapshot.riskFactors.length, 3);
});

test('buildPaymentPredictionSnapshot uses explicit grade ranking for downgrade warnings', () => {
  const downgrade = buildPaymentPredictionSnapshot({
    customer: {
      ...baseCustomer,
      grade: { tag: 'A' },
    } as never,
    moneyEvents: [
      {
        id: 60n,
        partyId: 1n,
        orderId: 1n,
        deliveryNoteId: null,
        kind: { tag: 'CustomerInvoice' },
        status: { tag: 'Active' },
        subtotalFils: 10_000n,
        vatFils: 1_000n,
        totalFils: 11_000n,
        reference: 'INV-A1',
        dueDate: ts(60),
        paidAt: null,
        createdBy: 'user-1',
        createdAt: ts(0),
        updatedAt: ts(0),
      },
      {
        id: 61n,
        partyId: 1n,
        orderId: null,
        deliveryNoteId: null,
        kind: { tag: 'CustomerPayment' },
        status: { tag: 'Terminal' },
        subtotalFils: 11_000n,
        vatFils: 0n,
        totalFils: 11_000n,
        reference: 'PAY-A1',
        dueDate: null,
        paidAt: ts(120),
        createdBy: 'user-1',
        createdAt: ts(120),
        updatedAt: ts(120),
      },
    ] as never,
    nowMicros: dayMicros(140),
  });

  const sameGrade = buildPaymentPredictionSnapshot({
    customer: {
      ...baseCustomer,
      grade: { tag: 'C' },
    } as never,
    moneyEvents: [
      {
        id: 62n,
        partyId: 1n,
        orderId: 1n,
        deliveryNoteId: null,
        kind: { tag: 'CustomerInvoice' },
        status: { tag: 'Active' },
        subtotalFils: 10_000n,
        vatFils: 1_000n,
        totalFils: 11_000n,
        reference: 'INV-C1',
        dueDate: ts(60),
        paidAt: null,
        createdBy: 'user-1',
        createdAt: ts(0),
        updatedAt: ts(0),
      },
      {
        id: 63n,
        partyId: 1n,
        orderId: null,
        deliveryNoteId: null,
        kind: { tag: 'CustomerPayment' },
        status: { tag: 'Terminal' },
        subtotalFils: 11_000n,
        vatFils: 0n,
        totalFils: 11_000n,
        reference: 'PAY-C1',
        dueDate: null,
        paidAt: ts(120),
        createdBy: 'user-1',
        createdAt: ts(120),
        updatedAt: ts(120),
      },
    ] as never,
    nowMicros: dayMicros(140),
  });

  const strongerGrade = buildPaymentPredictionSnapshot({
    customer: {
      ...baseCustomer,
      grade: { tag: 'D' },
    } as never,
    moneyEvents: [
      {
        id: 64n,
        partyId: 1n,
        orderId: 1n,
        deliveryNoteId: null,
        kind: { tag: 'CustomerInvoice' },
        status: { tag: 'Active' },
        subtotalFils: 10_000n,
        vatFils: 1_000n,
        totalFils: 11_000n,
        reference: 'INV-D1',
        dueDate: ts(45),
        paidAt: null,
        createdBy: 'user-1',
        createdAt: ts(0),
        updatedAt: ts(0),
      },
      {
        id: 65n,
        partyId: 1n,
        orderId: null,
        deliveryNoteId: null,
        kind: { tag: 'CustomerPayment' },
        status: { tag: 'Terminal' },
        subtotalFils: 11_000n,
        vatFils: 0n,
        totalFils: 11_000n,
        reference: 'PAY-D1',
        dueDate: null,
        paidAt: ts(30),
        createdBy: 'user-1',
        createdAt: ts(30),
        updatedAt: ts(30),
      },
    ] as never,
    nowMicros: dayMicros(40),
  });

  assert.ok(downgrade.riskFactors.some((factor) => factor.includes('weaker than the current assigned grade')));
  assert.ok(!sameGrade.riskFactors.some((factor) => factor.includes('weaker than the current assigned grade')));
  assert.ok(!strongerGrade.riskFactors.some((factor) => factor.includes('weaker than the current assigned grade')));
});

let failures = 0;
for (const testCase of cases) {
  try {
    console.log(`RUN | ${testCase.name}`);
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
