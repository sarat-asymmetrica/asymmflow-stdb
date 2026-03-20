import assert from 'node:assert/strict';

import { buildPurchaseOrderSkillRequest } from './purchaseOrderSkill';

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

test('buildPurchaseOrderSkillRequest parses supplier, delivery terms, and line items', () => {
  const request = buildPurchaseOrderSkillRequest({
    supplierId: 8,
    orderId: 10,
    deliveryTerms: 'CIF Bahrain',
    items: JSON.stringify([
      { description: 'Valve', quantity: 2, unitPriceFils: 1500 },
      { description: 'Gauge', quantity: 1, unitPriceFils: 3000 },
    ]),
  });

  assert.equal(request.supplierId, 8n);
  assert.equal(request.orderId, 10n);
  assert.equal(request.deliveryTerms, 'CIF Bahrain');
  assert.equal(request.items.length, 2);
  assert.equal(request.totalFils, 6000n);
});

test('buildPurchaseOrderSkillRequest rejects missing delivery terms', () => {
  expectThrows(
    () =>
      buildPurchaseOrderSkillRequest({
        supplierId: 8,
        items: JSON.stringify([{ description: 'Valve', quantity: 2, unitPriceFils: 1500 }]),
      }),
    /deliveryTerms is required/,
  );
});

test('buildPurchaseOrderSkillRequest rejects invalid quantities or prices', () => {
  expectThrows(
    () =>
      buildPurchaseOrderSkillRequest({
        supplierId: 8,
        deliveryTerms: 'CIF Bahrain',
        items: JSON.stringify([{ description: 'Valve', quantity: 0, unitPriceFils: 1500 }]),
      }),
    /items\[0\]\.quantity/,
  );
});

let failures = 0;
for (const testCase of cases) {
  try {
    console.log(`RUN | ${testCase.name}`);
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
