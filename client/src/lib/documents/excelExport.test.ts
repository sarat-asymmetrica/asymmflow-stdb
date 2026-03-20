import assert from 'node:assert/strict';
import type { WorkBook } from 'xlsx';
import {
  buildARAgingExportRows,
  downloadARAgingWorkbook,
  type WorkbookWriterDeps,
} from './excelExport';

const cases: Array<{ name: string; fn: () => void }> = [];

function test(name: string, fn: () => void) {
  cases.push({ name, fn });
}

test('buildARAgingExportRows formats customer rows and totals for Excel export', () => {
  const rows = buildARAgingExportRows({
    rows: [
      {
        name: 'BAPCO',
        grade: 'B',
        invoicedFils: 0n,
        paidFils: 0n,
        d15Fils: 1_500n,
        d30Fils: 2_500n,
        d60Fils: 0n,
        d90Fils: 0n,
        d90plusFils: 10_000n,
        outstandingFils: 14_000n,
      },
    ],
    totals: {
      d15: 1_500n,
      d30: 2_500n,
      d60: 0n,
      d90: 0n,
      d90plus: 10_000n,
      total: 14_000n,
    },
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    Customer: 'BAPCO',
    Grade: 'B',
    'Current (0-15)': '1.500',
    '16-30 Days': '2.500',
    '31-60 Days': '0.000',
    '61-90 Days': '0.000',
    '90+ Days': '10.000',
    'Total Outstanding': '14.000',
  });
  assert.equal(rows[1]?.Customer, 'TOTAL');
  assert.equal(rows[1]?.['Total Outstanding'], '14.000');
});

test('downloadARAgingWorkbook writes a workbook using the expected filename and sheet', () => {
  const appendedSheets: Array<{ workbook: object; worksheet: object; sheetName: string }> = [];
  const writtenFiles: Array<{ workbook: object; filename: string }> = [];
  const workbook = {};
  const worksheet = {};

  const deps: WorkbookWriterDeps = {
    utils: {
      book_new: () => workbook as WorkBook,
      json_to_sheet: (rows: unknown[]) => {
        assert.equal(Array.isArray(rows), true);
        return worksheet as never;
      },
      book_append_sheet: (targetWorkbook, targetWorksheet, sheetName = '') => {
        appendedSheets.push({
          workbook: targetWorkbook as object,
          worksheet: targetWorksheet as object,
          sheetName,
        });
      },
    },
    writeFileXLSX: (targetWorkbook, filename) => {
      writtenFiles.push({ workbook: targetWorkbook as object, filename });
    },
  };

  const filename = downloadARAgingWorkbook(
    {
      rows: [],
      totals: {
        d15: 0n,
        d30: 0n,
        d60: 0n,
        d90: 0n,
        d90plus: 0n,
        total: 0n,
      },
    },
    new Date('2026-03-20T08:30:00.000Z'),
    deps,
  );

  assert.equal(filename, 'AR-Aging-2026-03-20.xlsx');
  assert.deepEqual(appendedSheets, [
    {
      workbook,
      worksheet,
      sheetName: 'AR Aging',
    },
  ]);
  assert.deepEqual(writtenFiles, [
    {
      workbook,
      filename: 'AR-Aging-2026-03-20.xlsx',
    },
  ]);
});

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
