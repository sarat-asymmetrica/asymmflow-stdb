type TimestampLike = { microsSinceUnixEpoch: bigint };

type GenericCtx = {
  sender: unknown;
  timestamp: TimestampLike;
  db: Record<string, any>;
};

type PartyLike = {
  id: bigint;
  name: string;
  isCustomer: boolean;
  isSupplier: boolean;
  grade: { tag: string };
  creditLimitFils: bigint;
  isCreditBlocked: boolean;
  paymentTermsDays: bigint;
  productTypes: string;
  annualGoalFils: bigint;
  notes: string;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
};

type LineItemLike = {
  id: bigint;
  parentType: string;
  parentId: bigint;
  description: string;
  quantity: bigint;
  unitPriceFils: bigint;
  totalPriceFils: bigint;
  fobCostFils: bigint;
  freightCostFils: bigint;
  customsCostFils: bigint;
  insuranceCostFils: bigint;
  handlingCostFils: bigint;
  financeCostFils: bigint;
  marginBps: number;
  costPerUnitFils: bigint;
};

type MoneyEventKindLike = { tag: string };
type EntityStatusLike = { tag: string };

function getTimestampYear(timestamp: TimestampLike): number {
  return new Date(Number(timestamp.microsSinceUnixEpoch / 1000n)).getUTCFullYear();
}

export function computeLineItemCostPerUnit(
  fobCostFils: bigint,
  freightCostFils: bigint,
  customsCostFils: bigint,
  insuranceCostFils: bigint,
  handlingCostFils: bigint,
  financeCostFils: bigint,
): bigint {
  return fobCostFils + freightCostFils + customsCostFils + insuranceCostFils + handlingCostFils + financeCostFils;
}

function isOrderOpen(status: { tag: string }): boolean {
  return status.tag === 'Active' || status.tag === 'InProgress';
}

function isPurchaseOrderOpen(status: { tag: string }): boolean {
  return status.tag === 'Active' || status.tag === 'InProgress';
}

const ALLOWED_ORDER_TRANSITIONS: Record<string, string[]> = {
  Draft: ['Active', 'Cancelled'],
  Active: ['InProgress', 'Terminal', 'Cancelled'],
  InProgress: ['Terminal', 'Cancelled'],
};

const ALLOWED_PO_TRANSITIONS: Record<string, string[]> = {
  Draft: ['Active', 'Cancelled'],
  Active: ['InProgress', 'Terminal', 'Cancelled'],
  InProgress: ['Terminal', 'Cancelled'],
};

const ALLOWED_PIPELINE_TRANSITIONS: Record<string, string[]> = {
  Draft: ['Active', 'Cancelled'],
  Active: ['InProgress', 'Terminal', 'Cancelled'],
  InProgress: ['Terminal', 'Cancelled'],
};

function computeOfferTotal(oemPriceFils: bigint, markupBps: bigint, additionalCostsFils: bigint): bigint {
  return oemPriceFils + additionalCostsFils + (oemPriceFils * markupBps) / 10000n;
}

export function issueDocNumber(ctx: GenericCtx, docType: string, year: number): string {
  if (year < 2020 || year > 2099) {
    throw new Error(`Year ${year} is out of the supported range 2020-2099`);
  }

  const prefixMap: Record<string, string> = {
    invoice: 'INV',
    quotation: 'QOT',
    statement: 'STM',
    purchase_order: 'PO',
    delivery_note: 'DN',
    grn: 'GRN',
  };

  let found:
    | { id: bigint; docType: string; year: number; lastNumber: number }
    | undefined;

  for (const row of ctx.db.docSequence.iter()) {
    if (row.docType === docType && row.year === year) {
      found = row as { id: bigint; docType: string; year: number; lastNumber: number };
      break;
    }
  }

  let newNumber: number;
  if (!found) {
    newNumber = 1;
    ctx.db.docSequence.insert({
      id: 0n,
      docType,
      year,
      lastNumber: newNumber,
    });
  } else {
    newNumber = found.lastNumber + 1;
    ctx.db.docSequence.id.update({
      ...found,
      lastNumber: newNumber,
    });
  }

  const prefix = prefixMap[docType] ?? docType.toUpperCase();
  return `${prefix}-${year}-${String(newNumber).padStart(3, '0')}`;
}

function sumDeliveredForLineItem(ctx: GenericCtx, lineItemId: bigint): bigint {
  let delivered = 0n;
  for (const item of ctx.db.deliveryNoteItem.iter()) {
    if (item.lineItemId !== lineItemId) continue;
    const note = ctx.db.deliveryNote.id.find(item.deliveryNoteId);
    if (!note || note.status.tag === 'Returned') continue;
    delivered += item.quantityDelivered;
  }
  return delivered;
}

function sumAcceptedForLineItem(ctx: GenericCtx, lineItemId: bigint): bigint {
  let accepted = 0n;
  for (const item of ctx.db.grnItem.iter()) {
    if (item.lineItemId !== lineItemId) continue;
    const grn = ctx.db.goodsReceivedNote.id.find(item.grnId);
    if (!grn || grn.status.tag !== 'Accepted') continue;
    accepted += item.quantityAccepted;
  }
  return accepted;
}

function sumInvoicedForDeliveryNote(ctx: GenericCtx, deliveryNoteId: bigint): bigint {
  let invoiced = 0n;
  for (const evt of ctx.db.moneyEvent.iter()) {
    if (evt.kind.tag !== 'CustomerInvoice') continue;
    if (evt.deliveryNoteId !== deliveryNoteId) continue;
    invoiced += evt.subtotalFils;
  }
  return invoiced;
}

function sumInvoicedForOrder(ctx: GenericCtx, orderId: bigint): bigint {
  let invoiced = 0n;
  for (const evt of ctx.db.moneyEvent.iter()) {
    if (evt.kind.tag !== 'CustomerInvoice') continue;
    if (evt.orderId !== orderId) continue;
    invoiced += evt.subtotalFils;
  }
  return invoiced;
}

function computeDeliveryNoteSubtotal(ctx: GenericCtx, deliveryNoteId: bigint): bigint {
  let subtotal = 0n;
  let foundItems = false;
  for (const item of ctx.db.deliveryNoteItem.iter()) {
    if (item.deliveryNoteId !== deliveryNoteId) continue;
    const lineItem = ctx.db.lineItem.id.find(item.lineItemId) as LineItemLike | undefined;
    if (!lineItem) {
      throw new Error(`Delivery note item #${item.id} references missing line item #${item.lineItemId}`);
    }
    foundItems = true;
    subtotal += item.quantityDelivered * lineItem.unitPriceFils;
  }
  if (!foundItems) {
    throw new Error(`Delivery note #${deliveryNoteId} has no items to invoice`);
  }
  return subtotal;
}

function computeDeliveredSubtotalForOrder(ctx: GenericCtx, orderId: bigint): bigint {
  let subtotal = 0n;
  for (const note of ctx.db.deliveryNote.iter()) {
    if (note.orderId !== orderId || note.status.tag === 'Returned') continue;
    subtotal += computeDeliveryNoteSubtotal(ctx, note.id);
  }
  return subtotal;
}

function refreshOrderStatusFromDeliveries(ctx: GenericCtx, orderId: bigint): void {
  const order = ctx.db.order.id.find(orderId);
  if (!order || order.status.tag === 'Cancelled' || order.status.tag === 'Terminal') return;

  let hasItems = false;
  let allDelivered = true;
  for (const item of ctx.db.lineItem.iter()) {
    if (item.parentType !== 'order' || item.parentId !== orderId) continue;
    hasItems = true;
    if (sumDeliveredForLineItem(ctx, item.id) < item.quantity) {
      allDelivered = false;
      break;
    }
  }

  const newStatus = hasItems && allDelivered ? { tag: 'Terminal' } : { tag: 'InProgress' };
  if (order.status.tag !== newStatus.tag) {
    ctx.db.order.id.update({
      ...order,
      status: newStatus,
      updatedAt: ctx.timestamp,
    });

    ctx.db.activityLog.insert({
      id: 0n,
      actorId: ctx.sender,
      entityType: 'order',
      entityId: order.id,
      action: 'delivery_progress',
      detail: `Order #${order.id} status updated to ${newStatus.tag} from delivery progress`,
      followUpDue: order.expectedDelivery,
      followUpDone: false,
      createdAt: ctx.timestamp,
    });
  }
}

function refreshPurchaseOrderStatusFromReceipts(ctx: GenericCtx, purchaseOrderId: bigint): void {
  const po = ctx.db.purchaseOrder.id.find(purchaseOrderId);
  if (!po || po.status.tag === 'Cancelled' || po.status.tag === 'Terminal') return;

  let hasItems = false;
  let allAccepted = true;
  for (const item of ctx.db.lineItem.iter()) {
    if (item.parentType !== 'purchase_order' || item.parentId !== purchaseOrderId) continue;
    hasItems = true;
    if (sumAcceptedForLineItem(ctx, item.id) < item.quantity) {
      allAccepted = false;
      break;
    }
  }

  const targetStatus = hasItems && allAccepted ? { tag: 'Terminal' } : { tag: 'InProgress' };
  if (po.status.tag !== targetStatus.tag) {
    ctx.db.purchaseOrder.id.update({
      ...po,
      status: targetStatus,
      updatedAt: ctx.timestamp,
    });

    ctx.db.activityLog.insert({
      id: 0n,
      actorId: ctx.sender,
      entityType: 'po',
      entityId: po.id,
      action: 'receipt_progress',
      detail: `PO #${po.id} status updated to ${targetStatus.tag} from GRN acceptance`,
      followUpDue: undefined,
      followUpDone: false,
      createdAt: ctx.timestamp,
    });
  }
}

export function addLineItemImpl(ctx: GenericCtx, args: {
  parentType: string;
  parentId: bigint;
  description: string;
  quantity: bigint;
  unitPriceFils: bigint;
  fobCostFils?: bigint;
  freightCostFils?: bigint;
  customsCostFils?: bigint;
  insuranceCostFils?: bigint;
  handlingCostFils?: bigint;
  financeCostFils?: bigint;
  marginBps?: number;
  costPerUnitFils?: bigint;
}): void {
  if (!args.description || args.description.trim() === '') {
    throw new Error('description is required');
  }
  if (args.quantity <= 0n) {
    throw new Error('quantity must be greater than zero');
  }

  if (args.parentType === 'pipeline') {
    const pipeline = ctx.db.pipeline.id.find(args.parentId);
    if (!pipeline) throw new Error(`Pipeline #${args.parentId} not found`);
  } else if (args.parentType === 'order') {
    const order = ctx.db.order.id.find(args.parentId);
    if (!order) throw new Error(`Order #${args.parentId} not found`);
    if (order.status.tag !== 'Draft') throw new Error(`Order #${args.parentId} is ${order.status.tag} — add line items only while Draft`);
  } else if (args.parentType === 'purchase_order') {
    const po = ctx.db.purchaseOrder.id.find(args.parentId);
    if (!po) throw new Error(`Purchase order #${args.parentId} not found`);
    if (po.status.tag !== 'Draft') throw new Error(`Purchase order #${args.parentId} is ${po.status.tag} — add line items only while Draft`);
  } else if (args.parentType === 'invoice') {
    const invoice = ctx.db.moneyEvent.id.find(args.parentId);
    if (!invoice) throw new Error(`Money event #${args.parentId} not found`);
    if (invoice.kind.tag !== 'CustomerInvoice' && invoice.kind.tag !== 'SupplierInvoice') {
      throw new Error(`Money event #${args.parentId} is ${invoice.kind.tag} — line items only apply to invoices`);
    }
    if (invoice.status.tag !== 'Draft' && invoice.status.tag !== 'Active') {
      throw new Error(`Invoice #${args.parentId} is ${invoice.status.tag} — line items can only be added while Draft or Active`);
    }
  } else {
    throw new Error(`Unsupported parentType "${args.parentType}"`);
  }

  const fobCostFils = args.fobCostFils ?? 0n;
  const freightCostFils = args.freightCostFils ?? 0n;
  const customsCostFils = args.customsCostFils ?? 0n;
  const insuranceCostFils = args.insuranceCostFils ?? 0n;
  const handlingCostFils = args.handlingCostFils ?? 0n;
  const financeCostFils = args.financeCostFils ?? 0n;
  const derivedCostPerUnit = computeLineItemCostPerUnit(
    fobCostFils,
    freightCostFils,
    customsCostFils,
    insuranceCostFils,
    handlingCostFils,
    financeCostFils,
  );
  const costPerUnitFils = args.costPerUnitFils ?? derivedCostPerUnit;
  const totalPriceFils = args.unitPriceFils * args.quantity;
  const totalCostFils = costPerUnitFils * args.quantity;

  const row = ctx.db.lineItem.insert({
    id: 0n,
    parentType: args.parentType,
    parentId: args.parentId,
    description: args.description,
    quantity: args.quantity,
    unitPriceFils: args.unitPriceFils,
    totalPriceFils,
    fobCostFils,
    freightCostFils,
    customsCostFils,
    insuranceCostFils,
    handlingCostFils,
    financeCostFils,
    marginBps: args.marginBps ?? 0,
    costPerUnitFils,
  });

  ctx.db.activityLog.insert({
    id: 0n,
    actorId: ctx.sender,
    entityType: 'line_item',
    entityId: row.id,
    action: 'created',
    detail: `Line item added to ${args.parentType}#${args.parentId} | qty ${args.quantity} | sell ${totalPriceFils} fils | cost ${totalCostFils} fils`,
    followUpDue: undefined,
    followUpDone: false,
    createdAt: ctx.timestamp,
  });
}

export function upsertPartyImpl(ctx: GenericCtx, args: {
  id: bigint;
  name: string;
  isCustomer: boolean;
  isSupplier: boolean;
  grade: { tag: string };
  creditLimitFils: bigint;
  paymentTermsDays: bigint;
  productTypes: string;
  annualGoalFils: bigint;
  notes: string;
}): void {
  let terms = args.paymentTermsDays;
  if (args.isCustomer && terms === 0n) {
    terms = args.grade.tag === 'A' ? 45n : args.grade.tag === 'B' ? 90n : 0n;
  }

  if (args.id === 0n) {
    const party = ctx.db.party.insert({
      id: 0n,
      name: args.name,
      isCustomer: args.isCustomer,
      isSupplier: args.isSupplier,
      grade: args.grade,
      creditLimitFils: args.creditLimitFils,
      isCreditBlocked: false,
      paymentTermsDays: terms,
      productTypes: args.productTypes,
      annualGoalFils: args.annualGoalFils,
      notes: args.notes,
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
    });

    ctx.db.activityLog.insert({
      id: 0n,
      actorId: ctx.sender,
      entityType: 'party',
      entityId: party.id,
      action: 'upsert_party',
      detail: `Created party: ${party.name}`,
      followUpDue: undefined,
      followUpDone: false,
      createdAt: ctx.timestamp,
    });
    return;
  }

  const existing = ctx.db.party.id.find(args.id) as PartyLike | undefined;
  if (!existing) throw new Error(`Party #${args.id} not found`);

  const updated = {
    ...existing,
    ...args,
    paymentTermsDays: terms,
    updatedAt: ctx.timestamp,
  };
  ctx.db.party.id.update(updated);

  ctx.db.activityLog.insert({
    id: 0n,
    actorId: ctx.sender,
    entityType: 'party',
    entityId: updated.id,
    action: 'upsert_party',
    detail: `Updated party: ${updated.name}`,
    followUpDue: undefined,
    followUpDone: false,
    createdAt: ctx.timestamp,
  });
}

export function upsertContactImpl(ctx: GenericCtx, args: {
  id: bigint;
  partyId: bigint;
  name: string;
  designation: string;
  phone: string;
  email: string;
  isWhatsApp: boolean;
}): void {
  if (!ctx.db.party.id.find(args.partyId)) throw new Error(`Party #${args.partyId} not found`);

  if (args.id === 0n) {
    const contact = ctx.db.contact.insert({ ...args, id: 0n });
    ctx.db.activityLog.insert({
      id: 0n,
      actorId: ctx.sender,
      entityType: 'contact',
      entityId: contact.id,
      action: 'upsert_contact',
      detail: `Created contact: ${contact.name}`,
      followUpDue: undefined,
      followUpDone: false,
      createdAt: ctx.timestamp,
    });
    return;
  }

  const existing = ctx.db.contact.id.find(args.id);
  if (!existing) throw new Error(`Contact #${args.id} not found`);
  const updated = { ...existing, ...args };
  ctx.db.contact.id.update(updated);

  ctx.db.activityLog.insert({
    id: 0n,
    actorId: ctx.sender,
    entityType: 'contact',
    entityId: updated.id,
    action: 'upsert_contact',
    detail: `Updated contact: ${updated.name}`,
    followUpDue: undefined,
    followUpDone: false,
    createdAt: ctx.timestamp,
  });
}

export function manageOrderImpl(ctx: GenericCtx, args: {
  id: bigint;
  partyId: bigint;
  pipelineId: bigint;
  newStatus: EntityStatusLike;
  totalFils: bigint;
  poReference: string;
  expectedDelivery?: TimestampLike;
}): void {
  const party = ctx.db.party.id.find(args.partyId);
  if (!party) throw new Error(`Party #${args.partyId} not found`);
  if (!ctx.db.pipeline.id.find(args.pipelineId)) throw new Error(`Pipeline #${args.pipelineId} not found`);

  if (args.id === 0n) {
    if (party.isCreditBlocked) {
      throw new Error('Cannot create order for credit-blocked party');
    }

    const order = ctx.db.order.insert({
      id: 0n,
      partyId: args.partyId,
      pipelineId: args.pipelineId,
      status: args.newStatus,
      totalFils: args.totalFils,
      poReference: args.poReference,
      expectedDelivery: args.expectedDelivery,
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
    });

    ctx.db.activityLog.insert({
      id: 0n,
      actorId: ctx.sender,
      entityType: 'order',
      entityId: order.id,
      action: 'manage_order',
      detail: `Created order #${order.id}`,
      followUpDue: args.expectedDelivery,
      followUpDone: false,
      createdAt: ctx.timestamp,
    });
    return;
  }

  const existing = ctx.db.order.id.find(args.id);
  if (!existing) throw new Error(`Order #${args.id} not found`);

  if (existing.status.tag !== args.newStatus.tag) {
    const allowed = ALLOWED_ORDER_TRANSITIONS[existing.status.tag];
    if (!allowed || !allowed.includes(args.newStatus.tag)) {
      throw new Error(`Cannot transition order from ${existing.status.tag} to ${args.newStatus.tag}`);
    }
  }

  const updated = {
    ...existing,
    status: args.newStatus,
    totalFils: args.totalFils,
    poReference: args.poReference,
    expectedDelivery: args.expectedDelivery ?? existing.expectedDelivery,
    updatedAt: ctx.timestamp,
  };
  ctx.db.order.id.update(updated);

  ctx.db.activityLog.insert({
    id: 0n,
    actorId: ctx.sender,
    entityType: 'order',
    entityId: updated.id,
    action: 'manage_order',
    detail: `Updated order #${updated.id} to ${updated.status.tag}`,
    followUpDue: updated.expectedDelivery,
    followUpDone: false,
    createdAt: ctx.timestamp,
  });
}

export function managePurchaseOrderImpl(ctx: GenericCtx, args: {
  id: bigint;
  partyId: bigint;
  orderId?: bigint;
  deliveryTerms?: string;
  newStatus: EntityStatusLike;
  totalFils: bigint;
}): void {
  const supplier = ctx.db.party.id.find(args.partyId);
  if (!supplier) throw new Error(`Supplier party #${args.partyId} not found`);

  const deliveryTerms = args.deliveryTerms?.trim() || 'CIF Bahrain unless otherwise specified';

  if (args.id === 0n) {
    const poNumber = issueDocNumber(ctx, 'purchase_order', getTimestampYear(ctx.timestamp));
    const purchaseOrder = ctx.db.purchaseOrder.insert({
      id: 0n,
      partyId: args.partyId,
      orderId: args.orderId,
      poNumber,
      deliveryTerms,
      status: args.newStatus,
      totalFils: args.totalFils,
      createdBy: ctx.sender,
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
    });

    ctx.db.activityLog.insert({
      id: 0n,
      actorId: ctx.sender,
      entityType: 'purchase_order',
      entityId: purchaseOrder.id,
      action: 'manage_purchase_order',
      detail: `Created purchase order ${purchaseOrder.poNumber}`,
      followUpDue: undefined,
      followUpDone: false,
      createdAt: ctx.timestamp,
    });
    return;
  }

  const existing = ctx.db.purchaseOrder.id.find(args.id);
  if (!existing) throw new Error(`Purchase order #${args.id} not found`);

  if (existing.status.tag !== args.newStatus.tag) {
    const allowed = ALLOWED_PO_TRANSITIONS[existing.status.tag];
    if (!allowed || !allowed.includes(args.newStatus.tag)) {
      throw new Error(`Cannot transition purchase order from ${existing.status.tag} to ${args.newStatus.tag}`);
    }
  }

  if (existing.status.tag !== 'Draft' && args.totalFils !== existing.totalFils) {
    throw new Error('Cannot update totalFils on a non-Draft purchase order');
  }

  const updated = {
    ...existing,
    deliveryTerms: args.deliveryTerms !== undefined ? deliveryTerms : existing.deliveryTerms,
    status: args.newStatus,
    totalFils: args.totalFils,
    updatedAt: ctx.timestamp,
  };
  ctx.db.purchaseOrder.id.update(updated);

  ctx.db.activityLog.insert({
    id: 0n,
    actorId: ctx.sender,
    entityType: 'purchase_order',
    entityId: updated.id,
    action: 'manage_purchase_order',
    detail: `Updated purchase order ${updated.poNumber} to ${updated.status.tag}`,
    followUpDue: undefined,
    followUpDone: false,
    createdAt: ctx.timestamp,
  });
}

export function advancePipelineImpl(ctx: GenericCtx, args: {
  id: bigint;
  partyId: bigint;
  title: string;
  newStatus: EntityStatusLike;
  estimatedValueFils: bigint;
  winProbabilityBps: bigint;
  competitorPresent: boolean;
  oemPriceFils: bigint;
  markupBps: bigint;
  additionalCostsFils: bigint;
  costingApproved: boolean;
  offerSentAt?: TimestampLike;
  lossReason?: string;
  nextFollowUp?: TimestampLike;
}): void {
  if (!ctx.db.party.id.find(args.partyId)) throw new Error(`Party #${args.partyId} not found`);

  const trimmedLossReason = args.lossReason?.trim();
  const nextLossReason = trimmedLossReason === '' ? undefined : trimmedLossReason;
  const offerTotalFils = computeOfferTotal(args.oemPriceFils, args.markupBps, args.additionalCostsFils);

  if (args.id === 0n) {
    if (args.newStatus.tag !== 'Draft') throw new Error('New pipelines must start with status Draft');
    if (nextLossReason !== undefined) throw new Error('lossReason may only be set when transitioning to Cancelled');

    const pipeline = ctx.db.pipeline.insert({
      id: 0n,
      partyId: args.partyId,
      ownerId: ctx.sender,
      title: args.title,
      status: args.newStatus,
      estimatedValueFils: args.estimatedValueFils,
      winProbabilityBps: args.winProbabilityBps,
      competitorPresent: args.competitorPresent,
      oemPriceFils: args.oemPriceFils,
      markupBps: args.markupBps,
      additionalCostsFils: args.additionalCostsFils,
      costingApproved: args.costingApproved,
      costingApprovedBy: args.costingApproved ? ctx.sender : undefined,
      offerTotalFils,
      offerSentAt: args.offerSentAt,
      lossReason: undefined,
      nextFollowUp: args.nextFollowUp,
      revision: 1n,
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
    });

    ctx.db.activityLog.insert({
      id: 0n,
      actorId: ctx.sender,
      entityType: 'pipeline',
      entityId: pipeline.id,
      action: 'advance_pipeline',
      detail: `Created pipeline #${pipeline.id} in ${pipeline.status.tag}`,
      followUpDue: pipeline.nextFollowUp,
      followUpDone: false,
      createdAt: ctx.timestamp,
    });
    return;
  }

  const existing = ctx.db.pipeline.id.find(args.id);
  if (!existing) throw new Error(`Pipeline #${args.id} not found`);

  if (existing.status.tag !== args.newStatus.tag) {
    const allowed = ALLOWED_PIPELINE_TRANSITIONS[existing.status.tag];
    if (!allowed || !allowed.includes(args.newStatus.tag)) {
      throw new Error(`Cannot transition pipeline from ${existing.status.tag} to ${args.newStatus.tag}`);
    }
  }

  if (args.newStatus.tag === 'Cancelled' && !nextLossReason) {
    throw new Error('lossReason is required when transitioning pipeline to Cancelled');
  }
  if (args.newStatus.tag !== 'Cancelled' && nextLossReason !== undefined) {
    throw new Error('lossReason may only be set when transitioning to Cancelled');
  }

  const updated = {
    ...existing,
    partyId: args.partyId,
    title: args.title,
    status: args.newStatus,
    estimatedValueFils: args.estimatedValueFils,
    winProbabilityBps: args.winProbabilityBps,
    competitorPresent: args.competitorPresent,
    oemPriceFils: args.oemPriceFils,
    markupBps: args.markupBps,
    additionalCostsFils: args.additionalCostsFils,
    costingApproved: args.costingApproved,
    costingApprovedBy: args.costingApproved ? (existing.costingApproved ? existing.costingApprovedBy : ctx.sender) : existing.costingApprovedBy,
    offerTotalFils,
    offerSentAt: args.offerSentAt ?? existing.offerSentAt,
    lossReason: args.newStatus.tag === 'Cancelled' ? nextLossReason : undefined,
    nextFollowUp: args.nextFollowUp ?? existing.nextFollowUp,
    revision: existing.revision + 1n,
    updatedAt: ctx.timestamp,
  };
  ctx.db.pipeline.id.update(updated);

  ctx.db.activityLog.insert({
    id: 0n,
    actorId: ctx.sender,
    entityType: 'pipeline',
    entityId: updated.id,
    action: 'advance_pipeline',
    detail: `Updated pipeline #${updated.id} to ${updated.status.tag}`,
    followUpDue: updated.nextFollowUp,
    followUpDone: false,
    createdAt: ctx.timestamp,
  });
}

export function createDeliveryNoteImpl(ctx: GenericCtx, args: {
  orderId: bigint;
  partyId: bigint;
  deliveryAddress: string;
  driverName: string;
  vehicleNumber: string;
}): void {
  const order = ctx.db.order.id.find(args.orderId);
  if (!order) throw new Error(`Order #${args.orderId} not found`);
  if (!isOrderOpen(order.status)) {
    throw new Error(`Order #${args.orderId} is ${order.status.tag} — delivery notes require Active or InProgress orders`);
  }
  if (order.partyId !== args.partyId) {
    throw new Error(`Order #${args.orderId} belongs to party #${order.partyId}, not party #${args.partyId}`);
  }

  const party = ctx.db.party.id.find(args.partyId);
  if (!party) throw new Error(`Party #${args.partyId} not found`);

  const dnNumber = issueDocNumber(ctx, 'delivery_note', getTimestampYear(ctx.timestamp));
  const row = ctx.db.deliveryNote.insert({
    id: 0n,
    orderId: args.orderId,
    partyId: args.partyId,
    dnNumber,
    status: { tag: 'Draft' },
    deliveryDate: ctx.timestamp,
    deliveryAddress: args.deliveryAddress,
    driverName: args.driverName,
    vehicleNumber: args.vehicleNumber,
    receiverName: '',
    notes: '',
    createdBy: ctx.sender,
    createdAt: ctx.timestamp,
    updatedAt: ctx.timestamp,
  });

  ctx.db.activityLog.insert({
    id: 0n,
    actorId: ctx.sender,
    entityType: 'delivery_note',
    entityId: row.id,
    action: 'created',
    detail: `Delivery note ${dnNumber} created for order #${args.orderId} (${party.name})`,
    followUpDue: order.expectedDelivery,
    followUpDone: false,
    createdAt: ctx.timestamp,
  });
}

export function advanceDeliveryNoteImpl(ctx: GenericCtx, args: {
  id: bigint;
  newStatus: { tag: string };
  receiverName?: string;
  notes?: string;
}): void {
  const note = ctx.db.deliveryNote.id.find(args.id);
  if (!note) throw new Error(`Delivery note #${args.id} not found`);

  const from = note.status.tag;
  const to = args.newStatus.tag;
  const allowed = from === 'Draft'
    ? ['Dispatched', 'Returned']
    : from === 'Dispatched'
      ? ['Delivered', 'Returned']
      : [];

  if (from !== to && !allowed.includes(to)) {
    throw new Error(`Invalid delivery note transition: ${from} -> ${to}. Allowed: ${allowed.join(', ') || 'none'}`);
  }

  if (to === 'Delivered' && (!args.receiverName || args.receiverName.trim() === '')) {
    throw new Error('receiverName is required when marking a delivery note as Delivered');
  }

  ctx.db.deliveryNote.id.update({
    ...note,
    status: args.newStatus,
    receiverName: to === 'Delivered' ? (args.receiverName ?? note.receiverName) : note.receiverName,
    notes: args.notes ?? note.notes,
    updatedAt: ctx.timestamp,
  });

  ctx.db.activityLog.insert({
    id: 0n,
    actorId: ctx.sender,
    entityType: 'delivery_note',
    entityId: note.id,
    action: `status:${from}->${to}`,
    detail: `Delivery note ${note.dnNumber} moved ${from} -> ${to}${args.receiverName ? ` | receiver: ${args.receiverName}` : ''}`,
    followUpDue: undefined,
    followUpDone: false,
    createdAt: ctx.timestamp,
  });

  if (to === 'Dispatched' || to === 'Delivered' || to === 'Returned') {
    refreshOrderStatusFromDeliveries(ctx, note.orderId);
  }
}

export function addDeliveryNoteItemImpl(ctx: GenericCtx, args: {
  deliveryNoteId: bigint;
  lineItemId: bigint;
  quantityDelivered: bigint;
  notes: string;
}): void {
  const note = ctx.db.deliveryNote.id.find(args.deliveryNoteId);
  if (!note) throw new Error(`Delivery note #${args.deliveryNoteId} not found`);
  if (note.status.tag !== 'Draft') throw new Error(`Delivery note #${args.deliveryNoteId} is ${note.status.tag} — items may only be added while Draft`);

  const lineItem = ctx.db.lineItem.id.find(args.lineItemId);
  if (!lineItem) throw new Error(`Line item #${args.lineItemId} not found`);
  if (lineItem.parentType !== 'order' || lineItem.parentId !== note.orderId) {
    throw new Error(`Line item #${args.lineItemId} does not belong to order #${note.orderId}`);
  }
  if (args.quantityDelivered <= 0n) {
    throw new Error('quantityDelivered must be greater than zero');
  }

  for (const item of ctx.db.deliveryNoteItem.iter()) {
    if (item.deliveryNoteId === args.deliveryNoteId && item.lineItemId === args.lineItemId) {
      throw new Error(`Line item #${args.lineItemId} is already attached to delivery note #${args.deliveryNoteId}`);
    }
  }

  const deliveredSoFar = sumDeliveredForLineItem(ctx, args.lineItemId);
  const remaining = lineItem.quantity > deliveredSoFar ? lineItem.quantity - deliveredSoFar : 0n;
  if (args.quantityDelivered > remaining) {
    throw new Error(`Cannot deliver ${args.quantityDelivered} units from line item #${args.lineItemId}; only ${remaining} remain`);
  }

  const row = ctx.db.deliveryNoteItem.insert({
    id: 0n,
    deliveryNoteId: args.deliveryNoteId,
    lineItemId: args.lineItemId,
    quantityDelivered: args.quantityDelivered,
    notes: args.notes,
  });

  ctx.db.activityLog.insert({
    id: 0n,
    actorId: ctx.sender,
    entityType: 'delivery_note',
    entityId: note.id,
    action: 'item_added',
    detail: `Delivery note item #${row.id} added from order line #${args.lineItemId} | qty ${args.quantityDelivered}`,
    followUpDue: undefined,
    followUpDone: false,
    createdAt: ctx.timestamp,
  });
}

export function createGrnImpl(ctx: GenericCtx, args: {
  purchaseOrderId: bigint;
  receivedDate: TimestampLike;
  inspectionNotes: string;
}): void {
  const po = ctx.db.purchaseOrder.id.find(args.purchaseOrderId);
  if (!po) throw new Error(`Purchase order #${args.purchaseOrderId} not found`);
  if (!isPurchaseOrderOpen(po.status)) {
    throw new Error(`Purchase order #${args.purchaseOrderId} is ${po.status.tag} — GRNs require Active or InProgress POs`);
  }

  const grnNumber = issueDocNumber(ctx, 'grn', getTimestampYear(ctx.timestamp));
  const row = ctx.db.goodsReceivedNote.insert({
    id: 0n,
    purchaseOrderId: args.purchaseOrderId,
    grnNumber,
    status: { tag: 'Draft' },
    receivedDate: args.receivedDate,
    receivedBy: ctx.sender,
    inspectionNotes: args.inspectionNotes,
    createdAt: ctx.timestamp,
  });

  ctx.db.activityLog.insert({
    id: 0n,
    actorId: ctx.sender,
    entityType: 'grn',
    entityId: row.id,
    action: 'created',
    detail: `GRN ${grnNumber} created for purchase order #${args.purchaseOrderId}`,
    followUpDue: undefined,
    followUpDone: false,
    createdAt: ctx.timestamp,
  });
}

export function advanceGrnImpl(ctx: GenericCtx, args: {
  id: bigint;
  newStatus: { tag: string };
  inspectionNotes?: string;
}): void {
  const grn = ctx.db.goodsReceivedNote.id.find(args.id);
  if (!grn) throw new Error(`GRN #${args.id} not found`);

  const from = grn.status.tag;
  const to = args.newStatus.tag;
  const allowed = from === 'Draft'
    ? ['Inspecting']
    : from === 'Inspecting'
      ? ['Accepted', 'Rejected']
      : [];

  if (from !== to && !allowed.includes(to)) {
    throw new Error(`Invalid GRN transition: ${from} -> ${to}. Allowed: ${allowed.join(', ') || 'none'}`);
  }

  ctx.db.goodsReceivedNote.id.update({
    ...grn,
    status: args.newStatus,
    inspectionNotes: args.inspectionNotes ?? grn.inspectionNotes,
  });

  ctx.db.activityLog.insert({
    id: 0n,
    actorId: ctx.sender,
    entityType: 'grn',
    entityId: grn.id,
    action: `status:${from}->${to}`,
    detail: `GRN ${grn.grnNumber} moved ${from} -> ${to}`,
    followUpDue: undefined,
    followUpDone: false,
    createdAt: ctx.timestamp,
  });

  if (to === 'Accepted') {
    refreshPurchaseOrderStatusFromReceipts(ctx, grn.purchaseOrderId);
  }
}

export function addGrnItemImpl(ctx: GenericCtx, args: {
  grnId: bigint;
  lineItemId: bigint;
  quantityReceived: bigint;
  quantityAccepted: bigint;
  notes: string;
}): void {
  const grn = ctx.db.goodsReceivedNote.id.find(args.grnId);
  if (!grn) throw new Error(`GRN #${args.grnId} not found`);
  if (grn.status.tag !== 'Draft' && grn.status.tag !== 'Inspecting') {
    throw new Error(`GRN #${args.grnId} is ${grn.status.tag} — items may only be added while Draft or Inspecting`);
  }

  const lineItem = ctx.db.lineItem.id.find(args.lineItemId);
  if (!lineItem) throw new Error(`Line item #${args.lineItemId} not found`);
  if (lineItem.parentType !== 'purchase_order' || lineItem.parentId !== grn.purchaseOrderId) {
    throw new Error(`Line item #${args.lineItemId} does not belong to purchase order #${grn.purchaseOrderId}`);
  }
  if (args.quantityReceived <= 0n) {
    throw new Error('quantityReceived must be greater than zero');
  }
  if (args.quantityAccepted > args.quantityReceived) {
    throw new Error('quantityAccepted cannot exceed quantityReceived');
  }

  const acceptedSoFar = sumAcceptedForLineItem(ctx, args.lineItemId);
  const remaining = lineItem.quantity > acceptedSoFar ? lineItem.quantity - acceptedSoFar : 0n;
  if (args.quantityReceived > remaining) {
    throw new Error(`Cannot receive ${args.quantityReceived} units from line item #${args.lineItemId}; only ${remaining} remain`);
  }

  const row = ctx.db.grnItem.insert({
    id: 0n,
    grnId: args.grnId,
    lineItemId: args.lineItemId,
    quantityReceived: args.quantityReceived,
    quantityAccepted: args.quantityAccepted,
    notes: args.notes,
  });

  ctx.db.activityLog.insert({
    id: 0n,
    actorId: ctx.sender,
    entityType: 'grn',
    entityId: grn.id,
    action: 'item_added',
    detail: `GRN item #${row.id} added from PO line #${args.lineItemId} | received ${args.quantityReceived} | accepted ${args.quantityAccepted}`,
    followUpDue: undefined,
    followUpDone: false,
    createdAt: ctx.timestamp,
  });
}

export function convertPipelineToOrderImpl(ctx: GenericCtx, args: {
  pipelineId: bigint;
  poReference: string;
  expectedDelivery?: TimestampLike;
}): void {
  const pipeline = ctx.db.pipeline.id.find(args.pipelineId);
  if (!pipeline) throw new Error(`Pipeline #${args.pipelineId} not found`);
  if (pipeline.status.tag !== 'Terminal') {
    throw new Error(`Pipeline #${args.pipelineId} is ${pipeline.status.tag} — only Terminal (won) pipelines may convert to orders`);
  }
  if (!args.poReference || args.poReference.trim() === '') {
    throw new Error('poReference is required when converting a pipeline to an order');
  }

  // NOTE: Full table scan — acceptable for PH Trading scale (~500 orders).
  // Add btree index on pipelineId if scale grows.
  for (const existing of ctx.db.order.iter()) {
    if (existing.pipelineId === args.pipelineId) {
      throw new Error(`Pipeline #${args.pipelineId} is already linked to order #${existing.id}`);
    }
  }

  const order = ctx.db.order.insert({
    id: 0n,
    partyId: pipeline.partyId,
    pipelineId: pipeline.id,
    status: { tag: 'Draft' },
    totalFils: pipeline.offerTotalFils,
    poReference: args.poReference,
    expectedDelivery: args.expectedDelivery,
    createdAt: ctx.timestamp,
    updatedAt: ctx.timestamp,
  });

  const pipelineItems = Array.from(ctx.db.lineItem.iter() as Iterable<LineItemLike>).filter(
    item => item.parentType === 'pipeline' && item.parentId === pipeline.id,
  );
  let copiedCount = 0n;
  for (const item of pipelineItems) {
    ctx.db.lineItem.insert({
      id: 0n,
      parentType: 'order',
      parentId: order.id,
      description: item.description,
      quantity: item.quantity,
      unitPriceFils: item.unitPriceFils,
      totalPriceFils: item.totalPriceFils,
      fobCostFils: item.fobCostFils,
      freightCostFils: item.freightCostFils,
      customsCostFils: item.customsCostFils,
      insuranceCostFils: item.insuranceCostFils,
      handlingCostFils: item.handlingCostFils,
      financeCostFils: item.financeCostFils,
      marginBps: item.marginBps,
      costPerUnitFils: item.costPerUnitFils,
    });
    copiedCount += 1n;
  }

  ctx.db.activityLog.insert({
    id: 0n,
    actorId: ctx.sender,
    entityType: 'order',
    entityId: order.id,
    action: 'converted_from_pipeline',
    detail: `Order #${order.id} created from pipeline #${pipeline.id} with ${copiedCount} copied line items`,
    followUpDue: args.expectedDelivery,
    followUpDone: false,
    createdAt: ctx.timestamp,
  });
}

export function resolveAiActionImpl(ctx: GenericCtx, args: {
  actionId: bigint;
  approve: boolean;
  result: string;
}): void {
  const action = ctx.db.aiAction.id.find(args.actionId);
  if (!action) throw new Error(`AI action #${args.actionId} not found`);
  if (action.status.tag !== 'Proposed') {
    throw new Error('Only Proposed actions may be resolved');
  }

  ctx.db.aiAction.id.update({
    ...action,
    status: args.approve ? ({ tag: 'Approved' } as EntityStatusLike) : ({ tag: 'Rejected' } as EntityStatusLike),
    approvedBy: args.approve ? ctx.sender : undefined,
    result: args.result,
    updatedAt: ctx.timestamp,
  });
}

export function recordMoneyEventImpl(ctx: GenericCtx, args: {
  partyId: bigint;
  orderId?: bigint;
  deliveryNoteId?: bigint;
  kind: MoneyEventKindLike;
  subtotalFils: bigint;
  reference: string;
  dueDate?: TimestampLike;
}): void {
  const party = ctx.db.party.id.find(args.partyId);
  if (!party) throw new Error(`Party #${args.partyId} not found`);

  if (args.kind.tag === 'CustomerInvoice') {
    let orderId = args.orderId;
    let subtotalFils = args.subtotalFils;
    const vatFils = (subtotalFils * 10n) / 100n;
    const grossInvoiceFils = subtotalFils + vatFils;

    if (party.isCreditBlocked) {
      throw new Error('Party is credit-blocked - cannot issue invoice');
    }

    if (party.grade?.tag === 'C' || party.grade?.tag === 'D') {
      let invoiced = 0n;
      let paid = 0n;
      for (const evt of ctx.db.moneyEvent.iter()) {
        if (evt.partyId !== args.partyId) continue;
        if (evt.kind.tag === 'CustomerInvoice') invoiced += evt.totalFils;
        else if (evt.kind.tag === 'CustomerPayment') paid += evt.totalFils;
      }

      const advanceBalance = paid > invoiced ? paid - invoiced : 0n;
      if (advanceBalance < grossInvoiceFils) {
        throw new Error('Grade C/D parties require advance payment covering the invoice amount');
      }
    }

    if (args.deliveryNoteId !== undefined) {
      const note = ctx.db.deliveryNote.id.find(args.deliveryNoteId);
      if (!note) throw new Error(`Delivery note #${args.deliveryNoteId} not found`);
      if (note.partyId !== args.partyId) {
        throw new Error(`Delivery note #${args.deliveryNoteId} belongs to party #${note.partyId}, not party #${args.partyId}`);
      }
      if (note.status.tag !== 'Delivered') {
        throw new Error(`Delivery note #${args.deliveryNoteId} is ${note.status.tag} - only Delivered notes may be invoiced`);
      }

      orderId = note.orderId;
      if (args.orderId !== undefined && args.orderId !== note.orderId) {
        throw new Error(`Delivery note #${args.deliveryNoteId} belongs to order #${note.orderId}, not order #${args.orderId}`);
      }

      const deliverySubtotal = computeDeliveryNoteSubtotal(ctx, note.id);
      const previouslyInvoiced = sumInvoicedForDeliveryNote(ctx, note.id);
      const remainingSubtotal = deliverySubtotal > previouslyInvoiced ? deliverySubtotal - previouslyInvoiced : 0n;
      if (remainingSubtotal <= 0n) {
        throw new Error(`Delivery note #${note.id} is already fully invoiced`);
      }
      if (subtotalFils !== remainingSubtotal) {
        throw new Error(`Invoice subtotal must equal delivered subtotal remaining for delivery note #${note.id}: expected ${remainingSubtotal}, got ${subtotalFils}`);
      }
    }

    if (orderId !== undefined) {
      const order = ctx.db.order.id.find(orderId);
      if (!order) throw new Error(`Order #${orderId} not found`);
      if (order.partyId !== args.partyId) {
        throw new Error(`Order #${orderId} belongs to party #${order.partyId}, not party #${args.partyId}`);
      }

      const deliveredSubtotal = computeDeliveredSubtotalForOrder(ctx, orderId);
      const previouslyInvoiced = sumInvoicedForOrder(ctx, orderId);
      const remainingSubtotal = deliveredSubtotal > previouslyInvoiced ? deliveredSubtotal - previouslyInvoiced : 0n;
      if (remainingSubtotal <= 0n) {
        throw new Error(`Order #${orderId} has no delivered subtotal remaining to invoice`);
      }
      if (subtotalFils > remainingSubtotal) {
        throw new Error(`Invoice subtotal ${subtotalFils} exceeds delivered subtotal remaining for order #${orderId}: ${remainingSubtotal}`);
      }
    }

    const row = ctx.db.moneyEvent.insert({
      id: 0n,
      partyId: args.partyId,
      orderId,
      deliveryNoteId: args.deliveryNoteId,
      kind: args.kind,
      status: { tag: 'Active' } as EntityStatusLike,
      subtotalFils,
      vatFils,
      totalFils: subtotalFils + vatFils,
      reference: args.reference,
      dueDate: args.dueDate,
      paidAt: undefined,
      createdBy: ctx.sender,
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
    });

    if (args.deliveryNoteId !== undefined) {
      for (const item of ctx.db.deliveryNoteItem.iter()) {
        if (item.deliveryNoteId !== args.deliveryNoteId) continue;
        const source = ctx.db.lineItem.id.find(item.lineItemId) as LineItemLike | undefined;
        if (!source) {
          throw new Error(`Delivery note item #${item.id} references missing line item #${item.lineItemId}`);
        }
        ctx.db.lineItem.insert({
          id: 0n,
          parentType: 'invoice',
          parentId: row.id,
          description: source.description,
          quantity: item.quantityDelivered,
          unitPriceFils: source.unitPriceFils,
          totalPriceFils: item.quantityDelivered * source.unitPriceFils,
          fobCostFils: source.fobCostFils,
          freightCostFils: source.freightCostFils,
          customsCostFils: source.customsCostFils,
          insuranceCostFils: source.insuranceCostFils,
          handlingCostFils: source.handlingCostFils,
          financeCostFils: source.financeCostFils,
          marginBps: source.marginBps,
          costPerUnitFils: source.costPerUnitFils,
        });
      }
    }

    ctx.db.activityLog.insert({
      id: 0n,
      actorId: ctx.sender,
      entityType: 'invoice',
      entityId: row.id,
      action: 'CustomerInvoice',
      detail: args.deliveryNoteId !== undefined
        ? `Invoice #${row.id} created from delivery note #${args.deliveryNoteId}`
        : `Invoice #${row.id}`,
      followUpDue: args.dueDate,
      followUpDone: false,
      createdAt: ctx.timestamp,
    });
    return;
  }

  if (args.kind.tag === 'CustomerPayment') {
    let invoiced = 0n;
    let paid = 0n;
    for (const evt of ctx.db.moneyEvent.iter()) {
      if (evt.partyId !== args.partyId) continue;
      if (evt.kind.tag === 'CustomerInvoice') invoiced += evt.totalFils;
      else if (evt.kind.tag === 'CustomerPayment') paid += evt.totalFils;
    }
    const outstanding = invoiced > paid ? invoiced - paid : 0n;
    if (args.subtotalFils > outstanding) throw new Error('Payment exceeds outstanding balance');

    const row = ctx.db.moneyEvent.insert({
      id: 0n,
      partyId: args.partyId,
      orderId: args.orderId,
      deliveryNoteId: args.deliveryNoteId,
      kind: args.kind,
      status: { tag: 'Terminal' } as EntityStatusLike,
      subtotalFils: args.subtotalFils,
      vatFils: 0n,
      totalFils: args.subtotalFils,
      reference: args.reference,
      dueDate: undefined,
      paidAt: ctx.timestamp,
      createdBy: ctx.sender,
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
    });

    ctx.db.activityLog.insert({
      id: 0n,
      actorId: ctx.sender,
      entityType: 'invoice',
      entityId: row.id,
      action: 'CustomerPayment',
      detail: `Payment #${row.id}`,
      followUpDue: undefined,
      followUpDone: false,
      createdAt: ctx.timestamp,
    });
    return;
  }

  const row = ctx.db.moneyEvent.insert({
    id: 0n,
    partyId: args.partyId,
    orderId: args.orderId,
    deliveryNoteId: args.deliveryNoteId,
    kind: args.kind,
    status: args.kind.tag === 'SupplierInvoice'
      ? ({ tag: 'Active' } as EntityStatusLike)
      : ({ tag: 'Terminal' } as EntityStatusLike),
    subtotalFils: args.subtotalFils,
    vatFils: args.kind.tag === 'SupplierInvoice' ? (args.subtotalFils * 10n) / 100n : 0n,
    totalFils: args.kind.tag === 'SupplierInvoice' ? args.subtotalFils + ((args.subtotalFils * 10n) / 100n) : args.subtotalFils,
    reference: args.reference,
    dueDate: args.kind.tag === 'SupplierInvoice' ? args.dueDate : undefined,
    paidAt: args.kind.tag === 'SupplierPayment' ? ctx.timestamp : undefined,
    createdBy: ctx.sender,
    createdAt: ctx.timestamp,
    updatedAt: ctx.timestamp,
  });

  ctx.db.activityLog.insert({
    id: 0n,
    actorId: ctx.sender,
    entityType: 'invoice',
    entityId: row.id,
    action: args.kind.tag,
    detail: `${args.kind.tag} #${row.id}`,
    followUpDue: args.dueDate,
    followUpDone: false,
    createdAt: ctx.timestamp,
  });
}
