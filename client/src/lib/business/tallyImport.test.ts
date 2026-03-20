import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { prepareTallyImportPreview } from './tallyImport';

const cases: Array<{ name: string; fn: () => void }> = [];

function test(name: string, fn: () => void) {
  cases.push({ name, fn });
}

function makeWorkbook(rows: unknown[][]): ArrayBuffer {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

const parties = [
  {
    id: 1n,
    name: 'BAPCO Refining',
    isCustomer: true,
    isSupplier: false,
    grade: { tag: 'B' },
    creditLimitFils: 0n,
    isCreditBlocked: false,
    paymentTermsDays: 45n,
    productTypes: '',
    annualGoalFils: 0n,
    notes: '',
    createdAt: { microsSinceUnixEpoch: 1n },
    updatedAt: { microsSinceUnixEpoch: 1n },
  },
  {
    id: 2n,
    name: 'Endress+Hauser',
    isCustomer: false,
    isSupplier: true,
    grade: { tag: 'B' },
    creditLimitFils: 0n,
    isCreditBlocked: false,
    paymentTermsDays: 30n,
    productTypes: '',
    annualGoalFils: 0n,
    notes: '',
    createdAt: { microsSinceUnixEpoch: 1n },
    updatedAt: { microsSinceUnixEpoch: 1n },
  },
];

test('prepareTallyImportPreview parses customer invoice sheets and derives pre-VAT subtotal', () => {
  const workbook = makeWorkbook([
    ['Invoice No', 'Customer Name', 'Date', 'Amount', 'Currency'],
    ['INV-001', 'BAPCO Refining', '2026-03-01', '110.000', 'BHD'],
  ]);

  const preview = prepareTallyImportPreview(
    workbook,
    'customer_invoices',
    parties as never,
    [],
    'Invoices 2026.xlsx',
  );

  assert.equal(preview.totalRows, 1);
  assert.equal(preview.readyRows, 1);
  assert.equal(preview.rows[0]?.matchedPartyId, 1n);
  assert.equal(preview.rows[0]?.subtotalFils, 100_000n);
  assert.equal(preview.rows[0]?.totalFils, 110_000n);
});

test('prepareTallyImportPreview marks existing ledger duplicates', () => {
  const workbook = makeWorkbook([
    ['Invoice No', 'Customer Name', 'Date', 'Amount', 'Currency'],
    ['INV-001', 'BAPCO Refining', '2026-03-01', '110.000', 'BHD'],
  ]);

  const preview = prepareTallyImportPreview(
    workbook,
    'customer_invoices',
    parties as never,
    [
      {
        id: 9n,
        partyId: 1n,
        orderId: undefined,
        deliveryNoteId: undefined,
        kind: { tag: 'CustomerInvoice' },
        status: { tag: 'Active' },
        subtotalFils: 100_000n,
        vatFils: 10_000n,
        totalFils: 110_000n,
        reference: 'INV-001',
        dueDate: undefined,
        paidAt: undefined,
        createdBy: 'user',
        createdAt: { microsSinceUnixEpoch: 1n },
        updatedAt: { microsSinceUnixEpoch: 1n },
      },
    ] as never,
    'Invoices 2026.xlsx',
  );

  assert.equal(preview.duplicateRows, 1);
  assert.equal(preview.rows[0]?.status, 'duplicate');
});

test('prepareTallyImportPreview flags unsupported non-BHD rows and missing suppliers', () => {
  const workbook = makeWorkbook([
    ['Voucher No', 'Vendor', 'Payment Date', 'Amount', 'Currency'],
    ['PAY-100', 'New Vendor LLC', '15/03/2026', '250.500', 'USD'],
  ]);

  const preview = prepareTallyImportPreview(
    workbook,
    'supplier_payments',
    parties as never,
    [],
    'Supplier Payments.xlsx',
  );

  assert.equal(preview.invalidRows, 1);
  assert.equal(preview.rows[0]?.willCreateParty, false);
  assert.match(preview.rows[0]?.issues.join(' ') ?? '', /Only BHD rows are supported/);
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
