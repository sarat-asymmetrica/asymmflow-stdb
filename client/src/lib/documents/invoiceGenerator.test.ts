import assert from 'node:assert/strict';
import { buildInvoiceDocDefinition, filsToWords, type InvoiceData } from './invoiceGenerator';

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
  } else if (Array.isArray(record.text)) {
    extractText(record.text, output);
  }

  for (const [key, value] of Object.entries(record)) {
    if (key !== 'image' && value !== record.text) {
      extractText(value, output);
    }
  }
  return output;
}

function createInvoiceData(): InvoiceData {
  return ({
    invoice: {
      id: 11n,
      partyId: 7n,
      orderId: 5n,
      kind: { tag: 'CustomerInvoice' },
      status: { tag: 'Active' },
      subtotalFils: 25_000n,
      vatFils: 2_500n,
      totalFils: 27_500n,
      reference: 'INV-2026-014',
      dueDate: ts(1_710_864_000_000_000n),
      paidAt: null,
      createdBy: 'user-1',
      createdAt: ts(1_710_000_000_000_000n),
      updatedAt: ts(1_710_000_000_000_000n),
    },
    party: {
      id: 7n,
      name: 'Acme Process Instruments',
      isCustomer: true,
      isSupplier: false,
      grade: { tag: 'B' },
      creditLimitFils: 100_000n,
      isCreditBlocked: false,
      paymentTermsDays: 90n,
      productTypes: 'Flow instruments',
      annualGoalFils: 500_000n,
      notes: 'TRN:123456789000001',
      createdAt: ts(1_700_000_000_000_000n),
      updatedAt: ts(1_700_000_000_000_000n),
    },
    lineItems: [
      {
        id: 1n,
        parentType: 'invoice',
        parentId: 11n,
        description: 'Magnetic Flow Meter',
        quantity: 2n,
        unitPriceFils: 12_500n,
        totalPriceFils: 25_000n,
        fobCostFils: 8_000n,
        freightCostFils: 600n,
        customsCostFils: 0n,
        insuranceCostFils: 0n,
        handlingCostFils: 0n,
        financeCostFils: 0n,
        marginBps: 1850,
        costPerUnitFils: 8_600n,
      },
    ],
    deliveryNoteNumber: 'DN-2026-008',
    deliveryNoteDate: '10-Mar-2026',
    customerPoNumber: 'PO-CUST-42',
    customerPoDate: '05-Mar-2026',
    placeOfSupply: 'Kingdom of Bahrain',
    destination: 'ALBA Gate 4',
    dispatchThrough: 'Own Vehicle',
    termsOfDelivery: 'Delivered duty paid',
    otherReferences: 'RFQ-889 / Project Alpha',
    showCostingColumns: {
      fob: true,
      freight: true,
      margin: true,
    },
  }) as unknown as InvoiceData;
}

const cases: Array<{ name: string; fn: () => void }> = [];

function test(name: string, fn: () => void) {
  cases.push({ name, fn });
}

test('invoiceGenerator renders the full Tally header fields', () => {
  const { docDef } = buildInvoiceDocDefinition(createInvoiceData());
  const allText = extractText(docDef).join(' | ');

  assert.match(allText, /Invoice No\./);
  assert.match(allText, /Date/);
  assert.match(allText, /Delivery Note#/);
  assert.match(allText, /DN Date/);
  assert.match(allText, /Customer PO#/);
  assert.match(allText, /PO Date/);
  assert.match(allText, /Place of Supply/);
  assert.match(allText, /Destination/);
  assert.match(allText, /Dispatch Through/);
  assert.match(allText, /Terms of Delivery/);
  assert.match(allText, /Other References/);
  assert.match(allText, /DN-2026-008/);
  assert.match(allText, /PO-CUST-42/);
  assert.match(allText, /Delivered duty paid/);
});

test('invoiceGenerator shows costing columns when enabled and totals stay consistent', () => {
  const { docDef } = buildInvoiceDocDefinition(createInvoiceData());
  const allText = extractText(docDef).join(' | ');

  assert.match(allText, /FOB \(BHD\)/);
  assert.match(allText, /Freight \(BHD\)/);
  assert.match(allText, /Margin %/);
  assert.match(allText, /8\.000/);
  assert.match(allText, /0\.600/);
  assert.match(allText, /18\.50%/);
  assert.match(allText, /25\.000/);
  assert.match(allText, /2\.500/);
  assert.match(allText, /27\.500/);
  assert.match(allText, /Twenty-Seven Bahraini Dinars and Five hundred fils/i);
});

test('filsToWords handles dinars and fils cleanly', () => {
  assert.equal(filsToWords(1_000n), 'One Bahraini Dinar');
  assert.equal(filsToWords(500n), 'Five hundred fils');
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
