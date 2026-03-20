import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  availableForDelivery,
  canInvoiceOrder,
  computeLineItemShipment,
  computeOrderShipmentSummary,
  formatShipmentProgress,
} from './shipmentTracking';
import type {
  ShipmentDeliveryNote,
  ShipmentDeliveryNoteItem,
  ShipmentLineItem,
} from './shipmentTracking';

function makeLineItem(overrides: Partial<ShipmentLineItem> & { id: bigint }): ShipmentLineItem {
  return {
    parentType: 'order',
    parentId: 100n,
    description: 'Widget',
    quantity: 10,
    unitPriceFils: 5000n,
    ...overrides,
  };
}

function makeDN(overrides: Partial<ShipmentDeliveryNote> & { id: bigint }): ShipmentDeliveryNote {
  return {
    orderId: 100n,
    status: { tag: 'Dispatched' },
    ...overrides,
  };
}

function makeDNI(
  deliveryNoteId: bigint,
  lineItemId: bigint,
  quantityDelivered: number,
): ShipmentDeliveryNoteItem {
  return { deliveryNoteId, lineItemId, quantityDelivered };
}

describe('computeLineItemShipment', () => {
  it('no deliveries: 0% shipped, full remaining', () => {
    const li = makeLineItem({ id: 1n, quantity: 10 });
    const result = computeLineItemShipment(li, [], []);
    assert.equal(result.quantityShipped, 0);
    assert.equal(result.quantityRemaining, 10);
    assert.equal(result.shipmentPct, 0);
    assert.equal(result.fullyShipped, false);
    assert.equal(result.valueFils, 50000n);
    assert.equal(result.shippedValueFils, 0n);
  });

  it('partial delivery: correct shipped/remaining', () => {
    const li = makeLineItem({ id: 1n, quantity: 10 });
    const dns = [makeDN({ id: 10n })];
    const dnis = [makeDNI(10n, 1n, 4)];
    const result = computeLineItemShipment(li, dns, dnis);
    assert.equal(result.quantityShipped, 4);
    assert.equal(result.quantityRemaining, 6);
    assert.equal(result.shipmentPct, 40);
    assert.equal(result.fullyShipped, false);
    assert.equal(result.shippedValueFils, 20000n);
  });

  it('full delivery: 100% shipped, 0 remaining', () => {
    const li = makeLineItem({ id: 1n, quantity: 10 });
    const dns = [makeDN({ id: 10n })];
    const dnis = [makeDNI(10n, 1n, 10)];
    const result = computeLineItemShipment(li, dns, dnis);
    assert.equal(result.quantityShipped, 10);
    assert.equal(result.quantityRemaining, 0);
    assert.equal(result.shipmentPct, 100);
    assert.equal(result.fullyShipped, true);
  });

  it('multiple delivery notes: quantities accumulate', () => {
    const li = makeLineItem({ id: 1n, quantity: 10 });
    const dns = [makeDN({ id: 10n }), makeDN({ id: 11n, status: { tag: 'Delivered' } })];
    const dnis = [makeDNI(10n, 1n, 3), makeDNI(11n, 1n, 5)];
    const result = computeLineItemShipment(li, dns, dnis);
    assert.equal(result.quantityShipped, 8);
    assert.equal(result.quantityRemaining, 2);
    assert.equal(result.shipmentPct, 80);
  });

  it('returned delivery note: excluded from count', () => {
    const li = makeLineItem({ id: 1n, quantity: 10 });
    const dns = [
      makeDN({ id: 10n }),
      makeDN({ id: 11n, status: { tag: 'Returned' } }),
    ];
    const dnis = [makeDNI(10n, 1n, 4), makeDNI(11n, 1n, 3)];
    const result = computeLineItemShipment(li, dns, dnis);
    assert.equal(result.quantityShipped, 4);
    assert.equal(result.quantityRemaining, 6);
  });

  it('over-delivery capped: remaining does not go negative', () => {
    const li = makeLineItem({ id: 1n, quantity: 5 });
    const dns = [makeDN({ id: 10n })];
    const dnis = [makeDNI(10n, 1n, 8)];
    const result = computeLineItemShipment(li, dns, dnis);
    assert.equal(result.quantityShipped, 8);
    assert.equal(result.quantityRemaining, 0);
    assert.equal(result.shipmentPct, 160);
    assert.equal(result.fullyShipped, true);
  });
});

describe('computeOrderShipmentSummary', () => {
  it('multiple line items: per-item and overall percentages', () => {
    const items = [
      makeLineItem({ id: 1n, quantity: 10, description: 'Widget A' }),
      makeLineItem({ id: 2n, quantity: 20, description: 'Widget B', unitPriceFils: 3000n }),
    ];
    const dns = [makeDN({ id: 10n })];
    const dnis = [makeDNI(10n, 1n, 10), makeDNI(10n, 2n, 5)];
    const summary = computeOrderShipmentSummary(100n, items, dns, dnis);

    assert.equal(summary.lineItems.length, 2);
    assert.equal(summary.lineItems[0].shipmentPct, 100);
    assert.equal(summary.lineItems[1].shipmentPct, 25);
    assert.equal(summary.totalOrdered, 30);
    assert.equal(summary.totalShipped, 15);
    assert.equal(summary.totalRemaining, 15);
    assert.equal(summary.overallShipmentPct, 50);
    assert.equal(summary.fullyShipped, false);
    assert.equal(summary.totalOrderValueFils, 110000n);
    assert.equal(summary.shippedValueFils, 65000n);
    assert.equal(summary.deliveryNoteCount, 1);
  });
});

describe('canInvoiceOrder', () => {
  it('false when partial', () => {
    const items = [makeLineItem({ id: 1n, quantity: 10 })];
    const dns = [makeDN({ id: 10n })];
    const dnis = [makeDNI(10n, 1n, 5)];
    const summary = computeOrderShipmentSummary(100n, items, dns, dnis);
    const result = canInvoiceOrder(summary);
    assert.equal(result.canInvoice, false);
    assert.ok(result.reason.includes('50.0%'));
  });

  it('true when fully shipped', () => {
    const items = [makeLineItem({ id: 1n, quantity: 10 })];
    const dns = [makeDN({ id: 10n })];
    const dnis = [makeDNI(10n, 1n, 10)];
    const summary = computeOrderShipmentSummary(100n, items, dns, dnis);
    const result = canInvoiceOrder(summary);
    assert.equal(result.canInvoice, true);
  });
});

describe('availableForDelivery', () => {
  it('correct remaining quantity', () => {
    const li = makeLineItem({ id: 1n, quantity: 10 });
    const dns = [makeDN({ id: 10n })];
    const dnis = [makeDNI(10n, 1n, 7)];
    const result = availableForDelivery(li, dns, dnis);
    assert.equal(result.available, true);
    assert.equal(result.remainingQuantity, 3);
  });

  it('unavailable when fully shipped', () => {
    const li = makeLineItem({ id: 1n, quantity: 10 });
    const dns = [makeDN({ id: 10n })];
    const dnis = [makeDNI(10n, 1n, 10)];
    const result = availableForDelivery(li, dns, dnis);
    assert.equal(result.available, false);
    assert.equal(result.remainingQuantity, 0);
  });
});

describe('formatShipmentProgress', () => {
  it('produces readable output', () => {
    const items = [
      makeLineItem({ id: 1n, quantity: 10, description: 'Widget A' }),
      makeLineItem({ id: 2n, quantity: 5, description: 'Widget B' }),
    ];
    const dns = [makeDN({ id: 10n })];
    const dnis = [makeDNI(10n, 1n, 10), makeDNI(10n, 2n, 2)];
    const summary = computeOrderShipmentSummary(100n, items, dns, dnis);
    const text = formatShipmentProgress(summary);

    assert.ok(text.includes('Order 100'));
    assert.ok(text.includes('[DONE] Widget A'));
    assert.ok(text.includes('[40%] Widget B'));
    assert.ok(text.includes('Pending shipment'));
  });

  it('shows ready for invoice when fully shipped', () => {
    const items = [makeLineItem({ id: 1n, quantity: 5, description: 'Gadget' })];
    const dns = [makeDN({ id: 10n })];
    const dnis = [makeDNI(10n, 1n, 5)];
    const summary = computeOrderShipmentSummary(100n, items, dns, dnis);
    const text = formatShipmentProgress(summary);

    assert.ok(text.includes('100.0% shipped'));
    assert.ok(text.includes('Ready for invoice'));
  });
});
