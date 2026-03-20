// @ts-nocheck
import assert from 'node:assert/strict';

import {
  addDeliveryNoteItemImpl,
  addGrnItemImpl,
  addLineItemImpl,
  advanceDeliveryNoteImpl,
  advanceGrnImpl,
  advancePipelineImpl,
  convertPipelineToOrderImpl,
  createDeliveryNoteImpl,
  createGrnImpl,
  manageOrderImpl,
  managePurchaseOrderImpl,
  recordMoneyEventImpl,
  resolveAiActionImpl,
  upsertContactImpl,
  upsertPartyImpl,
} from './milestone1_logic.ts';

const cases: Array<{ name: string; fn: () => void }> = [];

function test(name: string, fn: () => void): void {
  cases.push({ name, fn });
}

type TimestampLike = { microsSinceUnixEpoch: bigint };
type StatusTag = 'Draft' | 'Active' | 'InProgress' | 'Terminal' | 'Cancelled';
type DeliveryStatusTag = 'Draft' | 'Dispatched' | 'Delivered' | 'Returned';
type GRNStatusTag = 'Draft' | 'Inspecting' | 'Accepted' | 'Rejected';

type RowRecord = Record<string, unknown>;

class MockTable<T extends RowRecord> {
  rows: T[];
  private nextId: bigint;
  id: {
    find: (value: bigint) => T | undefined;
    update: (row: T) => void;
  };
  identity: {
    find: (value: string) => T | undefined;
    update: (row: T) => void;
  };

  constructor(initialRows: T[] = []) {
    this.rows = initialRows.map(row => ({ ...row }));
    this.nextId = this.computeNextId();
    this.id = {
      find: (value: bigint) => this.rows.find(row => row.id === value),
      update: (row: T) => this.replaceBy('id', row),
    };
    this.identity = {
      find: (value: string) => this.rows.find(row => row.identity === value),
      update: (row: T) => this.replaceBy('identity', row),
    };
  }

  iter(): IterableIterator<T> {
    return this.rows.values();
  }

  insert(row: T): T {
    const inserted = { ...row } as T;
    if ('id' in inserted && (inserted.id === 0n || inserted.id === undefined)) {
      inserted.id = this.nextId as T[Extract<keyof T, 'id'>];
      this.nextId += 1n;
    } else if ('id' in inserted && typeof inserted.id === 'bigint' && inserted.id >= this.nextId) {
      this.nextId = inserted.id + 1n;
    }
    this.rows.push(inserted);
    return inserted;
  }

  filterBy<K extends keyof T>(key: K, value: T[K]): IterableIterator<T> {
    return this.rows.filter(row => row[key] === value).values();
  }

  private computeNextId(): bigint {
    let max = 0n;
    for (const row of this.rows) {
      if (typeof row.id === 'bigint' && row.id > max) {
        max = row.id;
      }
    }
    return max + 1n;
  }

  private replaceBy<K extends keyof T>(key: K, row: T): void {
    const index = this.rows.findIndex(existing => existing[key] === row[key]);
    if (index === -1) {
      throw new Error(`Cannot update missing row by key "${String(key)}"`);
    }
    this.rows[index] = { ...row };
  }
}

function ts(microsSinceUnixEpoch: bigint): TimestampLike {
  return { microsSinceUnixEpoch };
}

function status(tag: StatusTag): { tag: StatusTag } {
  return { tag };
}

function deliveryStatus(tag: DeliveryStatusTag): { tag: DeliveryStatusTag } {
  return { tag };
}

function grnStatus(tag: GRNStatusTag): { tag: GRNStatusTag } {
  return { tag };
}

function expectThrows(fn: () => void, message: RegExp): void {
  assert.throws(fn, error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, message);
    return true;
  });
}

function computeOutstandingTotal(ctx: ReturnType<typeof createContext>, partyId: bigint): bigint {
  let invoiced = 0n;
  let paid = 0n;
  for (const evt of ctx.db.moneyEvent.iter()) {
    if (evt.partyId !== partyId) continue;
    if (evt.kind.tag === 'CustomerInvoice') invoiced += evt.totalFils;
    if (evt.kind.tag === 'CustomerPayment') paid += evt.totalFils;
  }
  return invoiced > paid ? invoiced - paid : 0n;
}

function createContext(options?: {
  sender?: string;
  senderRole?: 'Admin' | 'Manager' | 'Sales' | 'Operations' | 'Accountant';
  timestampMicros?: bigint;
  extraMembers?: RowRecord[];
}) {
  const sender = options?.sender ?? 'user-1';
  const timestamp = ts(options?.timestampMicros ?? 1_710_000_000_000_000n);

  const member = new MockTable<RowRecord>([
    {
      identity: sender,
      nickname: 'tester',
      fullName: 'Test User',
      role: { tag: options?.senderRole ?? 'Admin' },
      joinedAt: ts(1_700_000_000_000_000n),
    },
    ...(options?.extraMembers ?? []),
  ]);

  const party = new MockTable<RowRecord>();
  const pipeline = new MockTable<RowRecord>();
  const order = new MockTable<RowRecord>();
  const lineItem = new MockTable<RowRecord>();
  const purchaseOrder = new MockTable<RowRecord>();
  const deliveryNote = new MockTable<RowRecord>();
  const deliveryNoteItem = new MockTable<RowRecord>();
  const goodsReceivedNote = new MockTable<RowRecord>();
  const grnItem = new MockTable<RowRecord>();
  const moneyEvent = new MockTable<RowRecord>();
  const activityLog = new MockTable<RowRecord>();
  const aiAction = new MockTable<RowRecord>();
  const docSequence = new MockTable<RowRecord>();
  const bankTransaction = new MockTable<RowRecord>();
  const contact = new MockTable<RowRecord>();

  const ctx = {
    sender,
    timestamp,
    db: {
      member,
      party,
      pipeline,
      order,
      lineItem: Object.assign(lineItem, {
        line_item_by_parent: {
          filter: (parentId: bigint) => lineItem.filterBy('parentId', parentId),
        },
      }),
      purchaseOrder,
      deliveryNote,
      deliveryNoteItem,
      goodsReceivedNote,
      grnItem,
      moneyEvent: Object.assign(moneyEvent, {
        money_by_party: {
          filter: (partyId: bigint) => moneyEvent.filterBy('partyId', partyId),
        },
      }),
      activityLog,
      aiAction,
      docSequence,
      bankTransaction,
      contact,
    },
  };

  return ctx;
}

function insertParty(
  ctx: ReturnType<typeof createContext>,
  args?: Partial<{
    id: bigint;
    name: string;
    isCustomer: boolean;
    isSupplier: boolean;
    grade: 'A' | 'B' | 'C' | 'D';
    isCreditBlocked: boolean;
    paymentTermsDays: bigint;
  }>,
): void {
  ctx.db.party.insert({
    id: args?.id ?? 1n,
    name: args?.name ?? 'Acme',
    isCustomer: args?.isCustomer ?? true,
    isSupplier: args?.isSupplier ?? false,
    grade: { tag: args?.grade ?? 'B' },
    creditLimitFils: 0n,
    isCreditBlocked: args?.isCreditBlocked ?? false,
    paymentTermsDays: args?.paymentTermsDays ?? 90n,
    productTypes: '',
    annualGoalFils: 0n,
    notes: '',
    createdAt: ts(1n),
    updatedAt: ts(1n),
  });
}

function insertPipeline(
  ctx: ReturnType<typeof createContext>,
  args?: Partial<{
    id: bigint;
    partyId: bigint;
    status: StatusTag;
    title: string;
    markupBps: bigint;
    costingApproved: boolean;
    lossReason: string | undefined;
  }>,
): void {
  ctx.db.pipeline.insert({
    id: args?.id ?? 1n,
    partyId: args?.partyId ?? 1n,
    ownerId: ctx.sender,
    title: args?.title ?? 'Opportunity',
    status: status(args?.status ?? 'Draft'),
    estimatedValueFils: 10_000n,
    winProbabilityBps: 5_000n,
    competitorPresent: false,
    oemPriceFils: 6_000n,
    markupBps: args?.markupBps ?? 2_000n,
    additionalCostsFils: 1_000n,
    costingApproved: args?.costingApproved ?? false,
    costingApprovedBy: args?.costingApproved ? ctx.sender : undefined,
    offerTotalFils: 8_200n,
    offerSentAt: undefined,
    lossReason: args?.lossReason,
    nextFollowUp: undefined,
    revision: 1n,
    createdAt: ts(1n),
    updatedAt: ts(1n),
  });
}

function insertOrder(
  ctx: ReturnType<typeof createContext>,
  args?: Partial<{
    id: bigint;
    partyId: bigint;
    pipelineId: bigint;
    status: StatusTag;
    totalFils: bigint;
  }>,
): void {
  ctx.db.order.insert({
    id: args?.id ?? 1n,
    partyId: args?.partyId ?? 1n,
    pipelineId: args?.pipelineId ?? 1n,
    status: status(args?.status ?? 'Draft'),
    totalFils: args?.totalFils ?? 12_000n,
    poReference: 'PO-1',
    expectedDelivery: undefined,
    createdAt: ts(1n),
    updatedAt: ts(1n),
  });
}

function insertPurchaseOrder(
  ctx: ReturnType<typeof createContext>,
  args?: Partial<{
    id: bigint;
    partyId: bigint;
    status: StatusTag;
    totalFils: bigint;
    deliveryTerms: string;
  }>,
): void {
  ctx.db.purchaseOrder.insert({
    id: args?.id ?? 1n,
    partyId: args?.partyId ?? 1n,
    orderId: undefined,
    poNumber: `PO-2024-${String(args?.id ?? 1n).padStart(3, '0')}`,
    deliveryTerms: args?.deliveryTerms ?? 'CIF Bahrain unless otherwise specified',
    status: status(args?.status ?? 'Draft'),
    totalFils: args?.totalFils ?? 5_000n,
    createdBy: ctx.sender,
    createdAt: ts(1n),
    updatedAt: ts(1n),
  });
}

test('create_delivery_note happy path generates 3-digit DN and logs activity', () => {
  const ctx = createContext({ senderRole: 'Operations' });
  ctx.db.party.insert({
    id: 1n,
    name: 'Acme',
    isCustomer: true,
    isSupplier: false,
    grade: { tag: 'B' },
    creditLimitFils: 0n,
    isCreditBlocked: false,
    paymentTermsDays: 90n,
    productTypes: '',
    annualGoalFils: 0n,
    notes: '',
    createdAt: ts(1n),
    updatedAt: ts(1n),
  });
  ctx.db.order.insert({
    id: 1n,
    partyId: 1n,
    pipelineId: 10n,
    status: status('Active'),
    totalFils: 12_000n,
    poReference: 'PO-1',
    expectedDelivery: undefined,
    createdAt: ts(1n),
    updatedAt: ts(1n),
  });

  createDeliveryNoteImpl(ctx as never, {
    orderId: 1n,
    partyId: 1n,
    deliveryAddress: 'Manama',
    driverName: 'Ravi',
    vehicleNumber: '123',
  });

  const note = ctx.db.deliveryNote.id.find(1n);
  assert.ok(note);
  assert.equal(note.dnNumber, 'DN-2024-001');
  assert.equal(note.status.tag, 'Draft');
  assert.equal(note.updatedAt, ctx.timestamp);
  assert.equal(ctx.db.activityLog.rows.length, 1);
});

test('create_delivery_note rejects missing order', () => {
  const ctx = createContext({ senderRole: 'Operations' });
  ctx.db.party.insert({
    id: 1n,
    name: 'Acme',
    isCustomer: true,
    isSupplier: false,
    grade: { tag: 'B' },
    creditLimitFils: 0n,
    isCreditBlocked: false,
    paymentTermsDays: 90n,
    productTypes: '',
    annualGoalFils: 0n,
    notes: '',
    createdAt: ts(1n),
    updatedAt: ts(1n),
  });

  expectThrows(
    () =>
      createDeliveryNoteImpl(ctx as never, {
        orderId: 99n,
        partyId: 1n,
        deliveryAddress: 'Manama',
        driverName: 'Ravi',
        vehicleNumber: '123',
      }),
    /Order #99 not found/,
  );
});

test('create_delivery_note rejects terminal orders', () => {
  const ctx = createContext({ senderRole: 'Operations' });
  ctx.db.party.insert({
    id: 1n,
    name: 'Acme',
    isCustomer: true,
    isSupplier: false,
    grade: { tag: 'B' },
    creditLimitFils: 0n,
    isCreditBlocked: false,
    paymentTermsDays: 90n,
    productTypes: '',
    annualGoalFils: 0n,
    notes: '',
    createdAt: ts(1n),
    updatedAt: ts(1n),
  });
  ctx.db.order.insert({
    id: 1n,
    partyId: 1n,
    pipelineId: 10n,
    status: status('Terminal'),
    totalFils: 12_000n,
    poReference: 'PO-1',
    expectedDelivery: undefined,
    createdAt: ts(1n),
    updatedAt: ts(1n),
  });

  expectThrows(
    () =>
      createDeliveryNoteImpl(ctx as never, {
        orderId: 1n,
        partyId: 1n,
        deliveryAddress: 'Manama',
        driverName: 'Ravi',
        vehicleNumber: '123',
      }),
    /Active or InProgress orders/,
  );
});

test('add_delivery_note_item happy path inserts item against draft DN', () => {
  const ctx = createContext({ senderRole: 'Operations' });
  ctx.db.order.insert({
    id: 1n,
    partyId: 1n,
    pipelineId: 10n,
    status: status('Active'),
    totalFils: 12_000n,
    poReference: 'PO-1',
    expectedDelivery: undefined,
    createdAt: ts(1n),
    updatedAt: ts(1n),
  });
  ctx.db.deliveryNote.insert({
    id: 1n,
    orderId: 1n,
    partyId: 1n,
    dnNumber: 'DN-2024-001',
    status: deliveryStatus('Draft'),
    deliveryDate: ts(2n),
    deliveryAddress: 'Manama',
    driverName: 'Ravi',
    vehicleNumber: '123',
    receiverName: '',
    notes: '',
    createdBy: ctx.sender,
    createdAt: ts(2n),
    updatedAt: ts(2n),
  });
  ctx.db.lineItem.insert({
    id: 1n,
    parentType: 'order',
    parentId: 1n,
    description: 'Valve',
    quantity: 5n,
    unitPriceFils: 1_000n,
    totalPriceFils: 5_000n,
    fobCostFils: 100n,
    freightCostFils: 10n,
    customsCostFils: 10n,
    insuranceCostFils: 5n,
    handlingCostFils: 5n,
    financeCostFils: 5n,
    marginBps: 1000,
    costPerUnitFils: 135n,
  });

  addDeliveryNoteItemImpl(ctx as never, {
    deliveryNoteId: 1n,
    lineItemId: 1n,
    quantityDelivered: 3n,
    notes: 'partial',
  });

  const item = ctx.db.deliveryNoteItem.id.find(1n);
  assert.ok(item);
  assert.equal(item.quantityDelivered, 3n);
});

test('add_delivery_note_item rejects over-delivery across prior DNs', () => {
  const ctx = createContext({ senderRole: 'Operations' });
  ctx.db.order.insert({
    id: 1n,
    partyId: 1n,
    pipelineId: 10n,
    status: status('InProgress'),
    totalFils: 12_000n,
    poReference: 'PO-1',
    expectedDelivery: undefined,
    createdAt: ts(1n),
    updatedAt: ts(1n),
  });
  ctx.db.deliveryNote.insert({
    id: 1n,
    orderId: 1n,
    partyId: 1n,
    dnNumber: 'DN-2024-001',
    status: deliveryStatus('Delivered'),
    deliveryDate: ts(2n),
    deliveryAddress: 'Manama',
    driverName: 'Ravi',
    vehicleNumber: '123',
    receiverName: 'Ali',
    notes: '',
    createdBy: ctx.sender,
    createdAt: ts(2n),
    updatedAt: ts(3n),
  });
  ctx.db.deliveryNote.insert({
    id: 2n,
    orderId: 1n,
    partyId: 1n,
    dnNumber: 'DN-2024-002',
    status: deliveryStatus('Draft'),
    deliveryDate: ts(4n),
    deliveryAddress: 'Manama',
    driverName: 'Ravi',
    vehicleNumber: '123',
    receiverName: '',
    notes: '',
    createdBy: ctx.sender,
    createdAt: ts(4n),
    updatedAt: ts(4n),
  });
  ctx.db.lineItem.insert({
    id: 1n,
    parentType: 'order',
    parentId: 1n,
    description: 'Valve',
    quantity: 5n,
    unitPriceFils: 1_000n,
    totalPriceFils: 5_000n,
    fobCostFils: 0n,
    freightCostFils: 0n,
    customsCostFils: 0n,
    insuranceCostFils: 0n,
    handlingCostFils: 0n,
    financeCostFils: 0n,
    marginBps: 0,
    costPerUnitFils: 0n,
  });
  ctx.db.deliveryNoteItem.insert({
    id: 1n,
    deliveryNoteId: 1n,
    lineItemId: 1n,
    quantityDelivered: 4n,
    notes: '',
  });

  expectThrows(
    () =>
      addDeliveryNoteItemImpl(ctx as never, {
        deliveryNoteId: 2n,
        lineItemId: 1n,
        quantityDelivered: 2n,
        notes: 'too much',
      }),
    /only 1 remain/,
  );
});

test('add_delivery_note_item rejects line items from a different order', () => {
  const ctx = createContext({ senderRole: 'Operations' });
  ctx.db.deliveryNote.insert({
    id: 1n,
    orderId: 1n,
    partyId: 1n,
    dnNumber: 'DN-2024-001',
    status: deliveryStatus('Draft'),
    deliveryDate: ts(2n),
    deliveryAddress: 'Manama',
    driverName: 'Ravi',
    vehicleNumber: '123',
    receiverName: '',
    notes: '',
    createdBy: ctx.sender,
    createdAt: ts(2n),
    updatedAt: ts(2n),
  });
  ctx.db.lineItem.insert({
    id: 1n,
    parentType: 'order',
    parentId: 2n,
    description: 'Valve',
    quantity: 5n,
    unitPriceFils: 1_000n,
    totalPriceFils: 5_000n,
    fobCostFils: 0n,
    freightCostFils: 0n,
    customsCostFils: 0n,
    insuranceCostFils: 0n,
    handlingCostFils: 0n,
    financeCostFils: 0n,
    marginBps: 0,
    costPerUnitFils: 0n,
  });

  expectThrows(
    () =>
      addDeliveryNoteItemImpl(ctx as never, {
        deliveryNoteId: 1n,
        lineItemId: 1n,
        quantityDelivered: 1n,
        notes: '',
      }),
    /does not belong to order #1/,
  );
});

test('advance_delivery_note rejects invalid transition', () => {
  const ctx = createContext({ senderRole: 'Operations', timestampMicros: 9n });
  ctx.db.deliveryNote.insert({
    id: 1n,
    orderId: 1n,
    partyId: 1n,
    dnNumber: 'DN-2024-001',
    status: deliveryStatus('Draft'),
    deliveryDate: ts(2n),
    deliveryAddress: 'Manama',
    driverName: 'Ravi',
    vehicleNumber: '123',
    receiverName: '',
    notes: '',
    createdBy: ctx.sender,
    createdAt: ts(2n),
    updatedAt: ts(2n),
  });

  expectThrows(
    () =>
      advanceDeliveryNoteImpl(ctx as never, {
        id: 1n,
        newStatus: deliveryStatus('Delivered'),
        receiverName: 'Ali',
        notes: '',
      }),
    /Invalid delivery note transition: Draft -> Delivered/,
  );
});

test('create_grn happy path generates GRN number', () => {
  const ctx = createContext({ senderRole: 'Operations' });
  ctx.db.purchaseOrder.insert({
    id: 1n,
    partyId: 2n,
    orderId: 1n,
    poNumber: 'PO-2024-001',
    status: status('Active'),
    totalFils: 10_000n,
    createdBy: ctx.sender,
    createdAt: ts(1n),
    updatedAt: ts(1n),
  });

  createGrnImpl(ctx as never, {
    purchaseOrderId: 1n,
    receivedDate: ctx.timestamp,
    inspectionNotes: 'looks good',
  });

  const grn = ctx.db.goodsReceivedNote.id.find(1n);
  assert.ok(grn);
  assert.equal(grn.grnNumber, 'GRN-2024-001');
  assert.equal(grn.status.tag, 'Draft');
});

test('create_grn rejects terminal purchase orders', () => {
  const ctx = createContext({ senderRole: 'Operations' });
  ctx.db.purchaseOrder.insert({
    id: 1n,
    partyId: 2n,
    orderId: 1n,
    poNumber: 'PO-2024-001',
    status: status('Terminal'),
    totalFils: 10_000n,
    createdBy: ctx.sender,
    createdAt: ts(1n),
    updatedAt: ts(1n),
  });

  expectThrows(
    () =>
      createGrnImpl(ctx as never, {
        purchaseOrderId: 1n,
        receivedDate: ctx.timestamp,
        inspectionNotes: 'looks good',
      }),
    /GRNs require Active or InProgress POs/,
  );
});

test('add_grn_item happy path inserts accepted quantity', () => {
  const ctx = createContext({ senderRole: 'Operations' });
  ctx.db.goodsReceivedNote.insert({
    id: 1n,
    purchaseOrderId: 1n,
    grnNumber: 'GRN-2024-001',
    status: grnStatus('Draft'),
    receivedDate: ctx.timestamp,
    receivedBy: ctx.sender,
    inspectionNotes: '',
    createdAt: ctx.timestamp,
  });
  ctx.db.lineItem.insert({
    id: 1n,
    parentType: 'purchase_order',
    parentId: 1n,
    description: 'Sensor',
    quantity: 5n,
    unitPriceFils: 1_000n,
    totalPriceFils: 5_000n,
    fobCostFils: 0n,
    freightCostFils: 0n,
    customsCostFils: 0n,
    insuranceCostFils: 0n,
    handlingCostFils: 0n,
    financeCostFils: 0n,
    marginBps: 0,
    costPerUnitFils: 0n,
  });

  addGrnItemImpl(ctx as never, {
    grnId: 1n,
    lineItemId: 1n,
    quantityReceived: 5n,
    quantityAccepted: 4n,
    notes: '1 rejected',
  });

  const item = ctx.db.grnItem.id.find(1n);
  assert.ok(item);
  assert.equal(item.quantityAccepted, 4n);
});

test('add_grn_item rejects quantityAccepted greater than quantityReceived', () => {
  const ctx = createContext({ senderRole: 'Operations' });
  ctx.db.goodsReceivedNote.insert({
    id: 1n,
    purchaseOrderId: 1n,
    grnNumber: 'GRN-2024-001',
    status: grnStatus('Inspecting'),
    receivedDate: ctx.timestamp,
    receivedBy: ctx.sender,
    inspectionNotes: '',
    createdAt: ctx.timestamp,
  });
  ctx.db.lineItem.insert({
    id: 1n,
    parentType: 'purchase_order',
    parentId: 1n,
    description: 'Sensor',
    quantity: 5n,
    unitPriceFils: 1_000n,
    totalPriceFils: 5_000n,
    fobCostFils: 0n,
    freightCostFils: 0n,
    customsCostFils: 0n,
    insuranceCostFils: 0n,
    handlingCostFils: 0n,
    financeCostFils: 0n,
    marginBps: 0,
    costPerUnitFils: 0n,
  });

  expectThrows(
    () =>
      addGrnItemImpl(ctx as never, {
        grnId: 1n,
        lineItemId: 1n,
        quantityReceived: 2n,
        quantityAccepted: 3n,
        notes: '',
      }),
    /cannot exceed quantityReceived/,
  );
});

test('add_grn_item rejects over-receipt across accepted GRNs', () => {
  const ctx = createContext({ senderRole: 'Operations' });
  ctx.db.goodsReceivedNote.insert({
    id: 1n,
    purchaseOrderId: 1n,
    grnNumber: 'GRN-2024-001',
    status: grnStatus('Accepted'),
    receivedDate: ts(2n),
    receivedBy: ctx.sender,
    inspectionNotes: '',
    createdAt: ts(2n),
  });
  ctx.db.goodsReceivedNote.insert({
    id: 2n,
    purchaseOrderId: 1n,
    grnNumber: 'GRN-2024-002',
    status: grnStatus('Inspecting'),
    receivedDate: ts(3n),
    receivedBy: ctx.sender,
    inspectionNotes: '',
    createdAt: ts(3n),
  });
  ctx.db.lineItem.insert({
    id: 1n,
    parentType: 'purchase_order',
    parentId: 1n,
    description: 'Sensor',
    quantity: 5n,
    unitPriceFils: 1_000n,
    totalPriceFils: 5_000n,
    fobCostFils: 0n,
    freightCostFils: 0n,
    customsCostFils: 0n,
    insuranceCostFils: 0n,
    handlingCostFils: 0n,
    financeCostFils: 0n,
    marginBps: 0,
    costPerUnitFils: 0n,
  });
  ctx.db.grnItem.insert({
    id: 1n,
    grnId: 1n,
    lineItemId: 1n,
    quantityReceived: 4n,
    quantityAccepted: 4n,
    notes: '',
  });

  expectThrows(
    () =>
      addGrnItemImpl(ctx as never, {
        grnId: 2n,
        lineItemId: 1n,
        quantityReceived: 2n,
        quantityAccepted: 2n,
        notes: '',
      }),
    /only 1 remain/,
  );
});

test('advance_grn rejects invalid transition', () => {
  const ctx = createContext({ senderRole: 'Operations' });
  ctx.db.goodsReceivedNote.insert({
    id: 1n,
    purchaseOrderId: 1n,
    grnNumber: 'GRN-2024-001',
    status: grnStatus('Draft'),
    receivedDate: ctx.timestamp,
    receivedBy: ctx.sender,
    inspectionNotes: '',
    createdAt: ctx.timestamp,
  });

  expectThrows(
    () =>
      advanceGrnImpl(ctx as never, {
        id: 1n,
        newStatus: grnStatus('Accepted'),
        inspectionNotes: '',
      }),
    /Invalid GRN transition: Draft -> Accepted/,
  );
});

test('add_line_item derives costPerUnitFils from full costing breakdown', () => {
  const ctx = createContext({ senderRole: 'Sales' });
  ctx.db.pipeline.insert({
    id: 1n,
    partyId: 1n,
    ownerId: ctx.sender,
    title: 'Quote',
    status: status('Draft'),
    estimatedValueFils: 10_000n,
    winProbabilityBps: 5000n,
    competitorPresent: false,
    oemPriceFils: 5_000n,
    markupBps: 1500n,
    additionalCostsFils: 0n,
    costingApproved: false,
    costingApprovedBy: undefined,
    offerTotalFils: 6_000n,
    offerSentAt: undefined,
    lossReason: undefined,
    nextFollowUp: undefined,
    revision: 1n,
    createdAt: ts(1n),
    updatedAt: ts(1n),
  });

  addLineItemImpl(ctx as never, {
    parentType: 'pipeline',
    parentId: 1n,
    description: 'Flow meter',
    quantity: 2n,
    unitPriceFils: 7_500n,
    fobCostFils: 3_000n,
    freightCostFils: 150n,
    customsCostFils: 50n,
    insuranceCostFils: 25n,
    handlingCostFils: 75n,
    financeCostFils: 100n,
    marginBps: 1200,
    costPerUnitFils: undefined,
  });

  const item = ctx.db.lineItem.id.find(1n);
  assert.ok(item);
  assert.equal(item.costPerUnitFils, 3_400n);
  assert.equal(item.totalPriceFils, 15_000n);
});

test('add_line_item rejects empty description', () => {
  const ctx = createContext({ senderRole: 'Sales' });
  ctx.db.pipeline.insert({
    id: 1n,
    partyId: 1n,
    ownerId: ctx.sender,
    title: 'Quote',
    status: status('Draft'),
    estimatedValueFils: 10_000n,
    winProbabilityBps: 5000n,
    competitorPresent: false,
    oemPriceFils: 5_000n,
    markupBps: 1500n,
    additionalCostsFils: 0n,
    costingApproved: false,
    costingApprovedBy: undefined,
    offerTotalFils: 6_000n,
    offerSentAt: undefined,
    lossReason: undefined,
    nextFollowUp: undefined,
    revision: 1n,
    createdAt: ts(1n),
    updatedAt: ts(1n),
  });

  expectThrows(
    () =>
      addLineItemImpl(ctx as never, {
        parentType: 'pipeline',
        parentId: 1n,
        description: '   ',
        quantity: 1n,
        unitPriceFils: 1_000n,
        fobCostFils: undefined,
        freightCostFils: undefined,
        customsCostFils: undefined,
        insuranceCostFils: undefined,
        handlingCostFils: undefined,
        financeCostFils: undefined,
        marginBps: undefined,
        costPerUnitFils: undefined,
      }),
    /description is required/,
  );
});

test('convert_pipeline_to_order copies line items with costing fidelity', () => {
  const ctx = createContext({ senderRole: 'Sales' });
  ctx.db.pipeline.insert({
    id: 1n,
    partyId: 7n,
    ownerId: ctx.sender,
    title: 'Won deal',
    status: status('Terminal'),
    estimatedValueFils: 10_000n,
    winProbabilityBps: 9000n,
    competitorPresent: false,
    oemPriceFils: 5_000n,
    markupBps: 1500n,
    additionalCostsFils: 0n,
    costingApproved: true,
    costingApprovedBy: ctx.sender,
    offerTotalFils: 22_000n,
    offerSentAt: undefined,
    lossReason: undefined,
    nextFollowUp: undefined,
    revision: 4n,
    createdAt: ts(1n),
    updatedAt: ts(1n),
  });
  ctx.db.lineItem.insert({
    id: 1n,
    parentType: 'pipeline',
    parentId: 1n,
    description: 'Analyzer',
    quantity: 2n,
    unitPriceFils: 11_000n,
    totalPriceFils: 22_000n,
    fobCostFils: 8_000n,
    freightCostFils: 500n,
    customsCostFils: 200n,
    insuranceCostFils: 100n,
    handlingCostFils: 50n,
    financeCostFils: 150n,
    marginBps: 1750,
    costPerUnitFils: 9_000n,
  });

  convertPipelineToOrderImpl(ctx as never, {
    pipelineId: 1n,
    poReference: 'PO-CUST-1',
    expectedDelivery: undefined,
  });

  const order = ctx.db.order.id.find(1n);
  assert.equal(order?.pipelineId, 1n);
  const copied = ctx.db.lineItem.id.find(2n);
  assert.equal(copied?.parentType, 'order');
  assert.equal(copied?.parentId, 1n);
  assert.equal(copied?.financeCostFils, 150n);
  assert.equal(copied?.marginBps, 1750);
});

test('convert_pipeline_to_order rejects non-terminal pipelines', () => {
  const ctx = createContext({ senderRole: 'Sales' });
  ctx.db.pipeline.insert({
    id: 1n,
    partyId: 7n,
    ownerId: ctx.sender,
    title: 'Open deal',
    status: status('Active'),
    estimatedValueFils: 10_000n,
    winProbabilityBps: 5000n,
    competitorPresent: false,
    oemPriceFils: 5_000n,
    markupBps: 1500n,
    additionalCostsFils: 0n,
    costingApproved: true,
    costingApprovedBy: ctx.sender,
    offerTotalFils: 22_000n,
    offerSentAt: undefined,
    lossReason: undefined,
    nextFollowUp: undefined,
    revision: 2n,
    createdAt: ts(1n),
    updatedAt: ts(1n),
  });

  expectThrows(
    () =>
      convertPipelineToOrderImpl(ctx as never, {
        pipelineId: 1n,
        poReference: 'PO-CUST-1',
        expectedDelivery: undefined,
      }),
    /only Terminal \(won\) pipelines may convert to orders/,
  );
});

test('convert_pipeline_to_order rejects double conversion', () => {
  const ctx = createContext({ senderRole: 'Sales' });
  ctx.db.pipeline.insert({
    id: 1n,
    partyId: 7n,
    ownerId: ctx.sender,
    title: 'Won deal',
    status: status('Terminal'),
    estimatedValueFils: 10_000n,
    winProbabilityBps: 9000n,
    competitorPresent: false,
    oemPriceFils: 5_000n,
    markupBps: 1500n,
    additionalCostsFils: 0n,
    costingApproved: true,
    costingApprovedBy: ctx.sender,
    offerTotalFils: 22_000n,
    offerSentAt: undefined,
    lossReason: undefined,
    nextFollowUp: undefined,
    revision: 4n,
    createdAt: ts(1n),
    updatedAt: ts(1n),
  });
  ctx.db.order.insert({
    id: 1n,
    partyId: 7n,
    pipelineId: 1n,
    status: status('Draft'),
    totalFils: 22_000n,
    poReference: 'PO-CUST-1',
    expectedDelivery: undefined,
    createdAt: ts(2n),
    updatedAt: ts(2n),
  });

  expectThrows(
    () =>
      convertPipelineToOrderImpl(ctx as never, {
        pipelineId: 1n,
        poReference: 'PO-CUST-2',
        expectedDelivery: undefined,
      }),
    /already linked to order #1/,
  );
});

test('record_money_event invoices a delivered delivery note and snapshots invoice line items', () => {
  const ctx = createContext({ senderRole: 'Accountant' });
  ctx.db.party.insert({
    id: 1n,
    name: 'Acme',
    isCustomer: true,
    isSupplier: false,
    grade: { tag: 'A' },
    creditLimitFils: 0n,
    isCreditBlocked: false,
    paymentTermsDays: 30n,
    productTypes: '',
    annualGoalFils: 0n,
    notes: '',
    createdAt: ts(1n),
    updatedAt: ts(1n),
  });
  ctx.db.order.insert({
    id: 1n,
    partyId: 1n,
    pipelineId: 9n,
    status: status('InProgress'),
    totalFils: 5_000n,
    poReference: 'PO-1',
    expectedDelivery: undefined,
    createdAt: ts(1n),
    updatedAt: ts(1n),
  });
  ctx.db.lineItem.insert({
    id: 1n,
    parentType: 'order',
    parentId: 1n,
    description: 'Valve',
    quantity: 5n,
    unitPriceFils: 1_000n,
    totalPriceFils: 5_000n,
    fobCostFils: 100n,
    freightCostFils: 20n,
    customsCostFils: 10n,
    insuranceCostFils: 5n,
    handlingCostFils: 5n,
    financeCostFils: 10n,
    marginBps: 1250,
    costPerUnitFils: 150n,
  });
  ctx.db.deliveryNote.insert({
    id: 1n,
    orderId: 1n,
    partyId: 1n,
    dnNumber: 'DN-2024-001',
    status: deliveryStatus('Delivered'),
    deliveryDate: ts(2n),
    deliveryAddress: 'Manama',
    driverName: 'Ravi',
    vehicleNumber: '123',
    receiverName: 'Ali',
    notes: '',
    createdBy: ctx.sender,
    createdAt: ts(2n),
    updatedAt: ts(2n),
  });
  ctx.db.deliveryNoteItem.insert({
    id: 1n,
    deliveryNoteId: 1n,
    lineItemId: 1n,
    quantityDelivered: 5n,
    notes: '',
  });

  recordMoneyEventImpl(ctx as never, {
    partyId: 1n,
    orderId: 1n,
    deliveryNoteId: 1n,
    kind: { tag: 'CustomerInvoice' },
    subtotalFils: 5_000n,
    reference: 'INV-1',
    dueDate: ts(3n),
  });

  const invoice = ctx.db.moneyEvent.id.find(1n);
  assert.equal(invoice?.deliveryNoteId, 1n);
  assert.equal(invoice?.subtotalFils, 5_000n);
  assert.equal(invoice?.vatFils, 500n);

  const invoiceLines = ctx.db.lineItem.rows.filter((item) => item.parentType === 'invoice' && item.parentId === 1n);
  assert.equal(invoiceLines.length, 1);
  assert.equal(invoiceLines[0].quantity, 5n);
  assert.equal(invoiceLines[0].description, 'Valve');
  assert.equal(invoiceLines[0].costPerUnitFils, 150n);
});

test('record_money_event rejects invoicing a non-delivered delivery note', () => {
  const ctx = createContext({ senderRole: 'Accountant' });
  ctx.db.party.insert({
    id: 1n,
    name: 'Acme',
    isCustomer: true,
    isSupplier: false,
    grade: { tag: 'A' },
    creditLimitFils: 0n,
    isCreditBlocked: false,
    paymentTermsDays: 30n,
    productTypes: '',
    annualGoalFils: 0n,
    notes: '',
    createdAt: ts(1n),
    updatedAt: ts(1n),
  });
  ctx.db.order.insert({
    id: 1n,
    partyId: 1n,
    pipelineId: 9n,
    status: status('InProgress'),
    totalFils: 5_000n,
    poReference: 'PO-1',
    expectedDelivery: undefined,
    createdAt: ts(1n),
    updatedAt: ts(1n),
  });
  ctx.db.deliveryNote.insert({
    id: 1n,
    orderId: 1n,
    partyId: 1n,
    dnNumber: 'DN-2024-001',
    status: deliveryStatus('Dispatched'),
    deliveryDate: ts(2n),
    deliveryAddress: 'Manama',
    driverName: 'Ravi',
    vehicleNumber: '123',
    receiverName: '',
    notes: '',
    createdBy: ctx.sender,
    createdAt: ts(2n),
    updatedAt: ts(2n),
  });
  ctx.db.lineItem.insert({
    id: 1n,
    parentType: 'order',
    parentId: 1n,
    description: 'Valve',
    quantity: 5n,
    unitPriceFils: 1_000n,
    totalPriceFils: 5_000n,
    fobCostFils: 0n,
    freightCostFils: 0n,
    customsCostFils: 0n,
    insuranceCostFils: 0n,
    handlingCostFils: 0n,
    financeCostFils: 0n,
    marginBps: 0,
    costPerUnitFils: 0n,
  });
  ctx.db.deliveryNoteItem.insert({
    id: 1n,
    deliveryNoteId: 1n,
    lineItemId: 1n,
    quantityDelivered: 5n,
    notes: '',
  });

  expectThrows(
    () =>
      recordMoneyEventImpl(ctx as never, {
        partyId: 1n,
        orderId: 1n,
        deliveryNoteId: 1n,
        kind: { tag: 'CustomerInvoice' },
        subtotalFils: 5_000n,
        reference: 'INV-1',
        dueDate: ts(3n),
      }),
    /only Delivered notes may be invoiced/,
  );
});

test('record_money_event rejects over-invoicing or duplicate invoicing for a delivery note', () => {
  const ctx = createContext({ senderRole: 'Accountant' });
  ctx.db.party.insert({
    id: 1n,
    name: 'Acme',
    isCustomer: true,
    isSupplier: false,
    grade: { tag: 'A' },
    creditLimitFils: 0n,
    isCreditBlocked: false,
    paymentTermsDays: 30n,
    productTypes: '',
    annualGoalFils: 0n,
    notes: '',
    createdAt: ts(1n),
    updatedAt: ts(1n),
  });
  ctx.db.order.insert({
    id: 1n,
    partyId: 1n,
    pipelineId: 9n,
    status: status('InProgress'),
    totalFils: 5_000n,
    poReference: 'PO-1',
    expectedDelivery: undefined,
    createdAt: ts(1n),
    updatedAt: ts(1n),
  });
  ctx.db.lineItem.insert({
    id: 1n,
    parentType: 'order',
    parentId: 1n,
    description: 'Valve',
    quantity: 5n,
    unitPriceFils: 1_000n,
    totalPriceFils: 5_000n,
    fobCostFils: 0n,
    freightCostFils: 0n,
    customsCostFils: 0n,
    insuranceCostFils: 0n,
    handlingCostFils: 0n,
    financeCostFils: 0n,
    marginBps: 0,
    costPerUnitFils: 0n,
  });
  ctx.db.deliveryNote.insert({
    id: 1n,
    orderId: 1n,
    partyId: 1n,
    dnNumber: 'DN-2024-001',
    status: deliveryStatus('Delivered'),
    deliveryDate: ts(2n),
    deliveryAddress: 'Manama',
    driverName: 'Ravi',
    vehicleNumber: '123',
    receiverName: 'Ali',
    notes: '',
    createdBy: ctx.sender,
    createdAt: ts(2n),
    updatedAt: ts(2n),
  });
  ctx.db.deliveryNoteItem.insert({
    id: 1n,
    deliveryNoteId: 1n,
    lineItemId: 1n,
    quantityDelivered: 5n,
    notes: '',
  });

  expectThrows(
    () =>
      recordMoneyEventImpl(ctx as never, {
        partyId: 1n,
        orderId: 1n,
        deliveryNoteId: 1n,
        kind: { tag: 'CustomerInvoice' },
        subtotalFils: 6_000n,
        reference: 'INV-TOO-MUCH',
        dueDate: ts(3n),
      }),
    /must equal delivered subtotal remaining/,
  );

  recordMoneyEventImpl(ctx as never, {
    partyId: 1n,
    orderId: 1n,
    deliveryNoteId: 1n,
    kind: { tag: 'CustomerInvoice' },
    subtotalFils: 5_000n,
    reference: 'INV-1',
    dueDate: ts(3n),
  });

  expectThrows(
    () =>
      recordMoneyEventImpl(ctx as never, {
        partyId: 1n,
        orderId: 1n,
        deliveryNoteId: 1n,
        kind: { tag: 'CustomerInvoice' },
        subtotalFils: 5_000n,
        reference: 'INV-2',
        dueDate: ts(4n),
      }),
    /already fully invoiced/,
  );
});

test('record_money_event supports full pipeline-to-payment lifecycle with delivered subtotal controls', () => {
  const ctx = createContext({ senderRole: 'Admin', timestampMicros: 1_710_000_000_000_000n });
  ctx.db.party.insert({
    id: 1n,
    name: 'Acme',
    isCustomer: true,
    isSupplier: false,
    grade: { tag: 'A' },
    creditLimitFils: 0n,
    isCreditBlocked: false,
    paymentTermsDays: 30n,
    productTypes: '',
    annualGoalFils: 0n,
    notes: '',
    createdAt: ts(1n),
    updatedAt: ts(1n),
  });
  ctx.db.pipeline.insert({
    id: 1n,
    partyId: 1n,
    ownerId: ctx.sender,
    title: 'Won deal',
    status: status('Terminal'),
    estimatedValueFils: 10_000n,
    winProbabilityBps: 9000n,
    competitorPresent: false,
    oemPriceFils: 5_000n,
    markupBps: 1500n,
    additionalCostsFils: 0n,
    costingApproved: true,
    costingApprovedBy: ctx.sender,
    offerTotalFils: 10_000n,
    offerSentAt: undefined,
    lossReason: undefined,
    nextFollowUp: undefined,
    revision: 1n,
    createdAt: ts(1n),
    updatedAt: ts(1n),
  });
  ctx.db.lineItem.insert({
    id: 1n,
    parentType: 'pipeline',
    parentId: 1n,
    description: 'Valve',
    quantity: 5n,
    unitPriceFils: 2_000n,
    totalPriceFils: 10_000n,
    fobCostFils: 400n,
    freightCostFils: 50n,
    customsCostFils: 25n,
    insuranceCostFils: 10n,
    handlingCostFils: 15n,
    financeCostFils: 20n,
    marginBps: 2000,
    costPerUnitFils: 520n,
  });

  convertPipelineToOrderImpl(ctx as never, {
    pipelineId: 1n,
    poReference: 'PO-CUST-1',
    expectedDelivery: undefined,
  });

  const order = ctx.db.order.id.find(1n);
  assert.equal(order?.status.tag, 'Draft');
  ctx.db.order.id.update({
    ...order,
    status: status('Active'),
    updatedAt: ctx.timestamp,
  });

  createDeliveryNoteImpl(ctx as never, {
    orderId: 1n,
    partyId: 1n,
    deliveryAddress: 'Manama',
    driverName: 'Ravi',
    vehicleNumber: '123',
  });

  addDeliveryNoteItemImpl(ctx as never, {
    deliveryNoteId: 1n,
    lineItemId: 2n,
    quantityDelivered: 5n,
    notes: 'complete',
  });

  expectThrows(
    () =>
      recordMoneyEventImpl(ctx as never, {
        partyId: 1n,
        orderId: 1n,
        deliveryNoteId: 1n,
        kind: { tag: 'CustomerInvoice' },
        subtotalFils: 10_000n,
        reference: 'INV-BEFORE-DELIVERY',
        dueDate: ts(4n),
      }),
    /only Delivered notes may be invoiced/,
  );

  advanceDeliveryNoteImpl(ctx as never, {
    id: 1n,
    newStatus: { tag: 'Dispatched' },
    receiverName: undefined,
    notes: '',
  });
  advanceDeliveryNoteImpl(ctx as never, {
    id: 1n,
    newStatus: { tag: 'Delivered' },
    receiverName: 'Ali',
    notes: 'signed',
  });

  assert.equal(ctx.db.order.id.find(1n)?.status.tag, 'Terminal');
  assert.equal(computeOutstandingTotal(ctx), 0n);

  recordMoneyEventImpl(ctx as never, {
    partyId: 1n,
    orderId: 1n,
    deliveryNoteId: 1n,
    kind: { tag: 'CustomerInvoice' },
    subtotalFils: 10_000n,
    reference: 'INV-1',
    dueDate: ts(5n),
  });

  assert.equal(computeOutstandingTotal(ctx, 1n), 11_000n);

  recordMoneyEventImpl(ctx as never, {
    partyId: 1n,
    orderId: 1n,
    deliveryNoteId: 1n,
    kind: { tag: 'CustomerPayment' },
    subtotalFils: 11_000n,
    reference: 'PAY-1',
    dueDate: undefined,
  });

  assert.equal(computeOutstandingTotal(ctx, 1n), 0n);
});

test('partial-delivery lifecycle preserves invoicing guardrails across multiple delivery notes', () => {
  const ctx = createContext({ senderRole: 'Admin', timestampMicros: 1_710_500_000_000_000n });
  ctx.db.party.insert({
    id: 1n,
    name: 'Grade B Customer',
    isCustomer: true,
    isSupplier: false,
    grade: { tag: 'B' },
    creditLimitFils: 50_000n,
    isCreditBlocked: false,
    paymentTermsDays: 90n,
    productTypes: '',
    annualGoalFils: 0n,
    notes: '',
    createdAt: ts(1n),
    updatedAt: ts(1n),
  });
  ctx.db.pipeline.insert({
    id: 1n,
    partyId: 1n,
    ownerId: ctx.sender,
    title: 'Won RFQ',
    status: status('Terminal'),
    estimatedValueFils: 24_000n,
    winProbabilityBps: 10_000n,
    competitorPresent: true,
    oemPriceFils: 16_000n,
    markupBps: 1500n,
    additionalCostsFils: 0n,
    costingApproved: true,
    costingApprovedBy: ctx.sender,
    offerTotalFils: 24_000n,
    offerSentAt: undefined,
    lossReason: undefined,
    nextFollowUp: undefined,
    revision: 3n,
    createdAt: ts(1n),
    updatedAt: ts(1n),
  });

  for (const line of [
    { id: 1n, description: 'Flow meter', quantity: 2n, unitPriceFils: 4_000n, totalPriceFils: 8_000n },
    { id: 2n, description: 'Pressure gauge', quantity: 3n, unitPriceFils: 2_000n, totalPriceFils: 6_000n },
    { id: 3n, description: 'Temperature transmitter', quantity: 2n, unitPriceFils: 5_000n, totalPriceFils: 10_000n },
  ]) {
    ctx.db.lineItem.insert({
      ...line,
      parentType: 'pipeline',
      parentId: 1n,
      fobCostFils: 0n,
      freightCostFils: 0n,
      customsCostFils: 0n,
      insuranceCostFils: 0n,
      handlingCostFils: 0n,
      financeCostFils: 0n,
      marginBps: 0,
      costPerUnitFils: 0n,
    });
  }

  convertPipelineToOrderImpl(ctx as never, {
    pipelineId: 1n,
    poReference: 'B-CUST-PO-77',
    expectedDelivery: undefined,
  });

  const order = ctx.db.order.id.find(1n);
  ctx.db.order.id.update({
    ...order,
    status: status('InProgress'),
    updatedAt: ctx.timestamp,
  });

  createDeliveryNoteImpl(ctx as never, {
    orderId: 1n,
    partyId: 1n,
    deliveryAddress: 'Hidd',
    driverName: 'Ravi',
    vehicleNumber: '123',
  });
  addDeliveryNoteItemImpl(ctx as never, {
    deliveryNoteId: 1n,
    lineItemId: 4n,
    quantityDelivered: 2n,
    notes: 'line 1 complete',
  });
  addDeliveryNoteItemImpl(ctx as never, {
    deliveryNoteId: 1n,
    lineItemId: 5n,
    quantityDelivered: 1n,
    notes: 'line 2 partial',
  });
  advanceDeliveryNoteImpl(ctx as never, {
    id: 1n,
    newStatus: { tag: 'Dispatched' },
    receiverName: undefined,
    notes: '',
  });
  advanceDeliveryNoteImpl(ctx as never, {
    id: 1n,
    newStatus: { tag: 'Delivered' },
    receiverName: 'Khalid',
    notes: '',
  });

  recordMoneyEventImpl(ctx as never, {
    partyId: 1n,
    orderId: 1n,
    deliveryNoteId: 1n,
    kind: { tag: 'CustomerInvoice' },
    subtotalFils: 10_000n,
    reference: 'INV-PART-1',
    dueDate: ts(10n),
  });
  assert.equal(computeOutstandingTotal(ctx, 1n), 11_000n);

  createDeliveryNoteImpl(ctx as never, {
    orderId: 1n,
    partyId: 1n,
    deliveryAddress: 'Hidd',
    driverName: 'Ravi',
    vehicleNumber: '123',
  });
  addDeliveryNoteItemImpl(ctx as never, {
    deliveryNoteId: 2n,
    lineItemId: 5n,
    quantityDelivered: 2n,
    notes: 'line 2 balance',
  });
  addDeliveryNoteItemImpl(ctx as never, {
    deliveryNoteId: 2n,
    lineItemId: 6n,
    quantityDelivered: 2n,
    notes: 'line 3 complete',
  });

  expectThrows(
    () =>
      recordMoneyEventImpl(ctx as never, {
        partyId: 1n,
        orderId: 1n,
        deliveryNoteId: 2n,
        kind: { tag: 'CustomerInvoice' },
        subtotalFils: 16_000n,
        reference: 'INV-EARLY',
        dueDate: ts(11n),
      }),
    /only Delivered notes may be invoiced/,
  );

  advanceDeliveryNoteImpl(ctx as never, {
    id: 2n,
    newStatus: { tag: 'Dispatched' },
    receiverName: undefined,
    notes: '',
  });
  advanceDeliveryNoteImpl(ctx as never, {
    id: 2n,
    newStatus: { tag: 'Delivered' },
    receiverName: 'Khalid',
    notes: '',
  });

  recordMoneyEventImpl(ctx as never, {
    partyId: 1n,
    orderId: 1n,
    deliveryNoteId: 2n,
    kind: { tag: 'CustomerInvoice' },
    subtotalFils: 14_000n,
    reference: 'INV-PART-2',
    dueDate: ts(12n),
  });
  assert.equal(computeOutstandingTotal(ctx, 1n), 26_400n);
  assert.equal(ctx.db.order.id.find(1n)?.status.tag, 'Terminal');

  recordMoneyEventImpl(ctx as never, {
    partyId: 1n,
    orderId: 1n,
    deliveryNoteId: undefined,
    kind: { tag: 'CustomerPayment' },
    subtotalFils: 10_000n,
    reference: 'PAY-PARTIAL',
    dueDate: undefined,
  });
  assert.equal(computeOutstandingTotal(ctx, 1n), 16_400n);
});

test('manageOrderImpl rejects reopening terminal or cancelled orders and allows forward transitions', () => {
  const ctx = createContext();
  insertParty(ctx);
  insertPipeline(ctx);
  insertOrder(ctx, { id: 1n, status: 'Terminal' });
  insertOrder(ctx, { id: 2n, status: 'Cancelled' });
  insertOrder(ctx, { id: 3n, status: 'Active' });
  insertOrder(ctx, { id: 4n, status: 'Active' });

  expectThrows(
    () =>
      manageOrderImpl(ctx as never, {
        id: 1n,
        partyId: 1n,
        pipelineId: 1n,
        newStatus: status('Active'),
        totalFils: 12_000n,
        poReference: 'PO-1',
      }),
    /Cannot transition order from Terminal to Active/,
  );

  expectThrows(
    () =>
      manageOrderImpl(ctx as never, {
        id: 2n,
        partyId: 1n,
        pipelineId: 1n,
        newStatus: status('InProgress'),
        totalFils: 12_000n,
        poReference: 'PO-2',
      }),
    /Cannot transition order from Cancelled to InProgress/,
  );

  manageOrderImpl(ctx as never, {
    id: 3n,
    partyId: 1n,
    pipelineId: 1n,
    newStatus: status('Terminal'),
    totalFils: 12_000n,
    poReference: 'PO-3',
  });
  manageOrderImpl(ctx as never, {
    id: 4n,
    partyId: 1n,
    pipelineId: 1n,
    newStatus: status('Cancelled'),
    totalFils: 12_000n,
    poReference: 'PO-4',
  });

  assert.equal(ctx.db.order.id.find(3n)?.status.tag, 'Terminal');
  assert.equal(ctx.db.order.id.find(4n)?.status.tag, 'Cancelled');
  assert.equal(ctx.db.activityLog.rows.at(-1)?.action, 'manage_order');
});

test('manageOrderImpl rejects creating an order for a credit-blocked party', () => {
  const ctx = createContext();
  insertParty(ctx, { isCreditBlocked: true });
  insertPipeline(ctx);

  expectThrows(
    () =>
      manageOrderImpl(ctx as never, {
        id: 0n,
        partyId: 1n,
        pipelineId: 1n,
        newStatus: status('Draft'),
        totalFils: 5_000n,
        poReference: 'PO-NEW',
      }),
    /Cannot create order for credit-blocked party/,
  );
});

test('managePurchaseOrderImpl enforces absorbing terminal states and blocks total updates after draft', () => {
  const ctx = createContext();
  insertParty(ctx, { isCustomer: false, isSupplier: true });
  insertPurchaseOrder(ctx, { id: 1n, status: 'Terminal' });
  insertPurchaseOrder(ctx, { id: 2n, status: 'Cancelled' });
  insertPurchaseOrder(ctx, { id: 3n, status: 'Active', totalFils: 5_000n });
  insertPurchaseOrder(ctx, { id: 4n, status: 'Active', totalFils: 5_000n });

  expectThrows(
    () =>
      managePurchaseOrderImpl(ctx as never, {
        id: 1n,
        partyId: 1n,
        newStatus: status('Active'),
        totalFils: 5_000n,
      }),
    /Cannot transition purchase order from Terminal to Active/,
  );

  expectThrows(
    () =>
      managePurchaseOrderImpl(ctx as never, {
        id: 2n,
        partyId: 1n,
        newStatus: status('InProgress'),
        totalFils: 5_000n,
      }),
    /Cannot transition purchase order from Cancelled to InProgress/,
  );

  expectThrows(
    () =>
      managePurchaseOrderImpl(ctx as never, {
        id: 3n,
        partyId: 1n,
        newStatus: status('InProgress'),
        totalFils: 6_000n,
      }),
    /Cannot update totalFils on a non-Draft purchase order/,
  );

  managePurchaseOrderImpl(ctx as never, {
    id: 4n,
    partyId: 1n,
    newStatus: status('Terminal'),
    totalFils: 5_000n,
  });

  assert.equal(ctx.db.purchaseOrder.id.find(4n)?.status.tag, 'Terminal');
  assert.equal(ctx.db.activityLog.rows.at(-1)?.action, 'manage_purchase_order');
});

test('managePurchaseOrderImpl assigns a stored poNumber when creating a purchase order', () => {
  const ctx = createContext({ timestampMicros: 1_735_689_600_000_000n });
  insertParty(ctx, { isCustomer: false, isSupplier: true });

  managePurchaseOrderImpl(ctx as never, {
    id: 0n,
    partyId: 1n,
    newStatus: status('Draft'),
    totalFils: 5_000n,
    deliveryTerms: 'CIF Bahrain',
  });

  const created = ctx.db.purchaseOrder.id.find(1n);
  assert.equal(created?.poNumber, 'PO-2025-001');
  assert.equal(ctx.db.activityLog.rows.at(-1)?.detail, 'Created purchase order PO-2025-001');
});

test('refreshPurchaseOrderStatusFromReceipts keeps terminal purchase orders terminal', () => {
  const ctx = createContext({ senderRole: 'Operations' });
  insertParty(ctx, { id: 2n, isCustomer: false, isSupplier: true });
  insertPurchaseOrder(ctx, { id: 1n, partyId: 2n, status: 'Terminal' });
  ctx.db.goodsReceivedNote.insert({
    id: 1n,
    purchaseOrderId: 1n,
    grnNumber: 'GRN-2024-001',
    status: grnStatus('Draft'),
    receivedDate: ctx.timestamp,
    receivedBy: ctx.sender,
    inspectionNotes: '',
    createdAt: ctx.timestamp,
  });
  ctx.db.lineItem.insert({
    id: 1n,
    parentType: 'purchase_order',
    parentId: 1n,
    description: 'Valve',
    quantity: 10n,
    unitPriceFils: 1_000n,
    totalPriceFils: 10_000n,
    fobCostFils: 0n,
    freightCostFils: 0n,
    customsCostFils: 0n,
    insuranceCostFils: 0n,
    handlingCostFils: 0n,
    financeCostFils: 0n,
    marginBps: 0,
    costPerUnitFils: 0n,
  });

  addGrnItemImpl(ctx as never, {
    grnId: 1n,
    lineItemId: 1n,
    quantityReceived: 5n,
    quantityAccepted: 5n,
    notes: 'partial',
  });
  advanceGrnImpl(ctx as never, {
    id: 1n,
    newStatus: grnStatus('Inspecting'),
    inspectionNotes: '',
  });
  advanceGrnImpl(ctx as never, {
    id: 1n,
    newStatus: grnStatus('Accepted'),
    inspectionNotes: 'accepted',
  });

  assert.equal(ctx.db.purchaseOrder.id.find(1n)?.status.tag, 'Terminal');
});

test('advancePipelineImpl enforces state machine and loss-reason rules', () => {
  const ctx = createContext();
  insertParty(ctx);
  insertPipeline(ctx, { id: 1n, status: 'Terminal' });
  insertPipeline(ctx, { id: 2n, status: 'Cancelled', lossReason: 'Lost to competitor' });
  insertPipeline(ctx, { id: 3n, status: 'Draft' });

  expectThrows(
    () =>
      advancePipelineImpl(ctx as never, {
        id: 1n,
        partyId: 1n,
        title: 'Won deal',
        newStatus: status('Draft'),
        estimatedValueFils: 10_000n,
        winProbabilityBps: 5_000n,
        competitorPresent: false,
        oemPriceFils: 6_000n,
        markupBps: 2_000n,
        additionalCostsFils: 1_000n,
        costingApproved: false,
      }),
    /Cannot transition pipeline from Terminal to Draft/,
  );

  expectThrows(
    () =>
      advancePipelineImpl(ctx as never, {
        id: 2n,
        partyId: 1n,
        title: 'Lost deal',
        newStatus: status('Active'),
        estimatedValueFils: 10_000n,
        winProbabilityBps: 5_000n,
        competitorPresent: false,
        oemPriceFils: 6_000n,
        markupBps: 2_000n,
        additionalCostsFils: 1_000n,
        costingApproved: false,
      }),
    /Cannot transition pipeline from Cancelled to Active/,
  );

  expectThrows(
    () =>
      advancePipelineImpl(ctx as never, {
        id: 3n,
        partyId: 1n,
        title: 'Open deal',
        newStatus: status('Active'),
        estimatedValueFils: 10_000n,
        winProbabilityBps: 5_000n,
        competitorPresent: false,
        oemPriceFils: 6_000n,
        markupBps: 2_000n,
        additionalCostsFils: 1_000n,
        costingApproved: false,
        lossReason: 'Should not exist',
      }),
    /lossReason may only be set when transitioning to Cancelled/,
  );

  advancePipelineImpl(ctx as never, {
    id: 3n,
    partyId: 1n,
    title: 'Open deal',
    newStatus: status('Active'),
    estimatedValueFils: 10_000n,
    winProbabilityBps: 5_000n,
    competitorPresent: false,
    oemPriceFils: 6_000n,
    markupBps: 2_000n,
    additionalCostsFils: 1_000n,
    costingApproved: false,
  });

  assert.equal(ctx.db.pipeline.id.find(3n)?.status.tag, 'Active');
  assert.equal(ctx.db.activityLog.rows.at(-1)?.action, 'advance_pipeline');
});

test('resolveAiActionImpl only allows proposed actions to be resolved once', () => {
  const ctx = createContext();
  ctx.db.aiAction.insert({
    id: 1n,
    requestorId: 'user-2',
    skillName: 'generate_delivery_note',
    plan: 'Create a DN',
    status: { tag: 'Proposed' },
    approvedBy: undefined,
    result: '',
    errorMessage: undefined,
    createdAt: ts(1n),
    updatedAt: ts(1n),
  });

  resolveAiActionImpl(ctx as never, {
    actionId: 1n,
    approve: true,
    result: 'Approved',
  });

  expectThrows(
    () =>
      resolveAiActionImpl(ctx as never, {
        actionId: 1n,
        approve: false,
        result: 'Second pass',
      }),
    /Only Proposed actions may be resolved/,
  );
});

test('recordMoneyEventImpl rejects invoicing grade C parties without sufficient advance payment', () => {
  const ctx = createContext();
  insertParty(ctx, { grade: 'C', paymentTermsDays: 0n });

  expectThrows(
    () =>
      recordMoneyEventImpl(ctx as never, {
        partyId: 1n,
        kind: { tag: 'CustomerInvoice' },
        subtotalFils: 1_000n,
        reference: 'INV-C-1',
        dueDate: ts(1n),
      }),
    /Grade C\/D parties require advance payment covering the invoice amount/,
  );
});

test('recordMoneyEventImpl allows invoicing grade C parties when advance covers the gross amount', () => {
  const ctx = createContext();
  insertParty(ctx, { grade: 'C', paymentTermsDays: 0n });
  ctx.db.moneyEvent.insert({
    id: 1n,
    partyId: 1n,
    orderId: undefined,
    deliveryNoteId: undefined,
    kind: { tag: 'CustomerPayment' },
    status: status('Terminal'),
    subtotalFils: 1_100n,
    vatFils: 0n,
    totalFils: 1_100n,
    reference: 'ADV-1',
    dueDate: undefined,
    paidAt: ts(1n),
    createdBy: ctx.sender,
    createdAt: ts(1n),
    updatedAt: ts(1n),
  });

  recordMoneyEventImpl(ctx as never, {
    partyId: 1n,
    kind: { tag: 'CustomerInvoice' },
    subtotalFils: 1_000n,
    reference: 'INV-C-2',
    dueDate: ts(2n),
  });

  assert.equal(ctx.db.moneyEvent.rows.length, 2);
  assert.equal(ctx.db.moneyEvent.id.find(2n)?.totalFils, 1_100n);
});

test('recordMoneyEventImpl rejects invoices for credit-blocked parties', () => {
  const ctx = createContext();
  insertParty(ctx, { isCreditBlocked: true });

  expectThrows(
    () =>
      recordMoneyEventImpl(ctx as never, {
        partyId: 1n,
        kind: { tag: 'CustomerInvoice' },
        subtotalFils: 1_000n,
        reference: 'INV-BLOCK',
        dueDate: ts(2n),
      }),
    /Party is credit-blocked - cannot issue invoice/,
  );
});

test('recordMoneyEventImpl computes VAT for supplier invoices', () => {
  const ctx = createContext();
  insertParty(ctx, { isCustomer: false, isSupplier: true });

  recordMoneyEventImpl(ctx as never, {
    partyId: 1n,
    kind: { tag: 'SupplierInvoice' },
    subtotalFils: 2_000n,
    reference: 'SINV-1',
    dueDate: ts(5n),
  });

  const invoice = ctx.db.moneyEvent.id.find(1n);
  assert.equal(invoice?.vatFils, 200n);
  assert.equal(invoice?.totalFils, 2_200n);
});

test('upsertPartyImpl and upsertContactImpl create activity log rows', () => {
  const ctx = createContext();

  upsertPartyImpl(ctx as never, {
    id: 0n,
    name: 'Logged Party',
    isCustomer: true,
    isSupplier: false,
    grade: { tag: 'B' },
    creditLimitFils: 10_000n,
    paymentTermsDays: 45n,
    productTypes: 'Instrumentation',
    annualGoalFils: 50_000n,
    notes: '',
  });
  upsertContactImpl(ctx as never, {
    id: 0n,
    partyId: 1n,
    name: 'Lana',
    designation: 'Buyer',
    phone: '123',
    email: 'lana@example.com',
    isWhatsApp: true,
  });

  assert.equal(ctx.db.activityLog.rows.length, 2);
  assert.equal(ctx.db.activityLog.rows[0]?.action, 'upsert_party');
  assert.equal(ctx.db.activityLog.rows[1]?.action, 'upsert_contact');
});

let failures = 0;
for (const testCase of cases) {
  const started = Date.now();
  try {
    console.log(`RUN | ${testCase.name}`);
    testCase.fn();
    const duration = Date.now() - started;
    console.log(`PASS | ${testCase.name} | ${duration}ms`);
  } catch (error) {
    failures += 1;
    const duration = Date.now() - started;
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(`FAIL | ${testCase.name} | ${duration}ms`);
    console.error(message);
  }
}

process.exit(failures);
