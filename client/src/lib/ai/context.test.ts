import assert from 'node:assert/strict';

import { buildBusinessState, buildSystemPrompt, type BusinessState } from './context';

const cases: Array<{ name: string; fn: () => void }> = [];

function test(name: string, fn: () => void): void {
  cases.push({ name, fn });
}

const state: BusinessState = {
  isMockData: false,
  customerCount: 10,
  supplierCount: 4,
  gradeBreakdown: { A: 2, B: 5, C: 3, D: 0, unknown: 0 },
  totalRevenueFils: 10_000n,
  totalPaymentsFils: 7_000n,
  totalOutstandingFils: 3_000n,
  totalOverdueFils: 1_000n,
  overdueCustomerCount: 2,
  collectionRatePct: '70.0%',
  pipelineValueFils: 8_000n,
  openPipelineCount: 3,
  activeOrderCount: 2,
  purchaseOrderCount: 5,
  deliveryNoteCount: 7,
  grnCount: 4,
  topOverdueCustomers: [{ name: 'Acme', outstandingBHD: '1.000', overdueDays: 20 }],
  recentActivitySummary: 'Last action: created on delivery_note #7',
};

test('buildSystemPrompt includes operational counts and new skill guidance', () => {
  const prompt = buildSystemPrompt(
    {
      identity: 'user-1',
      nickname: 'Sam',
      fullName: 'Sam Chan',
      role: { tag: 'Manager' },
    } as never,
    state,
  );

  assert.match(prompt, /Purchase orders: 5\s+\|\s+Delivery notes: 7\s+\|\s+GRNs: 4/);
  assert.match(prompt, /predict_payment_date .* Predict Payment Date/);
  assert.match(prompt, /generate_purchase_order .* Generate Purchase Order/);
  assert.match(prompt, /generate_delivery_note .* Generate Delivery Note/);
  assert.match(prompt, /PRODUCT MARKUP FLOORS/);
  assert.match(prompt, /E\+H Flow: min 12%, target 20%, max discount from target 5%/);
});

// Test that new Wave 1-8 skills are mentioned in the system prompt
test('buildSystemPrompt includes Wave 1-8 skill references', () => {
  const prompt = buildSystemPrompt(
    {
      identity: 'user-1',
      nickname: 'Sam',
      fullName: 'Sam Chan',
      role: { tag: 'Manager' },
    } as never,
    state,
  );

  assert.match(prompt, /compute_vat_return/);
  assert.match(prompt, /evaluate_risk_portfolio/);
  assert.match(prompt, /evaluate_alerts/);
  assert.match(prompt, /generate_contract/);
  assert.match(prompt, /parse_eh_basket/);
  assert.match(prompt, /import_tally/);
  assert.match(prompt, /check_shipment_status/);
  assert.match(prompt, /generate_sales_report/);
});

test('buildBusinessState floors outstanding at zero and formats collection rate without bigint underflow', async () => {
  const db = await import('../db');
  const { activityLogs, deliveryNotes, grns, moneyEvents, orders, parties, pipelines, purchaseOrders } = db;

  parties.set([
    {
      id: 1n,
      name: 'Advance Customer',
      code: '',
      category: '',
      isCustomer: true,
      isSupplier: false,
      grade: { tag: 'B' },
      creditLimitFils: 0n,
      isCreditBlocked: false,
      paymentTermsDays: 30n,
      productTypes: '',
      annualGoalFils: 0n,
      city: '',
      country: '',
      phone: '',
      email: '',
      source: '',
      active2024: false,
      active2025: false,
      active2026: false,
      notes: '',
      bankIban: '',
      bankSwift: '',
      bankAccountName: '',
      createdAt: {} as never,
      updatedAt: {} as never,
    },
  ]);
  pipelines.set([]);
  orders.set([]);
  purchaseOrders.set([]);
  deliveryNotes.set([]);
  grns.set([]);
  activityLogs.set([]);
  moneyEvents.set([
    {
      id: 1n,
      partyId: 1n,
      orderId: undefined,
      deliveryNoteId: undefined,
      kind: { tag: 'CustomerInvoice' },
      status: { tag: 'Active' },
      subtotalFils: 1_000n,
      vatFils: 100n,
      totalFils: 1_100n,
      reference: 'INV-1',
      sourceDate: undefined,
      dueDate: undefined,
      paidAt: undefined,
      createdBy: {} as never,
      createdAt: {} as never,
      updatedAt: {} as never,
    },
    {
      id: 2n,
      partyId: 1n,
      orderId: undefined,
      deliveryNoteId: undefined,
      kind: { tag: 'CustomerPayment' },
      status: { tag: 'Terminal' },
      subtotalFils: 2_000n,
      vatFils: 0n,
      totalFils: 2_000n,
      reference: 'PAY-1',
      sourceDate: undefined,
      dueDate: undefined,
      paidAt: undefined,
      createdBy: {} as never,
      createdAt: {} as never,
      updatedAt: {} as never,
    },
  ]);

  const snapshot = buildBusinessState();

  assert.equal(snapshot.totalOutstandingFils, 0n);
  assert.equal(snapshot.collectionRatePct, '181.81%');
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
