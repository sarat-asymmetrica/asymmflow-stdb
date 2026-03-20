import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeDashboardMetrics, computeTopCustomersByOutstanding } from '../business/dashboardMetrics';

type SeedParty = {
  name: string;
  isCustomer: boolean;
  isSupplier: boolean;
  grade: string;
  paymentTermsDays: number;
};

type SeedPipeline = {
  partyIdx: number;
  title: string;
  status: string;
  estimatedValueFils: number;
  createdAt: string | null;
};

type SeedOrder = {
  partyIdx: number;
  pipelineIdx: number | null;
  status: string;
  totalFils: number;
  poReference: string;
  expectedDelivery: string | null;
  createdAt: string | null;
};

type SeedPurchaseOrder = {
  partyIdx: number;
  orderIdx: number | null;
  status: string;
  totalFils: number;
};

type SeedMoneyEvent = {
  partyIdx: number;
  orderIdx: number | null;
  kind: string;
  status: string;
  subtotalFils: number;
  vatFils: number;
  totalFils: number;
  reference: string;
  dueDate: string | null;
  paidAt: string | null;
  createdAt: string | null;
};

export type SeedData = {
  parties: SeedParty[];
  contacts: Array<Record<string, unknown>>;
  pipelines: SeedPipeline[];
  orders: SeedOrder[];
  purchaseOrders: SeedPurchaseOrder[];
  moneyEvents: SeedMoneyEvent[];
};

function timestampMicros(iso: string | null | undefined): bigint {
  const ms = iso ? Date.parse(iso) : Date.UTC(2026, 2, 10);
  return BigInt(ms) * 1000n;
}

export function getSeedDataPath(): string {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(dir, '../../../public/seed_data.json');
}

export function loadSeedData(filePath = getSeedDataPath()): SeedData {
  return JSON.parse(readFileSync(filePath, 'utf8')) as SeedData;
}

export function summarizeSeedData(seed: SeedData) {
  const customerInvoices = seed.moneyEvents.filter((event) => event.kind === 'CustomerInvoice');
  const customerPayments = seed.moneyEvents.filter((event) => event.kind === 'CustomerPayment');
  const supplierInvoices = seed.moneyEvents.filter((event) => event.kind === 'SupplierInvoice');
  const supplierPayments = seed.moneyEvents.filter((event) => event.kind === 'SupplierPayment');

  const sumTotals = (events: SeedMoneyEvent[]) =>
    events.reduce((sum, event) => sum + BigInt(event.totalFils), 0n);

  return {
    parties: seed.parties.length,
    contacts: seed.contacts.length,
    pipelines: seed.pipelines.length,
    orders: seed.orders.length,
    purchaseOrders: seed.purchaseOrders.length,
    moneyEvents: seed.moneyEvents.length,
    customerInvoices: customerInvoices.length,
    customerPayments: customerPayments.length,
    supplierInvoices: supplierInvoices.length,
    supplierPayments: supplierPayments.length,
    customerInvoiceTotalFils: sumTotals(customerInvoices),
    customerPaymentTotalFils: sumTotals(customerPayments),
    supplierInvoiceTotalFils: sumTotals(supplierInvoices),
    supplierPaymentTotalFils: sumTotals(supplierPayments),
  };
}

export function buildSeedDashboardSnapshot(seed: SeedData, nowMicros: bigint) {
  const parties = seed.parties.map((party, index) => ({
    id: BigInt(index + 1),
    name: party.name,
    isCustomer: party.isCustomer,
    isSupplier: party.isSupplier,
    grade: { tag: party.grade },
  }));

  const pipelines = seed.pipelines.map((pipeline, index) => ({
    id: BigInt(index + 1),
    partyId: BigInt(pipeline.partyIdx + 1),
    title: pipeline.title,
    status: { tag: pipeline.status },
    estimatedValueFils: BigInt(pipeline.estimatedValueFils),
    nextFollowUp: undefined,
  }));

  const orders = seed.orders.map((order) => ({
    status: { tag: order.status },
  }));

  const moneyEvents = seed.moneyEvents.map((event, index) => ({
    id: BigInt(index + 1),
    partyId: BigInt(event.partyIdx + 1),
    kind: { tag: event.kind },
    status: { tag: event.status },
    totalFils: BigInt(event.totalFils),
    dueDate: event.dueDate ? { microsSinceUnixEpoch: timestampMicros(event.dueDate) } : undefined,
    paidAt: event.paidAt ? { microsSinceUnixEpoch: timestampMicros(event.paidAt) } : undefined,
    createdAt: { microsSinceUnixEpoch: timestampMicros(event.createdAt) },
  }));

  const metrics = computeDashboardMetrics({
    parties,
    pipelines,
    orders,
    moneyEvents,
    nowMicros,
  });

  const topDebtors = computeTopCustomersByOutstanding(parties, moneyEvents);

  return {
    parties,
    pipelines,
    orders,
    moneyEvents,
    metrics,
    topDebtors,
  };
}
