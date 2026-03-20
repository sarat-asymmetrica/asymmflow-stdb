import * as XLSX from 'xlsx';
import type { WorkBook } from 'xlsx';
import type { ARAgingRow, ARAgingTotals } from '../business/arAging';
import { formatBHD } from '../format';

type ExportCellValue = string | number | boolean | null;
type ExportRow = Record<string, ExportCellValue>;

export interface WorkbookWriterDeps {
  utils: Pick<typeof XLSX.utils, 'book_new' | 'book_append_sheet' | 'json_to_sheet'>;
  writeFileXLSX: (workbook: WorkBook, filename: string) => void;
}

export interface ARAgingExportSnapshot {
  rows: ARAgingRow[];
  totals: ARAgingTotals;
}

const workbookWriterDeps: WorkbookWriterDeps = {
  utils: XLSX.utils,
  writeFileXLSX: XLSX.writeFileXLSX,
};

function buildTimestampLabel(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function buildARAgingExportRows(snapshot: ARAgingExportSnapshot): ExportRow[] {
  const customerRows = snapshot.rows.map((row) => ({
    Customer: row.name,
    Grade: row.grade,
    'Current (0-15)': formatBHD(row.d15Fils),
    '16-30 Days': formatBHD(row.d30Fils),
    '31-60 Days': formatBHD(row.d60Fils),
    '61-90 Days': formatBHD(row.d90Fils),
    '90+ Days': formatBHD(row.d90plusFils),
    'Total Outstanding': formatBHD(row.outstandingFils),
  }));

  customerRows.push({
    Customer: 'TOTAL',
    Grade: '',
    'Current (0-15)': formatBHD(snapshot.totals.d15),
    '16-30 Days': formatBHD(snapshot.totals.d30),
    '31-60 Days': formatBHD(snapshot.totals.d60),
    '61-90 Days': formatBHD(snapshot.totals.d90),
    '90+ Days': formatBHD(snapshot.totals.d90plus),
    'Total Outstanding': formatBHD(snapshot.totals.total),
  });

  return customerRows;
}

export function downloadWorkbook(
  filename: string,
  sheetName: string,
  rows: ExportRow[],
  deps: WorkbookWriterDeps = workbookWriterDeps,
): string {
  const workbook = deps.utils.book_new();
  const worksheet = deps.utils.json_to_sheet(rows);
  deps.utils.book_append_sheet(workbook, worksheet, sheetName);
  deps.writeFileXLSX(workbook, filename);
  return filename;
}

export function downloadARAgingWorkbook(
  snapshot: ARAgingExportSnapshot,
  now = new Date(),
  deps: WorkbookWriterDeps = workbookWriterDeps,
): string {
  const filename = `AR-Aging-${buildTimestampLabel(now)}.xlsx`;
  const rows = buildARAgingExportRows(snapshot);
  return downloadWorkbook(filename, 'AR Aging', rows, deps);
}
