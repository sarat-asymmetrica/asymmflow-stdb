export interface ShipmentLineItem {
  id: bigint;
  parentType: string;
  parentId: bigint;
  description: string;
  quantity: number;
  unitPriceFils: bigint;
}

export interface ShipmentDeliveryNote {
  id: bigint;
  orderId: bigint;
  status: { tag: string };
}

export interface ShipmentDeliveryNoteItem {
  deliveryNoteId: bigint;
  lineItemId: bigint;
  quantityDelivered: number;
}

export interface LineItemShipmentStatus {
  lineItemId: bigint;
  description: string;
  quantityOrdered: number;
  quantityShipped: number;
  quantityRemaining: number;
  shipmentPct: number;
  fullyShipped: boolean;
  valueFils: bigint;
  shippedValueFils: bigint;
}

export interface OrderShipmentSummary {
  orderId: bigint;
  lineItems: LineItemShipmentStatus[];
  totalOrdered: number;
  totalShipped: number;
  totalRemaining: number;
  overallShipmentPct: number;
  fullyShipped: boolean;
  totalOrderValueFils: bigint;
  shippedValueFils: bigint;
  deliveryNoteCount: number;
}

function activeDeliveryNoteIds(deliveryNotes: ShipmentDeliveryNote[]): Set<bigint> {
  const ids = new Set<bigint>();
  for (const dn of deliveryNotes) {
    if (dn.status.tag !== 'Returned') {
      ids.add(dn.id);
    }
  }
  return ids;
}

/** Compute shipment status for a single line item */
export function computeLineItemShipment(
  lineItem: ShipmentLineItem,
  deliveryNotes: ShipmentDeliveryNote[],
  deliveryNoteItems: ShipmentDeliveryNoteItem[],
): LineItemShipmentStatus {
  const activeIds = activeDeliveryNoteIds(deliveryNotes);

  let quantityShipped = 0;
  for (const dni of deliveryNoteItems) {
    if (dni.lineItemId === lineItem.id && activeIds.has(dni.deliveryNoteId)) {
      quantityShipped += dni.quantityDelivered;
    }
  }

  const quantityOrdered = lineItem.quantity;
  const quantityRemaining = Math.max(0, quantityOrdered - quantityShipped);
  const shipmentPct = quantityOrdered === 0 ? 0 : (quantityShipped / quantityOrdered) * 100;
  const fullyShipped = quantityRemaining === 0 && quantityOrdered > 0;
  const valueFils = lineItem.unitPriceFils * BigInt(quantityOrdered);
  const shippedValueFils = lineItem.unitPriceFils * BigInt(quantityShipped);

  return {
    lineItemId: lineItem.id,
    description: lineItem.description,
    quantityOrdered,
    quantityShipped,
    quantityRemaining,
    shipmentPct,
    fullyShipped,
    valueFils,
    shippedValueFils,
  };
}

/** Compute shipment summary for an entire order */
export function computeOrderShipmentSummary(
  orderId: bigint,
  lineItems: ShipmentLineItem[],
  deliveryNotes: ShipmentDeliveryNote[],
  deliveryNoteItems: ShipmentDeliveryNoteItem[],
): OrderShipmentSummary {
  const orderDNs = deliveryNotes.filter((dn) => dn.orderId === orderId);
  const orderLineItems = lineItems.filter((li) => li.parentType === 'order' && li.parentId === orderId);

  const statuses = orderLineItems.map((li) =>
    computeLineItemShipment(li, orderDNs, deliveryNoteItems),
  );

  let totalOrdered = 0;
  let totalShipped = 0;
  let totalOrderValueFils = 0n;
  let shippedValueFils = 0n;

  for (const s of statuses) {
    totalOrdered += s.quantityOrdered;
    totalShipped += s.quantityShipped;
    totalOrderValueFils += s.valueFils;
    shippedValueFils += s.shippedValueFils;
  }

  const totalRemaining = Math.max(0, totalOrdered - totalShipped);
  const overallShipmentPct = totalOrdered === 0 ? 0 : (totalShipped / totalOrdered) * 100;
  const fullyShipped = totalRemaining === 0 && totalOrdered > 0;

  const activeIds = activeDeliveryNoteIds(orderDNs);
  const deliveryNoteCount = activeIds.size;

  return {
    orderId,
    lineItems: statuses,
    totalOrdered,
    totalShipped,
    totalRemaining,
    overallShipmentPct,
    fullyShipped,
    totalOrderValueFils,
    shippedValueFils,
    deliveryNoteCount,
  };
}

/** Check if an order can be invoiced (all items shipped) */
export function canInvoiceOrder(summary: OrderShipmentSummary): {
  canInvoice: boolean;
  reason: string;
} {
  if (summary.overallShipmentPct === 100) {
    return { canInvoice: true, reason: 'All items fully shipped' };
  }
  return {
    canInvoice: false,
    reason: `Only ${summary.overallShipmentPct.toFixed(1)}% shipped (${summary.totalRemaining} items remaining)`,
  };
}

/** Check if a line item can be added to a new delivery note (has remaining qty) */
export function availableForDelivery(
  lineItem: ShipmentLineItem,
  deliveryNotes: ShipmentDeliveryNote[],
  deliveryNoteItems: ShipmentDeliveryNoteItem[],
): { available: boolean; remainingQuantity: number } {
  const status = computeLineItemShipment(lineItem, deliveryNotes, deliveryNoteItems);
  return {
    available: status.quantityRemaining > 0,
    remainingQuantity: status.quantityRemaining,
  };
}

/** Format shipment progress as text */
export function formatShipmentProgress(summary: OrderShipmentSummary): string {
  const lines: string[] = [];
  lines.push(`Order ${summary.orderId}: ${summary.overallShipmentPct.toFixed(1)}% shipped`);
  lines.push(`  ${summary.totalShipped}/${summary.totalOrdered} items shipped, ${summary.totalRemaining} remaining`);
  lines.push(`  ${summary.deliveryNoteCount} delivery note(s)`);

  for (const li of summary.lineItems) {
    const marker = li.fullyShipped ? '[DONE]' : `[${li.shipmentPct.toFixed(0)}%]`;
    lines.push(`  ${marker} ${li.description}: ${li.quantityShipped}/${li.quantityOrdered}`);
  }

  if (summary.fullyShipped) {
    lines.push('  Status: Ready for invoice');
  } else {
    lines.push('  Status: Pending shipment');
  }

  return lines.join('\n');
}
