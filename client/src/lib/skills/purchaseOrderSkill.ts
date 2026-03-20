import { asPositiveBigInt, parseJsonArray } from './utils';

export type PurchaseOrderSkillItem = {
  description: string;
  quantity: bigint;
  unitPriceFils: bigint;
};

export type PurchaseOrderSkillRequest = {
  supplierId: bigint;
  orderId?: bigint;
  deliveryTerms: string;
  items: PurchaseOrderSkillItem[];
  totalFils: bigint;
};

export function buildPurchaseOrderSkillRequest(params: Record<string, unknown>): PurchaseOrderSkillRequest {
  if (params.supplierId == null) {
    throw new Error('supplierId is required');
  }

  const supplierId = asPositiveBigInt(params.supplierId, 'supplierId');
  const deliveryTerms = String(params.deliveryTerms ?? '').trim();
  if (!deliveryTerms) {
    throw new Error('deliveryTerms is required');
  }

  const items = parseJsonArray(params.items).map((item, index) => {
    const description = String(item.description ?? '').trim();
    if (!description) throw new Error(`items[${index}].description is required`);
    const quantity = asPositiveBigInt(item.quantity, `items[${index}].quantity`);
    const unitPriceFils = asPositiveBigInt(item.unitPriceFils, `items[${index}].unitPriceFils`);
    return { description, quantity, unitPriceFils };
  });

  if (items.length === 0) {
    throw new Error('items must contain at least one purchase-order line');
  }

  const totalFils = items.reduce((sum, item) => sum + item.quantity * item.unitPriceFils, 0n);
  const orderId = params.orderId == null ? undefined : asPositiveBigInt(params.orderId, 'orderId');

  return {
    supplierId,
    orderId,
    deliveryTerms,
    items,
    totalFils,
  };
}
