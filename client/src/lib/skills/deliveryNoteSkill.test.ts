import assert from 'node:assert/strict';

import { buildDeliveryNoteSkillRequest } from './deliveryNoteSkill';

const cases: Array<{ name: string; fn: () => void }> = [];

function test(name: string, fn: () => void): void {
  cases.push({ name, fn });
}

function expectThrows(fn: () => void, message: RegExp): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, message);
    return true;
  });
}

const mockOrder = {
  id: 10n,
  partyId: 5n,
  pipelineId: 1n,
  status: { tag: 'Active' },
  totalFils: 5_000n,
  poReference: 'PO-1',
  expectedDelivery: undefined,
  createdAt: {} as never,
  updatedAt: {} as never,
} as const;

const mockLineItems = [
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
  {
    id: 101n,
    parentType: 'order',
    parentId: 10n,
    description: 'Gauge',
    quantity: 2n,
    unitPriceFils: 2_000n,
    totalPriceFils: 4_000n,
    fobCostFils: 0n,
    freightCostFils: 0n,
    customsCostFils: 0n,
    insuranceCostFils: 0n,
    handlingCostFils: 0n,
    financeCostFils: 0n,
    marginBps: 0,
    costPerUnitFils: 0n,
  },
] as const;

test('buildDeliveryNoteSkillRequest parses JSON subset items and preserves descriptions', () => {
  const request = buildDeliveryNoteSkillRequest(
    {
      orderId: 10,
      deliveryAddress: 'Warehouse 4',
      driverName: 'Ravi',
      vehicleNumber: '12345',
      items: JSON.stringify([
        { lineItemId: 100, quantityDelivered: 3, notes: 'partial' },
        { lineItemId: 101, quantityDelivered: 1 },
      ]),
    },
    mockOrder as never,
    mockLineItems as never,
  );

  assert.equal(request.orderId, 10n);
  assert.equal(request.deliveryAddress, 'Warehouse 4');
  assert.equal(request.items.length, 2);
  assert.equal(request.items[0].lineItemId, 100n);
  assert.equal(request.items[0].quantityDelivered, 3n);
  assert.equal(request.items[0].description, 'Valve');
  assert.equal(request.items[1].description, 'Gauge');
});

test('buildDeliveryNoteSkillRequest rejects line items outside the order subset', () => {
  expectThrows(
    () =>
      buildDeliveryNoteSkillRequest(
        {
          orderId: 10,
          deliveryAddress: 'Warehouse 4',
          items: JSON.stringify([{ lineItemId: 999, quantityDelivered: 1 }]),
        },
        mockOrder as never,
        mockLineItems as never,
      ),
    /does not belong to order #10/,
  );
});

test('buildDeliveryNoteSkillRequest rejects zero or invalid quantities', () => {
  expectThrows(
    () =>
      buildDeliveryNoteSkillRequest(
        {
          orderId: 10,
          deliveryAddress: 'Warehouse 4',
          items: JSON.stringify([{ lineItemId: 100, quantityDelivered: 0 }]),
        },
        mockOrder as never,
        mockLineItems as never,
      ),
    /quantityDelivered/,
  );
});

test('buildDeliveryNoteSkillRequest rejects over-delivery beyond the ordered quantity', () => {
  expectThrows(
    () =>
      buildDeliveryNoteSkillRequest(
        {
          orderId: 10,
          deliveryAddress: 'Warehouse 4',
          items: JSON.stringify([{ lineItemId: 100, quantityDelivered: 6 }]),
        },
        mockOrder as never,
        mockLineItems as never,
      ),
    /exceeds ordered quantity \(5\)/,
  );
});

let failures = 0;
for (const testCase of cases) {
  const started = Date.now();
  try {
    console.log(`RUN | ${testCase.name}`);
    testCase.fn();
    console.log(`PASS | ${testCase.name} | ${Date.now() - started}ms`);
  } catch (error) {
    failures += 1;
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(`FAIL | ${testCase.name} | ${Date.now() - started}ms`);
    console.error(message);
  }
}

process.exit(failures);
