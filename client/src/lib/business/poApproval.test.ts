import assert from 'node:assert/strict';
import {
  checkPOApproval,
  canCreatePO,
  createApprovalEntry,
  appendApprovalEntry,
  createEmptyApprovalLog,
  saveApprovalLog,
  loadApprovalLog,
  formatApprovalSummary,
  PO_APPROVAL_THRESHOLD_FILS,
  DEFAULT_PO_RULE,
} from './poApproval';

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
// 1. checkPOApproval: below threshold → no approval required
// ---------------------------------------------------------------------------
test('checkPOApproval: below threshold → no approval required', () => {
  const result = checkPOApproval(4_999_999n, 'Operations');
  assert.equal(result.requiresApproval, false);
  assert.equal(result.canApprove, true);
  assert.equal(result.poValueFils, 4_999_999n);
  assert.equal(result.thresholdFils, PO_APPROVAL_THRESHOLD_FILS);
});

// ---------------------------------------------------------------------------
// 2. checkPOApproval: above threshold with Manager → can approve
// ---------------------------------------------------------------------------
test('checkPOApproval: above threshold with Manager → can approve', () => {
  const result = checkPOApproval(6_000_000n, 'Manager');
  assert.equal(result.requiresApproval, true);
  assert.equal(result.canApprove, true);
  assert.ok(result.reason.includes('Manager'));
});

// ---------------------------------------------------------------------------
// 3. checkPOApproval: above threshold with Operations → cannot approve
// ---------------------------------------------------------------------------
test('checkPOApproval: above threshold with Operations → cannot approve', () => {
  const result = checkPOApproval(6_000_000n, 'Operations');
  assert.equal(result.requiresApproval, true);
  assert.equal(result.canApprove, false);
  assert.ok(result.requiredRole !== undefined);
});

// ---------------------------------------------------------------------------
// 4. checkPOApproval: exact threshold → requires approval
// ---------------------------------------------------------------------------
test('checkPOApproval: exact threshold → requires approval', () => {
  const result = checkPOApproval(PO_APPROVAL_THRESHOLD_FILS, 'Operations');
  assert.equal(result.requiresApproval, true);
  assert.equal(result.canApprove, false);
});

// ---------------------------------------------------------------------------
// 5. canCreatePO: Operations below threshold → allowed
// ---------------------------------------------------------------------------
test('canCreatePO: Operations below threshold → allowed', () => {
  const result = canCreatePO(1_000_000n, 'Operations');
  assert.equal(result.allowed, true);
});

// ---------------------------------------------------------------------------
// 6. canCreatePO: Sales any value → not allowed
// ---------------------------------------------------------------------------
test('canCreatePO: Sales any value → not allowed', () => {
  const belowResult = canCreatePO(100n, 'Sales');
  assert.equal(belowResult.allowed, false);
  assert.ok(belowResult.reason.includes('Sales'));

  const aboveResult = canCreatePO(10_000_000n, 'Sales');
  assert.equal(aboveResult.allowed, false);
});

// ---------------------------------------------------------------------------
// 7. canCreatePO: Admin any value → always allowed
// ---------------------------------------------------------------------------
test('canCreatePO: Admin any value → always allowed', () => {
  const belowResult = canCreatePO(100n, 'Admin');
  assert.equal(belowResult.allowed, true);

  const aboveResult = canCreatePO(99_000_000n, 'Admin');
  assert.equal(aboveResult.allowed, true);
});

// ---------------------------------------------------------------------------
// 8. createApprovalEntry: correct fields
// ---------------------------------------------------------------------------
test('createApprovalEntry: correct fields', () => {
  const entry = createApprovalEntry(
    'PO-2026-001',
    'Gulf Supplies Co.',
    3_500_000n,
    'Operations',
    'auto_approved',
  );

  assert.equal(entry.poReference, 'PO-2026-001');
  assert.equal(entry.supplierName, 'Gulf Supplies Co.');
  assert.equal(entry.valueFils, 3_500_000n);
  assert.equal(entry.approvalRequired, false);
  assert.equal(entry.approvedBy, null);
  assert.equal(entry.approverRole, null);
  assert.equal(entry.decision, 'auto_approved');
  assert.ok(entry.id.startsWith('po-'));
  assert.ok(entry.timestamp.length > 0);

  const manualEntry = createApprovalEntry(
    'PO-2026-002',
    'National Hardware',
    7_000_000n,
    'Manager',
    'approved',
    'Ahmed Al-Khalifa',
    'Urgent procurement',
  );

  assert.equal(manualEntry.approvalRequired, true);
  assert.equal(manualEntry.approvedBy, 'Ahmed Al-Khalifa');
  assert.equal(manualEntry.approverRole, 'Manager');
  assert.equal(manualEntry.notes, 'Urgent procurement');
});

// ---------------------------------------------------------------------------
// 9. appendApprovalEntry: prepends to log
// ---------------------------------------------------------------------------
test('appendApprovalEntry: prepends to log', () => {
  const log0 = createEmptyApprovalLog();
  assert.equal(log0.entries.length, 0);
  assert.equal(log0.version, 0);

  const entry1 = createApprovalEntry('PO-A', 'Supplier A', 1_000n, 'Admin', 'auto_approved');
  const log1 = appendApprovalEntry(log0, entry1);
  assert.equal(log1.entries.length, 1);
  assert.equal(log1.version, 1);

  const entry2 = createApprovalEntry('PO-B', 'Supplier B', 2_000n, 'Admin', 'approved', 'Admin User');
  const log2 = appendApprovalEntry(log1, entry2);
  assert.equal(log2.entries.length, 2);
  assert.equal(log2.version, 2);

  // Most recent entry is first (prepend)
  assert.equal(log2.entries[0].poReference, 'PO-B');
  assert.equal(log2.entries[1].poReference, 'PO-A');

  // Original log unchanged (immutable)
  assert.equal(log0.entries.length, 0);
  assert.equal(log1.entries.length, 1);
});

// ---------------------------------------------------------------------------
// 10. formatApprovalSummary: readable output
// ---------------------------------------------------------------------------
test('formatApprovalSummary: readable output', () => {
  let log = createEmptyApprovalLog();

  // Empty log
  assert.equal(formatApprovalSummary(log), 'No PO approvals recorded.');

  log = appendApprovalEntry(log, createApprovalEntry('PO-1', 'S1', 1_000_000n, 'Admin', 'auto_approved'));
  log = appendApprovalEntry(log, createApprovalEntry('PO-2', 'S2', 6_000_000n, 'Manager', 'approved', 'Ali'));
  log = appendApprovalEntry(log, createApprovalEntry('PO-3', 'S3', 8_000_000n, 'Admin', 'rejected'));

  const summary = formatApprovalSummary(log);
  assert.ok(summary.includes('Total entries: 3'));
  assert.ok(summary.includes('Approved: 1'));
  assert.ok(summary.includes('Rejected: 1'));
  assert.ok(summary.includes('Auto-approved: 1'));
  assert.ok(summary.includes('BHD'));
  assert.ok(summary.includes('v3'));
});

// ---------------------------------------------------------------------------
// 11. localStorage round-trip
// ---------------------------------------------------------------------------
test('localStorage round-trip', () => {
  store.clear();

  let log = createEmptyApprovalLog();
  log = appendApprovalEntry(log, createApprovalEntry('PO-RT-1', 'Roundtrip Supplier', 5_500_000n, 'Manager', 'approved', 'Manager A'));
  log = appendApprovalEntry(log, createApprovalEntry('PO-RT-2', 'Another Supplier', 2_000_000n, 'Operations', 'auto_approved'));

  saveApprovalLog(log);
  const loaded = loadApprovalLog();

  assert.equal(loaded.version, log.version);
  assert.equal(loaded.entries.length, 2);
  assert.equal(loaded.entries[0].poReference, 'PO-RT-2');
  assert.equal(loaded.entries[1].poReference, 'PO-RT-1');

  // Bigint values survive round-trip
  assert.equal(loaded.entries[0].valueFils, 2_000_000n);
  assert.equal(loaded.entries[1].valueFils, 5_500_000n);

  // Loading when nothing stored returns empty log
  store.clear();
  const empty = loadApprovalLog();
  assert.equal(empty.entries.length, 0);
  assert.equal(empty.version, 0);
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
