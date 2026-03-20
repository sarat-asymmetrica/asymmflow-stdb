// ---------------------------------------------------------------------------
// RFQ (Request for Quotation) Management — AsymmFlow V5
// ---------------------------------------------------------------------------

export interface RFQPipeline {
  id: bigint;
  partyId: bigint;
  title: string;
  status: { tag: string };
  estimatedValueFils: bigint;
  competitorPresent: boolean;
  createdAt: { microsSinceUnixEpoch: bigint };
  nextFollowUp?: { microsSinceUnixEpoch: bigint };
}

export interface RFQParty {
  id: bigint;
  name: string;
  grade: { tag: string };
}

export type RFQStatus = 'received' | 'reviewing' | 'costing' | 'quoted' | 'expired' | 'won' | 'lost';

export interface RFQTracking {
  pipelineId: string;
  rfqReference: string;
  receivedDate: string;
  responseDeadline: string;
  status: RFQStatus;
  source: string;
  notes: string;
  responseSubmittedDate?: string;
}

export interface RFQTrackingStore {
  entries: RFQTracking[];
  version: number;
}

export interface RFQDashboard {
  total: number;
  byStatus: Record<RFQStatus, number>;
  overdue: RFQTracking[];
  dueSoon: RFQTracking[];
  averageResponseDays: number;
  winRate: number;
  totalValueFils: bigint;
}

const STORAGE_KEY = 'asymmflow_rfq_tracking';

const ALL_STATUSES: readonly RFQStatus[] = [
  'received', 'reviewing', 'costing', 'quoted', 'expired', 'won', 'lost',
] as const;

const ACTIVE_STATUSES: ReadonlySet<RFQStatus> = new Set<RFQStatus>([
  'received', 'reviewing', 'costing',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysBetween(isoA: string, isoB: string): number {
  const msPerDay = 86_400_000;
  const a = new Date(isoA).getTime();
  const b = new Date(isoB).getTime();
  return (b - a) / msPerDay;
}

function daysUntilDeadline(deadline: string, nowIso: string): number {
  return daysBetween(nowIso, deadline);
}

function serializeStore(s: RFQTrackingStore): string {
  return JSON.stringify(s, (_key, value) =>
    typeof value === 'bigint' ? value.toString() + 'n' : value,
  );
}

function deserializeStore(raw: string): RFQTrackingStore {
  return JSON.parse(raw, (_key, value) => {
    if (typeof value === 'string' && /^\d+n$/.test(value)) {
      return BigInt(value.slice(0, -1));
    }
    return value;
  }) as RFQTrackingStore;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createEmptyRFQStore(): RFQTrackingStore {
  return { entries: [], version: 0 };
}

/** Register a new RFQ (link to pipeline) */
export function registerRFQ(
  store: RFQTrackingStore,
  pipelineId: string,
  rfqReference: string,
  receivedDate: string,
  responseDeadline: string,
  source: string,
  notes?: string,
): RFQTrackingStore {
  const entry: RFQTracking = {
    pipelineId,
    rfqReference,
    receivedDate,
    responseDeadline,
    status: 'received',
    source,
    notes: notes ?? '',
  };
  return {
    entries: [...store.entries, entry],
    version: store.version + 1,
  };
}

/** Update RFQ status */
export function updateRFQStatus(
  store: RFQTrackingStore,
  pipelineId: string,
  newStatus: RFQStatus,
  responseDate?: string,
): RFQTrackingStore {
  const entries = store.entries.map((e) => {
    if (e.pipelineId !== pipelineId) return e;
    const updated: RFQTracking = { ...e, status: newStatus };
    if (responseDate !== undefined) {
      updated.responseSubmittedDate = responseDate;
    }
    return updated;
  });
  return { entries, version: store.version + 1 };
}

/** Find overdue RFQs (past deadline, status still received/reviewing/costing) */
export function findOverdueRFQs(store: RFQTrackingStore, nowIso: string): RFQTracking[] {
  return store.entries.filter((e) =>
    ACTIVE_STATUSES.has(e.status) && daysUntilDeadline(e.responseDeadline, nowIso) < 0,
  );
}

/** Find RFQs due soon (within N days) */
export function findDueSoonRFQs(
  store: RFQTrackingStore,
  nowIso: string,
  withinDays: number = 3,
): RFQTracking[] {
  return store.entries.filter((e) => {
    if (!ACTIVE_STATUSES.has(e.status)) return false;
    const days = daysUntilDeadline(e.responseDeadline, nowIso);
    return days >= 0 && days <= withinDays;
  });
}

/** Compute RFQ dashboard from tracking data + pipelines */
export function computeRFQDashboard(
  store: RFQTrackingStore,
  pipelines: RFQPipeline[],
  nowIso: string,
): RFQDashboard {
  const byStatus = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<RFQStatus, number>;
  for (const e of store.entries) {
    byStatus[e.status] += 1;
  }

  const overdue = findOverdueRFQs(store, nowIso);
  const dueSoon = findDueSoonRFQs(store, nowIso, 3);

  // Average response days: from received to quoted/won (entries that have a responseSubmittedDate)
  const responded = store.entries.filter(
    (e) => e.responseSubmittedDate !== undefined,
  );
  let averageResponseDays = 0;
  if (responded.length > 0) {
    const totalDays = responded.reduce(
      (sum, e) => sum + daysBetween(e.receivedDate, e.responseSubmittedDate!),
      0,
    );
    averageResponseDays = Math.round((totalDays / responded.length) * 100) / 100;
  }

  // Win rate
  const won = byStatus.won;
  const lost = byStatus.lost;
  const winRate = won + lost > 0 ? Math.round((won / (won + lost)) * 10000) / 100 : 0;

  // Total value of active RFQs
  const pipelineMap = new Map<string, RFQPipeline>();
  for (const p of pipelines) {
    pipelineMap.set(p.id.toString(), p);
  }
  let totalValueFils = 0n;
  for (const e of store.entries) {
    if (ACTIVE_STATUSES.has(e.status)) {
      const pipeline = pipelineMap.get(e.pipelineId);
      if (pipeline) {
        totalValueFils += pipeline.estimatedValueFils;
      }
    }
  }

  return {
    total: store.entries.length,
    byStatus,
    overdue,
    dueSoon,
    averageResponseDays,
    winRate,
    totalValueFils,
  };
}

/** Suggest response priority based on value + deadline + competition */
export function prioritizeRFQs(
  store: RFQTrackingStore,
  pipelines: RFQPipeline[],
  nowIso: string,
): Array<{ pipelineId: string; rfqReference: string; priority: 'urgent' | 'high' | 'normal' | 'low'; reason: string }> {
  const pipelineMap = new Map<string, RFQPipeline>();
  for (const p of pipelines) {
    pipelineMap.set(p.id.toString(), p);
  }

  return store.entries
    .filter((e) => ACTIVE_STATUSES.has(e.status))
    .map((e) => {
      const days = daysUntilDeadline(e.responseDeadline, nowIso);
      const pipeline = pipelineMap.get(e.pipelineId);
      const competitorPresent = pipeline?.competitorPresent ?? false;
      const valueFils = pipeline?.estimatedValueFils ?? 0n;
      // 10,000 BHD = 10,000,000 fils
      const highValue = valueFils > 10_000_000n;

      let priority: 'urgent' | 'high' | 'normal' | 'low';
      let reason: string;

      if (days <= 2) {
        priority = 'urgent';
        reason = `Deadline within ${Math.max(0, Math.round(days * 10) / 10)} days`;
      } else if ((competitorPresent && days <= 7) || (highValue && days <= 5)) {
        priority = 'high';
        const reasons: string[] = [];
        if (competitorPresent && days <= 7) reasons.push('competitor present');
        if (highValue && days <= 5) reasons.push('high value');
        reason = `${reasons.join(' + ')}; deadline in ${Math.round(days * 10) / 10} days`;
      } else if (days <= 14) {
        priority = 'normal';
        reason = `Deadline in ${Math.round(days * 10) / 10} days`;
      } else {
        priority = 'low';
        reason = `Deadline in ${Math.round(days * 10) / 10} days; low urgency`;
      }

      return { pipelineId: e.pipelineId, rfqReference: e.rfqReference, priority, reason };
    });
}

/** Save RFQ store to localStorage */
export function saveRFQStore(store: RFQTrackingStore): void {
  localStorage.setItem(STORAGE_KEY, serializeStore(store));
}

/** Load RFQ store from localStorage */
export function loadRFQStore(): RFQTrackingStore {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return createEmptyRFQStore();
  return deserializeStore(raw);
}

/** Format RFQ dashboard summary */
export function formatRFQSummary(dashboard: RFQDashboard): string {
  if (dashboard.total === 0) return 'No RFQs tracked.';

  const totalBHD = Number(dashboard.totalValueFils) / 1000;

  const lines = [
    `RFQ Dashboard — ${dashboard.total} total`,
    `By status: ${ALL_STATUSES.map((s) => `${s}: ${dashboard.byStatus[s]}`).join(', ')}`,
    `Overdue: ${dashboard.overdue.length} | Due soon: ${dashboard.dueSoon.length}`,
    `Avg response: ${dashboard.averageResponseDays} days | Win rate: ${dashboard.winRate}%`,
    `Active pipeline value: ${totalBHD.toLocaleString('en-BH', { minimumFractionDigits: 3 })} BHD`,
  ];

  return lines.join('\n');
}
