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

const gradeCCustomer = {
  id: 3n,
  name: 'Risky Corp',
  isCustomer: true,
  isSupplier: false,
  grade: { tag: 'C' },
  creditLimitFils: 0n,
  isCreditBlocked: false,
  paymentTermsDays: 30n,
  productTypes: '',
  annualGoalFils: 0n,
  notes: '',
  createdAt: { microsSinceUnixEpoch: 1n },
  updatedAt: { microsSinceUnixEpoch: 1n },
};

test('customer_payments happy path — correct moneyKind and no VAT reverse-calc', () => {
  const workbook = makeWorkbook([
    ['Customer Name', 'Payment Date', 'Reference', 'Amount', 'Currency'],
    ['BAPCO Refining', '2026-03-10', 'REC-001', '500.000', 'BHD'],
  ]);

  const preview = prepareTallyImportPreview(
    workbook,
    'customer_payments',
    parties as never,
    [],
    'Customer Payments.xlsx',
  );

  assert.equal(preview.totalRows, 1);
  assert.equal(preview.readyRows, 1);
  assert.equal(preview.rows[0]?.status, 'ready');
  assert.equal(preview.rows[0]?.matchedPartyId, 1n);
  assert.equal(preview.rows[0]?.reference, 'REC-001');
  // requiresInvoiceMath is false, so subtotalFils === grossFils (no VAT reverse-calc)
  assert.equal(preview.rows[0]?.subtotalFils, 500_000n);
  assert.equal(preview.rows[0]?.totalFils, 500_000n);
  assert.equal(preview.rows[0]?.willCreateParty, false);
});

test('customer_payments marks duplicate when payment already exists', () => {
  const workbook = makeWorkbook([
    ['Customer Name', 'Receipt Date', 'Receipt No', 'Amount', 'Currency'],
    ['BAPCO Refining', '2026-03-10', 'REC-001', '500.000', 'BHD'],
  ]);

  const existingEvents = [
    {
      id: 10n,
      partyId: 1n,
      orderId: undefined,
      deliveryNoteId: undefined,
      kind: { tag: 'CustomerPayment' },
      status: { tag: 'Active' },
      subtotalFils: 500_000n,
      vatFils: 0n,
      totalFils: 500_000n,
      reference: 'REC-001',
      dueDate: undefined,
      paidAt: undefined,
      createdBy: 'user',
      createdAt: { microsSinceUnixEpoch: 1n },
      updatedAt: { microsSinceUnixEpoch: 1n },
    },
  ];

  const preview = prepareTallyImportPreview(
    workbook,
    'customer_payments',
    parties as never,
    existingEvents as never,
    'Customer Payments.xlsx',
  );

  assert.equal(preview.duplicateRows, 1);
  assert.equal(preview.rows[0]?.status, 'duplicate');
});

test('customer_payments assigns ROW-N fallback when reference is missing', () => {
  const workbook = makeWorkbook([
    ['Customer Name', 'Payment Date', 'Amount', 'Currency'],
    ['BAPCO Refining', '2026-03-10', '250.000', 'BHD'],
  ]);

  const preview = prepareTallyImportPreview(
    workbook,
    'customer_payments',
    parties as never,
    [],
    'Customer Payments.xlsx',
  );

  // payments don't requiresInvoiceMath, so missing reference is not an issue
  assert.equal(preview.readyRows, 1);
  assert.equal(preview.rows[0]?.status, 'ready');
  assert.equal(preview.rows[0]?.reference, 'ROW-2');
});

test('customer_payments rejects non-BHD currency rows', () => {
  const workbook = makeWorkbook([
    ['Customer Name', 'Payment Date', 'Reference', 'Amount', 'Currency'],
    ['BAPCO Refining', '2026-03-10', 'REC-002', '100.000', 'USD'],
  ]);

  const preview = prepareTallyImportPreview(
    workbook,
    'customer_payments',
    parties as never,
    [],
    'Customer Payments.xlsx',
  );

  assert.equal(preview.invalidRows, 1);
  assert.equal(preview.rows[0]?.status, 'invalid');
  assert.match(preview.rows[0]?.issues.join(' ') ?? '', /Only BHD rows are supported/);
});

test('customer_payments does NOT flag grade C/D customers (unlike customer_invoices)', () => {
  const workbook = makeWorkbook([
    ['Customer Name', 'Payment Date', 'Reference', 'Amount', 'Currency'],
    ['Risky Corp', '2026-03-10', 'REC-003', '300.000', 'BHD'],
  ]);

  const partiesWithGradeC = [...parties, gradeCCustomer];

  const preview = prepareTallyImportPreview(
    workbook,
    'customer_payments',
    partiesWithGradeC as never,
    [],
    'Customer Payments.xlsx',
  );

  assert.equal(preview.readyRows, 1);
  assert.equal(preview.rows[0]?.status, 'ready');
  assert.equal(preview.rows[0]?.issues.length, 0);

  // Verify that customer_invoices DOES flag the same party
  const invoiceWorkbook = makeWorkbook([
    ['Invoice No', 'Customer Name', 'Date', 'Amount', 'Currency'],
    ['INV-999', 'Risky Corp', '2026-03-10', '330.000', 'BHD'],
  ]);

  const invoicePreview = prepareTallyImportPreview(
    invoiceWorkbook,
    'customer_invoices',
    partiesWithGradeC as never,
    [],
    'Invoices.xlsx',
  );

  assert.match(invoicePreview.rows[0]?.issues.join(' ') ?? '', /grade C.*advance cover/);
});

test('customer_payments sets willCreateParty when customer is not found', () => {
  const workbook = makeWorkbook([
    ['Customer Name', 'Payment Date', 'Reference', 'Amount', 'Currency'],
    ['Unknown Customer LLC', '2026-03-10', 'REC-004', '750.000', 'BHD'],
  ]);

  const preview = prepareTallyImportPreview(
    workbook,
    'customer_payments',
    parties as never,
    [],
    'Customer Payments.xlsx',
  );

  assert.equal(preview.readyRows, 1);
  assert.equal(preview.rows[0]?.status, 'ready');
  assert.equal(preview.rows[0]?.willCreateParty, true);
  assert.equal(preview.rows[0]?.matchedPartyId, undefined);
});

test('ar_defaulters happy path — amounts taken as-is, no VAT reverse-calc', () => {
  const workbook = makeWorkbook([
    ['Customer Name', 'Outstanding', 'Date', 'Reference', 'Currency'],
    ['BAPCO Refining', '1500.000', '2026-03-15', 'DEF-001', 'BHD'],
  ]);

  const preview = prepareTallyImportPreview(
    workbook,
    'ar_defaulters',
    parties as never,
    [],
    'AR Defaulters Q1.xlsx',
  );

  assert.equal(preview.totalRows, 1);
  assert.equal(preview.readyRows, 1);
  assert.equal(preview.rows[0]?.status, 'ready');
  assert.equal(preview.rows[0]?.matchedPartyId, 1n);
  assert.equal(preview.rows[0]?.matchedPartyName, 'BAPCO Refining');
  // amounts taken as-is (no VAT reverse-calc): subtotalFils === totalFils === grossFils
  assert.equal(preview.rows[0]?.subtotalFils, 1_500_000n);
  assert.equal(preview.rows[0]?.totalFils, 1_500_000n);
  assert.equal(preview.rows[0]?.willCreateParty, false);
});

test('ar_defaulters — no duplicate marking even when existing CustomerInvoice has same reference', () => {
  const workbook = makeWorkbook([
    ['Customer Name', 'Outstanding', 'Date', 'Reference', 'Currency'],
    ['BAPCO Refining', '110.000', '2026-03-15', 'INV-001', 'BHD'],
  ]);

  const existingEvents = [
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
  ];

  const preview = prepareTallyImportPreview(
    workbook,
    'ar_defaulters',
    parties as never,
    existingEvents as never,
    'AR Defaulters Q1.xlsx',
  );

  // ar_defaulters is audit data — should NOT be marked as duplicate
  assert.equal(preview.duplicateRows, 0);
  assert.equal(preview.readyRows, 1);
  assert.equal(preview.rows[0]?.status, 'ready');
});

test('ar_defaulters — unmatched customer gets willCreateParty', () => {
  const workbook = makeWorkbook([
    ['Customer Name', 'Outstanding', 'Date', 'Currency'],
    ['Unknown Debtor LLC', '800.000', '2026-03-15', 'BHD'],
  ]);

  const preview = prepareTallyImportPreview(
    workbook,
    'ar_defaulters',
    parties as never,
    [],
    'AR Defaulters Q1.xlsx',
  );

  assert.equal(preview.readyRows, 1);
  assert.equal(preview.rows[0]?.status, 'ready');
  assert.equal(preview.rows[0]?.willCreateParty, true);
  assert.equal(preview.rows[0]?.matchedPartyId, undefined);
});

test('ar_defaulters — non-BHD rows flagged as invalid', () => {
  const workbook = makeWorkbook([
    ['Customer Name', 'Outstanding', 'Date', 'Reference', 'Currency'],
    ['BAPCO Refining', '500.000', '2026-03-15', 'DEF-002', 'USD'],
  ]);

  const preview = prepareTallyImportPreview(
    workbook,
    'ar_defaulters',
    parties as never,
    [],
    'AR Defaulters Q1.xlsx',
  );

  assert.equal(preview.invalidRows, 1);
  assert.equal(preview.rows[0]?.status, 'invalid');
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
