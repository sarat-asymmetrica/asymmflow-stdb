import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyRegister,
  issueCheque,
  advanceChequeStatus,
  CHEQUE_TRANSITIONS,
  isStale,
  markStaleCheques,
  computeChequeSummary,
  findByStatus,
  findByPayee,
  saveChequeRegister,
  loadChequeRegister,
  formatChequeReport,
  type ChequeEntry,
  type ChequeRegister,
  type ChequeStatus,
} from './chequeRegister';

// ── localStorage mock ────────────────────────────────────────────────

const mockStorage = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (key: string) => mockStorage.get(key) ?? null,
  setItem: (key: string, value: string) => mockStorage.set(key, value),
  removeItem: (key: string) => mockStorage.delete(key),
};

// ── Helpers ──────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<ChequeEntry> = {}): ChequeEntry {
  return {
    id: 'CHQ-20260320-ab12',
    chequeNumber: '000451',
    bankName: 'National Bank of Kuwait',
    payeeName: 'Gulf Trading LLC',
    amountFils: 500_000n,
    issueDate: '2026-03-20T00:00:00.000Z',
    status: 'issued',
    reference: 'INV-2026-100',
    statusHistory: [{ from: 'new', to: 'issued', date: '2026-03-20T00:00:00.000Z' }],
    createdAt: '2026-03-20T00:00:00.000Z',
    updatedAt: '2026-03-20T00:00:00.000Z',
    ...overrides,
  };
}

function buildRegister(entries: ChequeEntry[]): ChequeRegister {
  return { entries, version: 1 };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('createEmptyRegister', () => {
  it('returns correct structure', () => {
    const reg = createEmptyRegister();
    assert.deepEqual(reg.entries, []);
    assert.equal(reg.version, 1);
  });

  it('returns a new object each call', () => {
    const a = createEmptyRegister();
    const b = createEmptyRegister();
    assert.notEqual(a, b);
    assert.notEqual(a.entries, b.entries);
  });
});

describe('issueCheque', () => {
  it('creates entry with correct fields', () => {
    const reg = issueCheque(
      createEmptyRegister(),
      '000451',
      'National Bank of Kuwait',
      'Gulf Trading LLC',
      500_000n,
      '2026-03-20T00:00:00.000Z',
      'INV-2026-100',
      'party-123',
    );

    assert.equal(reg.entries.length, 1);
    const entry = reg.entries[0];
    assert.match(entry.id, /^CHQ-\d{8}-[0-9a-f]{4}$/);
    assert.equal(entry.chequeNumber, '000451');
    assert.equal(entry.bankName, 'National Bank of Kuwait');
    assert.equal(entry.payeeName, 'Gulf Trading LLC');
    assert.equal(entry.amountFils, 500_000n);
    assert.equal(entry.issueDate, '2026-03-20T00:00:00.000Z');
    assert.equal(entry.status, 'issued');
    assert.equal(entry.reference, 'INV-2026-100');
    assert.equal(entry.payeePartyId, 'party-123');
    assert.equal(entry.statusHistory.length, 1);
    assert.equal(entry.statusHistory[0].from, 'new');
    assert.equal(entry.statusHistory[0].to, 'issued');
  });

  it('does not mutate the original register', () => {
    const original = createEmptyRegister();
    issueCheque(original, '001', 'Bank', 'Payee', 100n, '2026-01-01', 'ref');
    assert.equal(original.entries.length, 0);
  });
});

describe('advanceChequeStatus', () => {
  it('valid transition: issued -> presented', () => {
    const entry = makeEntry({ id: 'CHQ-TEST-0001' });
    const reg = buildRegister([entry]);
    const updated = advanceChequeStatus(reg, 'CHQ-TEST-0001', 'presented', 'Deposited at bank');

    const e = updated.entries[0];
    assert.equal(e.status, 'presented');
    assert.equal(e.statusHistory.length, 2);
    assert.equal(e.statusHistory[1].from, 'issued');
    assert.equal(e.statusHistory[1].to, 'presented');
    assert.equal(e.statusHistory[1].note, 'Deposited at bank');
  });

  it('valid transition: presented -> cleared sets clearingDate', () => {
    const entry = makeEntry({ id: 'CHQ-TEST-0002', status: 'presented' });
    const reg = buildRegister([entry]);
    const updated = advanceChequeStatus(reg, 'CHQ-TEST-0002', 'cleared');

    const e = updated.entries[0];
    assert.equal(e.status, 'cleared');
    assert.ok(e.clearingDate);
  });

  it('invalid transition throws error', () => {
    const entry = makeEntry({ id: 'CHQ-TEST-0003', status: 'cleared' });
    const reg = buildRegister([entry]);

    assert.throws(
      () => advanceChequeStatus(reg, 'CHQ-TEST-0003', 'presented'),
      /Invalid transition: cleared -> presented/,
    );
  });

  it('throws when cheque not found', () => {
    const reg = createEmptyRegister();
    assert.throws(
      () => advanceChequeStatus(reg, 'CHQ-NONEXISTENT', 'presented'),
      /Cheque not found/,
    );
  });

  it('does not mutate the original register', () => {
    const entry = makeEntry({ id: 'CHQ-TEST-IMMUT' });
    const reg = buildRegister([entry]);
    advanceChequeStatus(reg, 'CHQ-TEST-IMMUT', 'presented');
    assert.equal(reg.entries[0].status, 'issued');
  });
});

describe('CHEQUE_TRANSITIONS', () => {
  it('terminal states have no transitions', () => {
    const terminals: ChequeStatus[] = ['cleared', 'bounced', 'cancelled', 'stale'];
    for (const s of terminals) {
      assert.deepEqual(CHEQUE_TRANSITIONS[s], [], `${s} should be terminal`);
    }
  });

  it('issued can transition to presented, cancelled, stale', () => {
    assert.deepEqual(CHEQUE_TRANSITIONS['issued'], ['presented', 'cancelled', 'stale']);
  });

  it('presented can transition to cleared, bounced, cancelled', () => {
    assert.deepEqual(CHEQUE_TRANSITIONS['presented'], ['cleared', 'bounced', 'cancelled', 'stale']);
  });
});

describe('isStale', () => {
  it('returns false for cheque issued <180 days ago', () => {
    const entry = makeEntry({ issueDate: '2026-03-01T00:00:00.000Z', status: 'issued' });
    assert.equal(isStale(entry, '2026-06-01T00:00:00.000Z'), false); // 92 days
  });

  it('returns true for cheque issued >180 days ago', () => {
    const entry = makeEntry({ issueDate: '2025-06-01T00:00:00.000Z', status: 'issued' });
    assert.equal(isStale(entry, '2026-03-20T00:00:00.000Z'), true); // ~292 days
  });

  it('returns false for cleared cheque even if >180 days', () => {
    const entry = makeEntry({
      issueDate: '2025-06-01T00:00:00.000Z',
      status: 'cleared',
    });
    assert.equal(isStale(entry, '2026-03-20T00:00:00.000Z'), false);
  });

  it('returns true for presented cheque >180 days old', () => {
    const entry = makeEntry({ issueDate: '2025-06-01T00:00:00.000Z', status: 'presented' });
    assert.equal(isStale(entry, '2026-03-20T00:00:00.000Z'), true);
  });

  it('returns false for exactly 180 days (boundary)', () => {
    const entry = makeEntry({ issueDate: '2025-09-22T00:00:00.000Z', status: 'issued' });
    assert.equal(isStale(entry, '2026-03-21T00:00:00.000Z'), false); // exactly 180 days
  });
});

describe('markStaleCheques', () => {
  it('marks issued cheques older than 180 days as stale', () => {
    const old = makeEntry({
      id: 'CHQ-OLD-0001',
      issueDate: '2025-01-01T00:00:00.000Z',
      status: 'issued',
    });
    const recent = makeEntry({
      id: 'CHQ-NEW-0001',
      issueDate: '2026-03-01T00:00:00.000Z',
      status: 'issued',
    });
    const reg = buildRegister([old, recent]);
    const updated = markStaleCheques(reg);

    assert.equal(updated.entries[0].status, 'stale');
    assert.equal(updated.entries[1].status, 'issued');
  });

  it('marks presented cheques older than 180 days as stale', () => {
    const old = makeEntry({
      id: 'CHQ-OLD-0002',
      issueDate: '2025-01-01T00:00:00.000Z',
      status: 'presented',
    });
    const reg = buildRegister([old]);
    const updated = markStaleCheques(reg);

    assert.equal(updated.entries[0].status, 'stale');
  });

  it('does not mark cleared/bounced/cancelled cheques', () => {
    const cleared = makeEntry({ id: 'CHQ-C-1', issueDate: '2025-01-01T00:00:00.000Z', status: 'cleared' });
    const bounced = makeEntry({ id: 'CHQ-B-1', issueDate: '2025-01-01T00:00:00.000Z', status: 'bounced' });
    const cancelled = makeEntry({ id: 'CHQ-X-1', issueDate: '2025-01-01T00:00:00.000Z', status: 'cancelled' });
    const reg = buildRegister([cleared, bounced, cancelled]);
    const updated = markStaleCheques(reg);

    assert.equal(updated.entries[0].status, 'cleared');
    assert.equal(updated.entries[1].status, 'bounced');
    assert.equal(updated.entries[2].status, 'cancelled');
  });
});

describe('computeChequeSummary', () => {
  it('computes correct counts and amounts', () => {
    const entries: ChequeEntry[] = [
      makeEntry({ status: 'issued', amountFils: 100_000n }),
      makeEntry({ status: 'issued', amountFils: 200_000n }),
      makeEntry({ status: 'presented', amountFils: 150_000n }),
      makeEntry({ status: 'cleared', amountFils: 300_000n }),
      makeEntry({ status: 'bounced', amountFils: 50_000n }),
      makeEntry({ status: 'stale', amountFils: 75_000n }),
      makeEntry({ status: 'cancelled', amountFils: 25_000n }),
    ];
    const reg = buildRegister(entries);
    const summary = computeChequeSummary(reg);

    assert.equal(summary.totalIssued, 2);
    assert.equal(summary.totalCleared, 1);
    assert.equal(summary.totalBounced, 1);
    assert.equal(summary.totalStale, 1);
    assert.equal(summary.totalCancelled, 1);
    assert.equal(summary.totalPending, 3); // 2 issued + 1 presented
    assert.equal(summary.outstandingAmountFils, 450_000n); // 100k + 200k + 150k
    assert.equal(summary.clearedAmountFils, 300_000n);
    assert.equal(summary.bouncedAmountFils, 50_000n);
  });

  it('returns zeros for empty register', () => {
    const summary = computeChequeSummary(createEmptyRegister());
    assert.equal(summary.totalPending, 0);
    assert.equal(summary.outstandingAmountFils, 0n);
    assert.equal(summary.clearedAmountFils, 0n);
  });
});

describe('findByStatus', () => {
  it('filters correctly', () => {
    const entries: ChequeEntry[] = [
      makeEntry({ id: 'A', status: 'issued' }),
      makeEntry({ id: 'B', status: 'cleared' }),
      makeEntry({ id: 'C', status: 'issued' }),
      makeEntry({ id: 'D', status: 'bounced' }),
    ];
    const reg = buildRegister(entries);

    const issued = findByStatus(reg, 'issued');
    assert.equal(issued.length, 2);
    assert.equal(issued[0].id, 'A');
    assert.equal(issued[1].id, 'C');

    const cleared = findByStatus(reg, 'cleared');
    assert.equal(cleared.length, 1);
    assert.equal(cleared[0].id, 'B');

    const stale = findByStatus(reg, 'stale');
    assert.equal(stale.length, 0);
  });
});

describe('findByPayee', () => {
  it('matches case-insensitively', () => {
    const entries: ChequeEntry[] = [
      makeEntry({ id: 'A', payeeName: 'Gulf Trading LLC' }),
      makeEntry({ id: 'B', payeeName: 'Al Salam Enterprises' }),
      makeEntry({ id: 'C', payeeName: 'Gulf Supplies Co' }),
    ];
    const reg = buildRegister(entries);

    const results = findByPayee(reg, 'gulf');
    assert.equal(results.length, 2);
    assert.equal(results[0].id, 'A');
    assert.equal(results[1].id, 'C');
  });

  it('returns empty array when no match', () => {
    const reg = buildRegister([makeEntry({ payeeName: 'Alpha Corp' })]);
    assert.deepEqual(findByPayee(reg, 'beta'), []);
  });
});

describe('saveChequeRegister / loadChequeRegister', () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  it('round-trips a register through localStorage', () => {
    let reg = createEmptyRegister();
    reg = issueCheque(reg, '000451', 'NBK', 'Gulf Trading LLC', 500_000n, '2026-03-20', 'INV-100');

    saveChequeRegister(reg);
    const loaded = loadChequeRegister();

    assert.equal(loaded.version, 1);
    assert.equal(loaded.entries.length, 1);
    assert.equal(loaded.entries[0].chequeNumber, '000451');
    assert.equal(loaded.entries[0].amountFils, 500_000n);
    assert.equal(loaded.entries[0].status, 'issued');
    assert.equal(loaded.entries[0].payeeName, 'Gulf Trading LLC');
    assert.equal(loaded.entries[0].reference, 'INV-100');
  });

  it('returns empty register when nothing is stored', () => {
    const loaded = loadChequeRegister();
    assert.deepEqual(loaded.entries, []);
    assert.equal(loaded.version, 1);
  });

  it('preserves bigint amountFils through serialisation', () => {
    const reg = buildRegister([
      makeEntry({ amountFils: 9_999_999_999n }),
    ]);
    saveChequeRegister(reg);
    const loaded = loadChequeRegister();
    assert.equal(loaded.entries[0].amountFils, 9_999_999_999n);
    assert.equal(typeof loaded.entries[0].amountFils, 'bigint');
  });
});

describe('formatChequeReport', () => {
  it('contains expected header and summary sections', () => {
    const report = formatChequeReport(createEmptyRegister());
    assert.ok(report.includes('AsymmFlow Cheque Register Report'));
    assert.ok(report.includes('Generated:'));
    assert.ok(report.includes('Summary:'));
    assert.ok(report.includes('Total pending: 0'));
  });

  it('renders cheque entries with correct data', () => {
    const reg = buildRegister([
      makeEntry({
        chequeNumber: '000451',
        status: 'cleared',
        payeeName: 'Gulf Trading LLC',
        bankName: 'NBK',
        amountFils: 500_000n,
        issueDate: '2026-03-20T00:00:00.000Z',
        clearingDate: '2026-03-25T00:00:00.000Z',
        reference: 'INV-100',
      }),
    ]);

    const report = formatChequeReport(reg);
    assert.ok(report.includes('#000451'));
    assert.ok(report.includes('[CLEARED]'));
    assert.ok(report.includes('Gulf Trading LLC'));
    assert.ok(report.includes('NBK'));
    assert.ok(report.includes('500000 fils'));
    assert.ok(report.includes('Ref: INV-100'));
  });
});
