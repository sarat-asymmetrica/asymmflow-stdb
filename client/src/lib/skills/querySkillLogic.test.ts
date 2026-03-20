import assert from 'node:assert/strict';

import { buildARAgingSnapshot, buildOrderStatusSnapshot } from './querySkillLogic';

const cases: Array<{ name: string; fn: () => void }> = [];

function test(name: string, fn: () => void): void {
  cases.push({ name, fn });
}

const ts = (microsSinceUnixEpoch: bigint) => ({ microsSinceUnixEpoch });

test('buildARAgingSnapshot returns totals and customer rows', () => {
  const snapshot = buildARAgingSnapshot(
    [
      {
        id: 1n,
        name: 'Acme',
        isCustomer: true,
        isSupplier: false,
        grade: { tag: 'B' },
        creditLimitFils: 0n,
        isCreditBlocked: false,
        paymentTermsDays: 30n,
        productTypes: '',
        annualGoalFils: 0n,
        notes: '',
        createdAt: ts(1n),
        updatedAt: ts(1n),
      },
    ] as never,
    [
      {
        id: 1n,
        partyId: 1n,
        orderId: 10n,
        deliveryNoteId: null,
        kind: { tag: 'CustomerInvoice' },
        status: { tag: 'Active' },
        subtotalFils: 10_000n,
        vatFils: 1_000n,
        totalFils: 11_000n,
        reference: 'INV-1',
        dueDate: ts(1n),
        paidAt: null,
        createdBy: 'user-1',
        createdAt: ts(1n),
        updatedAt: ts(1n),
      },
    ] as never,
    100_000_000_000n,
  );

  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.totals.total, 11_000n);
});

test('buildOrderStatusSnapshot links DNs, invoices, and progress', () => {
  const snapshot = buildOrderStatusSnapshot({
    order: {
      id: 10n,
      partyId: 1n,
      pipelineId: 2n,
      status: { tag: 'InProgress' },
      totalFils: 5_500n,
      poReference: 'PO-1',
      expectedDelivery: undefined,
      createdAt: ts(1n),
      updatedAt: ts(1n),
    } as never,
    party: {
      id: 1n,
      name: 'Acme',
      isCustomer: true,
      isSupplier: false,
      grade: { tag: 'B' },
      creditLimitFils: 0n,
      isCreditBlocked: false,
      paymentTermsDays: 30n,
      productTypes: '',
      annualGoalFils: 0n,
      notes: '',
      createdAt: ts(1n),
      updatedAt: ts(1n),
    } as never,
    orderLineItems: [
      {
        id: 100n,
        parentType: 'order',
        parentId: 10n,
        description: 'Valve',
        quantity: 5n,
        unitPriceFils: 1_000n,
        totalPriceFils: 5_000n,
        fobCostFils: 0n,
        freightCostFils: 0n,
        customsCostFils: 0n,
        insuranceCostFils: 0n,
        handlingCostFils: 0n,
        financeCostFils: 0n,
        marginBps: 0,
        costPerUnitFils: 0n,
      },
    ] as never,
    deliveryNotes: [
      {
        id: 20n,
        orderId: 10n,
        partyId: 1n,
        dnNumber: 'DN-2026-001',
        status: { tag: 'Delivered' },
        deliveryDate: ts(1n),
        deliveryAddress: 'Warehouse',
        driverName: 'Ravi',
        vehicleNumber: '123',
        receiverName: 'Ali',
        notes: '',
        createdBy: 'user-1',
        createdAt: ts(1n),
        updatedAt: ts(1n),
      },
    ] as never,
    deliveryNoteItems: [
      {
        id: 30n,
        deliveryNoteId: 20n,
        lineItemId: 100n,
        quantityDelivered: 3n,
        notes: '',
      },
    ] as never,
    moneyEvents: [
      {
        id: 40n,
        partyId: 1n,
        orderId: 10n,
        deliveryNoteId: 20n,
        kind: { tag: 'CustomerInvoice' },
        status: { tag: 'Active' },
        subtotalFils: 3_000n,
        vatFils: 300n,
        totalFils: 3_300n,
        reference: 'INV-1',
        dueDate: ts(1n),
        paidAt: null,
        createdBy: 'user-1',
        createdAt: ts(1n),
        updatedAt: ts(1n),
      },
      {
        id: 41n,
        partyId: 1n,
        orderId: 10n,
        deliveryNoteId: null,
        kind: { tag: 'CustomerPayment' },
        status: { tag: 'Terminal' },
        subtotalFils: 3_300n,
        vatFils: 0n,
        totalFils: 3_300n,
        reference: 'PAY-1',
        dueDate: null,
        paidAt: ts(1n),
        createdBy: 'user-1',
        createdAt: ts(1n),
        updatedAt: ts(1n),
      },
    ] as never,
  });

  assert.equal(snapshot.orderStatus, 'InProgress');
  assert.equal(snapshot.deliveryProgress, '3/5');
  assert.equal(snapshot.linkedDeliveryNotes.length, 1);
  assert.equal(snapshot.linkedInvoices.length, 1);
  assert.equal(snapshot.linkedPayments.length, 1);
  assert.equal(snapshot.orderOutstandingFils, '0');
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
