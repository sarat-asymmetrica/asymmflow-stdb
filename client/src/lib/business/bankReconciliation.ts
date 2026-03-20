import type { BankTransaction, MoneyEvent, Party } from '../db';

export type ParsedBankStatementRow = {
  lineNumber: number;
  bankName: string;
  transactionDate: Date;
  description: string;
  amountFils: bigint;
  reference: string;
};

export type PaymentCandidate = {
  moneyEventId: bigint;
  partyId: bigint;
  partyName: string;
  kind: string;
  reference: string;
  amountFils: bigint;
  signedAmountFils: bigint;
  createdAtMicros: bigint;
};

export type BankMatchSuggestion = {
  moneyEventId: bigint;
  partyName: string;
  kind: string;
  reference: string;
  signedAmountFils: bigint;
  score: number;
  reasons: string[];
  daysApart: number;
};

const DATE_HEADERS = ['date', 'transaction date', 'value date', 'posted date'];
const DESCRIPTION_HEADERS = ['description', 'details', 'narration', 'memo', 'particulars', 'remarks'];
const REFERENCE_HEADERS = ['reference', 'ref', 'cheque no', 'cheque number', 'document no', 'transaction id'];
const AMOUNT_HEADERS = ['amount', 'transaction amount', 'value', 'net amount'];
const DEBIT_HEADERS = ['debit', 'withdrawal', 'withdrawals', 'paid out'];
const CREDIT_HEADERS = ['credit', 'deposit', 'deposits', 'paid in'];

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeReference(value: string): string {
  return normalizeText(value.replace(/^\[[^\]]+\]\s*/u, ''));
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells.map((cell) => cell.replace(/^"(.*)"$/, '$1').trim());
}

function pickColumnIndex(headers: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const index = headers.findIndex((header) => header === alias);
    if (index >= 0) return index;
  }
  return -1;
}

function parseDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime())) return direct;

  const ddmmyyyy = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    const fullYear = yyyy.length === 2 ? `20${yyyy}` : yyyy;
    const parsed = new Date(`${fullYear}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return null;
}

function parseDecimalToFils(value: string): bigint | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalized = trimmed
    .replace(/[,\s]/g, '')
    .replace(/[()]/g, '')
    .replace(/CR$/i, '')
    .replace(/DR$/i, '');
  if (!normalized) return null;

  const negative = /[(]|-$|^-/u.test(trimmed) || /DR$/i.test(trimmed);
  const numberValue = Number.parseFloat(normalized);
  if (!Number.isFinite(numberValue)) return null;

  const fils = BigInt(Math.round(numberValue * 1000));
  return negative ? -fils : fils;
}

function toSignedPaymentAmount(kind: string, amountFils: bigint): bigint {
  if (kind === 'SupplierPayment') return -amountFils;
  return amountFils;
}

function absoluteBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function daysBetween(leftMicros: bigint, rightMicros: bigint): number {
  const diffMicros = leftMicros >= rightMicros ? leftMicros - rightMicros : rightMicros - leftMicros;
  return Math.floor(Number(diffMicros / 1_000_000n / 86_400n));
}

export function parseBankStatementCsv(csvText: string, bankName: string): ParsedBankStatementRow[] {
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    throw new Error('CSV must include a header row and at least one transaction row.');
  }

  const headers = splitCsvLine(lines[0]).map(normalizeHeader);
  const dateIndex = pickColumnIndex(headers, DATE_HEADERS);
  const descriptionIndex = pickColumnIndex(headers, DESCRIPTION_HEADERS);
  const referenceIndex = pickColumnIndex(headers, REFERENCE_HEADERS);
  const amountIndex = pickColumnIndex(headers, AMOUNT_HEADERS);
  const debitIndex = pickColumnIndex(headers, DEBIT_HEADERS);
  const creditIndex = pickColumnIndex(headers, CREDIT_HEADERS);

  if (dateIndex < 0) {
    throw new Error('CSV is missing a date column.');
  }
  if (descriptionIndex < 0) {
    throw new Error('CSV is missing a description column.');
  }
  if (amountIndex < 0 && debitIndex < 0 && creditIndex < 0) {
    throw new Error('CSV must contain either an amount column or debit/credit columns.');
  }

  const rows: ParsedBankStatementRow[] = [];

  for (let index = 1; index < lines.length; index += 1) {
    const cells = splitCsvLine(lines[index]);
    const rawDate = cells[dateIndex] ?? '';
    const rawDescription = cells[descriptionIndex] ?? '';
    const rawReference = referenceIndex >= 0 ? cells[referenceIndex] ?? '' : '';

    const parsedDate = parseDate(rawDate);
    if (!parsedDate || !rawDescription.trim()) {
      continue;
    }

    let amountFils: bigint | null = null;
    if (amountIndex >= 0) {
      amountFils = parseDecimalToFils(cells[amountIndex] ?? '');
    } else {
      const debitFils = debitIndex >= 0 ? parseDecimalToFils(cells[debitIndex] ?? '') ?? 0n : 0n;
      const creditFils = creditIndex >= 0 ? parseDecimalToFils(cells[creditIndex] ?? '') ?? 0n : 0n;
      amountFils = creditFils - absoluteBigInt(debitFils);
    }

    if (!amountFils || amountFils === 0n) {
      continue;
    }

    rows.push({
      lineNumber: index + 1,
      bankName,
      transactionDate: parsedDate,
      description: rawDescription.trim(),
      amountFils,
      reference: rawReference.trim(),
    });
  }

  if (rows.length === 0) {
    throw new Error('No transaction rows could be parsed from the CSV.');
  }

  return rows;
}

export function buildPaymentCandidates(args: {
  parties: Party[];
  moneyEvents: MoneyEvent[];
  bankTransactions: BankTransaction[];
}): PaymentCandidate[] {
  const matchedMoneyEventIds = new Set(
    args.bankTransactions
      .filter((transaction) => transaction.matchedMoneyEventId !== undefined)
      .map((transaction) => transaction.matchedMoneyEventId as bigint),
  );

  const partyNames = new Map(args.parties.map((party) => [party.id, party.name]));

  return args.moneyEvents
    .filter((event) => {
      if (matchedMoneyEventIds.has(event.id)) return false;
      if (event.kind.tag !== 'CustomerPayment' && event.kind.tag !== 'SupplierPayment') return false;
      if (event.status.tag === 'Draft' || event.status.tag === 'Cancelled') return false;
      return true;
    })
    .map((event) => ({
      moneyEventId: event.id,
      partyId: event.partyId,
      partyName: partyNames.get(event.partyId) ?? 'Unknown',
      kind: event.kind.tag,
      reference: event.reference ?? '',
      amountFils: event.totalFils,
      signedAmountFils: toSignedPaymentAmount(event.kind.tag, event.totalFils),
      createdAtMicros: event.createdAt.microsSinceUnixEpoch,
    }))
    .sort((left, right) => Number(right.createdAtMicros - left.createdAtMicros));
}

export function suggestMatches(
  transaction: Pick<BankTransaction, 'amountFils' | 'description' | 'reference' | 'transactionDate'>,
  candidates: PaymentCandidate[],
): BankMatchSuggestion[] {
  const transactionText = normalizeText(`${transaction.description} ${transaction.reference}`);
  const transactionDateMicros = transaction.transactionDate.microsSinceUnixEpoch;

  return candidates
    .map((candidate) => {
      const reasons: string[] = [];
      let score = 0;

      if (candidate.signedAmountFils === transaction.amountFils) {
        score += 70;
        reasons.push('Exact amount');
      } else if (absoluteBigInt(candidate.amountFils) === absoluteBigInt(transaction.amountFils)) {
        score += 45;
        reasons.push('Amount magnitude matches');
      }

      const candidateDateMicros = candidate.createdAtMicros;
      const daysApart = daysBetween(transactionDateMicros, candidateDateMicros);
      if (daysApart === 0) {
        score += 20;
        reasons.push('Same day');
      } else if (daysApart <= 3) {
        score += 12;
        reasons.push('Within 3 days');
      } else if (daysApart <= 7) {
        score += 6;
        reasons.push('Within 7 days');
      }

      const candidateReference = normalizeReference(candidate.reference);
      const partyName = normalizeText(candidate.partyName);
      if (candidateReference && transactionText.includes(candidateReference)) {
        score += 20;
        reasons.push('Reference match');
      }
      if (partyName && transactionText.includes(partyName)) {
        score += 12;
        reasons.push('Party name match');
      }
      if (candidate.kind === 'CustomerPayment' && transaction.amountFils > 0n) {
        score += 4;
      }
      if (candidate.kind === 'SupplierPayment' && transaction.amountFils < 0n) {
        score += 4;
      }

      return {
        moneyEventId: candidate.moneyEventId,
        partyName: candidate.partyName,
        kind: candidate.kind,
        reference: candidate.reference,
        signedAmountFils: candidate.signedAmountFils,
        score,
        reasons,
        daysApart,
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => {
      if (left.score === right.score) return left.daysApart - right.daysApart;
      return right.score - left.score;
    })
    .slice(0, 5);
}
