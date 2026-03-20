import { computeARAgingRows, computeARAgingTotals } from '../business/arAging';
import type {
  DeliveryNote,
  DeliveryNoteItem,
  LineItem,
  MoneyEvent,
  Order,
  Party,
} from '../db';

export function buildARAgingSnapshot(parties: Party[], moneyEvents: MoneyEvent[], nowMicros: bigint) {
  const rows = computeARAgingRows(parties, moneyEvents, nowMicros);
  const totals = computeARAgingTotals(rows);

  return {
    rows,
    totals,
    summary:
      rows.length === 0
        ? 'AR aging is clear with no outstanding customer balances.'
        : `AR aging shows ${rows.length} customer${rows.length === 1 ? '' : 's'} with ${totals.total} fils outstanding.`,
  };
}

export function buildOrderStatusSnapshot(args: {
  order: Order;
  party: Party;
  orderLineItems: LineItem[];
  deliveryNotes: DeliveryNote[];
  deliveryNoteItems: DeliveryNoteItem[];
  moneyEvents: MoneyEvent[];
}) {
  const returnedDnIds = new Set(
    args.deliveryNotes.filter((note) => note.status.tag === 'Returned').map((note) => note.id),
  );

  const deliveredByLineItem = new Map<bigint, bigint>();
  for (const item of args.deliveryNoteItems) {
    if (returnedDnIds.has(item.deliveryNoteId)) continue;
    deliveredByLineItem.set(
      item.lineItemId,
      (deliveredByLineItem.get(item.lineItemId) ?? 0n) + item.quantityDelivered,
    );
  }

  const orderedQuantity = args.orderLineItems.reduce((sum, item) => sum + item.quantity, 0n);
  const deliveredQuantity = args.orderLineItems.reduce(
    (sum, item) => sum + (deliveredByLineItem.get(item.id) ?? 0n),
    0n,
  );

  const dnItemsByNote = new Map<bigint, DeliveryNoteItem[]>();
  for (const item of args.deliveryNoteItems) {
    const rows = dnItemsByNote.get(item.deliveryNoteId) ?? [];
    rows.push(item);
    dnItemsByNote.set(item.deliveryNoteId, rows);
  }

  const linkedDeliveryNotes = args.deliveryNotes
    .map((note) => ({
      id: String(note.id),
      dnNumber: note.dnNumber,
      status: note.status.tag,
      itemCount: (dnItemsByNote.get(note.id) ?? []).length,
      quantityDelivered: (dnItemsByNote.get(note.id) ?? []).reduce((sum, item) => sum + item.quantityDelivered, 0n),
    }))
    .sort((a, b) => Number(BigInt(b.id) - BigInt(a.id)));

  const linkedInvoices = args.moneyEvents
    .filter((event) => event.kind.tag === 'CustomerInvoice' && event.orderId === args.order.id)
    .map((event) => ({
      id: String(event.id),
      reference: event.reference || `INV-${String(event.id).padStart(3, '0')}`,
      status: event.status.tag,
      totalFils: event.totalFils,
      deliveryNoteId: event.deliveryNoteId ? String(event.deliveryNoteId) : null,
    }))
    .sort((a, b) => Number(BigInt(b.id) - BigInt(a.id)));

  const linkedPayments = args.moneyEvents
    .filter((event) => event.kind.tag === 'CustomerPayment' && event.orderId === args.order.id)
    .map((event) => ({
      id: String(event.id),
      reference: event.reference || `PAY-${String(event.id).padStart(3, '0')}`,
      totalFils: event.totalFils,
    }))
    .sort((a, b) => Number(BigInt(b.id) - BigInt(a.id)));

  const orderInvoicedFils = linkedInvoices.reduce((sum, event) => sum + event.totalFils, 0n);
  const orderCollectedFils = linkedPayments.reduce((sum, event) => sum + event.totalFils, 0n);
  const orderOutstandingFils = orderInvoicedFils > orderCollectedFils ? orderInvoicedFils - orderCollectedFils : 0n;

  let customerInvoicedFils = 0n;
  let customerPaidFils = 0n;
  for (const event of args.moneyEvents) {
    if (event.partyId !== args.party.id) continue;
    if (event.kind.tag === 'CustomerInvoice') customerInvoicedFils += event.totalFils;
    if (event.kind.tag === 'CustomerPayment') customerPaidFils += event.totalFils;
  }
  const customerOutstandingFils =
    customerInvoicedFils > customerPaidFils ? customerInvoicedFils - customerPaidFils : 0n;

  return {
    orderId: String(args.order.id),
    partyId: String(args.party.id),
    partyName: args.party.name,
    orderStatus: args.order.status.tag,
    poReference: args.order.poReference,
    orderedQuantity: String(orderedQuantity),
    deliveredQuantity: String(deliveredQuantity),
    deliveryProgress: orderedQuantity === 0n ? '0/0' : `${deliveredQuantity}/${orderedQuantity}`,
    linkedDeliveryNotes,
    linkedInvoices,
    linkedPayments,
    orderInvoicedFils: String(orderInvoicedFils),
    orderCollectedFils: String(orderCollectedFils),
    orderOutstandingFils: String(orderOutstandingFils),
    customerOutstandingFils: String(customerOutstandingFils),
  };
}
