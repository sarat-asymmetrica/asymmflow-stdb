// ── Tally Import Batch Audit Log ─────────────────────────────────────
// Client-side import batch tracking with localStorage persistence.
// Provides idempotency fingerprinting, batch history, and report export.

const STORAGE_KEY = 'asymmflow_tally_audit_log';
const CURRENT_VERSION = 1;

// ── Types ────────────────────────────────────────────────────────────

export interface TallyImportBatchRecord {
  /** Unique batch ID (timestamp + random hex suffix) */
  batchId: string;
  /** When the import was executed */
  executedAt: string; // ISO date string
  /** Import mode used */
  mode: string;
  /** Original filename */
  fileName: string;
  /** Number of rows in the source file */
  totalRows: number;
  /** Number of rows successfully imported */
  importedRows: number;
  /** Number of duplicate rows skipped */
  duplicateRows: number;
  /** Number of invalid rows skipped */
  invalidRows: number;
  /** Number of new parties created during import */
  createdParties: number;
  /** Number of rows that failed during execution */
  errorCount: number;
  /** Error details (first N) */
  errorDetails: string[];
  /** Import fingerprint for idempotency (hash of file content + mode) */
  fingerprint: string;
  /** Whether the batch was fully successful (errorCount === 0) */
  success: boolean;
}

export interface TallyImportAuditLog {
  /** All import batch records, most recent first */
  batches: TallyImportBatchRecord[];
  /** Schema version for future migration */
  version: number;
}

// ── Internal helpers ─────────────────────────────────────────────────

/** FNV-1a hash of an ArrayBuffer with a string salt. */
function simpleHash(data: ArrayBuffer, salt: string): string {
  const view = new Uint8Array(data);
  let hash = 0x811c9dc5; // FNV-1a offset basis
  const prime = 0x01000193; // FNV-1a prime

  for (const byte of view) {
    hash ^= byte;
    hash = Math.imul(hash, prime);
  }

  // Mix in salt
  for (let i = 0; i < salt.length; i++) {
    hash ^= salt.charCodeAt(i);
    hash = Math.imul(hash, prime);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Generate a batch ID: YYYYMMDD-HHmmss-XXXX */
function generateBatchId(now: Date = new Date()): string {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const time = `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  const rand = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `${date}-${time}-${rand}`;
}

// ── Core functions ───────────────────────────────────────────────────

/** Generate a deterministic fingerprint from file content and mode for idempotency. */
export function computeImportFingerprint(fileContent: ArrayBuffer, mode: string): string {
  return simpleHash(fileContent, mode);
}

/** Create a new batch record from import result data. */
export function createBatchRecord(
  mode: string,
  fileName: string,
  totalRows: number,
  importedRows: number,
  duplicateRows: number,
  invalidRows: number,
  createdParties: number,
  errorCount: number,
  errorDetails: string[],
  fingerprint: string,
): TallyImportBatchRecord {
  return {
    batchId: generateBatchId(),
    executedAt: new Date().toISOString(),
    mode,
    fileName,
    totalRows,
    importedRows,
    duplicateRows,
    invalidRows,
    createdParties,
    errorCount,
    errorDetails,
    fingerprint,
    success: errorCount === 0,
  };
}

/** Check if an import with this fingerprint has already been executed. */
export function hasBeenImported(log: TallyImportAuditLog, fingerprint: string): boolean {
  return log.batches.some((b) => b.fingerprint === fingerprint);
}

/** Append a batch record to the audit log (prepended, most recent first). */
export function appendBatch(log: TallyImportAuditLog, batch: TallyImportBatchRecord): TallyImportAuditLog {
  return {
    ...log,
    batches: [batch, ...log.batches],
  };
}

/** Get summary statistics from the audit log. */
export function getAuditSummary(log: TallyImportAuditLog): {
  totalBatches: number;
  totalImported: number;
  totalDuplicates: number;
  totalErrors: number;
  totalPartiesCreated: number;
  lastImportAt: string | null;
  modeBreakdown: Record<string, number>;
} {
  let totalImported = 0;
  let totalDuplicates = 0;
  let totalErrors = 0;
  let totalPartiesCreated = 0;
  const modeBreakdown: Record<string, number> = {};

  for (const b of log.batches) {
    totalImported += b.importedRows;
    totalDuplicates += b.duplicateRows;
    totalErrors += b.errorCount;
    totalPartiesCreated += b.createdParties;
    modeBreakdown[b.mode] = (modeBreakdown[b.mode] ?? 0) + 1;
  }

  return {
    totalBatches: log.batches.length,
    totalImported,
    totalDuplicates,
    totalErrors,
    totalPartiesCreated,
    lastImportAt: log.batches.length > 0 ? log.batches[0].executedAt : null,
    modeBreakdown,
  };
}

/** Create an empty audit log. */
export function createEmptyAuditLog(): TallyImportAuditLog {
  return { batches: [], version: CURRENT_VERSION };
}

/** Persist audit log to localStorage. */
export function saveAuditLog(log: TallyImportAuditLog): void {
  globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
}

/** Load audit log from localStorage (returns empty log if none exists). */
export function loadAuditLog(): TallyImportAuditLog {
  const raw = globalThis.localStorage.getItem(STORAGE_KEY);
  if (raw === null) return createEmptyAuditLog();

  const parsed: TallyImportAuditLog = JSON.parse(raw);
  // Future-proof: if version is older, migrate here
  return parsed;
}

/** Export audit log as a formatted text report. */
export function formatAuditReport(log: TallyImportAuditLog): string {
  const summary = getAuditSummary(log);
  const lines: string[] = [];

  lines.push('AsymmFlow Tally Import Audit Report');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('\u2550'.repeat(35));
  lines.push('');
  lines.push('Summary:');
  lines.push(`  Total imports: ${summary.totalBatches}`);
  lines.push(`  Total rows imported: ${summary.totalImported}`);
  lines.push(`  Total duplicates skipped: ${summary.totalDuplicates}`);
  lines.push(`  Total errors: ${summary.totalErrors}`);
  lines.push(`  New parties created: ${summary.totalPartiesCreated}`);

  if (log.batches.length > 0) {
    lines.push('');
    lines.push('Batch History:');
    lines.push('\u2500'.repeat(35));

    for (const b of log.batches) {
      const dt = b.executedAt.replace('T', ' ').slice(0, 16);
      lines.push(`  [${dt}] ${b.mode} from "${b.fileName}"`);

      const marker = b.success ? '\u2713' : '\u2717';
      lines.push(
        `    ${marker} ${b.importedRows} imported, ${b.duplicateRows} duplicates, ${b.errorCount} errors, ${b.createdParties} new parties`,
      );
      lines.push(`    Fingerprint: ${b.fingerprint}`);

      if (b.errorDetails.length > 0) {
        lines.push(`    Errors: ${b.errorDetails.join('; ')}`);
      }

      lines.push('');
    }
  }

  return lines.join('\n');
}
