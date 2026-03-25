/**
 * AsymmFlow Skills — Document Executor
 *
 * Handles all document-generation skill cases:
 *   - generate_delivery_note
 *   - generate_purchase_order
 *   - chase_payment
 *   - generate_statement
 *   - generate_quotation
 *   - generate_email_draft   (new)
 *   - generate_cover_letter  (new)
 *   - generate_technical_submittal (new)
 *
 * Returns null for any skill name not handled here, allowing the caller to
 * fall through to other routers.
 */

import type { SkillResult } from './types';
import { get } from 'svelte/store';
import {
  parties,
  moneyEvents,
  pipelines,
  lineItems,
  orders,
  deliveryNotes,
  purchaseOrders,
  getConnection,
} from '../db';
import type { Party, MoneyEvent } from '../db';
import { Timestamp } from 'spacetimedb';
import { formatBHD } from '../format';
import { generateStatementPdf } from '../documents/statementGenerator';
import {
  generateQuotationPdf,
  getNextQuotationNumber,
  type QuotationItem,
} from '../documents/quotationGenerator';
import {
  generateChaseMessage,
  determineTone,
  type ChaseData,
} from '../documents/chaseGenerator';
import { buildDeliveryNoteSkillRequest } from './deliveryNoteSkill';
import { buildPurchaseOrderSkillRequest } from './purchaseOrderSkill';
import {
  generateEmailDraft,
  type EmailVariant,
} from '../documents/emailDraftGenerator';
import { generateCoverLetterPdf, type CoverLetterItem } from '../documents/coverLetterGenerator';
import { generateTechnicalSubmittalPdf, type SubmittalDocument } from '../documents/technicalSubmittalGenerator';

// ── Internal helpers ──────────────────────────────────────────────────────────

function isCustomerInvoice(ev: MoneyEvent): boolean {
  return (ev.kind as any)?.tag === 'CustomerInvoice';
}

function isCustomerPayment(ev: MoneyEvent): boolean {
  return (ev.kind as any)?.tag === 'CustomerPayment';
}

function outstandingFils(partyId: bigint, events: MoneyEvent[]): bigint {
  let invoiced = 0n;
  let paid = 0n;
  for (const ev of events) {
    if (ev.partyId !== partyId) continue;
    if (isCustomerInvoice(ev)) invoiced += ev.totalFils;
    if (isCustomerPayment(ev)) paid += ev.totalFils;
  }
  return invoiced > paid ? invoiced - paid : 0n;
}

function isOverdue(partyId: bigint, events: MoneyEvent[], nowMs: number): boolean {
  return events.some(
    (ev) =>
      ev.partyId === partyId &&
      isCustomerInvoice(ev) &&
      ev.dueDate &&
      Number(ev.dueDate.microsSinceUnixEpoch / 1000n) < nowMs
  );
}

function maxOverdueDays(partyId: bigint, events: MoneyEvent[], nowMs: number): number {
  let maxDays = 0;
  for (const ev of events) {
    if (ev.partyId !== partyId || !isCustomerInvoice(ev) || !ev.dueDate) continue;
    const dueMs = Number(ev.dueDate.microsSinceUnixEpoch / 1000n);
    if (dueMs >= nowMs) continue;
    const days = Math.floor((nowMs - dueMs) / 86_400_000);
    if (days > maxDays) maxDays = days;
  }
  return maxDays;
}

function gradeTag(party: Party): string {
  return (party.grade as any)?.tag ?? 'C';
}

async function waitForNewDeliveryNoteId(previousIds: Set<bigint>, timeoutMs = 4000): Promise<bigint> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const next = get(deliveryNotes).find((row) => !previousIds.has(row.id));
    if (next) return next.id;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for delivery note sync');
}

async function waitForNewPurchaseOrderId(previousIds: Set<bigint>, timeoutMs = 4000): Promise<bigint> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const next = get(purchaseOrders).find((row) => !previousIds.has(row.id));
    if (next) return next.id;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for purchase order sync');
}

// ── Existing handlers (moved from executor.ts) ────────────────────────────────

async function handleGenerateDeliveryNote(
  params: Record<string, unknown>
): Promise<SkillResult> {
  const conn = getConnection();
  if (!conn) {
    return { success: false, summary: 'Not connected to database.', error: 'no_connection' };
  }

  if (params.orderId == null) {
    return { success: false, summary: 'orderId is required.', error: 'missing_param' };
  }

  const numericOrderId = Number(params.orderId);
  if (!Number.isInteger(numericOrderId) || numericOrderId <= 0) {
    return { success: false, summary: 'orderId must be a positive integer.', error: 'invalid_param' };
  }

  const orderId = BigInt(numericOrderId);
  const order = get(orders).find((row) => row.id === orderId);
  if (!order) {
    return { success: false, summary: `Order #${orderId} not found.`, error: 'not_found' };
  }

  const party = get(parties).find((row) => row.id === order.partyId);
  if (!party) {
    return { success: false, summary: `Customer for order #${orderId} not found.`, error: 'not_found' };
  }

  const orderLineItems = get(lineItems).filter(
    (item) => item.parentType === 'order' && item.parentId === order.id
  );

  let request;
  try {
    request = buildDeliveryNoteSkillRequest(params, order, orderLineItems);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, summary: `Cannot generate delivery note: ${message}`, error: message };
  }

  try {
    const existingIds = new Set(get(deliveryNotes).map((row) => row.id));
    conn.reducers.createDeliveryNote({
      orderId: request.orderId,
      partyId: order.partyId,
      deliveryAddress: request.deliveryAddress,
      driverName: request.driverName,
      vehicleNumber: request.vehicleNumber,
    });

    const deliveryNoteId = await waitForNewDeliveryNoteId(existingIds);
    for (const item of request.items) {
      conn.reducers.addDeliveryNoteItem({
        deliveryNoteId,
        lineItemId: item.lineItemId,
        quantityDelivered: item.quantityDelivered,
        notes: item.notes,
      });
    }

    const note = get(deliveryNotes).find((row) => row.id === deliveryNoteId);
    return {
      success: true,
      summary:
        `Delivery note ${note?.dnNumber ?? `#${deliveryNoteId}`} created for ${party.name} ` +
        `with ${request.items.length} line item${request.items.length !== 1 ? 's' : ''}.`,
      data: {
        deliveryNoteId: String(deliveryNoteId),
        dnNumber: note?.dnNumber ?? '',
        orderId: String(order.id),
        partyId: String(party.id),
        partyName: party.name,
        itemCount: request.items.length,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, summary: `Failed to generate delivery note: ${message}`, error: message };
  }
}

async function handleGeneratePurchaseOrder(
  params: Record<string, unknown>
): Promise<SkillResult> {
  const conn = getConnection();
  if (!conn) {
    return { success: false, summary: 'Not connected to database.', error: 'no_connection' };
  }

  let request;
  try {
    request = buildPurchaseOrderSkillRequest(params);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, summary: `Cannot generate purchase order: ${message}`, error: message };
  }

  const supplier = get(parties).find((row) => row.id === request.supplierId);
  if (!supplier || !supplier.isSupplier) {
    return { success: false, summary: `Supplier #${request.supplierId} not found.`, error: 'not_found' };
  }

  if (request.orderId !== undefined) {
    const linkedOrder = get(orders).find((row) => row.id === request.orderId);
    if (!linkedOrder) {
      return { success: false, summary: `Linked order #${request.orderId} not found.`, error: 'not_found' };
    }
  }

  try {
    const existingIds = new Set(get(purchaseOrders).map((row) => row.id));
    conn.reducers.managePurchaseOrder({
      id: 0n,
      partyId: request.supplierId,
      orderId: request.orderId,
      deliveryTerms: request.deliveryTerms,
      source: request.orderId !== undefined ? 'native' : 'document_skill',
      newStatus: { tag: 'Draft' } as any,
      totalFils: request.totalFils,
    });

    const purchaseOrderId = await waitForNewPurchaseOrderId(existingIds);
    for (const item of request.items) {
      conn.reducers.addLineItem({
        parentType: 'purchase_order',
        parentId: purchaseOrderId,
        description: item.description,
        quantity: item.quantity,
        unitPriceFils: item.unitPriceFils,
        fobCostFils: undefined,
        freightCostFils: undefined,
        customsCostFils: undefined,
        insuranceCostFils: undefined,
        handlingCostFils: undefined,
        financeCostFils: undefined,
        marginBps: undefined,
        costPerUnitFils: undefined,
      });
    }

    return {
      success: true,
      summary:
        `Purchase order #${purchaseOrderId} created for ${supplier.name} with ${request.items.length} line item${request.items.length !== 1 ? 's' : ''}.`,
      data: {
        purchaseOrderId: String(purchaseOrderId),
        partyId: String(supplier.id),
        partyName: supplier.name,
        itemCount: request.items.length,
        deliveryTerms: request.deliveryTerms,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, summary: `Failed to generate purchase order: ${message}`, error: message };
  }
}

async function handleChasePayment(
  params: Record<string, unknown>
): Promise<SkillResult> {
  const allParties = get(parties);
  const allEvents = get(moneyEvents);
  const nowMs = Date.now();

  const specificId = params.customerId != null ? BigInt(params.customerId as number) : null;

  const targets = allParties.filter((p) => {
    if (!p.isCustomer) return false;
    if (specificId !== null && p.id !== specificId) return false;
    const outstanding = outstandingFils(p.id, allEvents);
    return outstanding > 0n && isOverdue(p.id, allEvents, nowMs);
  });

  if (targets.length === 0) {
    const scope = specificId ? `customer #${specificId}` : 'any customer';
    return {
      success: true,
      summary: `No overdue invoices found for ${scope}.`,
      data: { messages: [] },
    };
  }

  const messages: Array<{
    partyId: string;
    partyName: string;
    tone: string;
    subject: string;
    body: string;
    outstandingFils: string;
    overdueDays: number;
  }> = [];

  for (const party of targets) {
    const partyEvents = allEvents.filter((ev) => ev.partyId === party.id);
    const outstanding = outstandingFils(party.id, allEvents);
    const overdueDays = maxOverdueDays(party.id, allEvents, nowMs);
    const grade = gradeTag(party);
    const tone = determineTone(grade, overdueDays);

    const overdueInvoices = partyEvents
      .filter(
        (ev) =>
          isCustomerInvoice(ev) &&
          ev.dueDate &&
          Number(ev.dueDate.microsSinceUnixEpoch / 1000n) < nowMs
      )
      .map((ev) => ({
        reference: ev.reference || `INV-${String(ev.id).padStart(3, '0')}`,
        totalFils: ev.totalFils,
        dueDate: ev.dueDate
          ? new Date(Number(ev.dueDate.microsSinceUnixEpoch / 1000n)).toLocaleDateString('en-GB')
          : undefined,
      }));

    const chaseData: ChaseData = {
      party,
      outstandingFils: outstanding,
      overdueDays,
      overdueInvoices,
      channel: 'whatsapp',
    };

    const result = generateChaseMessage(chaseData);

    messages.push({
      partyId: String(party.id),
      partyName: party.name,
      tone: result.tone,
      subject: result.subject,
      body: result.body,
      outstandingFils: String(outstanding),
      overdueDays,
    });
  }

  const summary =
    `Generated ${messages.length} chase message${messages.length !== 1 ? 's' : ''} ` +
    `(${messages.filter((m) => m.tone === 'friendly').length} friendly, ` +
    `${messages.filter((m) => m.tone === 'firm').length} firm, ` +
    `${messages.filter((m) => m.tone === 'final_notice').length} final notice).`;

  return { success: true, summary, data: { messages } };
}

async function handleGenerateStatement(
  params: Record<string, unknown>
): Promise<SkillResult> {
  const allParties = get(parties);

  let party: Party | undefined;

  if (params.customerId != null) {
    party = allParties.find((p) => p.id === BigInt(params.customerId as number));
  } else if (params.customerName) {
    const name = String(params.customerName).toLowerCase();
    party = allParties.find((p) => p.name.toLowerCase().includes(name));
  }

  if (!party) {
    const identifier = params.customerId ? `#${params.customerId}` : `"${params.customerName}"`;
    return { success: false, summary: `Customer ${identifier} not found.`, error: 'not_found' };
  }

  const allEvents = get(moneyEvents);
  const partyEvents = allEvents.filter((ev) => ev.partyId === party!.id);

  await generateStatementPdf({ party, moneyEvents: partyEvents });

  const outstanding = outstandingFils(party.id, allEvents);

  return {
    success: true,
    summary: `Statement of Account generated for ${party.name} (BHD ${formatBHD(outstanding)} outstanding). PDF opened in new tab.`,
    data: {
      partyId: String(party.id),
      partyName: party.name,
      outstandingFils: String(outstanding),
    },
  };
}

async function handleGenerateQuotation(
  params: Record<string, unknown>
): Promise<SkillResult> {
  const conn = getConnection();
  if (!conn) {
    return { success: false, summary: 'Not connected to database.', error: 'no_connection' };
  }

  const partyId = params.partyId;
  if (partyId == null) {
    return { success: false, summary: 'partyId is required.', error: 'missing_param' };
  }

  let rawItems = params.items;
  if (typeof rawItems === 'string') {
    try {
      rawItems = JSON.parse(rawItems);
    } catch {
      return { success: false, summary: 'items parameter is not valid JSON.', error: 'invalid_param' };
    }
  }
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { success: false, summary: 'items array is required and must be non-empty.', error: 'missing_param' };
  }

  const allParties = get(parties);
  const party = allParties.find((p) => p.id === BigInt(partyId as number));
  if (!party) {
    return { success: false, summary: `Customer #${partyId} not found.`, error: 'not_found' };
  }

  const items: QuotationItem[] = rawItems.map((it: any) => ({
    description: String(it.description ?? ''),
    quantity: Number(it.quantity ?? 1),
    unit: String(it.unit ?? 'EA'),
    unitPriceFils: BigInt(Math.round(Number(it.unitPriceFils ?? 0))),
  }));

  const validityDays = params.validityDays != null ? Number(params.validityDays) : 30;
  const notes = params.notes != null ? String(params.notes) : undefined;

  const quotNo = getNextQuotationNumber();
  await generateQuotationPdf({ party, items, validityDays, notes });

  // Post-hook: set follow-up on the most recent active pipeline for this party
  const allPipelines = get(pipelines);
  const partyPipelines = allPipelines.filter(
    (pl) =>
      pl.partyId === party.id &&
      ((pl.status as any)?.tag === 'Active' ||
        (pl.status as any)?.tag === 'Draft' ||
        (pl.status as any)?.tag === 'InProgress')
  );

  if (partyPipelines.length > 0) {
    const pipeline = partyPipelines.reduce((best, pl) => (pl.id > best.id ? pl : best));

    const nowMicros = BigInt(Date.now()) * 1000n;
    const followUpMicros = nowMicros + BigInt(7 * 24 * 60 * 60 * 1_000_000);

    try {
      conn.reducers.advancePipeline({
        id: pipeline.id,
        partyId: pipeline.partyId,
        title: pipeline.title,
        legacyYear: pipeline.legacyYear,
        opportunityNumber: pipeline.opportunityNumber,
        folderNumber: pipeline.folderNumber,
        folderName: pipeline.folderName,
        sfdcTitle: pipeline.sfdcTitle,
        comment: pipeline.comment,
        ehReference: pipeline.ehReference,
        paymentTerms: pipeline.paymentTerms,
        ownerName: pipeline.ownerName,
        source: pipeline.source,
        sourceNotes: pipeline.sourceNotes,
        deliverySummary: pipeline.deliverySummary,
        newStatus: pipeline.status as any,
        estimatedValueFils: pipeline.estimatedValueFils,
        winProbabilityBps: pipeline.winProbabilityBps,
        competitorPresent: pipeline.competitorPresent,
        oemPriceFils: pipeline.oemPriceFils,
        markupBps: pipeline.markupBps,
        additionalCostsFils: pipeline.additionalCostsFils,
        costingApproved: pipeline.costingApproved,
        offerSentAt: new Timestamp(nowMicros),
        lossReason: pipeline.lossReason,
        nextFollowUp: new Timestamp(followUpMicros),
      });
    } catch (err) {
      console.warn('[handleGenerateQuotation] advancePipeline failed:', err);
    }
  }

  const followUpNote =
    partyPipelines.length > 0
      ? ' Follow-up reminder set for 7 days from now on the active pipeline deal.'
      : ' No active pipeline deal found for this customer — follow-up reminder not set.';

  return {
    success: true,
    summary:
      `Quotation ${quotNo} generated for ${party.name} (${items.length} line item${items.length !== 1 ? 's' : ''}, ${validityDays}-day validity). PDF downloading.` +
      followUpNote,
    data: {
      quotNo,
      partyId: String(party.id),
      partyName: party.name,
      itemCount: items.length,
      validityDays,
      followUpSet: partyPipelines.length > 0,
    },
  };
}

// ── New handlers ──────────────────────────────────────────────────────────────

async function handleGenerateEmailDraft(
  params: Record<string, unknown>
): Promise<SkillResult> {
  const partyId = params.partyId;
  if (partyId == null) {
    return { success: false, summary: 'partyId is required.', error: 'missing_param' };
  }

  const variant = String(params.variant ?? 'rfq_response') as EmailVariant;
  const validVariants: EmailVariant[] = [
    'rfq_response',
    'offer_submission',
    'follow_up',
    'revision_notice',
    'po_acknowledgment',
  ];
  if (!validVariants.includes(variant)) {
    return {
      success: false,
      summary: `variant must be one of: ${validVariants.join(', ')}.`,
      error: 'invalid_param',
    };
  }

  const allParties = get(parties);
  const party = allParties.find((p) => p.id === BigInt(partyId as number));
  if (!party) {
    return { success: false, summary: `Party #${partyId} not found.`, error: 'not_found' };
  }

  // Optionally link a pipeline
  let pipeline;
  if (params.pipelineId != null) {
    pipeline = get(pipelines).find((pl) => pl.id === BigInt(params.pipelineId as number));
  }

  const contact = params.contact != null ? String(params.contact) : undefined;
  const senderName = params.senderName != null ? String(params.senderName) : undefined;

  let points: string[] = [];
  if (Array.isArray(params.points)) {
    points = params.points.map(String);
  } else if (typeof params.points === 'string') {
    try {
      const parsed = JSON.parse(params.points);
      if (Array.isArray(parsed)) points = parsed.map(String);
    } catch {
      // ignore parse error; use empty points
    }
  }

  const result = generateEmailDraft({ party, contact, pipeline, variant, senderName, points });

  return {
    success: true,
    summary: `Email draft (${variant}) generated for ${party.name}. Subject: "${result.subject}".`,
    data: {
      partyId: String(party.id),
      partyName: party.name,
      variant: result.variant,
      subject: result.subject,
      body: result.body,
    },
  };
}

async function handleGenerateCoverLetter(
  params: Record<string, unknown>
): Promise<SkillResult> {
  const partyId = params.partyId;
  if (partyId == null) {
    return { success: false, summary: 'partyId is required.', error: 'missing_param' };
  }

  const allParties = get(parties);
  const party = allParties.find((p) => p.id === BigInt(partyId as number));
  if (!party) {
    return { success: false, summary: `Party #${partyId} not found.`, error: 'not_found' };
  }

  // Optionally link a pipeline
  let pipeline;
  if (params.pipelineId != null) {
    pipeline = get(pipelines).find((pl) => pl.id === BigInt(params.pipelineId as number));
  }

  // Parse items — may arrive as array or JSON string
  let rawItems = params.items;
  if (typeof rawItems === 'string') {
    try { rawItems = JSON.parse(rawItems); } catch { rawItems = []; }
  }
  const items: CoverLetterItem[] = Array.isArray(rawItems)
    ? rawItems.map((it: any) => ({
        description: String(it.description ?? ''),
        quantity: Number(it.quantity ?? 1),
        unit: String(it.unit ?? 'EA'),
      }))
    : [];

  if (items.length === 0) {
    // Fall back to line items from the pipeline's linked order if available
    if (pipeline) {
      const allLineItems = get(lineItems);
      const pipelineItems = allLineItems.filter(
        (li) => li.parentType === 'pipeline' && li.parentId === pipeline!.id
      );
      for (const li of pipelineItems) {
        items.push({
          description: li.description,
          quantity: Number(li.quantity),
          unit: 'EA',
        });
      }
    }
  }

  if (items.length === 0) {
    return { success: false, summary: 'items array is required and must be non-empty.', error: 'missing_param' };
  }

  const contact = params.contact != null ? String(params.contact) : undefined;
  const deliveryTerms = params.deliveryTerms != null ? String(params.deliveryTerms) : undefined;
  const notes = params.notes != null ? String(params.notes) : undefined;
  const senderName = params.senderName != null ? String(params.senderName) : undefined;

  await generateCoverLetterPdf({ party, contact, pipeline, items, deliveryTerms, notes, senderName });

  return {
    success: true,
    summary: `Cover letter PDF generated for ${party.name} (${items.length} item${items.length !== 1 ? 's' : ''}). PDF downloading.`,
    data: {
      partyId: String(party.id),
      partyName: party.name,
      pipelineId: pipeline ? String(pipeline.id) : undefined,
      itemCount: items.length,
    },
  };
}

async function handleGenerateTechnicalSubmittal(
  params: Record<string, unknown>
): Promise<SkillResult> {
  // Parse documents — may arrive as array or JSON string
  let rawDocs = params.documents;
  if (typeof rawDocs === 'string') {
    try { rawDocs = JSON.parse(rawDocs); } catch { rawDocs = []; }
  }

  if (!Array.isArray(rawDocs) || rawDocs.length === 0) {
    return {
      success: false,
      summary: 'documents array is required and must be non-empty.',
      error: 'missing_param',
    };
  }

  const documents: SubmittalDocument[] = rawDocs.map((d: any) => ({
    name: String(d.name ?? ''),
    type: String(d.type ?? 'Other') as SubmittalDocument['type'],
    pages: d.pages != null ? Number(d.pages) : undefined,
  }));

  // Optionally link a pipeline
  let pipeline;
  if (params.pipelineId != null) {
    pipeline = get(pipelines).find((pl) => pl.id === BigInt(params.pipelineId as number));
  }

  // Resolve party name for addressee
  let partyName: string | undefined;
  if (params.partyId != null) {
    const party = get(parties).find((p) => p.id === BigInt(params.partyId as number));
    partyName = party?.name;
  } else if (params.partyName != null) {
    partyName = String(params.partyName);
  } else if (pipeline) {
    const party = get(parties).find((p) => p.id === pipeline!.partyId);
    partyName = party?.name;
  }

  const preparedBy = params.preparedBy != null ? String(params.preparedBy) : undefined;

  await generateTechnicalSubmittalPdf({ pipeline, partyName, documents, preparedBy });

  const titleHint = pipeline ? pipeline.title : (partyName ?? 'Submittal');

  return {
    success: true,
    summary: `Technical submittal PDF generated for "${titleHint}" (${documents.length} document${documents.length !== 1 ? 's' : ''}). PDF downloading.`,
    data: {
      pipelineId: pipeline ? String(pipeline.id) : undefined,
      partyName,
      documentCount: documents.length,
    },
  };
}

// ── Public router ─────────────────────────────────────────────────────────────

/**
 * Route document-generation skill names to their handlers.
 * Returns null if the skill name is not handled here (caller falls through).
 */
export async function executeDocumentSkill(
  skillName: string,
  params: Record<string, unknown>
): Promise<SkillResult | null> {
  switch (skillName) {
    case 'generate_delivery_note':
      return handleGenerateDeliveryNote(params);

    case 'generate_purchase_order':
      return handleGeneratePurchaseOrder(params);

    case 'chase_payment':
      return handleChasePayment(params);

    case 'generate_statement':
      return handleGenerateStatement(params);

    case 'generate_quotation':
      return handleGenerateQuotation(params);

    case 'generate_email_draft':
      return handleGenerateEmailDraft(params);

    case 'generate_cover_letter':
      return handleGenerateCoverLetter(params);

    case 'generate_technical_submittal':
      return handleGenerateTechnicalSubmittal(params);

    default:
      return null;
  }
}
