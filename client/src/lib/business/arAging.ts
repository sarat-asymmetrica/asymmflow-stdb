import type { MoneyEvent, Party } from '../db';

type AgingInvoice = {
  invoiceId: bigint;
  totalFils: bigint;
  remainingFils: bigint;
  createdAtMicros: bigint;
  diffDays: number;
  isOverdue: boolean;
};

export type PartyReceivableSnapshot = {
  partyId: bigint;
  name: string;
  grade: string;
  invoicedFils: bigint;
  paidFils: bigint;
  d15Fils: bigint;
  d30Fils: bigint;
  d60Fils: bigint;
  d90Fils: bigint;
  d90plusFils: bigint;
  overdueFils: bigint;
  outstandingFils: bigint;
};

export type ARAgingRow = Omit<PartyReceivableSnapshot, 'partyId' | 'overdueFils'>;

export type ARAgingTotals = {
  d15: bigint;
  d30: bigint;
  d60: bigint;
  d90: bigint;
  d90plus: bigint;
  total: bigint;
};

function bucketDiffDays(snapshot: PartyReceivableSnapshot, diffDays: number, amount: bigint): void {
  if (diffDays <= 15) {
    snapshot.d15Fils += amount;
  } else if (diffDays <= 30) {
    snapshot.d30Fils += amount;
  } else if (diffDays <= 60) {
    snapshot.d60Fils += amount;
  } else if (diffDays <= 90) {
    snapshot.d90Fils += amount;
  } else {
    snapshot.d90plusFils += amount;
  }
}

export function computePartyReceivableSnapshots(
  parties: Party[],
  moneyEvents: MoneyEvent[],
  nowMicrosSinceUnixEpoch: bigint,
): PartyReceivableSnapshot[] {
  const partySnapshots = new Map<bigint, PartyReceivableSnapshot>();
  const openInvoices = new Map<bigint, AgingInvoice[]>();
  const paymentsByParty = new Map<bigint, bigint>();

  for (const party of parties) {
    if (!party.isCustomer) continue;
    partySnapshots.set(party.id, {
      partyId: party.id,
      name: party.name,
      grade: party.grade.tag,
      invoicedFils: 0n,
      paidFils: 0n,
      d15Fils: 0n,
      d30Fils: 0n,
      d60Fils: 0n,
      d90Fils: 0n,
      d90plusFils: 0n,
      overdueFils: 0n,
      outstandingFils: 0n,
    });
  }

  for (const event of moneyEvents) {
    const status = event.status.tag;
    if (status === 'Draft' || status === 'Cancelled') continue;

    const snapshot = partySnapshots.get(event.partyId);
    if (!snapshot) continue;

    if (event.kind.tag === 'CustomerInvoice') {
      snapshot.invoicedFils += event.totalFils;
      if (status === 'Terminal') continue;

      const dueMicros = event.dueDate?.microsSinceUnixEpoch;
      const isOverdue = !!dueMicros && dueMicros < nowMicrosSinceUnixEpoch;
      const diffDays = !dueMicros || dueMicros >= nowMicrosSinceUnixEpoch
        ? 0
        : Math.floor(Number((nowMicrosSinceUnixEpoch - dueMicros) / 1_000_000n / 86_400n));

      const invoices = openInvoices.get(event.partyId) ?? [];
      invoices.push({
        invoiceId: event.id,
        totalFils: event.totalFils,
        remainingFils: event.totalFils,
        createdAtMicros: event.createdAt.microsSinceUnixEpoch,
        diffDays,
        isOverdue,
      });
      openInvoices.set(event.partyId, invoices);
    } else if (event.kind.tag === 'CustomerPayment') {
      snapshot.paidFils += event.totalFils;
      paymentsByParty.set(event.partyId, (paymentsByParty.get(event.partyId) ?? 0n) + event.totalFils);
    }
  }

  const snapshots: PartyReceivableSnapshot[] = [];

  for (const [partyId, snapshot] of partySnapshots) {
    let remainingPayment = paymentsByParty.get(partyId) ?? 0n;
    const invoices = (openInvoices.get(partyId) ?? [])
      .slice()
      .sort((left, right) => {
        if (left.createdAtMicros === right.createdAtMicros) {
          return left.invoiceId < right.invoiceId ? -1 : 1;
        }
        return left.createdAtMicros < right.createdAtMicros ? -1 : 1;
      });

    for (const invoice of invoices) {
      if (remainingPayment <= 0n) break;
      const applied = remainingPayment < invoice.remainingFils ? remainingPayment : invoice.remainingFils;
      invoice.remainingFils -= applied;
      remainingPayment -= applied;
    }

    for (const invoice of invoices) {
      if (invoice.remainingFils <= 0n) continue;
      bucketDiffDays(snapshot, invoice.diffDays, invoice.remainingFils);
      if (invoice.isOverdue) {
        snapshot.overdueFils += invoice.remainingFils;
      }
      snapshot.outstandingFils += invoice.remainingFils;
    }

    if (snapshot.outstandingFils > 0n) {
      snapshots.push(snapshot);
    }
  }

  return snapshots.sort((left, right) => (left.outstandingFils < right.outstandingFils ? 1 : -1));
}

export function computeARAgingRows(
  parties: Party[],
  moneyEvents: MoneyEvent[],
  nowMicrosSinceUnixEpoch: bigint,
): ARAgingRow[] {
  return computePartyReceivableSnapshots(parties, moneyEvents, nowMicrosSinceUnixEpoch).map((snapshot) => ({
    name: snapshot.name,
    grade: snapshot.grade,
    invoicedFils: snapshot.invoicedFils,
    paidFils: snapshot.paidFils,
    d15Fils: snapshot.d15Fils,
    d30Fils: snapshot.d30Fils,
    d60Fils: snapshot.d60Fils,
    d90Fils: snapshot.d90Fils,
    d90plusFils: snapshot.d90plusFils,
    outstandingFils: snapshot.outstandingFils,
  }));
}

export function computeARAgingTotals(rows: ARAgingRow[]): ARAgingTotals {
  return rows.reduce<ARAgingTotals>((totals, row) => ({
    d15: totals.d15 + row.d15Fils,
    d30: totals.d30 + row.d30Fils,
    d60: totals.d60 + row.d60Fils,
    d90: totals.d90 + row.d90Fils,
    d90plus: totals.d90plus + row.d90plusFils,
    total: totals.total + row.outstandingFils,
  }), {
    d15: 0n,
    d30: 0n,
    d60: 0n,
    d90: 0n,
    d90plus: 0n,
    total: 0n,
  });
}
