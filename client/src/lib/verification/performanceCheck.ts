import { performance } from 'node:perf_hooks';
import { Identity, Timestamp } from 'spacetimedb';

import { buildDeliveryNoteDocDefinition } from '../documents/deliveryNoteGenerator';
import { buildInvoiceDocDefinition } from '../documents/invoiceGenerator';
import { buildPurchaseOrderDocDefinition } from '../documents/purchaseOrderGenerator';
import { buildQuotationDocDefinition } from '../documents/quotationGenerator';
import { buildStatementDocDefinition } from '../documents/statementGenerator';
import type { DeliveryNote, DeliveryNoteItem, LineItem, MoneyEvent, Order, Party, PurchaseOrder } from '../db';
import { buildOrderStatusSnapshot } from '../skills/querySkillLogic';
import { buildSeedDashboardSnapshot, loadSeedData } from './seedVerification';

const storage = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem(key: string) {
    return storage.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    storage.set(key, value);
  },
};

function ts(iso: string) {
  return Timestamp.fromDate(new Date(iso));
}

const SAMPLE_IDENTITY = Identity.fromString('c200ec695e800f90bc5ed406ab884869b94d0a443b14d0744a9088f589cd45c1');

function measure(label: string, iterations: number, fn: () => void) {
  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    fn();
  }
  const elapsedMs = performance.now() - started;
  return {
    label,
    iterations,
    totalMs: Number(elapsedMs.toFixed(2)),
    avgMs: Number((elapsedMs / iterations).toFixed(2)),
  };
}

const seed = loadSeedData();
const nowMicros = BigInt(Date.parse('2026-03-10T00:00:00Z')) * 1000n;
const snapshot = buildSeedDashboardSnapshot(seed, nowMicros);
const sampleParty: Party = {
  ...snapshot.parties[0]!,
  grade: {
    tag: ((snapshot.parties[0]?.grade.tag ?? 'B') as 'A' | 'B' | 'C' | 'D'),
  },
  paymentTermsDays: 45n,
  notes: 'TRN:200010357800002',
  creditLimitFils: 0n,
  isCreditBlocked: false,
  productTypes: 'Instrumentation',
  annualGoalFils: 0n,
  createdAt: ts('2026-03-01T00:00:00Z'),
  updatedAt: ts('2026-03-01T00:00:00Z'),
};
const sampleOrder: Order = {
  id: 1n,
  partyId: sampleParty.id,
  pipelineId: 1n,
  status: { tag: 'InProgress' },
  totalFils: 3_300_000n,
  poReference: 'PH-PERF-001',
  expectedDelivery: undefined,
  createdAt: ts('2026-03-01T00:00:00Z'),
  updatedAt: ts('2026-03-05T00:00:00Z'),
};
const sampleDeliveryNote: DeliveryNote = {
  id: 1n,
  orderId: 1n,
  partyId: sampleParty.id,
  dnNumber: 'DN-2026-001',
  status: { tag: 'Delivered' },
  deliveryDate: ts('2026-03-05T00:00:00Z'),
  deliveryAddress: 'Bahrain',
  driverName: 'Driver',
  vehicleNumber: '12345',
  receiverName: 'Receiver',
  notes: '',
  createdBy: SAMPLE_IDENTITY,
  createdAt: ts('2026-03-05T00:00:00Z'),
  updatedAt: ts('2026-03-05T00:00:00Z'),
};
const sampleLineItem: LineItem = {
  id: 1n,
  parentType: 'order',
  parentId: 1n,
  description: 'Pressure transmitter',
  quantity: 3n,
  unitPriceFils: 1_000_000n,
  totalPriceFils: 3_000_000n,
  fobCostFils: 650_000n,
  freightCostFils: 50_000n,
  customsCostFils: 0n,
  insuranceCostFils: 0n,
  handlingCostFils: 0n,
  financeCostFils: 0n,
  marginBps: 1800,
  costPerUnitFils: 700_000n,
};
const sampleDeliveryItem: DeliveryNoteItem = {
  id: 1n,
  deliveryNoteId: 1n,
  lineItemId: 1n,
  quantityDelivered: 3n,
  notes: '',
};
const sampleInvoice: MoneyEvent = {
  id: 1n,
  partyId: sampleParty.id,
  orderId: 1n,
  deliveryNoteId: 1n,
  kind: { tag: 'CustomerInvoice' },
  status: { tag: 'Active' },
  subtotalFils: 3_000_000n,
  vatFils: 300_000n,
  totalFils: 3_300_000n,
  reference: 'INV-2026-001',
  dueDate: ts('2026-04-04T00:00:00Z'),
  paidAt: undefined,
  createdBy: SAMPLE_IDENTITY,
  createdAt: ts('2026-03-05T00:00:00Z'),
  updatedAt: ts('2026-03-05T00:00:00Z'),
};
const samplePo: PurchaseOrder = {
  id: 1n,
  partyId: sampleParty.id,
  orderId: 1n,
  poNumber: 'PO-2026-001',
  deliveryTerms: 'CIF Bahrain',
  status: { tag: 'Active' },
  totalFils: 2_000_000n,
  createdBy: SAMPLE_IDENTITY,
  createdAt: ts('2026-03-05T00:00:00Z'),
  updatedAt: ts('2026-03-05T00:00:00Z'),
};

const rows = [
  measure('dashboard metrics over seeded PH dataset', 200, () => {
    buildSeedDashboardSnapshot(seed, nowMicros);
  }),
  measure('order status snapshot', 500, () => {
    buildOrderStatusSnapshot({
      order: sampleOrder,
      party: sampleParty,
      orderLineItems: [sampleLineItem],
      deliveryNotes: [sampleDeliveryNote],
      deliveryNoteItems: [sampleDeliveryItem],
      moneyEvents: [sampleInvoice],
    });
  }),
  measure('invoice document definition', 100, () => {
    buildInvoiceDocDefinition({
      invoice: sampleInvoice,
      party: sampleParty,
      lineItems: [sampleLineItem],
      deliveryNoteNumber: 'DN-2026-001',
      deliveryNoteDate: '05-Mar-2026',
    });
  }),
  measure('quotation document definition', 100, () => {
    buildQuotationDocDefinition({
      party: sampleParty,
      items: [{ description: 'Pressure transmitter', quantity: 3, unit: 'EA', unitPriceFils: 1_000_000n }],
      validityDays: 30,
      deliveryTimeline: '4 weeks',
    });
  }),
  measure('statement document definition', 100, () => {
    buildStatementDocDefinition({
      party: sampleParty,
      moneyEvents: [sampleInvoice],
      dateTo: new Date('2026-03-10T00:00:00Z'),
    });
  }),
  measure('delivery note document definition', 100, () => {
    buildDeliveryNoteDocDefinition({
      deliveryNote: sampleDeliveryNote,
      party: sampleParty,
      orderReference: sampleOrder.poReference,
      items: [
        {
          deliveryItem: sampleDeliveryItem,
          lineItem: sampleLineItem,
        },
      ],
    });
  }),
  measure('purchase order document definition', 100, () => {
    buildPurchaseOrderDocDefinition({
      purchaseOrder: samplePo,
      supplier: sampleParty,
      lineItems: [sampleLineItem],
    });
  }),
];

console.table(rows);
