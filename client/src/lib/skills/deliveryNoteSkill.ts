import type { LineItem, Order } from '../db';
import { asPositiveBigInt, parseJsonArray } from './utils';

export type DeliveryNoteSkillItem = {
  lineItemId: bigint;
  quantityDelivered: bigint;
  notes: string;
  description: string;
};

export type DeliveryNoteSkillRequest = {
  orderId: bigint;
  deliveryAddress: string;
  driverName: string;
  vehicleNumber: string;
  items: DeliveryNoteSkillItem[];
};

export function buildDeliveryNoteSkillRequest(
  params: Record<string, unknown>,
  order: Order,
  orderLineItems: LineItem[],
): DeliveryNoteSkillRequest {
  const deliveryAddress = String(params.deliveryAddress ?? '').trim();
  if (!deliveryAddress) {
    throw new Error('deliveryAddress is required');
  }

  const driverName = String(params.driverName ?? '').trim();
  const vehicleNumber = String(params.vehicleNumber ?? '').trim();
  const parsedItems = parseJsonArray(params.items);
  if (parsedItems.length === 0) {
    throw new Error('items must contain at least one delivery line');
  }

  const orderLineItemMap = new Map(orderLineItems.map((item) => [item.id, item]));
  const items = parsedItems.map((item, index) => {
    const lineItemId = asPositiveBigInt(item.lineItemId, `items[${index}].lineItemId`);
    const quantityDelivered = asPositiveBigInt(item.quantityDelivered, `items[${index}].quantityDelivered`);
    const notes = String(item.notes ?? '').trim();
    const source = orderLineItemMap.get(lineItemId);

    if (!source) {
      throw new Error(`items[${index}].lineItemId ${lineItemId} does not belong to order #${order.id}`);
    }
    if (quantityDelivered > source.quantity) {
      throw new Error(
        `items[${index}].quantityDelivered (${quantityDelivered}) exceeds ordered quantity (${source.quantity})`,
      );
    }

    return {
      lineItemId,
      quantityDelivered,
      notes,
      description: source.description,
    };
  });

  return {
    orderId: order.id,
    deliveryAddress,
    driverName,
    vehicleNumber,
    items,
  };
}
