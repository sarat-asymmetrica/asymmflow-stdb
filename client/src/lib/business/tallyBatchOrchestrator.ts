import { prepareTallyImportPreview, executeTallyImport } from './tallyImport';
import type { TallyImportMode, TallyImportPreview, TallyImportExecutionResult } from './tallyImport';
import type { MoneyEvent, Party } from '../db';
import type { DbConnection } from '../../module_bindings';

// ── Types ────────────────────────────────────────────────────────────────────

export interface TallyBatchFile {
  /** Import mode for this file */
  mode: TallyImportMode;
  /** Original filename */
  fileName: string;
  /** File content as ArrayBuffer */
  data: ArrayBuffer;
}

export interface TallyBatchStepResult {
  mode: TallyImportMode;
  fileName: string;
  preview: TallyImportPreview;
  execution: TallyImportExecutionResult | null;
  status: 'pending' | 'previewing' | 'ready' | 'importing' | 'completed' | 'skipped' | 'failed';
  error?: string;
}

export interface TallyBatchPlan {
  /** Ordered list of steps (import order matters for data consistency) */
  steps: TallyBatchStepResult[];
  /** Overall batch status */
  status: 'planning' | 'previewing' | 'ready' | 'importing' | 'completed' | 'partial' | 'failed';
  /** Total rows across all files */
  totalRows: number;
  /** Total ready rows across all files */
  totalReadyRows: number;
  /** Total duplicate rows across all files */
  totalDuplicateRows: number;
  /** Total invalid rows across all files */
  totalInvalidRows: number;
}

export interface TallyBatchResult {
  plan: TallyBatchPlan;
  /** Total imported across all steps */
  totalImported: number;
  /** Total duplicates across all steps */
  totalDuplicates: number;
  /** Total errors across all steps */
  totalErrors: number;
  /** Total new parties created */
  totalCreatedParties: number;
  /** Steps that failed */
  failedSteps: string[];
  /** Whether all steps completed successfully */
  success: boolean;
}

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Recommended import order. Parties created in earlier steps can be matched
 * in later steps:
 *   1. customer_invoices — creates customer parties if missing
 *   2. customer_payments — matches against customers created in step 1
 *   3. supplier_invoices — creates supplier parties if missing
 *   4. supplier_payments — matches against suppliers created in step 3
 *   5. ar_defaulters — audit data, always last
 */
export const RECOMMENDED_IMPORT_ORDER: TallyImportMode[] = [
  'customer_invoices',
  'customer_payments',
  'supplier_invoices',
  'supplier_payments',
  'ar_defaulters',
];

/**
 * Modes required for a complete year import. ar_defaulters is optional
 * because it is audit/reference data, not transactional.
 */
const REQUIRED_MODES: TallyImportMode[] = [
  'customer_invoices',
  'customer_payments',
  'supplier_invoices',
  'supplier_payments',
];

// ── Pure utility functions ───────────────────────────────────────────────────

/**
 * Sort batch files into the recommended import order.
 * Files not in the recommended order are appended at the end.
 * Duplicate modes are preserved (multiple files per mode allowed).
 */
export function sortBatchFiles(files: TallyBatchFile[]): TallyBatchFile[] {
  const orderMap = new Map<TallyImportMode, number>();
  RECOMMENDED_IMPORT_ORDER.forEach((mode, index) => {
    orderMap.set(mode, index);
  });

  return [...files].sort((a, b) => {
    const aOrder = orderMap.get(a.mode) ?? RECOMMENDED_IMPORT_ORDER.length;
    const bOrder = orderMap.get(b.mode) ?? RECOMMENDED_IMPORT_ORDER.length;
    return aOrder - bOrder;
  });
}

/**
 * Validate that a set of files covers the minimum required modes
 * for a complete year import. Returns missing modes.
 * ar_defaulters is not required for completeness.
 */
export function validateBatchCompleteness(files: TallyBatchFile[]): {
  complete: boolean;
  presentModes: TallyImportMode[];
  missingModes: TallyImportMode[];
} {
  const presentSet = new Set(files.map((f) => f.mode));
  const presentModes = [...presentSet];
  const missingModes = REQUIRED_MODES.filter((mode) => !presentSet.has(mode));

  return {
    complete: missingModes.length === 0,
    presentModes,
    missingModes,
  };
}

/**
 * Generate a human-readable summary of a batch result.
 */
export function formatBatchSummary(result: TallyBatchResult): string {
  const lines: string[] = [];

  const overallStatus = result.success ? 'Completed successfully' : 'Completed with errors';
  lines.push(`Tally Batch Import: ${overallStatus}`);
  lines.push('');
  lines.push(`  Imported:  ${result.totalImported}`);
  lines.push(`  Duplicates: ${result.totalDuplicates}`);
  lines.push(`  Errors:    ${result.totalErrors}`);
  lines.push(`  Parties created: ${result.totalCreatedParties}`);

  if (result.failedSteps.length > 0) {
    lines.push('');
    lines.push(`  Failed steps: ${result.failedSteps.join(', ')}`);
  }

  lines.push('');
  lines.push('Per-step breakdown:');
  for (const step of result.plan.steps) {
    const execSummary = step.execution
      ? `${step.execution.imported} imported, ${step.execution.duplicates} duplicates, ${step.execution.errors} errors`
      : step.status;
    lines.push(`  [${step.status}] ${step.mode} (${step.fileName}): ${execSummary}`);
  }

  return lines.join('\n');
}

// ── Orchestration functions ──────────────────────────────────────────────────

function computePlanTotals(steps: TallyBatchStepResult[]): {
  totalRows: number;
  totalReadyRows: number;
  totalDuplicateRows: number;
  totalInvalidRows: number;
} {
  let totalRows = 0;
  let totalReadyRows = 0;
  let totalDuplicateRows = 0;
  let totalInvalidRows = 0;

  for (const step of steps) {
    totalRows += step.preview.totalRows;
    totalReadyRows += step.preview.readyRows;
    totalDuplicateRows += step.preview.duplicateRows;
    totalInvalidRows += step.preview.invalidRows;
  }

  return { totalRows, totalReadyRows, totalDuplicateRows, totalInvalidRows };
}

/**
 * Create a batch plan by previewing all files in order.
 * Does NOT execute any imports — just generates previews.
 */
export function createBatchPlan(
  files: TallyBatchFile[],
  parties: Party[],
  moneyEvents: MoneyEvent[],
): TallyBatchPlan {
  const sorted = sortBatchFiles(files);
  const steps: TallyBatchStepResult[] = [];

  for (const file of sorted) {
    const preview = prepareTallyImportPreview(
      file.data,
      file.mode,
      parties,
      moneyEvents,
      file.fileName,
    );

    steps.push({
      mode: file.mode,
      fileName: file.fileName,
      preview,
      execution: null,
      status: 'ready',
    });
  }

  const totals = computePlanTotals(steps);

  return {
    steps,
    status: 'ready',
    ...totals,
  };
}

/**
 * Execute a batch plan step by step.
 * Executes in order, stopping on the first failure if `stopOnError` is true.
 * Returns the final result with per-step details.
 *
 * This is an async generator that yields progress after each step,
 * allowing the UI to show real-time progress.
 */
export async function* executeBatchPlan(
  plan: TallyBatchPlan,
  connection: DbConnection,
  getLatestParties: () => Party[],
  getLatestMoneyEvents: () => MoneyEvent[],
  options?: { stopOnError?: boolean },
): AsyncGenerator<TallyBatchStepResult, TallyBatchResult, void> {
  const stopOnError = options?.stopOnError ?? false;
  let hasFailed = false;

  plan.status = 'importing';

  for (const step of plan.steps) {
    if (hasFailed && stopOnError) {
      step.status = 'skipped';
      step.execution = null;
      yield step;
      continue;
    }

    step.status = 'importing';
    yield step;

    try {
      // executeTallyImport re-fetches parties and moneyEvents via the getter
      // functions, so parties created in earlier steps are available for
      // matching in later steps.
      const executionResult = await executeTallyImport(
        step.preview,
        connection,
        getLatestParties,
        getLatestMoneyEvents,
      );

      step.execution = executionResult;
      step.status = 'completed';
    } catch (error) {
      step.status = 'failed';
      step.error = error instanceof Error ? error.message : String(error);
      step.execution = null;
      hasFailed = true;
    }

    yield step;
  }

  // Determine final plan status
  const failedSteps = plan.steps.filter((s) => s.status === 'failed');
  const completedSteps = plan.steps.filter((s) => s.status === 'completed');

  if (failedSteps.length === 0) {
    plan.status = 'completed';
  } else if (completedSteps.length > 0) {
    plan.status = 'partial';
  } else {
    plan.status = 'failed';
  }

  // Aggregate results
  let totalImported = 0;
  let totalDuplicates = 0;
  let totalErrors = 0;
  let totalCreatedParties = 0;

  for (const step of plan.steps) {
    if (step.execution) {
      totalImported += step.execution.imported;
      totalDuplicates += step.execution.duplicates;
      totalErrors += step.execution.errors;
      totalCreatedParties += step.execution.createdParties;
    }
  }

  return {
    plan,
    totalImported,
    totalDuplicates,
    totalErrors,
    totalCreatedParties,
    failedSteps: failedSteps.map((s) => `${s.mode} (${s.fileName})`),
    success: failedSteps.length === 0,
  };
}
