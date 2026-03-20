import assert from 'node:assert/strict';

import { buildQuotationDocDefinition, type QuotationData } from './quotationGenerator';

type PlainObject = Record<string, unknown>;

const storage = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem(key: string) {
    return storage.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    storage.set(key, value);
  },
};

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

function createQuotationData(): QuotationData {
  return {
    party: {
      id: 1n,
      name: 'Tatweer Petroleum',
      isCustomer: true,
      isSupplier: false,
      grade: { tag: 'B' },
      creditLimitFils: 50_000_000n,
      isCreditBlocked: false,
      paymentTermsDays: 90n,
      productTypes: 'Analyzers',
      annualGoalFils: 90_000_000n,
      notes: '',
      createdAt: ts(1n),
      updatedAt: ts(1n),
    } as never,
    items: [
      { description: 'Portable gas analyzer', quantity: 2, unit: 'EA', unitPriceFils: 5_500_000n },
      { description: 'Commissioning', quantity: 1, unit: 'LOT', unitPriceFils: 1_250_000n },
    ],
    validityDays: 30,
    deliveryTimeline: '4-6 weeks from PO',
    notes: 'Installation excluded.',
    buyerAddress: 'Awali Field\nKingdom of Bahrain',
    attention: 'Maintenance Team',
  };
}

const cases: Array<{ name: string; fn: () => void }> = [];

function test(name: string, fn: () => void) {
  cases.push({ name, fn });
}

test('quotationGenerator renders buyer block, validity, and delivery terms', () => {
  const { docDef, quotNo } = buildQuotationDocDefinition(createQuotationData());
  const allText = extractText(docDef).join(' | ');

  assert.match(quotNo, /^PH\d{4}-\d{4}$/);
  assert.match(allText, /PROFORMA INVOICE/);
  assert.match(allText, /Tatweer Petroleum/);
  assert.match(allText, /Maintenance Team/);
  assert.match(allText, /4-6 weeks from PO/);
  assert.match(allText, /valid for 30 days/i);
});

test('quotationGenerator totals include VAT and grand total', () => {
  const { docDef } = buildQuotationDocDefinition(createQuotationData());
  const allText = extractText(docDef).join(' | ');

  assert.match(allText, /VAT 10%/);
  assert.match(allText, /TOTAL/);
  assert.match(allText, /1,225\.000|1\.225/);
  assert.match(allText, /13,475\.000|13\.475/);
  assert.match(allText, /\(THIRTEEN THOUSAND FOUR HUNDRED SEVENTY-FIVE BAHRAINI DINARS ONLY\)/);
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
