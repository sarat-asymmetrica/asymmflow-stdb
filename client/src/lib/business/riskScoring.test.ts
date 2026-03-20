import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  scoreCustomerRisk,
  evaluatePortfolioRisk,
  scoreToTier,
  generateRecommendation,
} from './riskScoring';
import type { RiskParty, RiskMoneyEvent, CustomerRiskScore } from './riskScoring';

const DAY_MICROS = 86_400_000_000n;

function ts(microsSinceUnixEpoch: bigint) {
  return { microsSinceUnixEpoch };
}

const now = 1_800_000_000_000_000n;

function makeParty(overrides: Partial<RiskParty> & { id: bigint }): RiskParty {
  return {
    name: 'Test Customer',
    isCustomer: true,
    grade: { tag: 'A' },
    creditLimitFils: 100_000n,
    paymentTermsDays: 30n,
    ...overrides,
  };
}

function makeInvoice(
  partyId: bigint,
  totalFils: bigint,
  createdAtMicros: bigint,
  dueDateMicros?: bigint,
): RiskMoneyEvent {
  return {
    partyId,
    kind: { tag: 'CustomerInvoice' },
    totalFils,
    dueDate: dueDateMicros !== undefined ? ts(dueDateMicros) : undefined,
    createdAt: ts(createdAtMicros),
  };
}

function makePayment(
  partyId: bigint,
  totalFils: bigint,
  createdAtMicros: bigint,
): RiskMoneyEvent {
  return {
    partyId,
    kind: { tag: 'CustomerPayment' },
    totalFils,
    createdAt: ts(createdAtMicros),
  };
}

// --- Test 1: Grade A, paid on time → low risk ---
test('scoreCustomerRisk: Grade A, paid on time yields low risk', () => {
  const party = makeParty({ id: 1n, grade: { tag: 'A' }, creditLimitFils: 100_000n });

  const invoiceCreated = now - 60n * DAY_MICROS;
  const invoiceDue = invoiceCreated + 30n * DAY_MICROS;
  const paymentDate = invoiceCreated + 25n * DAY_MICROS; // paid 5 days early

  const events: RiskMoneyEvent[] = [
    makeInvoice(1n, 20_000n, invoiceCreated, invoiceDue),
    makePayment(1n, 20_000n, paymentDate),
  ];

  const result = scoreCustomerRisk(party, events, now);

  assert.equal(result.tier, 'low');
  assert.ok(result.riskScore <= 25, `Expected score <= 25, got ${result.riskScore}`);
  assert.equal(result.grade, 'A');
  assert.equal(result.outstandingFils, 0n);
});

// --- Test 2: Grade D, over limit, >90 days overdue → critical ---
test('scoreCustomerRisk: Grade D, over limit, >90 days overdue yields critical', () => {
  const party = makeParty({
    id: 2n,
    name: 'Bad Debtor',
    grade: { tag: 'D' },
    creditLimitFils: 50_000n,
    paymentTermsDays: 30n,
  });

  const invoiceCreated = now - 120n * DAY_MICROS;
  const invoiceDue = invoiceCreated + 30n * DAY_MICROS; // due 90 days ago

  const events: RiskMoneyEvent[] = [
    makeInvoice(2n, 80_000n, invoiceCreated, invoiceDue), // over 50k limit, unpaid
  ];

  const result = scoreCustomerRisk(party, events, now);

  assert.equal(result.tier, 'critical');
  assert.ok(result.riskScore >= 76, `Expected score >= 76, got ${result.riskScore}`);
  assert.equal(result.outstandingFils, 80_000n);
  assert.ok(result.maxOverdueDays >= 90, `Expected maxOverdue >= 90, got ${result.maxOverdueDays}`);
  assert.ok(result.creditUtilizationPct > 100, `Expected utilization > 100%, got ${result.creditUtilizationPct}`);
});

// --- Test 3: Mixed factors → medium score ---
test('scoreCustomerRisk: mixed factors produce medium risk', () => {
  const party = makeParty({
    id: 3n,
    name: 'Average Co',
    grade: { tag: 'B' },
    creditLimitFils: 100_000n,
    paymentTermsDays: 30n,
  });

  // Invoice created 50 days ago, due 20 days ago, still unpaid
  const invoiceCreated = now - 50n * DAY_MICROS;
  const invoiceDue = now - 20n * DAY_MICROS;

  // Another invoice paid 10 days late
  const inv2Created = now - 80n * DAY_MICROS;
  const inv2Due = inv2Created + 30n * DAY_MICROS;
  const pay2Date = inv2Created + 40n * DAY_MICROS; // 10 days late

  const events: RiskMoneyEvent[] = [
    makeInvoice(3n, 60_000n, invoiceCreated, invoiceDue),
    makeInvoice(3n, 30_000n, inv2Created, inv2Due),
    makePayment(3n, 30_000n, pay2Date),
  ];

  const result = scoreCustomerRisk(party, events, now);

  assert.ok(result.riskScore > 25, `Expected score > 25, got ${result.riskScore}`);
  assert.ok(result.riskScore <= 75, `Expected score <= 75, got ${result.riskScore}`);
  assert.ok(
    result.tier === 'medium' || result.tier === 'high',
    `Expected medium or high, got ${result.tier}`,
  );
});

// --- Test 4: scoreToTier boundary values ---
test('scoreToTier: boundary values', () => {
  assert.equal(scoreToTier(0), 'low');
  assert.equal(scoreToTier(25), 'low');
  assert.equal(scoreToTier(26), 'medium');
  assert.equal(scoreToTier(50), 'medium');
  assert.equal(scoreToTier(51), 'high');
  assert.equal(scoreToTier(75), 'high');
  assert.equal(scoreToTier(76), 'critical');
  assert.equal(scoreToTier(100), 'critical');
});

// --- Test 5: evaluatePortfolioRisk: multiple customers → correct summary ---
test('evaluatePortfolioRisk: multiple customers produce correct summary', () => {
  const partyA = makeParty({ id: 10n, name: 'Good Co', grade: { tag: 'A' }, creditLimitFils: 200_000n });
  const partyD = makeParty({ id: 20n, name: 'Bad Co', grade: { tag: 'D' }, creditLimitFils: 50_000n });
  const supplier = makeParty({ id: 30n, name: 'Supplier', isCustomer: false });

  const invCreated = now - 120n * DAY_MICROS;

  const events: RiskMoneyEvent[] = [
    // Good Co: small invoice, paid on time
    makeInvoice(10n, 10_000n, now - 60n * DAY_MICROS, now - 30n * DAY_MICROS),
    makePayment(10n, 10_000n, now - 35n * DAY_MICROS),
    // Bad Co: large overdue invoice
    makeInvoice(20n, 80_000n, invCreated, invCreated + 30n * DAY_MICROS),
  ];

  const result = evaluatePortfolioRisk([partyA, partyD, supplier], events, now);

  assert.equal(result.totalCustomers, 2);
  assert.equal(result.byTier.low + result.byTier.medium + result.byTier.high + result.byTier.critical, 2);
  assert.equal(result.totalExposureFils, 80_000n); // Good Co is fully paid
  assert.ok(result.topRisks.length <= 5);
  assert.ok(result.topRisks.length > 0);
  // The riskiest customer should be Bad Co
  assert.equal(result.topRisks[0].partyId, 20n);
});

// --- Test 6: Concentration risk: one customer = all AR → high concentration factor ---
test('concentration risk: single customer owning all AR scores high concentration', () => {
  const party = makeParty({ id: 50n, grade: { tag: 'A' }, creditLimitFils: 1_000_000n });

  const events: RiskMoneyEvent[] = [
    makeInvoice(50n, 100_000n, now - 10n * DAY_MICROS, now + 20n * DAY_MICROS),
  ];

  // When scoring a single customer, totalAR = their outstanding
  const result = scoreCustomerRisk(party, events, now);

  const concentrationFactor = result.factors.find(f => f.name === 'Concentration risk');
  assert.ok(concentrationFactor, 'Concentration factor should exist');
  assert.equal(concentrationFactor.weight, 20, 'Single customer = 100% of AR should score 20');
});

// --- Test 7: No payment history: falls back to payment terms + grade ---
test('no payment history: uses payment terms as fallback for avg days to payment', () => {
  const party = makeParty({
    id: 60n,
    grade: { tag: 'C' },
    creditLimitFils: 200_000n,
    paymentTermsDays: 30n,
  });

  // One invoice, no payments
  const events: RiskMoneyEvent[] = [
    makeInvoice(60n, 50_000n, now - 10n * DAY_MICROS, now + 20n * DAY_MICROS),
  ];

  const result = scoreCustomerRisk(party, events, now);

  // With no payment history, avgDaysToPayment should equal paymentTermsDays
  assert.equal(result.avgDaysToPayment, 30);
  // Payment behavior factor should be 0 (pays at terms = on time)
  const paymentFactor = result.factors.find(f => f.name === 'Payment behavior');
  assert.ok(paymentFactor, 'Payment factor should exist');
  assert.equal(paymentFactor.weight, 0, 'Paying at terms should count as on time');
});

// --- Test 8: generateRecommendation: correct text per tier ---
test('generateRecommendation: returns correct text for each tier', () => {
  const base: CustomerRiskScore = {
    partyId: 1n,
    name: 'Test',
    grade: 'A',
    riskScore: 0,
    tier: 'low',
    factors: [],
    outstandingFils: 0n,
    creditUtilizationPct: 0,
    avgDaysToPayment: 0,
    maxOverdueDays: 0,
    recommendation: '',
  };

  const low = { ...base, tier: 'low' as const, riskScore: 10 };
  assert.equal(
    generateRecommendation(low),
    'Continue standard terms. Review at next quarterly assessment.',
  );

  const medium = { ...base, tier: 'medium' as const, riskScore: 40 };
  assert.equal(
    generateRecommendation(medium),
    'Monitor payment patterns. Consider reducing credit limit if trend continues.',
  );

  const high = { ...base, tier: 'high' as const, riskScore: 60 };
  assert.equal(
    generateRecommendation(high),
    'Restrict new orders. Initiate formal payment chase. Review grade downgrade.',
  );

  const critical = { ...base, tier: 'critical' as const, riskScore: 90 };
  assert.equal(
    generateRecommendation(critical),
    'Block new credit. Escalate to management. Consider legal action for overdue amounts.',
  );
});
