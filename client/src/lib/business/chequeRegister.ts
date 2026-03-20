// ── Cheque Register ─────────────────────────────────────────────────
// Client-side cheque tracking with localStorage persistence.
// Provides issuance, status tracking, stale detection, and reporting.

const STORAGE_KEY = 'asymmflow_cheque_register';
const CURRENT_VERSION = 1;
const STALE_DAYS = 180;

// ── Types ────────────────────────────────────────────────────────────

export type ChequeStatus = 'issued' | 'presented' | 'cleared' | 'bounced' | 'cancelled' | 'stale';

export interface ChequeEntry {
  /** Unique cheque ID */
  id: string;
  /** Cheque number (from cheque book) */
  chequeNumber: string;
  /** Bank name */
  bankName: string;
  /** Payee (party name) */
  payeeName: string;
  /** Payee party ID if known */
  payeePartyId?: string;
  /** Amount in fils */
  amountFils: bigint;
  /** Issue date ISO string */
  issueDate: string;
  /** Clearing date ISO string (when cleared/bounced) */
  clearingDate?: string;
  /** Current status */
  status: ChequeStatus;
  /** Reference/memo */
  reference: string;
  /** Linked money event ID if reconciled */
  linkedMoneyEventId?: string;
  /** History of status changes */
  statusHistory: Array<{
    from: ChequeStatus | 'new';
    to: ChequeStatus;
    date: string;
    note?: string;
  }>;
  /** Created timestamp */
  createdAt: string;
  /** Last updated timestamp */
  updatedAt: string;
}

export interface ChequeRegister {
  entries: ChequeEntry[];
  version: number;
}

export interface ChequeSummary {
  totalIssued: number;
  totalCleared: number;
  totalBounced: number;
  totalStale: number;
  totalCancelled: number;
  totalPending: number;
  outstandingAmountFils: bigint;
  clearedAmountFils: bigint;
  bouncedAmountFils: bigint;
}

// ── Valid status transitions ─────────────────────────────────────────

export const CHEQUE_TRANSITIONS: Record<ChequeStatus, ChequeStatus[]> = {
  issued: ['presented', 'cancelled', 'stale'],
  presented: ['cleared', 'bounced', 'cancelled', 'stale'],
  cleared: [],
  bounced: [],
  cancelled: [],
  stale: [],
};

// ── Internal helpers ─────────────────────────────────────────────────

function generateChequeId(now: Date = new Date()): string {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const rand = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `CHQ-${date}-${rand}`;
}

function daysBetween(isoA: string, isoB: string): number {
  const msPerDay = 86_400_000;
  const a = new Date(isoA).getTime();
  const b = new Date(isoB).getTime();
  return Math.floor(Math.abs(b - a) / msPerDay);
}

// ── Serialisation helpers (bigint ↔ string) ──────────────────────────

interface SerialisedChequeEntry {
  id: string;
  chequeNumber: string;
  bankName: string;
  payeeName: string;
  payeePartyId?: string;
  amountFils: string;
  issueDate: string;
  clearingDate?: string;
  status: ChequeStatus;
  reference: string;
  linkedMoneyEventId?: string;
  statusHistory: Array<{
    from: ChequeStatus | 'new';
    to: ChequeStatus;
    date: string;
    note?: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

interface SerialisedChequeRegister {
  entries: SerialisedChequeEntry[];
  version: number;
}

function serialiseEntry(entry: ChequeEntry): SerialisedChequeEntry {
  return {
    ...entry,
    amountFils: entry.amountFils.toString(),
  };
}

function deserialiseEntry(raw: SerialisedChequeEntry): ChequeEntry {
  return {
    ...raw,
    amountFils: BigInt(raw.amountFils),
  };
}

// ── Core functions ───────────────────────────────────────────────────

/** Create empty register. */
export function createEmptyRegister(): ChequeRegister {
  return { entries: [], version: CURRENT_VERSION };
}

/** Issue a new cheque. */
export function issueCheque(
  register: ChequeRegister,
  chequeNumber: string,
  bankName: string,
  payeeName: string,
  amountFils: bigint,
  issueDate: string,
  reference: string,
  payeePartyId?: string,
): ChequeRegister {
  const now = new Date().toISOString();
  const entry: ChequeEntry = {
    id: generateChequeId(),
    chequeNumber,
    bankName,
    payeeName,
    payeePartyId,
    amountFils,
    issueDate,
    status: 'issued',
    reference,
    statusHistory: [
      { from: 'new', to: 'issued', date: now },
    ],
    createdAt: now,
    updatedAt: now,
  };

  return {
    ...register,
    entries: [...register.entries, entry],
  };
}

/** Advance cheque status. Throws if the transition is invalid. */
export function advanceChequeStatus(
  register: ChequeRegister,
  chequeId: string,
  newStatus: ChequeStatus,
  note?: string,
): ChequeRegister {
  const idx = register.entries.findIndex((e) => e.id === chequeId);
  if (idx === -1) {
    throw new Error(`Cheque not found: ${chequeId}`);
  }

  const entry = register.entries[idx];
  const allowed = CHEQUE_TRANSITIONS[entry.status];
  if (!allowed.includes(newStatus)) {
    throw new Error(
      `Invalid transition: ${entry.status} -> ${newStatus}. Allowed: ${allowed.length > 0 ? allowed.join(', ') : 'none (terminal state)'}`,
    );
  }

  const now = new Date().toISOString();
  const updated: ChequeEntry = {
    ...entry,
    status: newStatus,
    updatedAt: now,
    clearingDate: (newStatus === 'cleared' || newStatus === 'bounced') ? now : entry.clearingDate,
    statusHistory: [
      ...entry.statusHistory,
      { from: entry.status, to: newStatus, date: now, note },
    ],
  };

  const newEntries = [...register.entries];
  newEntries[idx] = updated;

  return { ...register, entries: newEntries };
}

/** Check if a cheque is stale (>180 days old, not in terminal cleared/bounced/cancelled/stale state). */
export function isStale(entry: ChequeEntry, nowIso?: string): boolean {
  if (entry.status !== 'issued' && entry.status !== 'presented') {
    return false;
  }
  const now = nowIso ?? new Date().toISOString();
  return daysBetween(entry.issueDate, now) > STALE_DAYS;
}

/** Mark all stale cheques (>180 days from issue, still issued/presented). */
export function markStaleCheques(register: ChequeRegister): ChequeRegister {
  const nowIso = new Date().toISOString();
  let result = register;

  for (const entry of register.entries) {
    if (isStale(entry, nowIso)) {
      result = advanceChequeStatus(result, entry.id, 'stale', 'Auto-marked stale (>180 days)');
    }
  }

  return result;
}

/** Compute summary statistics. */
export function computeChequeSummary(register: ChequeRegister): ChequeSummary {
  let totalIssued = 0;
  let totalCleared = 0;
  let totalBounced = 0;
  let totalStale = 0;
  let totalCancelled = 0;
  let totalPending = 0;
  let outstandingAmountFils = 0n;
  let clearedAmountFils = 0n;
  let bouncedAmountFils = 0n;

  for (const e of register.entries) {
    switch (e.status) {
      case 'issued':
        totalIssued++;
        totalPending++;
        outstandingAmountFils += e.amountFils;
        break;
      case 'presented':
        totalPending++;
        outstandingAmountFils += e.amountFils;
        break;
      case 'cleared':
        totalCleared++;
        clearedAmountFils += e.amountFils;
        break;
      case 'bounced':
        totalBounced++;
        bouncedAmountFils += e.amountFils;
        break;
      case 'stale':
        totalStale++;
        break;
      case 'cancelled':
        totalCancelled++;
        break;
    }
  }

  return {
    totalIssued,
    totalCleared,
    totalBounced,
    totalStale,
    totalCancelled,
    totalPending,
    outstandingAmountFils,
    clearedAmountFils,
    bouncedAmountFils,
  };
}

/** Find cheques by status. */
export function findByStatus(register: ChequeRegister, status: ChequeStatus): ChequeEntry[] {
  return register.entries.filter((e) => e.status === status);
}

/** Find cheques by payee (case-insensitive substring match). */
export function findByPayee(register: ChequeRegister, payeeName: string): ChequeEntry[] {
  const needle = payeeName.toLowerCase();
  return register.entries.filter((e) => e.payeeName.toLowerCase().includes(needle));
}

/** Persist register to localStorage. */
export function saveChequeRegister(register: ChequeRegister): void {
  const serialised: SerialisedChequeRegister = {
    version: register.version,
    entries: register.entries.map(serialiseEntry),
  };
  globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(serialised));
}

/** Load register from localStorage (returns empty register if none exists). */
export function loadChequeRegister(): ChequeRegister {
  const raw = globalThis.localStorage.getItem(STORAGE_KEY);
  if (raw === null) return createEmptyRegister();

  const parsed: SerialisedChequeRegister = JSON.parse(raw);
  return {
    version: parsed.version,
    entries: parsed.entries.map(deserialiseEntry),
  };
}

/** Format register as text report. */
export function formatChequeReport(register: ChequeRegister): string {
  const summary = computeChequeSummary(register);
  const lines: string[] = [];

  lines.push('AsymmFlow Cheque Register Report');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('\u2550'.repeat(40));
  lines.push('');
  lines.push('Summary:');
  lines.push(`  Total pending: ${summary.totalPending} (issued + presented)`);
  lines.push(`  Total cleared: ${summary.totalCleared}`);
  lines.push(`  Total bounced: ${summary.totalBounced}`);
  lines.push(`  Total stale: ${summary.totalStale}`);
  lines.push(`  Total cancelled: ${summary.totalCancelled}`);
  lines.push(`  Outstanding amount (fils): ${summary.outstandingAmountFils}`);
  lines.push(`  Cleared amount (fils): ${summary.clearedAmountFils}`);
  lines.push(`  Bounced amount (fils): ${summary.bouncedAmountFils}`);

  if (register.entries.length > 0) {
    lines.push('');
    lines.push('Cheque Entries:');
    lines.push('\u2500'.repeat(40));

    for (const e of register.entries) {
      const statusIcon = e.status === 'cleared' ? '\u2713' : e.status === 'bounced' ? '\u2717' : '\u25CB';
      lines.push(`  ${statusIcon} #${e.chequeNumber} [${e.status.toUpperCase()}]`);
      lines.push(`    Payee: ${e.payeeName} | Bank: ${e.bankName}`);
      lines.push(`    Amount: ${e.amountFils} fils | Issued: ${e.issueDate.slice(0, 10)}`);
      if (e.clearingDate) {
        lines.push(`    Clearing date: ${e.clearingDate.slice(0, 10)}`);
      }
      if (e.reference) {
        lines.push(`    Ref: ${e.reference}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
