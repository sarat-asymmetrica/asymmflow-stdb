/**
 * AsymmFlow Skills — Executor (thin router)
 *
 * Routes parsed skill blocks to concrete implementation functions.
 * Document-generation skills are handled by documentExecutor.ts.
 * Status-transition and memory skills are handled by statusExecutor.ts.
 * Query and mutation skills remain inline below.
 *
 * Guaranteed implementations:
 *   query_dashboard, query_customer_360, query_ar_aging,
 *   query_order_status, predict_payment_date, query_top_debtors,
 *   create_invoice, record_payment,
 *   + all skills delegated to documentExecutor / statusExecutor
 */

import type { SkillResult } from './types';
import { getSkillByName } from './registry';
import { get } from 'svelte/store';
import {
  parties,
  moneyEvents,
  contacts,
  pipelines,
  lineItems,
  orders,
  deliveryNotes,
  deliveryNoteItems,
  getConnection,
} from '../db';
import type { Party, MoneyEvent } from '../db';
import type { MoneyEventKind } from '../../module_bindings/types';
import { formatBHD } from '../format';
import { buildARAgingSnapshot, buildOrderStatusSnapshot } from './querySkillLogic';
import { buildPaymentPredictionSnapshot } from './paymentPredictionLogic';
import { executeDocumentSkill } from './documentExecutor';
import { executeStatusSkill } from './statusExecutor';
import { downloadARAgingWorkbook } from '../documents/excelExport';

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

// ── Inline skill handlers (queries + STDB mutations) ─────────────────────────

async function handleQueryDashboard(): Promise<SkillResult> {
  const allParties = get(parties);
  const allEvents = get(moneyEvents);
  const nowMs = Date.now();

  const customers = allParties.filter((p) => p.isCustomer);

  let totalOutstandingFils = 0n;
  let overdueCount = 0;
  let totalInvoicedFils = 0n;
  let totalPaidFils = 0n;

  for (const ev of allEvents) {
    if (isCustomerInvoice(ev)) totalInvoicedFils += ev.totalFils;
    if (isCustomerPayment(ev)) totalPaidFils += ev.totalFils;
  }

  for (const party of customers) {
    const outstanding = outstandingFils(party.id, allEvents);
    totalOutstandingFils += outstanding;
    if (outstanding > 0n && isOverdue(party.id, allEvents, nowMs)) {
      overdueCount++;
    }
  }

  const allPipelines = get(pipelines);
  let pipelineValueFils = 0n;
  for (const p of allPipelines) {
    pipelineValueFils += p.estimatedValueFils;
  }

  const collectionRate =
    totalInvoicedFils > 0n
      ? Number((totalPaidFils * 10000n) / totalInvoicedFils) / 100
      : 0;

  const summary =
    `${customers.length} customers, ` +
    `BHD ${formatBHD(totalOutstandingFils)} outstanding, ` +
    `${overdueCount} overdue, ` +
    `${collectionRate.toFixed(1)}% collection rate, ` +
    `BHD ${formatBHD(pipelineValueFils)} pipeline`;

  return {
    success: true,
    summary,
    data: {
      customerCount: customers.length,
      totalOutstandingFils: String(totalOutstandingFils),
      overdueCount,
      collectionRate,
      pipelineValueFils: String(pipelineValueFils),
    },
  };
}

async function handleQueryCustomer360(
  params: Record<string, unknown>
): Promise<SkillResult> {
  const customerName = String(params.customerName ?? '').trim();
  if (!customerName) {
    return { success: false, summary: 'customerName parameter is required.', error: 'missing_param' };
  }

  const allParties = get(parties);
  const party = allParties.find((p) =>
    p.name.toLowerCase().includes(customerName.toLowerCase())
  );

  if (!party) {
    return {
      success: false,
      summary: `No customer found matching "${customerName}".`,
      error: 'not_found',
    };
  }

  const allEvents = get(moneyEvents);
  const partyEvents = allEvents.filter((ev) => ev.partyId === party.id);
  const allContacts = get(contacts);
  const partyContacts = allContacts.filter((c) => c.partyId === party.id);
  const allPipelines = get(pipelines);
  const partyPipelines = allPipelines.filter((p) => p.partyId === party.id);

  const nowMs = Date.now();
  const outstanding = outstandingFils(party.id, allEvents);
  const invoiceCount = partyEvents.filter(isCustomerInvoice).length;
  const paymentCount = partyEvents.filter(isCustomerPayment).length;
  const overdueDays = maxOverdueDays(party.id, allEvents, nowMs);
  const grade = gradeTag(party);

  const activePipelines = partyPipelines.filter(
    (p) => (p.status as any)?.tag === 'Active' || (p.status as any)?.tag === 'Draft'
  );
  let pipelineValueFils = 0n;
  for (const p of activePipelines) pipelineValueFils += p.estimatedValueFils;

  const summary =
    `${party.name}: Grade ${grade}, ` +
    `${invoiceCount} invoices, ${paymentCount} payments, ` +
    `BHD ${formatBHD(outstanding)} outstanding` +
    (overdueDays > 0 ? `, ${overdueDays} days overdue` : '') +
    (activePipelines.length > 0
      ? `, ${activePipelines.length} active pipeline deals (BHD ${formatBHD(pipelineValueFils)})`
      : '');

  return {
    success: true,
    summary,
    data: {
      partyId: String(party.id),
      name: party.name,
      grade,
      outstandingFils: String(outstanding),
      invoiceCount,
      paymentCount,
      overdueDays,
      creditLimitFils: String(party.creditLimitFils),
      isCreditBlocked: party.isCreditBlocked,
      paymentTermsDays: String(party.paymentTermsDays),
      contacts: partyContacts.map((c) => ({ name: c.name, phone: c.phone, isWhatsApp: c.isWhatsApp })),
      activePipelineCount: activePipelines.length,
      pipelineValueFils: String(pipelineValueFils),
    },
  };
}

async function handleQueryARAging(): Promise<SkillResult> {
  const snapshot = buildARAgingSnapshot(
    get(parties),
    get(moneyEvents),
    BigInt(Date.now()) * 1000n,
  );

  return {
    success: true,
    summary:
      snapshot.rows.length === 0
        ? 'AR aging is clear with no outstanding customer balances.'
        : `AR aging shows ${snapshot.rows.length} customer${snapshot.rows.length === 1 ? '' : 's'} with BHD ${formatBHD(snapshot.totals.total)} outstanding.`,
    data: {
      rows: snapshot.rows.map((row) => ({
        name: row.name,
        grade: row.grade,
        d15Fils: String(row.d15Fils),
        d30Fils: String(row.d30Fils),
        d60Fils: String(row.d60Fils),
        d90Fils: String(row.d90Fils),
        d90plusFils: String(row.d90plusFils),
        outstandingFils: String(row.outstandingFils),
      })),
      totals: {
        d15: String(snapshot.totals.d15),
        d30: String(snapshot.totals.d30),
        d60: String(snapshot.totals.d60),
        d90: String(snapshot.totals.d90),
        d90plus: String(snapshot.totals.d90plus),
        total: String(snapshot.totals.total),
      },
    },
  };
}

async function handleQueryOrderStatus(
  params: Record<string, unknown>
): Promise<SkillResult> {
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

  const snapshot = buildOrderStatusSnapshot({
    order,
    party,
    orderLineItems: get(lineItems).filter((item) => item.parentType === 'order' && item.parentId === order.id),
    deliveryNotes: get(deliveryNotes).filter((note) => note.orderId === order.id),
    deliveryNoteItems: get(deliveryNoteItems),
    moneyEvents: get(moneyEvents),
  });

  return {
    success: true,
    summary:
      `Order #${snapshot.orderId} for ${snapshot.partyName} is ${snapshot.orderStatus}. ` +
      `Delivery progress ${snapshot.deliveryProgress}; ` +
      `${snapshot.linkedDeliveryNotes.length} DN${snapshot.linkedDeliveryNotes.length === 1 ? '' : 's'}, ` +
      `${snapshot.linkedInvoices.length} invoice${snapshot.linkedInvoices.length === 1 ? '' : 's'}, ` +
      `BHD ${formatBHD(BigInt(snapshot.orderOutstandingFils))} order-level outstanding.`,
    data: snapshot,
  };
}

async function handlePredictPaymentDate(
  params: Record<string, unknown>
): Promise<SkillResult> {
  if (params.customerId == null) {
    return { success: false, summary: 'customerId is required.', error: 'missing_param' };
  }

  const numericCustomerId = Number(params.customerId);
  if (!Number.isInteger(numericCustomerId) || numericCustomerId <= 0) {
    return { success: false, summary: 'customerId must be a positive integer.', error: 'invalid_param' };
  }

  let invoiceId: bigint | undefined;
  if (params.invoiceId != null) {
    const numericInvoiceId = Number(params.invoiceId);
    if (!Number.isInteger(numericInvoiceId) || numericInvoiceId <= 0) {
      return { success: false, summary: 'invoiceId must be a positive integer when provided.', error: 'invalid_param' };
    }
    invoiceId = BigInt(numericInvoiceId);
  }

  const customerId = BigInt(numericCustomerId);
  const customer = get(parties).find((row) => row.id === customerId && row.isCustomer);
  if (!customer) {
    return { success: false, summary: `Customer #${customerId} not found.`, error: 'not_found' };
  }

  if (invoiceId != null) {
    const invoice = get(moneyEvents).find(
      (event) =>
        event.id === invoiceId &&
        event.partyId === customerId &&
        (event.kind as any)?.tag === 'CustomerInvoice',
    );
    if (!invoice) {
      return {
        success: false,
        summary: `Customer invoice #${invoiceId} not found for ${customer.name}.`,
        error: 'not_found',
      };
    }
  }

  const snapshot = buildPaymentPredictionSnapshot({
    customer,
    moneyEvents: get(moneyEvents),
    nowMicros: BigInt(Date.now()) * 1000n,
    invoiceId,
  });

  const summary = snapshot.targetInvoice
    ? `Estimated payment for ${customer.name} invoice ${snapshot.targetInvoice.reference} is ${snapshot.targetInvoice.estimatedPaymentDateIso} (${snapshot.estimatedDays} days from invoice date, ${snapshot.confidence} confidence).`
    : `${customer.name} typically pays in about ${snapshot.estimatedDays} day(s) with ${snapshot.confidence} confidence.`;

  return {
    success: true,
    summary,
    data: {
      customerId: snapshot.customerId,
      customerName: snapshot.customerName,
      currentGrade: snapshot.currentGrade,
      suggestedGrade: snapshot.suggestedGrade,
      confidence: snapshot.confidence,
      confidenceScore: snapshot.confidenceScore,
      estimatedDays: snapshot.estimatedDays,
      historicalAverageDays: snapshot.historicalAverageDays,
      basedOnInvoices: snapshot.basedOnInvoices,
      paymentTermsDays: snapshot.paymentTermsDays,
      onTimeRatio: snapshot.onTimeRatio,
      reason: snapshot.reason,
      riskFactors: snapshot.riskFactors,
      estimatedPaymentDate: snapshot.targetInvoice?.estimatedPaymentDateIso,
      invoiceId: snapshot.targetInvoice ? String(snapshot.targetInvoice.invoiceId) : undefined,
      invoiceReference: snapshot.targetInvoice?.reference,
      estimatedDaysFromToday: snapshot.targetInvoice?.estimatedDaysFromToday,
      invoiceIssueDate: snapshot.targetInvoice?.issueDateIso,
      isOverdueToday: snapshot.targetInvoice?.isOverdueToday,
    },
  };
}

async function handleQueryTopDebtors(
  params: Record<string, unknown>
): Promise<SkillResult> {
  const allParties = get(parties);
  const allEvents = get(moneyEvents);
  const nowMs = Date.now();

  const limit = params.limit != null ? Number(params.limit) : null;

  const rows: Array<{
    name: string;
    grade: string;
    outstandingFils: bigint;
    overdueDays: number;
  }> = [];

  for (const party of allParties) {
    if (!party.isCustomer) continue;
    const outstanding = outstandingFils(party.id, allEvents);
    if (outstanding <= 0n) continue;
    const overdueDays = maxOverdueDays(party.id, allEvents, nowMs);
    rows.push({ name: party.name, grade: gradeTag(party), outstandingFils: outstanding, overdueDays });
  }

  rows.sort((a, b) => (b.outstandingFils > a.outstandingFils ? 1 : -1));

  const resultRows = limit != null && limit > 0 ? rows.slice(0, limit) : rows;
  const totalFils = rows.reduce((acc, r) => acc + r.outstandingFils, 0n);

  const summary =
    `Found ${rows.length} customer${rows.length !== 1 ? 's' : ''} with outstanding balances ` +
    `totalling BHD ${formatBHD(totalFils)}.` +
    (limit != null && rows.length > resultRows.length ? ` Showing top ${resultRows.length}.` : '');

  return {
    success: true,
    summary,
    data: {
      totalCustomers: rows.length,
      totalOutstandingFils: String(totalFils),
      debtors: resultRows.map((r) => ({
        name: r.name,
        grade: r.grade,
        outstanding: formatBHD(r.outstandingFils) + ' BHD',
        outstandingFils: String(r.outstandingFils),
        overdueDays: r.overdueDays,
      })),
    },
  };
}

async function handleExportToExcel(
  params: Record<string, unknown>
): Promise<SkillResult> {
  const dataSource = String(params.dataSource ?? '').trim().toLowerCase();
  const isARAgingExport =
    dataSource === 'ar aging' ||
    dataSource === 'aging' ||
    dataSource === 'accounts receivable aging' ||
    dataSource === 'overdue invoices';

  if (!isARAgingExport) {
    return {
      success: false,
      summary:
        `Excel export is currently wired for AR aging only. ` +
        `Try "AR Aging" as the data source.`,
      error: 'unsupported_data_source',
    };
  }

  const snapshot = buildARAgingSnapshot(
    get(parties),
    get(moneyEvents),
    BigInt(Date.now()) * 1000n,
  );

  const filename = downloadARAgingWorkbook(snapshot);

  return {
    success: true,
    summary:
      snapshot.rows.length === 0
        ? `AR aging workbook ${filename} generated with no outstanding balances.`
        : `AR aging workbook ${filename} generated for ${snapshot.rows.length} customer${snapshot.rows.length === 1 ? '' : 's'}.`,
    data: {
      fileName: filename,
      rowCount: snapshot.rows.length,
      totalOutstandingFils: String(snapshot.totals.total),
    },
  };
}

async function handleCreateInvoice(
  params: Record<string, unknown>
): Promise<SkillResult> {
  const conn = getConnection();
  if (!conn) {
    return { success: false, summary: 'Not connected to database.', error: 'no_connection' };
  }

  const customerId = params.customerId;
  const orderId = params.orderId;

  if (customerId == null || orderId == null) {
    return { success: false, summary: 'customerId and orderId are required.', error: 'missing_param' };
  }

  const allParties = get(parties);
  const party = allParties.find((p) => p.id === BigInt(customerId as number));
  if (!party) {
    return { success: false, summary: `Customer #${customerId} not found.`, error: 'not_found' };
  }

  try {
    conn.reducers.recordMoneyEvent({
      partyId: BigInt(customerId as number),
      orderId: BigInt(orderId as number),
      deliveryNoteId: undefined,
      kind: { tag: 'CustomerInvoice' } as MoneyEventKind,
      subtotalFils: 0n,
      reference: '',
      dueDate: undefined,
    });

    return {
      success: true,
      summary: `Invoice created for ${party.name} against order #${orderId}.`,
      data: { customerId: String(customerId), orderId: String(orderId), partyName: party.name },
    };
  } catch (err) {
    return { success: false, summary: `Failed to create invoice: ${String(err)}`, error: String(err) };
  }
}

async function handleRecordPayment(
  params: Record<string, unknown>
): Promise<SkillResult> {
  const conn = getConnection();
  if (!conn) {
    return { success: false, summary: 'Not connected to database.', error: 'no_connection' };
  }

  const invoiceId = params.invoiceId;
  const amountFils = params.amountFils;
  const reference = String(params.reference ?? '').trim();

  if (invoiceId == null || amountFils == null || !reference) {
    return { success: false, summary: 'invoiceId, amountFils, and reference are all required.', error: 'missing_param' };
  }

  const allEvents = get(moneyEvents);
  const invoice = allEvents.find(
    (ev) => ev.id === BigInt(invoiceId as number) && isCustomerInvoice(ev)
  );

  if (!invoice) {
    return { success: false, summary: `Invoice #${invoiceId} not found.`, error: 'not_found' };
  }

  const allParties = get(parties);
  const party = allParties.find((p) => p.id === invoice.partyId);
  const partyName = party?.name ?? `Party #${invoice.partyId}`;
  const amountBigInt = BigInt(Math.round(amountFils as number));

  try {
    conn.reducers.recordMoneyEvent({
      partyId: invoice.partyId,
      orderId: undefined,
      deliveryNoteId: undefined,
      kind: { tag: 'CustomerPayment' } as MoneyEventKind,
      subtotalFils: amountBigInt,
      reference,
      dueDate: undefined,
    });

    return {
      success: true,
      summary: `Payment of BHD ${formatBHD(amountBigInt)} recorded for ${partyName} (ref: ${reference}).`,
      data: {
        invoiceId: String(invoiceId),
        partyId: String(invoice.partyId),
        partyName,
        amountFils: String(amountBigInt),
        reference,
      },
    };
  } catch (err) {
    return { success: false, summary: `Failed to record payment: ${String(err)}`, error: String(err) };
  }
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Options passed by the caller to enforce role-based access control and the
 * approval flow. Both fields are optional for backward compatibility: if the
 * options bag is omitted entirely a console warning is emitted and execution
 * continues (transition period — legacy callers are not hard-broken).
 */
export interface ExecuteSkillOptions {
  /**
   * The role of the currently authenticated user, e.g. 'Admin', 'Manager'.
   * Must be present for role-gated skills; omitting it for those skills will
   * cause an `insufficient_role` rejection.
   */
  userRole?: string;
  /**
   * Set to `true` only after the user has explicitly clicked "Approve" in the
   * chat UI (or, for `auto` skills, the caller may set this to `true`
   * unconditionally).  Skills whose `approval` is `explicit` or `admin_only`
   * will be rejected if this is `false` or absent.
   */
  approved?: boolean;
}

/**
 * Execute a skill by name with the given parameters.
 *
 * Defence-in-depth guard (RC-15):
 *   1. Look up the skill definition in the registry.
 *   2. If the skill has `requiredRoles`, verify `options.userRole` is in the list.
 *   3. If the skill's `approval` is 'explicit' or 'admin_only', verify
 *      `options.approved === true`.
 *   4. Skills with `approval: 'auto'` bypass the approval check.
 *
 * Routing order:
 *   1. documentExecutor  — document-generation skills
 *   2. statusExecutor    — status-transition + memory skills
 *   3. Inline switch     — query and STDB-mutation skills
 *
 * Returns a SkillResult with success/failure and a human-readable summary.
 */
export async function executeSkill(
  skillName: string,
  params: Record<string, unknown>,
  options?: ExecuteSkillOptions
): Promise<SkillResult> {
  // ── RC-15 guard ───────────────────────────────────────────────────────────

  const skillDef = getSkillByName(skillName);

  if (skillDef) {
    if (!options) {
      console.warn(
        `[executeSkill] RC-15: options not provided for skill "${skillName}". ` +
        'Pass { userRole, approved } to enforce access control. ' +
        'This will become a hard error in a future release.'
      );
    } else {
      // 1. Role check
      if (skillDef.requiredRoles.length > 0) {
        const userRole = options.userRole ?? '';
        if (!skillDef.requiredRoles.includes(userRole as any)) {
          return {
            success: false,
            error: 'insufficient_role',
            summary:
              `Your role (${userRole || 'unknown'}) does not have permission to execute ` +
              `"${skillDef.displayName}". ` +
              `Required: ${skillDef.requiredRoles.join(', ')}.`,
          };
        }
      }

      // 2. Approval check (skip for 'auto' skills)
      if (skillDef.approval !== 'auto') {
        if (!options.approved) {
          const detail =
            skillDef.approval === 'admin_only'
              ? 'This action requires Admin approval.'
              : 'This action requires explicit user approval.';
          return {
            success: false,
            error: 'approval_required',
            summary: `"${skillDef.displayName}" requires approval before execution. ${detail}`,
          };
        }
      }
    }
  }
  // If skillDef is undefined the routing below will return 'not_implemented'.

  try {
    // ── Delegate to sub-routers ─────────────────────────────────────────────

    const docResult = await executeDocumentSkill(skillName, params);
    if (docResult !== null) return docResult;

    const statusResult = await executeStatusSkill(skillName, params);
    if (statusResult !== null) return statusResult;

    // ── Inline query + mutation handlers ────────────────────────────────────

    switch (skillName) {
      case 'query_dashboard':
        return await handleQueryDashboard();

      case 'query_customer_360':
        return await handleQueryCustomer360(params);

      case 'query_ar_aging':
        return await handleQueryARAging();

      case 'query_order_status':
        return await handleQueryOrderStatus(params);

      case 'predict_payment_date':
        return await handlePredictPaymentDate(params);

      case 'query_top_debtors':
        return await handleQueryTopDebtors(params);

      case 'export_to_excel':
        return await handleExportToExcel(params);

      case 'create_invoice':
        return await handleCreateInvoice(params);

      case 'record_payment':
        return await handleRecordPayment(params);

      default:
        return {
          success: false,
          summary: `Skill '${skillName}' is not yet implemented client-side.`,
          error: 'not_implemented',
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      summary: `Skill '${skillName}' threw an unexpected error: ${message}`,
      error: message,
    };
  }
}
