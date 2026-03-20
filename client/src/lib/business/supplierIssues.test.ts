import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyIssueLog,
  reportIssue,
  advanceIssueStatus,
  ISSUE_TRANSITIONS,
  computeIssueSummary,
  findIssuesBySupplier,
  findIssuesByStatus,
  findIssuesBySeverity,
  saveIssueLog,
  loadIssueLog,
  formatIssueReport,
  type SupplierIssue,
  type SupplierIssueLog,
  type IssueStatus,
} from './supplierIssues';

// ── localStorage mock ────────────────────────────────────────────────

const mockStorage = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (key: string) => mockStorage.get(key) ?? null,
  setItem: (key: string, value: string) => mockStorage.set(key, value),
  removeItem: (key: string) => mockStorage.delete(key),
};

// ── Helpers ──────────────────────────────────────────────────────────

function makeIssue(overrides: Partial<SupplierIssue> = {}): SupplierIssue {
  return {
    id: 'ISS-20260320-ab12',
    supplierId: 'SUP-001',
    supplierName: 'Gulf Trading LLC',
    title: 'Defective batch',
    description: 'Received 50 defective units in batch #42',
    category: 'quality',
    severity: 'high',
    status: 'open',
    costImpactFils: 250_000n,
    reportedBy: 'Ahmad',
    reportedAt: '2026-03-20T00:00:00.000Z',
    statusHistory: [{ from: 'new', to: 'open', date: '2026-03-20T00:00:00.000Z' }],
    ...overrides,
  };
}

function buildLog(issues: SupplierIssue[]): SupplierIssueLog {
  return { issues, version: 1 };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('createEmptyIssueLog', () => {
  it('returns correct structure', () => {
    const log = createEmptyIssueLog();
    assert.deepEqual(log.issues, []);
    assert.equal(log.version, 1);
  });

  it('returns a new object each call', () => {
    const a = createEmptyIssueLog();
    const b = createEmptyIssueLog();
    assert.notEqual(a, b);
    assert.notEqual(a.issues, b.issues);
  });
});

describe('reportIssue', () => {
  it('creates issue with correct fields', () => {
    const log = reportIssue(
      createEmptyIssueLog(),
      'SUP-001',
      'Gulf Trading LLC',
      'Late delivery',
      'Shipment arrived 3 weeks late',
      'delivery',
      'medium',
      'Ahmad',
      150_000n,
    );

    assert.equal(log.issues.length, 1);
    const issue = log.issues[0];
    assert.match(issue.id, /^ISS-\d{8}-[0-9a-f]{4}$/);
    assert.equal(issue.supplierId, 'SUP-001');
    assert.equal(issue.supplierName, 'Gulf Trading LLC');
    assert.equal(issue.title, 'Late delivery');
    assert.equal(issue.description, 'Shipment arrived 3 weeks late');
    assert.equal(issue.category, 'delivery');
    assert.equal(issue.severity, 'medium');
    assert.equal(issue.status, 'open');
    assert.equal(issue.costImpactFils, 150_000n);
    assert.equal(issue.reportedBy, 'Ahmad');
    assert.equal(issue.statusHistory.length, 1);
    assert.equal(issue.statusHistory[0].from, 'new');
    assert.equal(issue.statusHistory[0].to, 'open');
  });

  it('defaults costImpactFils to 0n when omitted', () => {
    const log = reportIssue(
      createEmptyIssueLog(),
      'SUP-002',
      'Al Salam Supplies',
      'Wrong docs',
      'Invoice did not match PO',
      'documentation',
      'low',
      'Fatima',
    );
    assert.equal(log.issues[0].costImpactFils, 0n);
  });

  it('does not mutate the original log', () => {
    const original = createEmptyIssueLog();
    reportIssue(original, 'SUP-001', 'Supplier', 'Title', 'Desc', 'other', 'low', 'User');
    assert.equal(original.issues.length, 0);
  });
});

describe('advanceIssueStatus', () => {
  it('valid transition: open -> pending', () => {
    const issue = makeIssue({ id: 'ISS-TEST-0001' });
    const log = buildLog([issue]);
    const updated = advanceIssueStatus(log, 'ISS-TEST-0001', 'pending', 'Awaiting supplier response');

    const i = updated.issues[0];
    assert.equal(i.status, 'pending');
    assert.equal(i.statusHistory.length, 2);
    assert.equal(i.statusHistory[1].from, 'open');
    assert.equal(i.statusHistory[1].to, 'pending');
    assert.equal(i.statusHistory[1].note, 'Awaiting supplier response');
  });

  it('valid transition: open -> resolved sets resolvedAt and resolution', () => {
    const issue = makeIssue({ id: 'ISS-TEST-0002' });
    const log = buildLog([issue]);
    const updated = advanceIssueStatus(
      log, 'ISS-TEST-0002', 'resolved', 'Supplier sent replacements', 'Replaced defective units',
    );

    const i = updated.issues[0];
    assert.equal(i.status, 'resolved');
    assert.ok(i.resolvedAt);
    assert.equal(i.resolution, 'Replaced defective units');
  });

  it('invalid transition: closed -> open throws', () => {
    const issue = makeIssue({ id: 'ISS-TEST-0003', status: 'closed' });
    const log = buildLog([issue]);

    assert.throws(
      () => advanceIssueStatus(log, 'ISS-TEST-0003', 'open'),
      /Invalid transition: closed -> open/,
    );
  });

  it('throws when issue not found', () => {
    const log = createEmptyIssueLog();
    assert.throws(
      () => advanceIssueStatus(log, 'ISS-NONEXISTENT', 'pending'),
      /Issue not found/,
    );
  });

  it('does not mutate the original log', () => {
    const issue = makeIssue({ id: 'ISS-TEST-IMMUT' });
    const log = buildLog([issue]);
    advanceIssueStatus(log, 'ISS-TEST-IMMUT', 'pending');
    assert.equal(log.issues[0].status, 'open');
  });
});

describe('ISSUE_TRANSITIONS', () => {
  it('closed is terminal (no transitions)', () => {
    assert.deepEqual(ISSUE_TRANSITIONS['closed'], []);
  });

  it('open can transition to pending, resolved, closed', () => {
    assert.deepEqual(ISSUE_TRANSITIONS['open'], ['pending', 'resolved', 'closed']);
  });

  it('resolved can reopen', () => {
    assert.ok(ISSUE_TRANSITIONS['resolved'].includes('open'));
  });
});

describe('computeIssueSummary', () => {
  it('computes correct counts and grouping', () => {
    const issues: SupplierIssue[] = [
      makeIssue({ status: 'open', severity: 'high', category: 'quality', supplierName: 'Gulf Trading LLC', costImpactFils: 100_000n }),
      makeIssue({ status: 'open', severity: 'critical', category: 'delivery', supplierName: 'Gulf Trading LLC', costImpactFils: 200_000n }),
      makeIssue({ status: 'pending', severity: 'medium', category: 'pricing', supplierName: 'Al Salam Supplies', costImpactFils: 50_000n }),
      makeIssue({ status: 'resolved', severity: 'low', category: 'documentation', supplierName: 'Al Salam Supplies', costImpactFils: 10_000n }),
      makeIssue({ status: 'closed', severity: 'high', category: 'quality', supplierName: 'Beta Corp', costImpactFils: 75_000n }),
    ];
    const log = buildLog(issues);
    const summary = computeIssueSummary(log);

    assert.equal(summary.totalIssues, 5);
    assert.equal(summary.openCount, 2);
    assert.equal(summary.pendingCount, 1);
    assert.equal(summary.resolvedCount, 1);
    assert.equal(summary.closedCount, 1);
    assert.equal(summary.totalCostImpactFils, 435_000n);

    assert.equal(summary.bySeverity.critical, 1);
    assert.equal(summary.bySeverity.high, 2);
    assert.equal(summary.bySeverity.medium, 1);
    assert.equal(summary.bySeverity.low, 1);

    assert.equal(summary.byCategory.quality, 2);
    assert.equal(summary.byCategory.delivery, 1);
    assert.equal(summary.byCategory.pricing, 1);
    assert.equal(summary.byCategory.documentation, 1);

    // bySupplier sorted by openCount descending
    assert.equal(summary.bySupplier[0].supplierName, 'Gulf Trading LLC');
    assert.equal(summary.bySupplier[0].count, 2);
    assert.equal(summary.bySupplier[0].openCount, 2);
    assert.equal(summary.bySupplier[1].openCount, 0);
    assert.equal(summary.bySupplier[2].openCount, 0);
  });

  it('returns zeros for empty log', () => {
    const summary = computeIssueSummary(createEmptyIssueLog());
    assert.equal(summary.totalIssues, 0);
    assert.equal(summary.openCount, 0);
    assert.equal(summary.totalCostImpactFils, 0n);
    assert.deepEqual(summary.bySupplier, []);
  });
});

describe('findIssuesBySupplier', () => {
  it('matches case-insensitively', () => {
    const issues: SupplierIssue[] = [
      makeIssue({ id: 'A', supplierName: 'Gulf Trading LLC' }),
      makeIssue({ id: 'B', supplierName: 'Al Salam Enterprises' }),
      makeIssue({ id: 'C', supplierName: 'Gulf Supplies Co' }),
    ];
    const log = buildLog(issues);

    const results = findIssuesBySupplier(log, 'gulf');
    assert.equal(results.length, 2);
    assert.equal(results[0].id, 'A');
    assert.equal(results[1].id, 'C');
  });

  it('returns empty array when no match', () => {
    const log = buildLog([makeIssue({ supplierName: 'Alpha Corp' })]);
    assert.deepEqual(findIssuesBySupplier(log, 'beta'), []);
  });
});

describe('findIssuesByStatus', () => {
  it('filters correctly', () => {
    const issues: SupplierIssue[] = [
      makeIssue({ id: 'A', status: 'open' }),
      makeIssue({ id: 'B', status: 'resolved' }),
      makeIssue({ id: 'C', status: 'open' }),
      makeIssue({ id: 'D', status: 'closed' }),
    ];
    const log = buildLog(issues);

    const open = findIssuesByStatus(log, 'open');
    assert.equal(open.length, 2);
    assert.equal(open[0].id, 'A');
    assert.equal(open[1].id, 'C');

    const resolved = findIssuesByStatus(log, 'resolved');
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].id, 'B');

    const pending = findIssuesByStatus(log, 'pending');
    assert.equal(pending.length, 0);
  });
});

describe('saveIssueLog / loadIssueLog', () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  it('round-trips a log through localStorage', () => {
    let log = createEmptyIssueLog();
    log = reportIssue(
      log, 'SUP-001', 'Gulf Trading LLC', 'Defective batch',
      'Received defective units', 'quality', 'high', 'Ahmad', 500_000n,
    );

    saveIssueLog(log);
    const loaded = loadIssueLog();

    assert.equal(loaded.version, 1);
    assert.equal(loaded.issues.length, 1);
    assert.equal(loaded.issues[0].supplierName, 'Gulf Trading LLC');
    assert.equal(loaded.issues[0].costImpactFils, 500_000n);
    assert.equal(loaded.issues[0].status, 'open');
    assert.equal(loaded.issues[0].severity, 'high');
    assert.equal(loaded.issues[0].title, 'Defective batch');
  });

  it('returns empty log when nothing is stored', () => {
    const loaded = loadIssueLog();
    assert.deepEqual(loaded.issues, []);
    assert.equal(loaded.version, 1);
  });

  it('preserves bigint costImpactFils through serialisation', () => {
    const log = buildLog([
      makeIssue({ costImpactFils: 9_999_999_999n }),
    ]);
    saveIssueLog(log);
    const loaded = loadIssueLog();
    assert.equal(loaded.issues[0].costImpactFils, 9_999_999_999n);
    assert.equal(typeof loaded.issues[0].costImpactFils, 'bigint');
  });
});

describe('formatIssueReport', () => {
  it('contains expected header and summary sections', () => {
    const report = formatIssueReport(createEmptyIssueLog());
    assert.ok(report.includes('AsymmFlow Supplier Issues Report'));
    assert.ok(report.includes('Generated:'));
    assert.ok(report.includes('Summary:'));
    assert.ok(report.includes('Total issues: 0'));
    assert.ok(report.includes('Open: 0'));
  });

  it('renders issue entries with correct data', () => {
    const log = buildLog([
      makeIssue({
        id: 'ISS-20260320-ab12',
        title: 'Defective batch',
        status: 'open',
        severity: 'high',
        category: 'quality',
        supplierName: 'Gulf Trading LLC',
        costImpactFils: 250_000n,
        reportedAt: '2026-03-20T00:00:00.000Z',
      }),
    ]);

    const report = formatIssueReport(log);
    assert.ok(report.includes('ISS-20260320-ab12'));
    assert.ok(report.includes('[OPEN]'));
    assert.ok(report.includes('HIGH'));
    assert.ok(report.includes('Defective batch'));
    assert.ok(report.includes('Gulf Trading LLC'));
    assert.ok(report.includes('250000 fils'));
  });
});
