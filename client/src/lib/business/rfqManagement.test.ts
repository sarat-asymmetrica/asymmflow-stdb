import assert from 'node:assert/strict';
import {
  createEmptyRFQStore,
  registerRFQ,
  updateRFQStatus,
  computeRFQDashboard,
  findOverdueRFQs,
  findDueSoonRFQs,
  prioritizeRFQs,
  saveRFQStore,
  loadRFQStore,
  formatRFQSummary,
} from './rfqManagement';
import type { RFQPipeline } from './rfqManagement';

// Minimal localStorage shim for Node
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
};

const cases: Array<{ name: string; fn: () => void }> = [];
function test(name: string, fn: () => void) {
  cases.push({ name, fn });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePipeline(overrides: Partial<RFQPipeline> & { id: bigint }): RFQPipeline {
  return {
    partyId: 1n,
    title: 'Test Pipeline',
    status: { tag: 'Draft' },
    estimatedValueFils: 5_000_000n,
    competitorPresent: false,
    createdAt: { microsSinceUnixEpoch: 0n },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. registerRFQ: creates entry correctly
// ---------------------------------------------------------------------------
test('registerRFQ: creates entry correctly', () => {
  const s0 = createEmptyRFQStore();
  assert.equal(s0.entries.length, 0);
  assert.equal(s0.version, 0);

  const s1 = registerRFQ(
    s0,
    '100',
    'RFQ-2026-001',
    '2026-03-01',
    '2026-03-20',
    'email',
    'Urgent steel order',
  );

  assert.equal(s1.entries.length, 1);
  assert.equal(s1.version, 1);
  assert.equal(s1.entries[0].pipelineId, '100');
  assert.equal(s1.entries[0].rfqReference, 'RFQ-2026-001');
  assert.equal(s1.entries[0].receivedDate, '2026-03-01');
  assert.equal(s1.entries[0].responseDeadline, '2026-03-20');
  assert.equal(s1.entries[0].status, 'received');
  assert.equal(s1.entries[0].source, 'email');
  assert.equal(s1.entries[0].notes, 'Urgent steel order');
  assert.equal(s1.entries[0].responseSubmittedDate, undefined);

  // Original store unchanged (immutable)
  assert.equal(s0.entries.length, 0);
  assert.equal(s0.version, 0);

  // Notes default to empty string
  const s2 = registerRFQ(s1, '101', 'RFQ-2026-002', '2026-03-05', '2026-03-25', 'portal');
  assert.equal(s2.entries.length, 2);
  assert.equal(s2.entries[1].notes, '');
});

// ---------------------------------------------------------------------------
// 2. updateRFQStatus: changes status, sets response date
// ---------------------------------------------------------------------------
test('updateRFQStatus: changes status and sets response date', () => {
  let s = createEmptyRFQStore();
  s = registerRFQ(s, '200', 'RFQ-UPD-001', '2026-03-01', '2026-03-20', 'phone');
  s = registerRFQ(s, '201', 'RFQ-UPD-002', '2026-03-02', '2026-03-22', 'tender');

  const s2 = updateRFQStatus(s, '200', 'quoted', '2026-03-15');

  assert.equal(s2.entries[0].status, 'quoted');
  assert.equal(s2.entries[0].responseSubmittedDate, '2026-03-15');
  // Other entry unaffected
  assert.equal(s2.entries[1].status, 'received');
  assert.equal(s2.entries[1].responseSubmittedDate, undefined);
  assert.equal(s2.version, s.version + 1);

  // Original unchanged
  assert.equal(s.entries[0].status, 'received');
});

// ---------------------------------------------------------------------------
// 3. computeRFQDashboard: correct counts and overdue
// ---------------------------------------------------------------------------
test('computeRFQDashboard: correct counts and overdue', () => {
  let s = createEmptyRFQStore();
  s = registerRFQ(s, '300', 'RFQ-D-001', '2026-03-01', '2026-03-10', 'email'); // overdue
  s = registerRFQ(s, '301', 'RFQ-D-002', '2026-03-05', '2026-03-22', 'portal'); // due soon (2 days)
  s = registerRFQ(s, '302', 'RFQ-D-003', '2026-03-10', '2026-04-10', 'phone'); // far out
  s = updateRFQStatus(s, '302', 'reviewing');

  const pipelines: RFQPipeline[] = [
    makePipeline({ id: 300n, estimatedValueFils: 2_000_000n }),
    makePipeline({ id: 301n, estimatedValueFils: 3_000_000n }),
    makePipeline({ id: 302n, estimatedValueFils: 4_000_000n }),
  ];

  const now = '2026-03-20T00:00:00.000Z';
  const dash = computeRFQDashboard(s, pipelines, now);

  assert.equal(dash.total, 3);
  assert.equal(dash.byStatus.received, 2);
  assert.equal(dash.byStatus.reviewing, 1);
  assert.equal(dash.byStatus.quoted, 0);
  assert.equal(dash.overdue.length, 1);
  assert.equal(dash.overdue[0].rfqReference, 'RFQ-D-001');
  assert.equal(dash.dueSoon.length, 1);
  assert.equal(dash.dueSoon[0].rfqReference, 'RFQ-D-002');
  // All 3 are active, total value
  assert.equal(dash.totalValueFils, 9_000_000n);
});

// ---------------------------------------------------------------------------
// 4. findOverdueRFQs: past deadline + not quoted
// ---------------------------------------------------------------------------
test('findOverdueRFQs: past deadline and not yet quoted', () => {
  let s = createEmptyRFQStore();
  s = registerRFQ(s, '400', 'RFQ-OD-001', '2026-03-01', '2026-03-15', 'email');
  s = registerRFQ(s, '401', 'RFQ-OD-002', '2026-03-01', '2026-03-25', 'email');
  s = registerRFQ(s, '402', 'RFQ-OD-003', '2026-03-01', '2026-03-10', 'email');
  s = updateRFQStatus(s, '402', 'quoted', '2026-03-09');

  const overdue = findOverdueRFQs(s, '2026-03-20T00:00:00.000Z');
  assert.equal(overdue.length, 1);
  assert.equal(overdue[0].pipelineId, '400');

  // Expired status should not be overdue
  s = updateRFQStatus(s, '400', 'expired');
  const overdue2 = findOverdueRFQs(s, '2026-03-20T00:00:00.000Z');
  assert.equal(overdue2.length, 0);
});

// ---------------------------------------------------------------------------
// 5. findDueSoonRFQs: within 3 days
// ---------------------------------------------------------------------------
test('findDueSoonRFQs: within 3 days', () => {
  let s = createEmptyRFQStore();
  s = registerRFQ(s, '500', 'RFQ-DS-001', '2026-03-01', '2026-03-21', 'email'); // 1 day
  s = registerRFQ(s, '501', 'RFQ-DS-002', '2026-03-01', '2026-03-23', 'email'); // 3 days
  s = registerRFQ(s, '502', 'RFQ-DS-003', '2026-03-01', '2026-03-24', 'email'); // 4 days — out
  s = registerRFQ(s, '503', 'RFQ-DS-004', '2026-03-01', '2026-03-19', 'email'); // past — out (overdue)

  const dueSoon = findDueSoonRFQs(s, '2026-03-20T00:00:00.000Z');
  assert.equal(dueSoon.length, 2);
  const refs = dueSoon.map((e) => e.rfqReference).sort();
  assert.deepEqual(refs, ['RFQ-DS-001', 'RFQ-DS-002']);

  // Custom window: 5 days
  const dueSoon5 = findDueSoonRFQs(s, '2026-03-20T00:00:00.000Z', 5);
  assert.equal(dueSoon5.length, 3);
});

// ---------------------------------------------------------------------------
// 6. prioritizeRFQs: urgent/high/normal/low classification
// ---------------------------------------------------------------------------
test('prioritizeRFQs: urgent/high/normal/low classification', () => {
  let s = createEmptyRFQStore();
  // Urgent: deadline within 2 days
  s = registerRFQ(s, '600', 'RFQ-P-URG', '2026-03-01', '2026-03-21', 'email');
  // High: competitor present + deadline within 7 days
  s = registerRFQ(s, '601', 'RFQ-P-HIGH-COMP', '2026-03-01', '2026-03-26', 'portal');
  // High: value > 10,000 BHD + deadline within 5 days
  s = registerRFQ(s, '602', 'RFQ-P-HIGH-VAL', '2026-03-01', '2026-03-24', 'phone');
  // Normal: deadline within 14 days
  s = registerRFQ(s, '603', 'RFQ-P-NORM', '2026-03-01', '2026-04-02', 'tender');
  // Low: deadline far out
  s = registerRFQ(s, '604', 'RFQ-P-LOW', '2026-03-01', '2026-04-30', 'email');

  const pipelines: RFQPipeline[] = [
    makePipeline({ id: 600n, estimatedValueFils: 1_000_000n }),
    makePipeline({ id: 601n, estimatedValueFils: 1_000_000n, competitorPresent: true }),
    makePipeline({ id: 602n, estimatedValueFils: 15_000_000n }), // 15,000 BHD > 10,000
    makePipeline({ id: 603n, estimatedValueFils: 1_000_000n }),
    makePipeline({ id: 604n, estimatedValueFils: 500_000n }),
  ];

  const now = '2026-03-20T00:00:00.000Z';
  const results = prioritizeRFQs(s, pipelines, now);

  assert.equal(results.length, 5);

  const byId = new Map(results.map((r) => [r.pipelineId, r]));
  assert.equal(byId.get('600')!.priority, 'urgent');
  assert.equal(byId.get('601')!.priority, 'high');
  assert.equal(byId.get('602')!.priority, 'high');
  assert.equal(byId.get('603')!.priority, 'normal');
  assert.equal(byId.get('604')!.priority, 'low');

  // Quoted entries should not appear
  s = updateRFQStatus(s, '600', 'quoted', '2026-03-20');
  const results2 = prioritizeRFQs(s, pipelines, now);
  assert.equal(results2.length, 4);
  assert.ok(!results2.some((r) => r.pipelineId === '600'));
});

// ---------------------------------------------------------------------------
// 7. winRate: correct percentage
// ---------------------------------------------------------------------------
test('winRate: correct percentage', () => {
  let s = createEmptyRFQStore();
  s = registerRFQ(s, '700', 'RFQ-WR-001', '2026-03-01', '2026-03-20', 'email');
  s = registerRFQ(s, '701', 'RFQ-WR-002', '2026-03-01', '2026-03-20', 'email');
  s = registerRFQ(s, '702', 'RFQ-WR-003', '2026-03-01', '2026-03-20', 'email');
  s = registerRFQ(s, '703', 'RFQ-WR-004', '2026-03-01', '2026-03-20', 'email');
  s = updateRFQStatus(s, '700', 'won');
  s = updateRFQStatus(s, '701', 'won');
  s = updateRFQStatus(s, '702', 'lost');
  // 703 stays received (not counted in win rate)

  const pipelines: RFQPipeline[] = [
    makePipeline({ id: 700n }),
    makePipeline({ id: 701n }),
    makePipeline({ id: 702n }),
    makePipeline({ id: 703n }),
  ];

  const dash = computeRFQDashboard(s, pipelines, '2026-03-20T00:00:00.000Z');
  // 2 won / (2 won + 1 lost) = 66.67%
  assert.equal(dash.winRate, 66.67);

  // Edge case: no won/lost
  const emptyDash = computeRFQDashboard(createEmptyRFQStore(), [], '2026-03-20T00:00:00.000Z');
  assert.equal(emptyDash.winRate, 0);
});

// ---------------------------------------------------------------------------
// 8. averageResponseDays: correct calculation
// ---------------------------------------------------------------------------
test('averageResponseDays: correct calculation', () => {
  let s = createEmptyRFQStore();
  s = registerRFQ(s, '800', 'RFQ-AR-001', '2026-03-01', '2026-03-20', 'email');
  s = registerRFQ(s, '801', 'RFQ-AR-002', '2026-03-05', '2026-03-25', 'email');
  s = registerRFQ(s, '802', 'RFQ-AR-003', '2026-03-10', '2026-03-30', 'email');

  // Respond to first two
  s = updateRFQStatus(s, '800', 'quoted', '2026-03-11'); // 10 days
  s = updateRFQStatus(s, '801', 'quoted', '2026-03-11'); // 6 days
  // 802 not responded yet

  const pipelines: RFQPipeline[] = [
    makePipeline({ id: 800n }),
    makePipeline({ id: 801n }),
    makePipeline({ id: 802n }),
  ];

  const dash = computeRFQDashboard(s, pipelines, '2026-03-20T00:00:00.000Z');
  // Average of 10 and 6 = 8
  assert.equal(dash.averageResponseDays, 8);

  // No responses — averageResponseDays should be 0
  const s2 = createEmptyRFQStore();
  const dash2 = computeRFQDashboard(
    registerRFQ(s2, '810', 'RFQ-AR-010', '2026-03-01', '2026-03-30', 'email'),
    [makePipeline({ id: 810n })],
    '2026-03-20T00:00:00.000Z',
  );
  assert.equal(dash2.averageResponseDays, 0);
});

// ---------------------------------------------------------------------------
// 9. localStorage round-trip
// ---------------------------------------------------------------------------
test('localStorage round-trip', () => {
  store.clear();

  let s = createEmptyRFQStore();
  s = registerRFQ(s, '900', 'RFQ-RT-001', '2026-03-01', '2026-03-20', 'email', 'Round-trip test');
  s = registerRFQ(s, '901', 'RFQ-RT-002', '2026-03-05', '2026-03-25', 'portal');
  s = updateRFQStatus(s, '900', 'quoted', '2026-03-15');

  saveRFQStore(s);
  const loaded = loadRFQStore();

  assert.equal(loaded.version, s.version);
  assert.equal(loaded.entries.length, 2);
  assert.equal(loaded.entries[0].rfqReference, 'RFQ-RT-001');
  assert.equal(loaded.entries[0].status, 'quoted');
  assert.equal(loaded.entries[0].responseSubmittedDate, '2026-03-15');
  assert.equal(loaded.entries[0].notes, 'Round-trip test');
  assert.equal(loaded.entries[1].rfqReference, 'RFQ-RT-002');
  assert.equal(loaded.entries[1].status, 'received');

  // Loading when nothing stored returns empty store
  store.clear();
  const empty = loadRFQStore();
  assert.equal(empty.entries.length, 0);
  assert.equal(empty.version, 0);
});

// ---------------------------------------------------------------------------
// 10. formatRFQSummary: readable output
// ---------------------------------------------------------------------------
test('formatRFQSummary: readable output', () => {
  const emptyDash = computeRFQDashboard(createEmptyRFQStore(), [], '2026-03-20T00:00:00.000Z');
  assert.equal(formatRFQSummary(emptyDash), 'No RFQs tracked.');

  let s = createEmptyRFQStore();
  s = registerRFQ(s, '1000', 'RFQ-FMT-001', '2026-03-01', '2026-03-10', 'email');
  s = registerRFQ(s, '1001', 'RFQ-FMT-002', '2026-03-05', '2026-03-25', 'portal');
  s = updateRFQStatus(s, '1001', 'won');

  const pipelines: RFQPipeline[] = [
    makePipeline({ id: 1000n, estimatedValueFils: 2_000_000n }),
    makePipeline({ id: 1001n, estimatedValueFils: 3_000_000n }),
  ];

  const dash = computeRFQDashboard(s, pipelines, '2026-03-20T00:00:00.000Z');
  const summary = formatRFQSummary(dash);
  assert.ok(summary.includes('2 total'));
  assert.ok(summary.includes('Overdue: 1'));
  assert.ok(summary.includes('BHD'));
  assert.ok(summary.includes('Win rate:'));
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
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
