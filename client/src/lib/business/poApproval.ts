/** PO approval threshold in fils (5,000 BHD = 5,000,000 fils) */
export const PO_APPROVAL_THRESHOLD_FILS = 5_000_000n;

/** Roles that can approve POs above threshold */
export const PO_APPROVAL_ROLES = ['Admin', 'Manager'] as const;

export type ApproverRole = (typeof PO_APPROVAL_ROLES)[number];

export interface POApprovalCheck {
  /** Whether the PO requires elevated approval */
  requiresApproval: boolean;
  /** Whether the current user role can approve */
  canApprove: boolean;
  /** Human-readable reason */
  reason: string;
  /** The threshold that was checked */
  thresholdFils: bigint;
  /** The PO value */
  poValueFils: bigint;
  /** Required role level if approval needed */
  requiredRole?: string;
}

export interface POApprovalRule {
  /** Threshold in fils — POs above this require elevated approval */
  thresholdFils: bigint;
  /** Roles that can approve above threshold */
  approverRoles: readonly string[];
  /** Roles that can create POs below threshold without approval */
  creatorRoles: readonly string[];
}

export interface POApprovalLog {
  entries: POApprovalEntry[];
  version: number;
}

export interface POApprovalEntry {
  /** Unique ID */
  id: string;
  /** PO reference or description */
  poReference: string;
  /** Supplier name */
  supplierName: string;
  /** PO value in fils */
  valueFils: bigint;
  /** Whether approval was required */
  approvalRequired: boolean;
  /** Who approved (null if auto-approved below threshold) */
  approvedBy: string | null;
  /** Approver role */
  approverRole: string | null;
  /** Timestamp ISO string */
  timestamp: string;
  /** Approval or rejection */
  decision: 'approved' | 'rejected' | 'auto_approved';
  /** Notes */
  notes?: string;
}

/** Default approval rule */
export const DEFAULT_PO_RULE: POApprovalRule = {
  thresholdFils: PO_APPROVAL_THRESHOLD_FILS,
  approverRoles: ['Admin', 'Manager'],
  creatorRoles: ['Admin', 'Manager', 'Operations'],
};

const STORAGE_KEY = 'asymmflow_po_approval_log';

/** Check if a PO requires approval given value and user role */
export function checkPOApproval(
  poValueFils: bigint,
  userRole: string,
  rule: POApprovalRule = DEFAULT_PO_RULE,
): POApprovalCheck {
  const requiresApproval = poValueFils >= rule.thresholdFils;

  if (!requiresApproval) {
    return {
      requiresApproval: false,
      canApprove: true,
      reason: 'PO value is below the approval threshold',
      thresholdFils: rule.thresholdFils,
      poValueFils,
    };
  }

  const canApprove = rule.approverRoles.includes(userRole);
  const requiredRole = rule.approverRoles.join(' or ');

  return {
    requiresApproval: true,
    canApprove,
    reason: canApprove
      ? `PO value meets/exceeds threshold; ${userRole} role can approve`
      : `PO value meets/exceeds threshold; requires ${requiredRole} approval`,
    thresholdFils: rule.thresholdFils,
    poValueFils,
    requiredRole,
  };
}

/** Validate a PO can be created by this role at this value */
export function canCreatePO(
  poValueFils: bigint,
  userRole: string,
  rule: POApprovalRule = DEFAULT_PO_RULE,
): { allowed: boolean; reason: string } {
  const isCreator = rule.creatorRoles.includes(userRole);

  if (!isCreator) {
    return {
      allowed: false,
      reason: `${userRole} role is not permitted to create purchase orders`,
    };
  }

  const isAboveThreshold = poValueFils >= rule.thresholdFils;

  if (!isAboveThreshold) {
    return {
      allowed: true,
      reason: 'PO value is below the approval threshold; no additional approval needed',
    };
  }

  // Above threshold — only approver roles can proceed
  const isApprover = rule.approverRoles.includes(userRole);

  if (isApprover) {
    return {
      allowed: true,
      reason: `${userRole} can create and approve POs above the threshold`,
    };
  }

  return {
    allowed: false,
    reason: `PO value meets/exceeds threshold; ${userRole} cannot approve — requires ${rule.approverRoles.join(' or ')}`,
  };
}

let idCounter = 0;

/** Create an approval log entry */
export function createApprovalEntry(
  poReference: string,
  supplierName: string,
  valueFils: bigint,
  userRole: string,
  decision: 'approved' | 'rejected' | 'auto_approved',
  approvedBy?: string,
  notes?: string,
): POApprovalEntry {
  idCounter += 1;
  const approvalRequired = decision !== 'auto_approved';

  return {
    id: `po-${Date.now()}-${idCounter}`,
    poReference,
    supplierName,
    valueFils,
    approvalRequired,
    approvedBy: approvedBy ?? null,
    approverRole: approvedBy ? userRole : null,
    timestamp: new Date().toISOString(),
    decision,
    notes,
  };
}

/** Append to approval log (immutable) */
export function appendApprovalEntry(
  log: POApprovalLog,
  entry: POApprovalEntry,
): POApprovalLog {
  return {
    entries: [entry, ...log.entries],
    version: log.version + 1,
  };
}

/** Create empty approval log */
export function createEmptyApprovalLog(): POApprovalLog {
  return { entries: [], version: 0 };
}

function serializeLog(log: POApprovalLog): string {
  return JSON.stringify(log, (_key, value) =>
    typeof value === 'bigint' ? value.toString() + 'n' : value,
  );
}

function deserializeLog(raw: string): POApprovalLog {
  return JSON.parse(raw, (_key, value) => {
    if (typeof value === 'string' && /^\d+n$/.test(value)) {
      return BigInt(value.slice(0, -1));
    }
    return value;
  }) as POApprovalLog;
}

/** Save approval log to localStorage */
export function saveApprovalLog(log: POApprovalLog): void {
  localStorage.setItem(STORAGE_KEY, serializeLog(log));
}

/** Load approval log from localStorage */
export function loadApprovalLog(): POApprovalLog {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return createEmptyApprovalLog();
  return deserializeLog(raw);
}

/** Format approval summary */
export function formatApprovalSummary(log: POApprovalLog): string {
  if (log.entries.length === 0) return 'No PO approvals recorded.';

  const approved = log.entries.filter((e) => e.decision === 'approved').length;
  const rejected = log.entries.filter((e) => e.decision === 'rejected').length;
  const autoApproved = log.entries.filter((e) => e.decision === 'auto_approved').length;
  const total = log.entries.length;

  const totalValueFils = log.entries.reduce((sum, e) => sum + e.valueFils, 0n);
  const totalBHD = Number(totalValueFils) / 1000;

  const lines = [
    `PO Approval Summary (v${log.version})`,
    `Total entries: ${total}`,
    `Approved: ${approved} | Rejected: ${rejected} | Auto-approved: ${autoApproved}`,
    `Total value: ${totalBHD.toLocaleString('en-BH', { minimumFractionDigits: 3 })} BHD`,
  ];

  return lines.join('\n');
}
