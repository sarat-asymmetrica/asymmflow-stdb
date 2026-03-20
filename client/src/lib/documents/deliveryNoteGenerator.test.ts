import assert from 'node:assert/strict';
import { buildDeliveryNoteDocDefinition, type DeliveryNoteData } from './deliveryNoteGenerator';

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

function createDeliveryNoteData(): DeliveryNoteData {
  return ({
    deliveryNote: {
      id: 9n,
      orderId: 5n,
      partyId: 2n,
      dnNumber: 'DN-2026-009',
      status: { tag: 'Dispatched' },
      deliveryDate: ts(1_710_000_000_000_000n),
      deliveryAddress: 'Alba Gate 4, Bahrain',
      driverName: 'Ravi Kumar',
      vehicleNumber: 'BHR-4521',
      receiverName: '',
      notes: 'Handle instruments with care.',
      createdBy: 'user-1',
      createdAt: ts(1_710_000_000_000_000n),
      updatedAt: ts(1_710_000_000_000_000n),
    },
    party: {
      id: 2n,
      name: 'Bahrain Process Control',
      isCustomer: true,
      isSupplier: false,
      grade: { tag: 'A' },
      creditLimitFils: 0n,
      isCreditBlocked: false,
      paymentTermsDays: 45n,
      productTypes: '',
      annualGoalFils: 0n,
      notes: '',
      createdAt: ts(1_700_000_000_000_000n),
      updatedAt: ts(1_700_000_000_000_000n),
    },
    orderReference: 'SO-005',
    items: [
      {
        deliveryItem: {
          id: 1n,
          deliveryNoteId: 9n,
          lineItemId: 14n,
          quantityDelivered: 2n,
          notes: 'Packed in wooden crate',
        },
        lineItem: {
          id: 14n,
          parentType: 'order',
          parentId: 5n,
          description: 'Ultrasonic Level Transmitter',
          quantity: 4n,
          unitPriceFils: 12_000n,
          totalPriceFils: 48_000n,
          fobCostFils: 0n,
          freightCostFils: 0n,
          customsCostFils: 0n,
          insuranceCostFils: 0n,
          handlingCostFils: 0n,
          financeCostFils: 0n,
          marginBps: 0,
          costPerUnitFils: 0n,
        },
      },
    ],
  }) as unknown as DeliveryNoteData;
}

const cases: Array<{ name: string; fn: () => void }> = [];

function test(name: string, fn: () => void) {
  cases.push({ name, fn });
}

test('deliveryNoteGenerator renders customer, order, and dispatch fields', () => {
  const { docDef } = buildDeliveryNoteDocDefinition(createDeliveryNoteData());
  const allText = extractText(docDef).join(' | ');

  assert.match(allText, /DELIVERY NOTE/);
  assert.match(allText, /Bahrain Process Control/);
  assert.match(allText, /DN Number/);
  assert.match(allText, /DN-2026-009/);
  assert.match(allText, /SO-005/);
  assert.match(allText, /Driver: Ravi Kumar/);
  assert.match(allText, /Vehicle: BHR-4521/);
});

test('deliveryNoteGenerator renders item quantities and signature section', () => {
  const { docDef } = buildDeliveryNoteDocDefinition(createDeliveryNoteData());
  const allText = extractText(docDef).join(' | ');

  assert.match(allText, /Ultrasonic Level Transmitter/);
  assert.match(allText, /Qty Delivered/);
  assert.match(allText, /Packed in wooden crate/);
  assert.match(allText, /Pending signature/);
  assert.match(allText, /Signature:/);
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
