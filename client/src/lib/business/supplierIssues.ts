// ── Supplier Issues Log ─────────────────────────────────────────────
// Client-side supplier issue tracking with localStorage persistence.
// Provides reporting, status tracking, and summary analytics.

const STORAGE_KEY = 'asymmflow_supplier_issues';
const CURRENT_VERSION = 1;

// ── Types ────────────────────────────────────────────────────────────

export type IssueStatus = 'open' | 'pending' | 'resolved' | 'closed';
export type IssueSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IssueCategory = 'quality' | 'delivery' | 'pricing' | 'documentation' | 'communication' | 'other';

export interface SupplierIssue {
  id: string;
  supplierId: string;
  supplierName: string;
  title: string;
  description: string;
  category: IssueCategory;
  severity: IssueSeverity;
  status: IssueStatus;
  costImpactFils: bigint;
  reportedBy: string;
  reportedAt: string;
  resolvedAt?: string;
  resolution?: string;
  statusHistory: Array<{
    from: IssueStatus | 'new';
    to: IssueStatus;
    date: string;
    note?: string;
  }>;
}

export interface SupplierIssueLog {
  issues: SupplierIssue[];
  version: number;
}

export interface SupplierIssueSummary {
  totalIssues: number;
  openCount: number;
  pendingCount: number;
  resolvedCount: number;
  closedCount: number;
  totalCostImpactFils: bigint;
  bySeverity: Record<IssueSeverity, number>;
  byCategory: Record<IssueCategory, number>;
  bySupplier: Array<{ supplierName: string; count: number; openCount: number }>;
}

// ── Valid status transitions ─────────────────────────────────────────

export const ISSUE_TRANSITIONS: Record<IssueStatus, IssueStatus[]> = {
  open: ['pending', 'resolved', 'closed'],
  pending: ['open', 'resolved', 'closed'],
  resolved: ['closed', 'open'],
  closed: [],
};

// ── Internal helpers ─────────────────────────────────────────────────

function generateIssueId(now: Date = new Date()): string {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const rand = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `ISS-${date}-${rand}`;
}

// ── Serialisation helpers (bigint ↔ string) ──────────────────────────

interface SerialisedSupplierIssue {
  id: string;
  supplierId: string;
  supplierName: string;
  title: string;
  description: string;
  category: IssueCategory;
  severity: IssueSeverity;
  status: IssueStatus;
  costImpactFils: string;
  reportedBy: string;
  reportedAt: string;
  resolvedAt?: string;
  resolution?: string;
  statusHistory: Array<{
    from: IssueStatus | 'new';
    to: IssueStatus;
    date: string;
    note?: string;
  }>;
}

interface SerialisedSupplierIssueLog {
  issues: SerialisedSupplierIssue[];
  version: number;
}

function serialiseIssue(issue: SupplierIssue): SerialisedSupplierIssue {
  return {
    ...issue,
    costImpactFils: issue.costImpactFils.toString(),
  };
}

function deserialiseIssue(raw: SerialisedSupplierIssue): SupplierIssue {
  return {
    ...raw,
    costImpactFils: BigInt(raw.costImpactFils),
  };
}

// ── Core functions ───────────────────────────────────────────────────

/** Create an empty issue log. */
export function createEmptyIssueLog(): SupplierIssueLog {
  return { issues: [], version: CURRENT_VERSION };
}

/** Report a new supplier issue. */
export function reportIssue(
  log: SupplierIssueLog,
  supplierId: string,
  supplierName: string,
  title: string,
  description: string,
  category: IssueCategory,
  severity: IssueSeverity,
  reportedBy: string,
  costImpactFils?: bigint,
): SupplierIssueLog {
  const now = new Date().toISOString();
  const issue: SupplierIssue = {
    id: generateIssueId(),
    supplierId,
    supplierName,
    title,
    description,
    category,
    severity,
    status: 'open',
    costImpactFils: costImpactFils ?? 0n,
    reportedBy,
    reportedAt: now,
    statusHistory: [
      { from: 'new', to: 'open', date: now },
    ],
  };

  return {
    ...log,
    issues: [...log.issues, issue],
  };
}

/** Advance issue status. Throws if the transition is invalid. */
export function advanceIssueStatus(
  log: SupplierIssueLog,
  issueId: string,
  newStatus: IssueStatus,
  note?: string,
  resolution?: string,
): SupplierIssueLog {
  const idx = log.issues.findIndex((i) => i.id === issueId);
  if (idx === -1) {
    throw new Error(`Issue not found: ${issueId}`);
  }

  const issue = log.issues[idx];
  const allowed = ISSUE_TRANSITIONS[issue.status];
  if (!allowed.includes(newStatus)) {
    throw new Error(
      `Invalid transition: ${issue.status} -> ${newStatus}. Allowed: ${allowed.length > 0 ? allowed.join(', ') : 'none (terminal state)'}`,
    );
  }

  const now = new Date().toISOString();
  const updated: SupplierIssue = {
    ...issue,
    status: newStatus,
    resolvedAt: newStatus === 'resolved' ? now : issue.resolvedAt,
    resolution: resolution ?? issue.resolution,
    statusHistory: [
      ...issue.statusHistory,
      { from: issue.status, to: newStatus, date: now, note },
    ],
  };

  const newIssues = [...log.issues];
  newIssues[idx] = updated;

  return { ...log, issues: newIssues };
}

/** Compute summary statistics for the issue log. */
export function computeIssueSummary(log: SupplierIssueLog): SupplierIssueSummary {
  let openCount = 0;
  let pendingCount = 0;
  let resolvedCount = 0;
  let closedCount = 0;
  let totalCostImpactFils = 0n;

  const bySeverity: Record<IssueSeverity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  const byCategory: Record<IssueCategory, number> = {
    quality: 0, delivery: 0, pricing: 0, documentation: 0, communication: 0, other: 0,
  };
  const supplierMap = new Map<string, { count: number; openCount: number }>();

  for (const issue of log.issues) {
    switch (issue.status) {
      case 'open': openCount++; break;
      case 'pending': pendingCount++; break;
      case 'resolved': resolvedCount++; break;
      case 'closed': closedCount++; break;
    }

    totalCostImpactFils += issue.costImpactFils;
    bySeverity[issue.severity]++;
    byCategory[issue.category]++;

    const existing = supplierMap.get(issue.supplierName);
    if (existing) {
      existing.count++;
      if (issue.status === 'open') existing.openCount++;
    } else {
      supplierMap.set(issue.supplierName, {
        count: 1,
        openCount: issue.status === 'open' ? 1 : 0,
      });
    }
  }

  const bySupplier = Array.from(supplierMap.entries())
    .map(([supplierName, data]) => ({ supplierName, ...data }))
    .sort((a, b) => b.openCount - a.openCount);

  return {
    totalIssues: log.issues.length,
    openCount,
    pendingCount,
    resolvedCount,
    closedCount,
    totalCostImpactFils,
    bySeverity,
    byCategory,
    bySupplier,
  };
}

/** Find issues by supplier name (case-insensitive substring match). */
export function findIssuesBySupplier(log: SupplierIssueLog, supplierName: string): SupplierIssue[] {
  const needle = supplierName.toLowerCase();
  return log.issues.filter((i) => i.supplierName.toLowerCase().includes(needle));
}

/** Find issues by status. */
export function findIssuesByStatus(log: SupplierIssueLog, status: IssueStatus): SupplierIssue[] {
  return log.issues.filter((i) => i.status === status);
}

/** Find issues by severity. */
export function findIssuesBySeverity(log: SupplierIssueLog, severity: IssueSeverity): SupplierIssue[] {
  return log.issues.filter((i) => i.severity === severity);
}

/** Persist issue log to localStorage. */
export function saveIssueLog(log: SupplierIssueLog): void {
  const serialised: SerialisedSupplierIssueLog = {
    version: log.version,
    issues: log.issues.map(serialiseIssue),
  };
  globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(serialised));
}

/** Load issue log from localStorage (returns empty log if none exists). */
export function loadIssueLog(): SupplierIssueLog {
  const raw = globalThis.localStorage.getItem(STORAGE_KEY);
  if (raw === null) return createEmptyIssueLog();

  const parsed: SerialisedSupplierIssueLog = JSON.parse(raw);
  return {
    version: parsed.version,
    issues: parsed.issues.map(deserialiseIssue),
  };
}

/** Format issue log as a text report. */
export function formatIssueReport(log: SupplierIssueLog): string {
  const summary = computeIssueSummary(log);
  const lines: string[] = [];

  lines.push('AsymmFlow Supplier Issues Report');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('\u2550'.repeat(40));
  lines.push('');
  lines.push('Summary:');
  lines.push(`  Total issues: ${summary.totalIssues}`);
  lines.push(`  Open: ${summary.openCount}`);
  lines.push(`  Pending: ${summary.pendingCount}`);
  lines.push(`  Resolved: ${summary.resolvedCount}`);
  lines.push(`  Closed: ${summary.closedCount}`);
  lines.push(`  Total cost impact (fils): ${summary.totalCostImpactFils}`);
  lines.push('');
  lines.push('By Severity:');
  lines.push(`  Critical: ${summary.bySeverity.critical}`);
  lines.push(`  High: ${summary.bySeverity.high}`);
  lines.push(`  Medium: ${summary.bySeverity.medium}`);
  lines.push(`  Low: ${summary.bySeverity.low}`);

  if (summary.bySupplier.length > 0) {
    lines.push('');
    lines.push('By Supplier:');
    for (const s of summary.bySupplier) {
      lines.push(`  ${s.supplierName}: ${s.count} issues (${s.openCount} open)`);
    }
  }

  if (log.issues.length > 0) {
    lines.push('');
    lines.push('Issue Details:');
    lines.push('\u2500'.repeat(40));

    for (const issue of log.issues) {
      const statusIcon = issue.status === 'resolved' ? '\u2713'
        : issue.status === 'closed' ? '\u2717'
        : '\u25CB';
      lines.push(`  ${statusIcon} ${issue.id} [${issue.status.toUpperCase()}] ${issue.severity.toUpperCase()}`);
      lines.push(`    Title: ${issue.title}`);
      lines.push(`    Supplier: ${issue.supplierName} | Category: ${issue.category}`);
      lines.push(`    Cost impact: ${issue.costImpactFils} fils | Reported: ${issue.reportedAt.slice(0, 10)}`);
      if (issue.resolution) {
        lines.push(`    Resolution: ${issue.resolution}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
