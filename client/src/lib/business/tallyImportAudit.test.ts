import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeImportFingerprint,
  createBatchRecord,
  hasBeenImported,
  appendBatch,
  getAuditSummary,
  createEmptyAuditLog,
  formatAuditReport,
  saveAuditLog,
  loadAuditLog,
  type TallyImportBatchRecord,
} from './tallyImportAudit';

// ── localStorage mock ────────────────────────────────────────────────

const mockStorage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => mockStorage.get(key) ?? null,
  setItem: (key: string, value: string) => mockStorage.set(key, value),
  removeItem: (key: string) => mockStorage.delete(key),
};

// ── Helpers ──────────────────────────────────────────────────────────

function makeBatch(overrides: Partial<TallyImportBatchRecord> = {}): TallyImportBatchRecord {
  return {
    batchId: '20260320-143000-ab12',
    executedAt: '2026-03-20T14:30:00.000Z',
    mode: 'customer_invoices',
    fileName: 'tally_export.xlsx',
    totalRows: 50,
    importedRows: 45,
    duplicateRows: 5,
    invalidRows: 0,
    createdParties: 2,
    errorCount: 0,
    errorDetails: [],
    fingerprint: 'a3f2bc01',
    success: true,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('createBatchRecord', () => {
  it('populates all fields correctly', () => {
    const record = createBatchRecord(
      'customer_invoices',
      'export.xlsx',
      50,
      45,
      3,
      2,
      1,
      0,
      [],
      'deadbeef',
    );

    assert.equal(record.mode, 'customer_invoices');
    assert.equal(record.fileName, 'export.xlsx');
    assert.equal(record.totalRows, 50);
    assert.equal(record.importedRows, 45);
    assert.equal(record.duplicateRows, 3);
    assert.equal(record.invalidRows, 2);
    assert.equal(record.createdParties, 1);
    assert.equal(record.errorCount, 0);
    assert.deepEqual(record.errorDetails, []);
    assert.equal(record.fingerprint, 'deadbeef');
    assert.equal(record.success, true);
    assert.match(record.batchId, /^\d{8}-\d{6}-[0-9a-f]{4}$/);
    // executedAt should be a valid ISO string
    assert.doesNotThrow(() => new Date(record.executedAt));
  });

  it('sets success to false when errorCount > 0', () => {
    const record = createBatchRecord(
      'supplier_payments',
      'payments.xlsx',
      30,
      28,
      0,
      0,
      0,
      2,
      ['Row 15: Amount must be positive', 'Row 22: Party not found'],
      'cafe1234',
    );

    assert.equal(record.success, false);
    assert.equal(record.errorCount, 2);
    assert.equal(record.errorDetails.length, 2);
  });
});

describe('computeImportFingerprint', () => {
  it('produces same fingerprint for same content and mode', () => {
    const buf = new Uint8Array([1, 2, 3, 4, 5]).buffer;
    const fp1 = computeImportFingerprint(buf, 'customer_invoices');
    const fp2 = computeImportFingerprint(buf, 'customer_invoices');
    assert.equal(fp1, fp2);
  });

  it('produces different fingerprint for different content', () => {
    const buf1 = new Uint8Array([1, 2, 3]).buffer;
    const buf2 = new Uint8Array([4, 5, 6]).buffer;
    const fp1 = computeImportFingerprint(buf1, 'customer_invoices');
    const fp2 = computeImportFingerprint(buf2, 'customer_invoices');
    assert.notEqual(fp1, fp2);
  });

  it('produces different fingerprint for different mode', () => {
    const buf = new Uint8Array([1, 2, 3]).buffer;
    const fp1 = computeImportFingerprint(buf, 'customer_invoices');
    const fp2 = computeImportFingerprint(buf, 'supplier_payments');
    assert.notEqual(fp1, fp2);
  });

  it('returns an 8-char hex string', () => {
    const buf = new Uint8Array([10, 20, 30]).buffer;
    const fp = computeImportFingerprint(buf, 'test');
    assert.match(fp, /^[0-9a-f]{8}$/);
  });
});

describe('hasBeenImported', () => {
  it('returns true when fingerprint exists in log', () => {
    const log = appendBatch(createEmptyAuditLog(), makeBatch({ fingerprint: 'aabbccdd' }));
    assert.equal(hasBeenImported(log, 'aabbccdd'), true);
  });

  it('returns false for unknown fingerprint', () => {
    const log = appendBatch(createEmptyAuditLog(), makeBatch({ fingerprint: 'aabbccdd' }));
    assert.equal(hasBeenImported(log, '11223344'), false);
  });

  it('returns false on empty log', () => {
    assert.equal(hasBeenImported(createEmptyAuditLog(), 'anything'), false);
  });
});

describe('appendBatch', () => {
  it('adds batch to the front of the list', () => {
    const first = makeBatch({ batchId: 'first' });
    const second = makeBatch({ batchId: 'second' });
    let log = createEmptyAuditLog();
    log = appendBatch(log, first);
    log = appendBatch(log, second);

    assert.equal(log.batches.length, 2);
    assert.equal(log.batches[0].batchId, 'second');
    assert.equal(log.batches[1].batchId, 'first');
  });

  it('preserves existing batches', () => {
    const existing = makeBatch({ batchId: 'existing' });
    let log = appendBatch(createEmptyAuditLog(), existing);
    const added = makeBatch({ batchId: 'added' });
    log = appendBatch(log, added);

    assert.equal(log.batches.length, 2);
    assert.equal(log.batches[1].batchId, 'existing');
  });

  it('does not mutate the original log', () => {
    const original = createEmptyAuditLog();
    appendBatch(original, makeBatch());
    assert.equal(original.batches.length, 0);
  });
});

describe('getAuditSummary', () => {
  it('computes correct totals across multiple batches', () => {
    let log = createEmptyAuditLog();
    log = appendBatch(log, makeBatch({
      mode: 'customer_invoices',
      importedRows: 40,
      duplicateRows: 5,
      errorCount: 1,
      createdParties: 3,
      executedAt: '2026-03-20T10:00:00.000Z',
    }));
    log = appendBatch(log, makeBatch({
      mode: 'supplier_payments',
      importedRows: 20,
      duplicateRows: 2,
      errorCount: 0,
      createdParties: 1,
      executedAt: '2026-03-20T14:00:00.000Z',
    }));

    const summary = getAuditSummary(log);

    assert.equal(summary.totalBatches, 2);
    assert.equal(summary.totalImported, 60);
    assert.equal(summary.totalDuplicates, 7);
    assert.equal(summary.totalErrors, 1);
    assert.equal(summary.totalPartiesCreated, 4);
  });

  it('reports correct mode breakdown', () => {
    let log = createEmptyAuditLog();
    log = appendBatch(log, makeBatch({ mode: 'customer_invoices' }));
    log = appendBatch(log, makeBatch({ mode: 'customer_invoices' }));
    log = appendBatch(log, makeBatch({ mode: 'supplier_payments' }));

    const summary = getAuditSummary(log);

    assert.equal(summary.modeBreakdown['customer_invoices'], 2);
    assert.equal(summary.modeBreakdown['supplier_payments'], 1);
  });

  it('returns lastImportAt from the most recent batch', () => {
    let log = createEmptyAuditLog();
    log = appendBatch(log, makeBatch({ executedAt: '2026-03-19T10:00:00.000Z' }));
    log = appendBatch(log, makeBatch({ executedAt: '2026-03-20T14:00:00.000Z' }));

    const summary = getAuditSummary(log);
    assert.equal(summary.lastImportAt, '2026-03-20T14:00:00.000Z');
  });

  it('returns null lastImportAt for empty log', () => {
    const summary = getAuditSummary(createEmptyAuditLog());
    assert.equal(summary.lastImportAt, null);
    assert.equal(summary.totalBatches, 0);
  });
});

describe('createEmptyAuditLog', () => {
  it('returns correct structure', () => {
    const log = createEmptyAuditLog();
    assert.deepEqual(log.batches, []);
    assert.equal(log.version, 1);
  });

  it('returns a new object each call', () => {
    const a = createEmptyAuditLog();
    const b = createEmptyAuditLog();
    assert.notEqual(a, b);
    assert.notEqual(a.batches, b.batches);
  });
});

describe('formatAuditReport', () => {
  it('contains expected header and summary sections', () => {
    const log = createEmptyAuditLog();
    const report = formatAuditReport(log);

    assert.ok(report.includes('AsymmFlow Tally Import Audit Report'));
    assert.ok(report.includes('Generated:'));
    assert.ok(report.includes('Summary:'));
    assert.ok(report.includes('Total imports: 0'));
  });

  it('renders batch history with correct data', () => {
    let log = createEmptyAuditLog();
    log = appendBatch(log, makeBatch({
      executedAt: '2026-03-20T14:25:00.000Z',
      mode: 'customer_invoices',
      fileName: 'tally_export.xlsx',
      importedRows: 45,
      duplicateRows: 5,
      errorCount: 0,
      createdParties: 2,
      fingerprint: 'a3f2bc01',
    }));

    const report = formatAuditReport(log);

    assert.ok(report.includes('Batch History:'));
    assert.ok(report.includes('[2026-03-20 14:25]'));
    assert.ok(report.includes('customer_invoices from "tally_export.xlsx"'));
    assert.ok(report.includes('45 imported'));
    assert.ok(report.includes('5 duplicates'));
    assert.ok(report.includes('0 errors'));
    assert.ok(report.includes('2 new parties'));
    assert.ok(report.includes('Fingerprint: a3f2bc01'));
  });

  it('shows check mark for successful batch and cross for failed', () => {
    let log = createEmptyAuditLog();
    log = appendBatch(log, makeBatch({ success: true, errorCount: 0 }));
    log = appendBatch(log, makeBatch({
      success: false,
      errorCount: 2,
      errorDetails: ['Row 15: Amount must be positive', 'Row 22: Party not found'],
      batchId: 'failed-batch',
    }));

    const report = formatAuditReport(log);

    assert.ok(report.includes('\u2713'));
    assert.ok(report.includes('\u2717'));
    assert.ok(report.includes('Errors: Row 15: Amount must be positive; Row 22: Party not found'));
  });
});

describe('saveAuditLog / loadAuditLog', () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  it('round-trips an audit log through localStorage', () => {
    let log = createEmptyAuditLog();
    log = appendBatch(log, makeBatch({ batchId: 'roundtrip-test', fingerprint: 'ff00ff00' }));

    saveAuditLog(log);
    const loaded = loadAuditLog();

    assert.equal(loaded.version, 1);
    assert.equal(loaded.batches.length, 1);
    assert.equal(loaded.batches[0].batchId, 'roundtrip-test');
    assert.equal(loaded.batches[0].fingerprint, 'ff00ff00');
  });

  it('returns empty log when nothing is stored', () => {
    const loaded = loadAuditLog();
    assert.deepEqual(loaded.batches, []);
    assert.equal(loaded.version, 1);
  });

  it('preserves all batch fields through serialization', () => {
    const batch = makeBatch({
      errorDetails: ['Row 5: Missing amount'],
      createdParties: 3,
      invalidRows: 7,
    });
    let log = createEmptyAuditLog();
    log = appendBatch(log, batch);

    saveAuditLog(log);
    const loaded = loadAuditLog();
    const restored = loaded.batches[0];

    assert.equal(restored.mode, batch.mode);
    assert.equal(restored.fileName, batch.fileName);
    assert.equal(restored.totalRows, batch.totalRows);
    assert.equal(restored.importedRows, batch.importedRows);
    assert.equal(restored.duplicateRows, batch.duplicateRows);
    assert.equal(restored.invalidRows, 7);
    assert.equal(restored.createdParties, 3);
    assert.equal(restored.errorCount, batch.errorCount);
    assert.deepEqual(restored.errorDetails, ['Row 5: Missing amount']);
    assert.equal(restored.fingerprint, batch.fingerprint);
    assert.equal(restored.success, batch.success);
  });
});
