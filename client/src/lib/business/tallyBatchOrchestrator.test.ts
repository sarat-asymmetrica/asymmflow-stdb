import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sortBatchFiles,
  validateBatchCompleteness,
  formatBatchSummary,
  RECOMMENDED_IMPORT_ORDER,
} from './tallyBatchOrchestrator';
import type {
  TallyBatchFile,
  TallyBatchResult,
  TallyBatchPlan,
  TallyBatchStepResult,
} from './tallyBatchOrchestrator';
import type { TallyImportMode } from './tallyImport';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBatchFile(mode: TallyImportMode, fileName?: string): TallyBatchFile {
  return {
    mode,
    fileName: fileName ?? `${mode}.xlsx`,
    data: new ArrayBuffer(0),
  };
}

function makeStepResult(
  mode: TallyImportMode,
  status: TallyBatchStepResult['status'],
  execution?: { imported: number; duplicates: number; errors: number; createdParties: number; errorDetails: string[] },
): TallyBatchStepResult {
  return {
    mode,
    fileName: `${mode}.xlsx`,
    preview: {
      fileName: `${mode}.xlsx`,
      mode,
      rows: [],
      totalRows: 10,
      readyRows: 8,
      duplicateRows: 1,
      invalidRows: 1,
    },
    execution: execution ?? null,
    status,
  };
}

// ── RECOMMENDED_IMPORT_ORDER ─────────────────────────────────────────────────

describe('RECOMMENDED_IMPORT_ORDER', () => {
  it('contains all 5 modes in the correct order', () => {
    assert.deepStrictEqual(RECOMMENDED_IMPORT_ORDER, [
      'customer_invoices',
      'customer_payments',
      'supplier_invoices',
      'supplier_payments',
      'ar_defaulters',
    ]);
  });

  it('has exactly 5 entries', () => {
    assert.equal(RECOMMENDED_IMPORT_ORDER.length, 5);
  });
});

// ── sortBatchFiles ───────────────────────────────────────────────────────────

describe('sortBatchFiles', () => {
  it('sorts files into the recommended import order', () => {
    const files: TallyBatchFile[] = [
      makeBatchFile('ar_defaulters'),
      makeBatchFile('supplier_payments'),
      makeBatchFile('customer_invoices'),
      makeBatchFile('supplier_invoices'),
      makeBatchFile('customer_payments'),
    ];

    const sorted = sortBatchFiles(files);
    const modes = sorted.map((f) => f.mode);

    assert.deepStrictEqual(modes, [
      'customer_invoices',
      'customer_payments',
      'supplier_invoices',
      'supplier_payments',
      'ar_defaulters',
    ]);
  });

  it('preserves multiple files per mode in original order', () => {
    const files: TallyBatchFile[] = [
      makeBatchFile('customer_invoices', 'jan-invoices.xlsx'),
      makeBatchFile('supplier_invoices', 'supplier-q1.xlsx'),
      makeBatchFile('customer_invoices', 'feb-invoices.xlsx'),
      makeBatchFile('supplier_invoices', 'supplier-q2.xlsx'),
    ];

    const sorted = sortBatchFiles(files);
    const names = sorted.map((f) => f.fileName);

    // customer_invoices come before supplier_invoices
    assert.equal(sorted[0].mode, 'customer_invoices');
    assert.equal(sorted[1].mode, 'customer_invoices');
    assert.equal(sorted[2].mode, 'supplier_invoices');
    assert.equal(sorted[3].mode, 'supplier_invoices');

    // Within the same mode, original relative order is preserved (stable sort)
    assert.equal(names[0], 'jan-invoices.xlsx');
    assert.equal(names[1], 'feb-invoices.xlsx');
    assert.equal(names[2], 'supplier-q1.xlsx');
    assert.equal(names[3], 'supplier-q2.xlsx');
  });

  it('appends unknown modes at the end', () => {
    const files: TallyBatchFile[] = [
      makeBatchFile('customer_invoices'),
      // Cast to simulate an unknown mode that might be added in the future
      makeBatchFile('unknown_mode' as TallyImportMode, 'mystery.xlsx'),
      makeBatchFile('supplier_invoices'),
    ];

    const sorted = sortBatchFiles(files);

    assert.equal(sorted[0].mode, 'customer_invoices');
    assert.equal(sorted[1].mode, 'supplier_invoices');
    assert.equal(sorted[2].fileName, 'mystery.xlsx');
  });

  it('returns empty array for empty input', () => {
    const sorted = sortBatchFiles([]);
    assert.deepStrictEqual(sorted, []);
  });

  it('does not mutate the original array', () => {
    const files: TallyBatchFile[] = [
      makeBatchFile('ar_defaulters'),
      makeBatchFile('customer_invoices'),
    ];

    const original = [...files];
    sortBatchFiles(files);

    assert.equal(files[0].mode, original[0].mode);
    assert.equal(files[1].mode, original[1].mode);
  });
});

// ── validateBatchCompleteness ────────────────────────────────────────────────

describe('validateBatchCompleteness', () => {
  it('reports complete when all 5 modes are present', () => {
    const files: TallyBatchFile[] = [
      makeBatchFile('customer_invoices'),
      makeBatchFile('customer_payments'),
      makeBatchFile('supplier_invoices'),
      makeBatchFile('supplier_payments'),
      makeBatchFile('ar_defaulters'),
    ];

    const result = validateBatchCompleteness(files);

    assert.equal(result.complete, true);
    assert.equal(result.missingModes.length, 0);
    assert.equal(result.presentModes.length, 5);
  });

  it('reports complete when only the 4 required modes are present (ar_defaulters is optional)', () => {
    const files: TallyBatchFile[] = [
      makeBatchFile('customer_invoices'),
      makeBatchFile('customer_payments'),
      makeBatchFile('supplier_invoices'),
      makeBatchFile('supplier_payments'),
    ];

    const result = validateBatchCompleteness(files);

    assert.equal(result.complete, true);
    assert.equal(result.missingModes.length, 0);
  });

  it('identifies missing modes correctly', () => {
    const files: TallyBatchFile[] = [
      makeBatchFile('customer_invoices'),
      makeBatchFile('supplier_invoices'),
    ];

    const result = validateBatchCompleteness(files);

    assert.equal(result.complete, false);
    assert.equal(result.missingModes.length, 2);
    assert.ok(result.missingModes.includes('customer_payments'));
    assert.ok(result.missingModes.includes('supplier_payments'));
  });

  it('handles empty file list', () => {
    const result = validateBatchCompleteness([]);

    assert.equal(result.complete, false);
    assert.equal(result.presentModes.length, 0);
    assert.equal(result.missingModes.length, 4);
  });

  it('does not require ar_defaulters for completeness', () => {
    // Only ar_defaulters present — still incomplete because required modes are missing
    const files: TallyBatchFile[] = [makeBatchFile('ar_defaulters')];

    const result = validateBatchCompleteness(files);

    assert.equal(result.complete, false);
    assert.equal(result.presentModes.length, 1);
    assert.ok(result.presentModes.includes('ar_defaulters'));
    assert.ok(!result.missingModes.includes('ar_defaulters'));
  });

  it('deduplicates present modes when multiple files share a mode', () => {
    const files: TallyBatchFile[] = [
      makeBatchFile('customer_invoices', 'jan.xlsx'),
      makeBatchFile('customer_invoices', 'feb.xlsx'),
      makeBatchFile('customer_payments'),
      makeBatchFile('supplier_invoices'),
      makeBatchFile('supplier_payments'),
    ];

    const result = validateBatchCompleteness(files);

    assert.equal(result.complete, true);
    // presentModes should contain unique modes only
    const uniqueCount = new Set(result.presentModes).size;
    assert.equal(uniqueCount, result.presentModes.length);
  });
});

// ── formatBatchSummary ───────────────────────────────────────────────────────

describe('formatBatchSummary', () => {
  it('produces readable output with correct counts for a successful batch', () => {
    const plan: TallyBatchPlan = {
      steps: [
        makeStepResult('customer_invoices', 'completed', {
          imported: 50,
          duplicates: 5,
          errors: 0,
          createdParties: 3,
          errorDetails: [],
        }),
        makeStepResult('supplier_invoices', 'completed', {
          imported: 30,
          duplicates: 2,
          errors: 1,
          createdParties: 2,
          errorDetails: ['Row 15: Amount must be a positive BHD value.'],
        }),
      ],
      status: 'completed',
      totalRows: 20,
      totalReadyRows: 16,
      totalDuplicateRows: 2,
      totalInvalidRows: 2,
    };

    const result: TallyBatchResult = {
      plan,
      totalImported: 80,
      totalDuplicates: 7,
      totalErrors: 1,
      totalCreatedParties: 5,
      failedSteps: [],
      success: true,
    };

    const summary = formatBatchSummary(result);

    assert.ok(summary.includes('Completed successfully'));
    assert.ok(summary.includes('Imported:  80'));
    assert.ok(summary.includes('Duplicates: 7'));
    assert.ok(summary.includes('Errors:    1'));
    assert.ok(summary.includes('Parties created: 5'));
    assert.ok(summary.includes('customer_invoices'));
    assert.ok(summary.includes('supplier_invoices'));
    assert.ok(!summary.includes('Failed steps'));
  });

  it('includes failed steps in the summary', () => {
    const plan: TallyBatchPlan = {
      steps: [
        makeStepResult('customer_invoices', 'completed', {
          imported: 10,
          duplicates: 0,
          errors: 0,
          createdParties: 1,
          errorDetails: [],
        }),
        makeStepResult('supplier_invoices', 'failed'),
      ],
      status: 'partial',
      totalRows: 20,
      totalReadyRows: 16,
      totalDuplicateRows: 2,
      totalInvalidRows: 2,
    };

    const result: TallyBatchResult = {
      plan,
      totalImported: 10,
      totalDuplicates: 0,
      totalErrors: 0,
      totalCreatedParties: 1,
      failedSteps: ['supplier_invoices (supplier_invoices.xlsx)'],
      success: false,
    };

    const summary = formatBatchSummary(result);

    assert.ok(summary.includes('Completed with errors'));
    assert.ok(summary.includes('Failed steps'));
    assert.ok(summary.includes('supplier_invoices'));
  });

  it('shows per-step breakdown with status labels', () => {
    const plan: TallyBatchPlan = {
      steps: [
        makeStepResult('customer_invoices', 'completed', {
          imported: 20,
          duplicates: 3,
          errors: 0,
          createdParties: 0,
          errorDetails: [],
        }),
        makeStepResult('customer_payments', 'skipped'),
      ],
      status: 'partial',
      totalRows: 20,
      totalReadyRows: 16,
      totalDuplicateRows: 2,
      totalInvalidRows: 2,
    };

    const result: TallyBatchResult = {
      plan,
      totalImported: 20,
      totalDuplicates: 3,
      totalErrors: 0,
      totalCreatedParties: 0,
      failedSteps: [],
      success: true,
    };

    const summary = formatBatchSummary(result);

    assert.ok(summary.includes('[completed]'));
    assert.ok(summary.includes('[skipped]'));
    assert.ok(summary.includes('Per-step breakdown'));
  });
});
