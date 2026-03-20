import * as XLSX from 'xlsx';
import { Timestamp } from 'spacetimedb';
import type { DbConnection } from '../../module_bindings';
import type { MoneyEventKind } from '../../module_bindings/types';
import type { MoneyEvent, Party } from '../db';

export type TallyImportMode =
  | 'customer_invoices'
  | 'supplier_invoices'
  | 'supplier_payments'
  | 'customer_payments'
  | 'ar_defaulters';

export type TallyImportStatus = 'ready' | 'duplicate' | 'invalid';

export interface TallyPreviewRow {
  rowNumber: number;
  partyName: string;
  reference: string;
  currency: string;
  transactionDate: Date;
  subtotalFils: bigint;
  totalFils: bigint;
  status: TallyImportStatus;
  issues: string[];
  matchedPartyId?: bigint;
  matchedPartyName?: string;
  willCreateParty: boolean;
}

export interface TallyImportPreview {
  fileName: string;
  mode: TallyImportMode;
  rows: TallyPreviewRow[];
  totalRows: number;
  readyRows: number;
  duplicateRows: number;
  invalidRows: number;
}

export interface TallyImportExecutionResult {
  imported: number;
  duplicates: number;
  createdParties: number;
  errors: number;
  errorDetails: string[];
}

type CellValue = string | number | boolean | Date | null | undefined;
type SheetRow = CellValue[];

const MAX_ERROR_DETAILS = 12;

const MODE_META: Record<
  TallyImportMode,
  {
    moneyKind: MoneyEventKind['tag'];
    isCustomer: boolean;
    isSupplier: boolean;
    partyLabel: 'customer' | 'supplier';
    requiresInvoiceMath: boolean;
    referenceHeaders: string[];
    partyHeaders: string[];
    dateHeaders: string[];
    amountHeaders: string[];
    currencyHeaders: string[];
    vatHeaders: string[];
  }
> = {
  customer_invoices: {
    moneyKind: 'CustomerInvoice',
    isCustomer: true,
    isSupplier: false,
    partyLabel: 'customer',
    requiresInvoiceMath: true,
    referenceHeaders: ['invoice no', 'invoice number', 'invoice #', 'inv no', 'voucher no', 'ref', 'reference'],
    partyHeaders: ['customer', 'customer name', 'party', 'party name', 'ledger name'],
    dateHeaders: ['date', 'invoice date', 'date of invoice', 'voucher date'],
    amountHeaders: ['amount', 'total', 'invoice amount', 'value', 'grand total', 'net amount'],
    currencyHeaders: ['currency', 'curr'],
    vatHeaders: ['vat', 'tax', 'vat amount', 'tax amount'],
  },
  supplier_invoices: {
    moneyKind: 'SupplierInvoice',
    isCustomer: false,
    isSupplier: true,
    partyLabel: 'supplier',
    requiresInvoiceMath: true,
    referenceHeaders: ['invoice no', 'invoice number', 'bill no', 'voucher no', 'ref', 'reference'],
    partyHeaders: ['supplier', 'supplier name', 'party', 'party name', 'vendor', 'ledger name'],
    dateHeaders: ['date', 'purchase date', 'invoice date', 'voucher date'],
    amountHeaders: ['amount', 'total', 'invoice amount', 'value', 'grand total', 'net amount'],
    currencyHeaders: ['currency', 'curr'],
    vatHeaders: ['vat', 'tax', 'vat amount', 'tax amount'],
  },
  supplier_payments: {
    moneyKind: 'SupplierPayment',
    isCustomer: false,
    isSupplier: true,
    partyLabel: 'supplier',
    requiresInvoiceMath: false,
    referenceHeaders: ['reference', 'ref', 'payment reference', 'cheque no', 'transaction ref', 'voucher no'],
    partyHeaders: ['supplier', 'supplier name', 'party', 'party name', 'vendor', 'ledger name'],
    dateHeaders: ['date', 'payment date', 'paid date', 'voucher date'],
    amountHeaders: ['amount', 'paid amount', 'payment amount', 'value'],
    currencyHeaders: ['currency', 'curr'],
    vatHeaders: [],
  },
  customer_payments: {
    moneyKind: 'CustomerPayment',
    isCustomer: true,
    isSupplier: false,
    partyLabel: 'customer',
    requiresInvoiceMath: false,
    referenceHeaders: ['reference', 'ref', 'payment reference', 'receipt no', 'receipt number', 'cheque no', 'transaction ref', 'voucher no'],
    partyHeaders: ['customer', 'customer name', 'party', 'party name', 'ledger name'],
    dateHeaders: ['date', 'payment date', 'receipt date', 'received date', 'voucher date'],
    amountHeaders: ['amount', 'received amount', 'payment amount', 'receipt amount', 'value'],
    currencyHeaders: ['currency', 'curr'],
    vatHeaders: [],
  },
  ar_defaulters: {
    moneyKind: 'CustomerInvoice',
    isCustomer: true,
    isSupplier: false,
    partyLabel: 'customer',
    requiresInvoiceMath: false,
    referenceHeaders: ['reference', 'ref', 'account no', 'account number', 'ledger code'],
    partyHeaders: ['customer', 'customer name', 'party', 'party name', 'debtor', 'debtor name', 'ledger name'],
    dateHeaders: ['date', 'as of date', 'report date', 'aging date'],
    amountHeaders: ['amount', 'outstanding', 'balance', 'overdue', 'total due', 'net balance'],
    currencyHeaders: ['currency', 'curr'],
    vatHeaders: [],
  },
};

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeHeader(cell: CellValue): string {
  return normalizeText(String(cell ?? ''));
}

function normalizePartyName(name: string): string {
  return normalizeText(name);
}

function pushIssue(issues: string[], issue: string) {
  if (!issues.includes(issue)) {
    issues.push(issue);
  }
}

function appendError(errorDetails: string[], detail: string) {
  if (errorDetails.length < MAX_ERROR_DETAILS) {
    errorDetails.push(detail);
  } else if (errorDetails.length === MAX_ERROR_DETAILS) {
    errorDetails.push('Additional errors truncated.');
  }
}

function findColumn(headerMap: Map<string, number>, variants: string[], required = true): number {
  for (const variant of variants) {
    const direct = headerMap.get(normalizeText(variant));
    if (direct != null) return direct;
  }

  if (!required) return -1;
  return -1;
}

function parseWorkbookRows(workbookData: ArrayBuffer): SheetRow[] {
  const workbook = XLSX.read(workbookData, { type: 'array', cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error('Workbook has no sheets.');
  const sheet = workbook.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: '',
  }) as SheetRow[];
}

function parseAmountFils(cell: CellValue): bigint | null {
  if (typeof cell === 'number') {
    return BigInt(Math.round(cell * 1000));
  }

  const text = String(cell ?? '').trim();
  if (!text) return null;

  const cleaned = text.replace(/,/g, '').replace(/[^0-9.-]/g, '');
  if (!cleaned) return null;

  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;

  return BigInt(Math.round(parsed * 1000));
}

function parseDateCell(cell: CellValue): Date | null {
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
    return cell;
  }

  if (typeof cell === 'number') {
    const parsed = XLSX.SSF.parse_date_code(cell);
    if (!parsed) return null;
    return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
  }

  const text = String(cell ?? '').trim();
  if (!text) return null;

  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) {
    return direct;
  }

  const ddmmyyyy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (ddmmyyyy) {
    const [, dayRaw, monthRaw, yearRaw] = ddmmyyyy;
    const year = yearRaw.length === 2 ? Number(`20${yearRaw}`) : Number(yearRaw);
    const candidate = new Date(Date.UTC(year, Number(monthRaw) - 1, Number(dayRaw)));
    if (!Number.isNaN(candidate.getTime())) return candidate;
  }

  return null;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatCompositeDuplicateKey(
  partyId: bigint,
  moneyKind: MoneyEventKind['tag'],
  reference: string,
  totalFils: bigint,
): string {
  return `${moneyKind}|${partyId}|${normalizeText(reference)}|${totalFils}`;
}

function findMatchingParty(parties: Party[], name: string, isCustomer: boolean, isSupplier: boolean): Party | undefined {
  const normalized = normalizePartyName(name);
  const eligible = parties.filter((party) => (isCustomer ? party.isCustomer : true) && (isSupplier ? party.isSupplier : true));

  let exact = eligible.find((party) => normalizePartyName(party.name) === normalized);
  if (exact) return exact;

  exact = eligible.find((party) => {
    const candidate = normalizePartyName(party.name);
    return candidate.includes(normalized) || normalized.includes(candidate);
  });
  return exact;
}

function hasDuplicateMoneyEvent(
  moneyEvents: MoneyEvent[],
  partyId: bigint,
  moneyKind: MoneyEventKind['tag'],
  reference: string,
  totalFils: bigint,
): boolean {
  const normalizedReference = normalizeText(reference);
  return moneyEvents.some((event) =>
    event.partyId === partyId &&
    event.kind.tag === moneyKind &&
    normalizeText(event.reference) === normalizedReference &&
    event.totalFils === totalFils,
  );
}

function defaultDueDateForParty(party: Party | undefined, transactionDate: Date): Date {
  const paymentTermsDays = party ? Number(party.paymentTermsDays) : 30;
  return addDays(transactionDate, Number.isFinite(paymentTermsDays) && paymentTermsDays > 0 ? paymentTermsDays : 30);
}

function grossToNetSubtotal(grossFils: bigint, explicitVatFils?: bigint): bigint | null {
  if (explicitVatFils != null) {
    const subtotal = grossFils - explicitVatFils;
    return subtotal > 0n ? subtotal : null;
  }

  if (grossFils <= 0n) return null;
  const subtotal = (grossFils * 100n) / 110n;
  return subtotal > 0n ? subtotal : null;
}

function computePreviewRow(
  row: SheetRow,
  rowNumber: number,
  mode: TallyImportMode,
  headerMap: Map<string, number>,
  parties: Party[],
  moneyEvents: MoneyEvent[],
): TallyPreviewRow | null {
  const config = MODE_META[mode];
  const issues: string[] = [];

  const partyCol = findColumn(headerMap, config.partyHeaders);
  const dateCol = findColumn(headerMap, config.dateHeaders);
  const amountCol = findColumn(headerMap, config.amountHeaders);
  const currencyCol = findColumn(headerMap, config.currencyHeaders, false);
  const referenceCol = findColumn(headerMap, config.referenceHeaders, false);
  const vatCol = config.vatHeaders.length > 0 ? findColumn(headerMap, config.vatHeaders, false) : -1;

  const partyName = String(row[partyCol] ?? '').trim();
  const reference = String(referenceCol >= 0 ? row[referenceCol] ?? '' : '').trim();
  const currency = String(currencyCol >= 0 ? row[currencyCol] ?? 'BHD' : 'BHD').trim().toUpperCase() || 'BHD';
  const transactionDate = parseDateCell(row[dateCol]);
  const grossFils = parseAmountFils(row[amountCol]);
  const vatFils = vatCol >= 0 ? parseAmountFils(row[vatCol]) ?? undefined : undefined;

  if (!partyName) pushIssue(issues, `${config.partyLabel} name is missing.`);
  if (!transactionDate) pushIssue(issues, 'Date is invalid or missing.');
  if (grossFils == null || grossFils <= 0n) pushIssue(issues, 'Amount must be a positive BHD value.');
  if (!reference && config.requiresInvoiceMath) pushIssue(issues, 'Invoice reference is missing.');
  if (currency && currency !== 'BHD') pushIssue(issues, `Only BHD rows are supported right now (found ${currency}).`);

  if (issues.length > 0 || !transactionDate || grossFils == null || grossFils <= 0n) {
    return {
      rowNumber,
      partyName,
      reference: reference || `ROW-${rowNumber}`,
      currency,
      transactionDate: transactionDate ?? new Date(0),
      subtotalFils: 0n,
      totalFils: grossFils ?? 0n,
      status: 'invalid',
      issues,
      willCreateParty: false,
    };
  }

  const matchedParty = findMatchingParty(parties, partyName, config.isCustomer, config.isSupplier);
  const subtotalFils = config.requiresInvoiceMath
    ? grossToNetSubtotal(grossFils, vatFils)
    : grossFils;

  if (subtotalFils == null || subtotalFils <= 0n) {
    pushIssue(issues, 'Could not derive a valid pre-VAT subtotal from the sheet amount.');
  }

  // AR defaulters mode: audit/reference data — never mark as duplicate
  if (mode === 'ar_defaulters') {
    return {
      rowNumber,
      partyName,
      reference: reference || `ROW-${rowNumber}`,
      currency,
      transactionDate: transactionDate!,
      subtotalFils: grossFils!,
      totalFils: grossFils!,
      status: issues.length > 0 ? 'invalid' : 'ready',
      issues,
      matchedPartyId: matchedParty?.id,
      matchedPartyName: matchedParty?.name,
      willCreateParty: !matchedParty,
    };
  }

  if (matchedParty && mode === 'customer_invoices') {
    const grade = matchedParty.grade?.tag ?? 'B';
    if (grade === 'C' || grade === 'D') {
      pushIssue(issues, `Matched customer ${matchedParty.name} is grade ${grade}; invoice reducer requires advance cover.`);
    }
  }

  const totalFils = config.requiresInvoiceMath && subtotalFils != null
    ? subtotalFils + ((subtotalFils * 10n) / 100n)
    : grossFils;

  const duplicate = matchedParty
    ? hasDuplicateMoneyEvent(moneyEvents, matchedParty.id, config.moneyKind, reference || `ROW-${rowNumber}`, totalFils)
    : false;

  return {
    rowNumber,
    partyName,
    reference: reference || `ROW-${rowNumber}`,
    currency,
    transactionDate,
    subtotalFils: subtotalFils ?? 0n,
    totalFils,
    status: issues.length > 0 ? 'invalid' : duplicate ? 'duplicate' : 'ready',
    issues,
    matchedPartyId: matchedParty?.id,
    matchedPartyName: matchedParty?.name,
    willCreateParty: !matchedParty,
  };
}

export function prepareTallyImportPreview(
  workbookData: ArrayBuffer,
  mode: TallyImportMode,
  parties: Party[],
  moneyEvents: MoneyEvent[],
  fileName: string,
): TallyImportPreview {
  const rows = parseWorkbookRows(workbookData);
  if (rows.length < 2) {
    throw new Error('Workbook does not contain any data rows.');
  }

  const headerRow = rows[0] ?? [];
  const headerMap = new Map<string, number>();
  headerRow.forEach((cell, index) => {
    headerMap.set(normalizeHeader(cell), index);
  });

  const previewRows: TallyPreviewRow[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const isBlank = row.every((cell) => String(cell ?? '').trim() === '');
    if (isBlank) continue;
    const previewRow = computePreviewRow(row, index + 1, mode, headerMap, parties, moneyEvents);
    if (previewRow) previewRows.push(previewRow);
  }

  return {
    fileName,
    mode,
    rows: previewRows,
    totalRows: previewRows.length,
    readyRows: previewRows.filter((row) => row.status === 'ready').length,
    duplicateRows: previewRows.filter((row) => row.status === 'duplicate').length,
    invalidRows: previewRows.filter((row) => row.status === 'invalid').length,
  };
}

async function waitForPartyByName(
  name: string,
  getLatestParties: () => Party[],
  isCustomer: boolean,
  isSupplier: boolean,
): Promise<Party | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    const match = findMatchingParty(getLatestParties(), name, isCustomer, isSupplier);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

export async function executeTallyImport(
  preview: TallyImportPreview,
  connection: DbConnection,
  getLatestParties: () => Party[],
  getLatestMoneyEvents: () => MoneyEvent[],
): Promise<TallyImportExecutionResult> {
  const config = MODE_META[preview.mode];
  const result: TallyImportExecutionResult = {
    imported: 0,
    duplicates: 0,
    createdParties: 0,
    errors: 0,
    errorDetails: [],
  };

  const createdPartyIds = new Map<string, bigint>();
  const importedKeys = new Set<string>();

  for (const row of preview.rows) {
    if (row.status === 'duplicate') {
      result.duplicates += 1;
      continue;
    }

    if (row.status !== 'ready') {
      result.errors += 1;
      appendError(result.errorDetails, `Row ${row.rowNumber}: ${row.issues.join(' ')}`);
      continue;
    }

    try {
      const normalizedName = normalizePartyName(row.partyName);
      let matchedParty =
        row.matchedPartyId != null
          ? getLatestParties().find((party) => party.id === row.matchedPartyId)
          : undefined;

      if (!matchedParty && createdPartyIds.has(normalizedName)) {
        matchedParty = getLatestParties().find((party) => party.id === createdPartyIds.get(normalizedName));
      }

      if (!matchedParty) {
        connection.reducers.upsertParty({
          id: 0n,
          name: row.partyName,
          isCustomer: config.isCustomer,
          isSupplier: config.isSupplier,
          grade: { tag: 'B' } as Party['grade'],
          creditLimitFils: 0n,
          paymentTermsDays: 30n,
          productTypes: '',
          annualGoalFils: 0n,
          notes: `Created from Tally import (${preview.mode.replace(/_/g, ' ')})`,
          bankIban: '',
          bankSwift: '',
          bankAccountName: '',
        });

        const createdParty = await waitForPartyByName(
          row.partyName,
          getLatestParties,
          config.isCustomer,
          config.isSupplier,
        );

        if (!createdParty) {
          throw new Error(`Party "${row.partyName}" did not sync back after creation.`);
        }

        matchedParty = createdParty;
        createdPartyIds.set(normalizedName, createdParty.id);
        result.createdParties += 1;
      }

      const duplicateKey = formatCompositeDuplicateKey(
        matchedParty.id,
        config.moneyKind,
        row.reference,
        row.totalFils,
      );

      if (config.moneyKind === 'CustomerInvoice' && preview.mode === 'ar_defaulters') {
        // AR defaulters: log activity only, don't create money events
        try {
          connection.reducers.logActivity({
            entityType: 'party',
            entityId: matchedParty.id,
            action: 'ar_defaulter_import',
            detail: `Tally AR defaulter: ${row.reference} outstanding BHD ${(Number(row.totalFils) / 1000).toFixed(3)}`,
            followUpDue: undefined,
          });
          importedKeys.add(duplicateKey);
          result.imported += 1;
        } catch (error) {
          result.errors += 1;
          appendError(
            result.errorDetails,
            `Row ${row.rowNumber} (${row.reference || row.partyName}): ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        continue;
      }

      if (importedKeys.has(duplicateKey) || hasDuplicateMoneyEvent(
        getLatestMoneyEvents(),
        matchedParty.id,
        config.moneyKind,
        row.reference,
        row.totalFils,
      )) {
        result.duplicates += 1;
        continue;
      }

      const dueDate = config.requiresInvoiceMath
        ? Timestamp.fromDate(defaultDueDateForParty(matchedParty, row.transactionDate))
        : undefined;

      connection.reducers.recordMoneyEvent({
        partyId: matchedParty.id,
        orderId: undefined,
        deliveryNoteId: undefined,
        kind: { tag: config.moneyKind } as MoneyEventKind,
        subtotalFils: row.subtotalFils,
        reference: row.reference,
        sourceDate: undefined,
        dueDate,
      });

      importedKeys.add(duplicateKey);
      result.imported += 1;
    } catch (error) {
      result.errors += 1;
      appendError(
        result.errorDetails,
        `Row ${row.rowNumber} (${row.reference || row.partyName}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return result;
}
