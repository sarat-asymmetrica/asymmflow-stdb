import assert from 'node:assert/strict';
import { buildPurchaseOrderDocDefinition, type PurchaseOrderData } from './purchaseOrderGenerator';

type PlainObject = Record<string, unknown>;

function ts(microsSinceUnixEpoch: bigint) {
  return { microsSinceUnixEpoch };
}

function extractText(node: unknown, output: string[] = []): string[] {
  if (typeof node === 'string') {
    output.push(node);
    return output;
  }
  if (Array.isArray(node)) {
    for (const child of node) extractText(child, output);
    return output;
  }
  if (!node || typeof node !== 'object') {
    return output;
  }

  const record = node as PlainObject;
  if (typeof record.image === 'string') {
    return output;
  }
  if (typeof record.text === 'string') {
    output.push(record.text);
  }
  for (const [key, value] of Object.entries(record)) {
    if (key !== 'image' && key !== 'text') {
      extractText(value, output);
    }
  }
  return output;
}

function createPurchaseOrderData(): PurchaseOrderData {
  return ({
    purchaseOrder: {
      id: 12n,
      partyId: 4n,
      orderId: 8n,
      poNumber: 'PO-2024-012',
      status: { tag: 'Draft' },
      totalFils: 16_500n,
      createdBy: 'user-1',
      createdAt: ts(1_710_000_000_000_000n),
      updatedAt: ts(1_710_000_000_000_000n),
    },
    supplier: {
      id: 4n,
      name: 'Omega Valves LLC',
      isCustomer: false,
      isSupplier: true,
      grade: { tag: 'A' },
      creditLimitFils: 0n,
      isCreditBlocked: false,
      paymentTermsDays: 30n,
      productTypes: 'Valves',
      annualGoalFils: 0n,
      notes: 'TRN:998877665544332',
      createdAt: ts(1_700_000_000_000_000n),
      updatedAt: ts(1_700_000_000_000_000n),
    },
    lineItems: [
      {
        id: 1n,
        parentType: 'purchase_order',
        parentId: 12n,
        description: 'Pressure Relief Valve',
        quantity: 3n,
        unitPriceFils: 5_000n,
        totalPriceFils: 15_000n,
        fobCostFils: 0n,
        freightCostFils: 0n,
        customsCostFils: 0n,
        insuranceCostFils: 0n,
        handlingCostFils: 0n,
        financeCostFils: 0n,
        marginBps: 0,
        costPerUnitFils: 0n,
      },
    ],
    supplierReference: 'RFQ-221',
    buyerOrderNumber: 'SO-008',
    paymentTerms: 'Net 45 days from invoice date',
    deliveryTerms: 'CIF Bahrain',
    deliveryAddress: 'Sitra Warehouse, Bahrain',
    notes: 'Pack each unit separately.',
  }) as unknown as PurchaseOrderData;
}

const cases: Array<{ name: string; fn: () => void }> = [];

function test(name: string, fn: () => void) {
  cases.push({ name, fn });
}

test('purchaseOrderGenerator renders supplier and PO metadata', () => {
  const { docDef } = buildPurchaseOrderDocDefinition(createPurchaseOrderData());
  const allText = extractText(docDef).join(' | ');

  assert.match(allText, /PURCHASE ORDER/);
  assert.match(allText, /Omega Valves LLC/);
  assert.match(allText, /PO Number/);
  assert.match(allText, /PO-2024-012/);
  assert.match(allText, /Supplier Ref/);
  assert.match(allText, /Buyer Order No/);
  assert.match(allText, /Payment Terms/);
  assert.match(allText, /Delivery Terms/);
  assert.match(allText, /Sitra Warehouse, Bahrain/);
});

test('purchaseOrderGenerator totals include VAT and final total', () => {
  const { docDef } = buildPurchaseOrderDocDefinition(createPurchaseOrderData());
  const allText = extractText(docDef).join(' | ');

  assert.match(allText, /15\.000/);
  assert.match(allText, /1\.500/);
  assert.match(allText, /16\.500/);
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
