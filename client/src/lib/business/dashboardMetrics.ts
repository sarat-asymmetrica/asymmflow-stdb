import { computePartyReceivableSnapshots } from './arAging';

type TimestampLike = { microsSinceUnixEpoch: bigint };
type TaggedStatus = { tag: string };

export type DashboardParty = {
  id: bigint;
  name: string;
  isCustomer: boolean;
  isSupplier: boolean;
  grade: TaggedStatus;
};

export type DashboardPipeline = {
  id: bigint;
  partyId: bigint;
  title: string;
  status: TaggedStatus;
  estimatedValueFils: bigint;
  nextFollowUp?: TimestampLike;
};

export type DashboardOrder = {
  status: TaggedStatus;
};

export type DashboardMoneyEvent = {
  partyId: bigint;
  kind: TaggedStatus;
  status: TaggedStatus;
  totalFils: bigint;
  dueDate?: TimestampLike;
  paidAt?: TimestampLike;
  createdAt: TimestampLike;
};

export type TopCustomerRow = {
  partyId: bigint;
  name: string;
  grade: string;
  outstanding: bigint;
  invoiced: bigint;
};

export function isSameUtcMonth(leftMicros: bigint, rightMicros: bigint): boolean {
  const left = new Date(Number(leftMicros / 1000n));
  const right = new Date(Number(rightMicros / 1000n));
  return (
    left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth()
  );
}

export function computeTopCustomersByOutstanding(
  parties: DashboardParty[],
  moneyEvents: DashboardMoneyEvent[],
): TopCustomerRow[] {
  const partyMap = new Map(parties.map((party) => [party.id, party]));
  const invoicedByParty = new Map<bigint, bigint>();
  const collectedByParty = new Map<bigint, bigint>();

  for (const event of moneyEvents) {
    if (event.kind.tag === 'CustomerInvoice') {
      invoicedByParty.set(
        event.partyId,
        (invoicedByParty.get(event.partyId) ?? 0n) + event.totalFils,
      );
    }
    if (event.kind.tag === 'CustomerPayment') {
      collectedByParty.set(
        event.partyId,
        (collectedByParty.get(event.partyId) ?? 0n) + event.totalFils,
      );
    }
  }

  const rows: TopCustomerRow[] = [];
  for (const [partyId, invoiced] of invoicedByParty) {
    const collected = collectedByParty.get(partyId) ?? 0n;
    const outstanding = invoiced > collected ? invoiced - collected : 0n;
    if (outstanding === 0n) continue;
    const party = partyMap.get(partyId);
    rows.push({
      partyId,
      name: party?.name ?? `Party #${partyId}`,
      grade: party?.grade.tag ?? 'C',
      outstanding,
      invoiced,
    });
  }

  return rows.sort((left, right) => (left.outstanding < right.outstanding ? 1 : -1)).slice(0, 5);
}

export function computeGradeDistribution(parties: DashboardParty[]) {
  const counts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };

  for (const party of parties) {
    if (!party.isCustomer) continue;
    const grade = party.grade.tag ?? 'C';
    if (grade in counts) counts[grade] += 1;
  }

  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return ['A', 'B', 'C', 'D'].map((grade) => ({
    grade,
    count: counts[grade],
    pct: total > 0 ? Math.round((counts[grade] / total) * 100) : 0,
  }));
}

export function computeDashboardMetrics(args: {
  parties: DashboardParty[];
  pipelines: DashboardPipeline[];
  orders: DashboardOrder[];
  moneyEvents: DashboardMoneyEvent[];
  nowMicros: bigint;
}) {
  const customerInvoices = args.moneyEvents.filter((event) => event.kind.tag === 'CustomerInvoice');
  const customerPayments = args.moneyEvents.filter((event) => event.kind.tag === 'CustomerPayment');
  const supplierPayments = args.moneyEvents.filter((event) => event.kind.tag === 'SupplierPayment');

  const revenueMtd = customerInvoices.reduce((sum, event) => {
    return isSameUtcMonth(event.createdAt.microsSinceUnixEpoch, args.nowMicros) ? sum + event.totalFils : sum;
  }, 0n);

  const totalInvoiced = customerInvoices.reduce((sum, event) => sum + event.totalFils, 0n);
  const totalCollected = customerPayments.reduce((sum, event) => sum + event.totalFils, 0n);
  const totalOutstanding = totalInvoiced > totalCollected ? totalInvoiced - totalCollected : 0n;

  const overdueAmount = computePartyReceivableSnapshots(
    args.parties as never,
    args.moneyEvents as never,
    args.nowMicros,
  ).reduce((sum, snapshot) => sum + snapshot.overdueFils, 0n);

  const activePipelines = args.pipelines.filter((pipeline) => {
    const tag = pipeline.status.tag;
    return tag === 'Draft' || tag === 'Active' || tag === 'InProgress';
  });
  const pipelineValue = activePipelines.reduce((sum, pipeline) => sum + pipeline.estimatedValueFils, 0n);

  const activeOrderCount = args.orders.filter((order) => {
    const tag = order.status.tag;
    return tag === 'Active' || tag === 'InProgress';
  }).length;

  const cashPosition = customerPayments.reduce((sum, event) => sum + event.totalFils, 0n)
    - supplierPayments.reduce((sum, event) => sum + event.totalFils, 0n);

  const customerCount = args.parties.filter((party) => party.isCustomer).length;
  const supplierCount = args.parties.filter((party) => party.isSupplier).length;
  const collectionRatePct =
    totalInvoiced === 0n ? 0 : Math.round(Number((totalCollected * 10000n) / totalInvoiced) / 100);

  return {
    revenueMtd,
    totalInvoiced,
    totalCollected,
    totalOutstanding,
    overdueAmount,
    activePipelines,
    pipelineValue,
    activeOrderCount,
    cashPosition,
    customerCount,
    supplierCount,
    collectionRatePct,
    topCustomers: computeTopCustomersByOutstanding(args.parties, args.moneyEvents),
    gradeDistribution: computeGradeDistribution(args.parties),
  };
}
