import assert from 'node:assert/strict';
import {
  selectClauses,
  generateContract,
  formatContractText,
  CLAUSE_LIBRARY,
  type ContractInput,
  type ContractParty,
  type ContractLineItem,
} from './contractGenerator';

const cases: Array<{ name: string; fn: () => void }> = [];

function test(name: string, fn: () => void) {
  cases.push({ name, fn });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeParty(overrides: Partial<ContractParty> = {}): ContractParty {
  return {
    name: 'EWA \u2014 Electricity & Water Authority',
    grade: 'A',
    paymentTermsDays: 45,
    creditLimitFils: 50_000_000n, // BHD 50,000
    ...overrides,
  };
}

function makeItems(): ContractLineItem[] {
  return [
    { description: 'Cerabar PMP71 Pressure Transmitter', quantity: 3, unitPriceFils: 540_000n },
    { description: 'Liquiline CM442 Analyser', quantity: 1, unitPriceFils: 2_250_000n },
  ];
}

function makeInput(overrides: Partial<ContractInput> = {}): ContractInput {
  return {
    party: makeParty(),
    items: makeItems(),
    contractNumber: 'CON-2026-001',
    issueDate: '2026-03-20',
    validityDays: 91,
    deliveryTerms: 'CIF Bahrain',
    ...overrides,
  };
}

// ── 1. selectClauses Grade A ─────────────────────────────────────────────────

test('selectClauses Grade A includes credit, discount, payment_credit and excludes advance clauses', () => {
  const clauses = selectClauses('A');
  const ids = clauses.map((c) => c.id);

  // Must include grade A specific clauses
  assert.ok(ids.includes('payment_credit'), 'should include payment_credit');
  assert.ok(ids.includes('credit_limit'), 'should include credit_limit');
  assert.ok(ids.includes('discount'), 'should include discount');

  // Must include mandatory clauses
  assert.ok(ids.includes('scope'), 'should include scope');
  assert.ok(ids.includes('vat'), 'should include vat');
  assert.ok(ids.includes('delivery'), 'should include delivery');

  // Must exclude advance / no-credit clauses
  assert.ok(!ids.includes('payment_advance_50'), 'should exclude payment_advance_50');
  assert.ok(!ids.includes('payment_advance_100'), 'should exclude payment_advance_100');
  assert.ok(!ids.includes('no_credit'), 'should exclude no_credit');
});

// ── 2. selectClauses Grade D ─────────────────────────────────────────────────

test('selectClauses Grade D includes advance_100, no_credit and excludes credit/discount', () => {
  const clauses = selectClauses('D');
  const ids = clauses.map((c) => c.id);

  // Must include grade D specific clauses
  assert.ok(ids.includes('payment_advance_100'), 'should include payment_advance_100');
  assert.ok(ids.includes('no_credit'), 'should include no_credit');

  // Must include mandatory clauses
  assert.ok(ids.includes('scope'), 'should include scope');
  assert.ok(ids.includes('governing_law'), 'should include governing_law');

  // Must exclude A/B-only clauses
  assert.ok(!ids.includes('payment_credit'), 'should exclude payment_credit');
  assert.ok(!ids.includes('credit_limit'), 'should exclude credit_limit');
  assert.ok(!ids.includes('discount'), 'should exclude discount');

  // Must exclude C-only clauses
  assert.ok(!ids.includes('payment_advance_50'), 'should exclude payment_advance_50');
});

// ── 3. generateContract: correct totals with VAT ─────────────────────────────

test('generateContract computes correct subtotal, VAT, and total', () => {
  const contract = generateContract(makeInput());

  // 3 * 540_000 + 1 * 2_250_000 = 1_620_000 + 2_250_000 = 3_870_000
  assert.equal(contract.subtotalFils, 3_870_000n);

  // VAT 10%: (3_870_000 * 10 + 50) / 100 = 38_700_050 / 100 = 387_000 (truncated)
  assert.equal(contract.vatFils, 387_000n);

  // Total
  assert.equal(contract.totalFils, 3_870_000n + 387_000n);
  assert.equal(contract.totalFils, 4_257_000n);
});

// ── 4. generateContract: clause placeholder substitution ─────────────────────

test('generateContract substitutes placeholders in clause bodies', () => {
  const input = makeInput({
    party: makeParty({ paymentTermsDays: 45, creditLimitFils: 50_000_000n }),
    deliveryTerms: 'CIF Bahrain',
  });
  const contract = generateContract(input);

  const paymentClause = contract.clauses.find((c) => c.id === 'payment_credit');
  assert.ok(paymentClause, 'payment_credit clause must exist');
  assert.ok(paymentClause.body.includes('45 days'), 'should substitute paymentTermsDays');
  assert.ok(!paymentClause.body.includes('{paymentTermsDays}'), 'placeholder should be gone');

  const creditClause = contract.clauses.find((c) => c.id === 'credit_limit');
  assert.ok(creditClause, 'credit_limit clause must exist');
  assert.ok(creditClause.body.includes('50,000.000'), 'should substitute creditLimit in BHD');
  assert.ok(!creditClause.body.includes('{creditLimit}'), 'placeholder should be gone');

  const deliveryClause = contract.clauses.find((c) => c.id === 'delivery');
  assert.ok(deliveryClause, 'delivery clause must exist');
  assert.ok(deliveryClause.body.includes('CIF Bahrain'), 'should substitute deliveryTerms');
  assert.ok(!deliveryClause.body.includes('{deliveryTerms}'), 'placeholder should be gone');
});

// ── 5. generateContract: expiry date calculation ─────────────────────────────

test('generateContract calculates correct expiry date', () => {
  const contract = generateContract(makeInput({
    issueDate: '2026-03-20',
    validityDays: 91,
  }));
  // 2026-03-20 + 91 days = 2026-06-19
  assert.equal(contract.expiryDate, '2026-06-19');
});

// ── 6. formatContractText: contains expected sections ────────────────────────

test('formatContractText contains all expected sections', () => {
  const contract = generateContract(makeInput());
  const text = formatContractText(contract);

  // Header
  assert.ok(text.includes('PH TRADING WLL'), 'should include company name');
  assert.ok(text.includes('COMMERCIAL CONTRACT'), 'should include title');
  assert.ok(text.includes('CON-2026-001'), 'should include contract number');
  assert.ok(text.includes('20 March 2026'), 'should include formatted issue date');
  assert.ok(text.includes('19 June 2026'), 'should include formatted expiry date');

  // Parties
  assert.ok(text.includes('PH Trading WLL ("Supplier")'), 'should include supplier');
  assert.ok(text.includes('("Buyer")'), 'should include buyer designation');
  assert.ok(text.includes('Customer Grade: A'), 'should include grade');

  // Schedule
  assert.ok(text.includes('SCHEDULE OF SUPPLY'), 'should include schedule heading');
  assert.ok(text.includes('Cerabar PMP71 Pressure Transmitter'), 'should include line item');
  assert.ok(text.includes('BHD 3,870.000'), 'should include subtotal');
  assert.ok(text.includes('BHD 387.000'), 'should include VAT');
  assert.ok(text.includes('BHD 4,257.000'), 'should include total');

  // Terms
  assert.ok(text.includes('TERMS AND CONDITIONS'), 'should include T&C heading');
  assert.ok(text.includes('SCOPE OF SUPPLY'), 'should include clause title');
  assert.ok(text.includes('PAYMENT TERMS'), 'should include payment terms clause');
});

// ── 7. Edge case: empty items list ───────────────────────────────────────────

test('generateContract handles empty items list with zero totals', () => {
  const contract = generateContract(makeInput({ items: [] }));

  assert.equal(contract.subtotalFils, 0n);
  assert.equal(contract.vatFils, 0n);
  assert.equal(contract.totalFils, 0n);
  assert.equal(contract.items.length, 0);

  // Should still produce clauses
  assert.ok(contract.clauses.length > 0, 'should still have clauses');

  // Format should not crash
  const text = formatContractText(contract);
  assert.ok(text.includes('SCHEDULE OF SUPPLY'), 'should still include schedule heading');
  assert.ok(text.includes('BHD 0.000'), 'should show zero total');
});

// ── Runner ───────────────────────────────────────────────────────────────────

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
