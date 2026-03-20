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
import { parseEHBasketXML, getProductTypeStats } from '../business/ehBasketParser';
import type { ParsedEHBasket } from '../business/ehBasketParser';
import { calculateSellingPrice } from '../business/invariants';
import { prepareTallyImportPreview, executeTallyImport } from '../business/tallyImport';
import type { TallyImportMode } from '../business/tallyImport';
import { parseBankStatementCsv } from '../business/bankReconciliation';
import { Timestamp } from 'spacetimedb';
import { computeVATReturn, getQuarterlyPeriods, formatVATReturnReport } from '../business/vatReturn';
import { generateContract, formatContractText } from '../documents/contractGenerator';
import { evaluateAlerts, sortAlerts, countBySeverity, formatAlertSummary } from '../business/alertSystem';
import {
  generateSalesReport, generateCollectionsReport, generatePayablesReport,
  formatSalesReport, formatCollectionsReport, formatPayablesReport,
} from '../business/financialReports';
import { evaluatePortfolioRisk } from '../business/riskScoring';
import { computeOrderShipmentSummary, formatShipmentProgress } from '../business/shipmentTracking';

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
      sourceDate: undefined,
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
      sourceDate: undefined,
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

// ── E+H basket handlers ─────────────────────────────────────────────────────

async function handleParseEHBasket(
  params: Record<string, unknown>
): Promise<SkillResult> {
  const xmlContent = params.xmlContent != null ? String(params.xmlContent) : '';
  if (!xmlContent.trim()) {
    return { success: false, summary: 'xmlContent parameter is required.', error: 'missing_param' };
  }

  let basket: ParsedEHBasket;
  try {
    basket = parseEHBasketXML(xmlContent);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, summary: `Failed to parse E+H basket XML: ${message}`, error: message };
  }

  const stats = getProductTypeStats(basket);
  const statsLines = stats
    .map(
      (s) =>
        `${s.productType}: ${s.itemCount} item${s.itemCount !== 1 ? 's' : ''}, ` +
        `cost BHD ${formatBHD(s.totalCostBHDFils)}, sell BHD ${formatBHD(s.totalSellBHDFils)}, ` +
        `margin ${s.averageMarginPct.toFixed(1)}%`
    )
    .join('; ');

  const summary =
    `Parsed E+H basket for ${basket.customerName || 'unknown customer'}: ` +
    `${basket.items.length} item${basket.items.length !== 1 ? 's' : ''}, ` +
    `total cost BHD ${formatBHD(basket.totalCostBHDFils)}, ` +
    `sell BHD ${formatBHD(basket.totalSellBHDFils)}, ` +
    `margin ${basket.overallMarginPct.toFixed(1)}%.` +
    (basket.warnings.length > 0 ? ` Warnings: ${basket.warnings.join('; ')}.` : '') +
    (statsLines ? ` Breakdown: ${statsLines}.` : '');

  return {
    success: true,
    summary,
    data: {
      customerNumber: basket.customerNumber,
      customerName: basket.customerName,
      positionsCount: basket.positionsCount,
      grossValueEUR: basket.grossValueEUR,
      totalCostBHDFils: String(basket.totalCostBHDFils),
      totalSellBHDFils: String(basket.totalSellBHDFils),
      totalProfitBHDFils: String(basket.totalProfitBHDFils),
      overallMarginPct: basket.overallMarginPct,
      items: basket.items.map((item) => ({
        orderCode: item.orderCode,
        shortDescription: item.shortDescription,
        quantity: item.quantity,
        productType: item.productType,
        unitCostBHDFils: String(item.unitCostBHDFils),
        unitSellBHDFils: String(item.unitSellBHDFils),
        itemSellBHDFils: String(item.itemSellBHDFils),
        itemProfitBHDFils: String(item.itemProfitBHDFils),
        productionTime: item.productionTime,
      })),
      stats: stats.map((s) => ({
        productType: s.productType,
        itemCount: s.itemCount,
        totalCostBHDFils: String(s.totalCostBHDFils),
        totalSellBHDFils: String(s.totalSellBHDFils),
        averageMarginPct: s.averageMarginPct,
      })),
      warnings: basket.warnings,
    },
  };
}

async function handleImportEHCosting(
  params: Record<string, unknown>
): Promise<SkillResult> {
  const conn = getConnection();
  if (!conn) {
    return { success: false, summary: 'Not connected to database.', error: 'no_connection' };
  }

  const pipelineId = params.pipelineId;
  if (pipelineId == null) {
    return { success: false, summary: 'pipelineId is required.', error: 'missing_param' };
  }

  const xmlContent = params.xmlContent != null ? String(params.xmlContent) : '';
  if (!xmlContent.trim()) {
    return { success: false, summary: 'xmlContent parameter is required.', error: 'missing_param' };
  }

  const numericPipelineId = Number(pipelineId);
  if (!Number.isInteger(numericPipelineId) || numericPipelineId <= 0) {
    return { success: false, summary: 'pipelineId must be a positive integer.', error: 'invalid_param' };
  }

  const pipeline = get(pipelines).find((pl) => pl.id === BigInt(numericPipelineId));
  if (!pipeline) {
    return { success: false, summary: `Pipeline #${pipelineId} not found.`, error: 'not_found' };
  }

  const party = get(parties).find((p) => p.id === pipeline.partyId);
  const customerDiscountPct = params.customerDiscountPct != null ? Number(params.customerDiscountPct) : 0;

  let basket: ParsedEHBasket;
  try {
    basket = parseEHBasketXML(xmlContent);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, summary: `Failed to parse E+H basket XML: ${message}`, error: message };
  }

  let addedCount = 0;
  const warnings: string[] = [...basket.warnings];

  for (const item of basket.items) {
    const costResult = calculateSellingPrice(
      item.unitCostBHDFils,
      item.productType,
      customerDiscountPct,
    );
    warnings.push(...costResult.warnings);

    try {
      conn.reducers.addLineItem({
        parentType: 'pipeline',
        parentId: BigInt(numericPipelineId),
        description: `${item.shortDescription} (${item.orderCode})`,
        quantity: BigInt(item.quantity),
        unitPriceFils: costResult.sellingPriceFils,
        fobCostFils: item.unitCostBHDFils,
        freightCostFils: undefined,
        customsCostFils: undefined,
        insuranceCostFils: undefined,
        handlingCostFils: undefined,
        financeCostFils: undefined,
        marginBps: Math.round(costResult.marginPct * 100),
        costPerUnitFils: item.unitCostBHDFils,
      });
      addedCount += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`Failed to add "${item.orderCode}": ${message}`);
    }
  }

  const summary =
    `Imported ${addedCount} of ${basket.items.length} E+H basket items into pipeline "${pipeline.title}"` +
    (party ? ` for ${party.name}` : '') +
    (customerDiscountPct > 0 ? ` with ${customerDiscountPct}% customer discount` : '') +
    `. Total sell BHD ${formatBHD(basket.totalSellBHDFils)}, margin ${basket.overallMarginPct.toFixed(1)}%.` +
    (warnings.length > 0 ? ` ${warnings.length} warning${warnings.length !== 1 ? 's' : ''}.` : '');

  return {
    success: true,
    summary,
    data: {
      pipelineId: String(pipeline.id),
      pipelineTitle: pipeline.title,
      itemsAdded: addedCount,
      totalItems: basket.items.length,
      totalSellBHDFils: String(basket.totalSellBHDFils),
      overallMarginPct: basket.overallMarginPct,
      customerDiscountPct,
      warnings,
    },
  };
}

// ── Tally import handler ────────────────────────────────────────────────────

async function handleImportTally(
  params: Record<string, unknown>
): Promise<SkillResult> {
  const conn = getConnection();
  if (!conn) {
    return { success: false, summary: 'Not connected to database.', error: 'no_connection' };
  }

  const mode = params.mode != null ? String(params.mode).trim() : '';
  const validModes: TallyImportMode[] = [
    'customer_invoices',
    'supplier_invoices',
    'supplier_payments',
    'customer_payments',
  ];
  if (!validModes.includes(mode as TallyImportMode)) {
    return {
      success: false,
      summary: `mode must be one of: ${validModes.join(', ')}.`,
      error: 'invalid_param',
    };
  }

  const fileContent = params.fileContent ?? params.workbookData;
  if (fileContent == null) {
    return {
      success: false,
      summary:
        `Tally import for "${mode}" is ready. ` +
        `Please use the Tally Import tab in FinanceHub to select the Excel file, ` +
        `or provide the file content via the fileContent parameter.`,
      error: 'file_required',
      data: { mode, navigateTo: 'finance_hub_tally_import' },
    };
  }

  let workbookData: ArrayBuffer;
  if (fileContent instanceof ArrayBuffer) {
    workbookData = fileContent;
  } else if (typeof fileContent === 'string') {
    try {
      const binaryString = atob(fileContent);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      workbookData = bytes.buffer;
    } catch {
      return { success: false, summary: 'fileContent is not valid base64.', error: 'invalid_param' };
    }
  } else {
    return { success: false, summary: 'fileContent must be a base64 string or ArrayBuffer.', error: 'invalid_param' };
  }

  const allParties = get(parties);
  const allEvents = get(moneyEvents);
  const fileName = params.fileName != null ? String(params.fileName) : 'tally_import.xlsx';

  let preview;
  try {
    preview = prepareTallyImportPreview(
      workbookData,
      mode as TallyImportMode,
      allParties,
      allEvents,
      fileName,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, summary: `Failed to preview Tally file: ${message}`, error: message };
  }

  if (preview.readyRows === 0) {
    return {
      success: true,
      summary:
        `Tally preview for "${mode}": ${preview.totalRows} row${preview.totalRows !== 1 ? 's' : ''} found, ` +
        `${preview.duplicateRows} duplicate${preview.duplicateRows !== 1 ? 's' : ''}, ` +
        `${preview.invalidRows} invalid. No rows ready for import.`,
      data: {
        mode,
        fileName,
        totalRows: preview.totalRows,
        readyRows: 0,
        duplicateRows: preview.duplicateRows,
        invalidRows: preview.invalidRows,
      },
    };
  }

  const result = await executeTallyImport(
    preview,
    conn as never,
    () => get(parties),
    () => get(moneyEvents),
  );

  const summary =
    `Tally import (${mode}): ${result.imported} imported, ` +
    `${result.duplicates} duplicate${result.duplicates !== 1 ? 's' : ''}, ` +
    `${result.createdParties} new part${result.createdParties !== 1 ? 'ies' : 'y'} created` +
    (result.errors > 0 ? `, ${result.errors} error${result.errors !== 1 ? 's' : ''}` : '') + '.';

  return {
    success: result.errors === 0,
    summary,
    data: {
      mode,
      fileName,
      imported: result.imported,
      duplicates: result.duplicates,
      createdParties: result.createdParties,
      errors: result.errors,
      errorDetails: result.errorDetails,
    },
    error: result.errors > 0 ? result.errorDetails.join('; ') : undefined,
  };
}

// ── Bank statement import handler ────────────────────────────────────────────

async function handleImportBankStatement(
  params: Record<string, unknown>
): Promise<SkillResult> {
  const conn = getConnection();
  if (!conn) {
    return { success: false, summary: 'Not connected to database.', error: 'no_connection' };
  }

  const bankName = params.bankName != null ? String(params.bankName).trim() : '';
  if (!bankName) {
    return { success: false, summary: 'bankName parameter is required.', error: 'missing_param' };
  }

  const fileContent = params.fileContent ?? params.csvContent;
  if (fileContent == null) {
    return {
      success: false,
      summary:
        `Bank statement import for "${bankName}" is ready. ` +
        `Please use the Bank Recon tab in FinanceHub to upload the CSV file, ` +
        `or provide the file content via the fileContent parameter.`,
      error: 'file_required',
      data: { bankName, navigateTo: 'finance_hub_bank_recon' },
    };
  }

  let csvText: string;
  if (typeof fileContent === 'string') {
    // Try base64 decode first, fall back to treating as raw CSV
    try {
      csvText = atob(fileContent);
    } catch {
      csvText = fileContent;
    }
  } else {
    return { success: false, summary: 'fileContent must be a string (base64 or raw CSV).', error: 'invalid_param' };
  }

  let parsed;
  try {
    parsed = parseBankStatementCsv(csvText, bankName);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, summary: `Failed to parse bank statement: ${message}`, error: message };
  }

  let importedCount = 0;
  const warnings: string[] = [];

  for (const txn of parsed) {
    try {
      conn.reducers.importBankTransaction({
        bankName,
        transactionDate: Timestamp.fromDate(txn.transactionDate),
        description: txn.description,
        amountFils: txn.amountFils,
        reference: txn.reference,
      });
      importedCount += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`Row "${txn.description}": ${message}`);
    }
  }

  const summary =
    `Imported ${importedCount} of ${parsed.length} transactions from ${bankName} bank statement.` +
    (warnings.length > 0 ? ` ${warnings.length} warning${warnings.length !== 1 ? 's' : ''}.` : '') +
    ` Navigate to Bank Recon tab to match transactions.`;

  return {
    success: warnings.length === 0,
    summary,
    data: {
      bankName,
      totalParsed: parsed.length,
      imported: importedCount,
      warnings,
    },
    error: warnings.length > 0 ? warnings.join('; ') : undefined,
  };
}

// ── Finance report handlers ──────────────────────────────────────────────────

function buildPeriodFromParams(params: Record<string, unknown>): { startDate: string; endDate: string; label: string } {
  const year = Number(params.year ?? new Date().getFullYear());
  const quarter = params.quarter != null ? Number(params.quarter) : null;

  if (quarter != null && quarter >= 1 && quarter <= 4) {
    const periods = getQuarterlyPeriods(year);
    return periods[quarter - 1];
  }
  return { startDate: `${year}-01-01`, endDate: `${year}-12-31`, label: `FY ${year}` };
}

async function handleComputeVATReturn(params: Record<string, unknown>): Promise<SkillResult> {
  const period = buildPeriodFromParams(params);
  const result = computeVATReturn(period, get(moneyEvents) as never, get(parties) as never);
  const report = formatVATReturnReport(result);

  return {
    success: true,
    summary: result.summary,
    data: {
      period: result.period,
      outputVATFils: String(result.outputVAT.totalVATFils),
      inputVATFils: String(result.inputVAT.totalVATFils),
      netPayableFils: String(result.netVATPayableFils),
      outputInvoiceCount: result.outputVAT.invoiceCount,
      inputInvoiceCount: result.inputVAT.invoiceCount,
      report,
    },
  };
}

async function handleGenerateSalesReport(params: Record<string, unknown>): Promise<SkillResult> {
  const period = buildPeriodFromParams(params);
  const report = generateSalesReport(
    period, get(moneyEvents) as never, get(parties) as never, get(pipelines) as never,
  );
  const text = formatSalesReport(report);

  return {
    success: true,
    summary: `Sales report for ${period.label}: BHD ${formatBHD(report.totalRevenueFils)} revenue from ${report.invoiceCount} invoices.`,
    data: {
      period: report.period,
      totalRevenueFils: String(report.totalRevenueFils),
      invoiceCount: report.invoiceCount,
      topCustomers: report.topCustomers.map(c => ({ name: c.name, grade: c.grade, revenueBHD: formatBHD(c.revenueFils) })),
      pipelineSummary: report.pipelineSummary,
      report: text,
    },
  };
}

async function handleGenerateCollectionsReport(params: Record<string, unknown>): Promise<SkillResult> {
  const period = buildPeriodFromParams(params);
  const report = generateCollectionsReport(period, get(moneyEvents) as never, get(parties) as never);
  const text = formatCollectionsReport(report);

  return {
    success: true,
    summary: `Collections report for ${period.label}: ${report.collectionRatePct.toFixed(1)}% collection rate, avg ${report.averageDaysToPayment} days to payment.`,
    data: {
      period: report.period,
      collectionRatePct: report.collectionRatePct,
      averageDaysToPayment: report.averageDaysToPayment,
      totalCollectedFils: String(report.totalCollectedFils),
      report: text,
    },
  };
}

async function handleGeneratePayablesReport(params: Record<string, unknown>): Promise<SkillResult> {
  const period = buildPeriodFromParams(params);
  const report = generatePayablesReport(period, get(moneyEvents) as never, get(parties) as never);
  const text = formatPayablesReport(report);

  return {
    success: true,
    summary: `Payables report for ${period.label}: BHD ${formatBHD(report.totalPayableFils)} outstanding across ${report.supplierCount} suppliers.`,
    data: {
      period: report.period,
      totalPayableFils: String(report.totalPayableFils),
      supplierCount: report.supplierCount,
      report: text,
    },
  };
}

// ── Contract + alerts handlers ───────────────────────────────────────────────

async function handleGenerateContract(params: Record<string, unknown>): Promise<SkillResult> {
  const partyId = params.partyId;
  if (partyId == null) {
    return { success: false, summary: 'partyId is required.', error: 'missing_param' };
  }

  const allParties = get(parties);
  const party = allParties.find((p) => p.id === BigInt(Number(partyId)));
  if (!party) {
    return { success: false, summary: `Customer #${partyId} not found.`, error: 'not_found' };
  }

  let rawItems = params.items;
  if (typeof rawItems === 'string') {
    try { rawItems = JSON.parse(rawItems); } catch { return { success: false, summary: 'items is not valid JSON.', error: 'invalid_param' }; }
  }
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { success: false, summary: 'items array is required and must be non-empty.', error: 'missing_param' };
  }

  const items = rawItems.map((it: Record<string, unknown>) => ({
    description: String(it.description ?? ''),
    quantity: Number(it.quantity ?? 1),
    unitPriceFils: BigInt(Math.round(Number(it.unitPriceFils ?? 0))),
  }));

  const grade = (party.grade as { tag: string })?.tag ?? 'B';
  const contract = generateContract({
    party: {
      name: party.name,
      grade,
      paymentTermsDays: Number(party.paymentTermsDays),
      creditLimitFils: party.creditLimitFils,
    },
    items,
    contractNumber: `CON-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
    issueDate: new Date().toISOString().slice(0, 10),
    validityDays: params.validityDays != null ? Number(params.validityDays) : 90,
    deliveryTerms: params.deliveryTerms != null ? String(params.deliveryTerms) : 'EXW Bahrain',
    specialConditions: params.specialConditions != null ? String(params.specialConditions) : undefined,
  });

  const text = formatContractText(contract);

  return {
    success: true,
    summary: `Contract ${contract.contractNumber} generated for ${party.name} (Grade ${grade}, ${items.length} items, BHD ${formatBHD(contract.totalFils)}).`,
    data: {
      contractNumber: contract.contractNumber,
      partyName: party.name,
      grade,
      clauseCount: contract.clauses.length,
      totalFils: String(contract.totalFils),
      report: text,
    },
  };
}

async function handleEvaluateAlerts(): Promise<SkillResult> {
  const alerts = evaluateAlerts({
    parties: get(parties) as never,
    moneyEvents: get(moneyEvents) as never,
    pipelines: get(pipelines) as never,
    nowMicros: BigInt(Date.now()) * 1000n,
  });

  const sorted = sortAlerts(alerts);
  const counts = countBySeverity(alerts);
  const summary = formatAlertSummary(alerts);

  return {
    success: true,
    summary: `${alerts.length} alert${alerts.length !== 1 ? 's' : ''}: ${counts.critical} critical, ${counts.warning} warning, ${counts.info} info.`,
    data: {
      totalAlerts: alerts.length,
      counts,
      alerts: sorted.map(a => ({
        severity: a.severity,
        category: a.category,
        title: a.title,
        message: a.message,
        actionLabel: a.actionLabel,
      })),
      report: summary,
    },
  };
}

// ── Risk portfolio handler ────────────────────────────────────────────────────

async function handleEvaluateRiskPortfolio(): Promise<SkillResult> {
  const result = evaluatePortfolioRisk(
    get(parties) as never,
    get(moneyEvents) as never,
    BigInt(Date.now()) * 1000n,
  );

  const summary =
    `Portfolio risk: ${result.totalCustomers} customers, ` +
    `${result.byTier.critical} critical, ${result.byTier.high} high, ` +
    `${result.byTier.medium} medium, ${result.byTier.low} low. ` +
    `Total exposure BHD ${formatBHD(result.totalExposureFils)}, ` +
    `high-risk exposure BHD ${formatBHD(result.highRiskExposureFils)}.`;

  return {
    success: true,
    summary,
    data: {
      totalCustomers: result.totalCustomers,
      byTier: result.byTier,
      totalExposureFils: String(result.totalExposureFils),
      highRiskExposureFils: String(result.highRiskExposureFils),
      averageRiskScore: result.averageRiskScore,
      topRisks: result.topRisks.map(r => ({
        name: r.name,
        grade: r.grade,
        riskScore: r.riskScore,
        tier: r.tier,
        outstandingFils: String(r.outstandingFils),
        recommendation: r.recommendation,
      })),
    },
  };
}

// ── Shipment status handler ──────────────────────────────────────────────────

async function handleCheckShipmentStatus(params: Record<string, unknown>): Promise<SkillResult> {
  if (params.orderId == null) {
    return { success: false, summary: 'orderId is required.', error: 'missing_param' };
  }

  const numericId = Number(params.orderId);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return { success: false, summary: 'orderId must be a positive integer.', error: 'invalid_param' };
  }

  const orderId = BigInt(numericId);
  const order = get(orders).find(o => o.id === orderId);
  if (!order) {
    return { success: false, summary: `Order #${orderId} not found.`, error: 'not_found' };
  }

  const orderLineItems = get(lineItems).filter(
    li => li.parentType === 'order' && li.parentId === orderId
  );

  const summary = computeOrderShipmentSummary(
    orderId,
    orderLineItems as never,
    get(deliveryNotes) as never,
    get(deliveryNoteItems) as never,
  );

  const text = formatShipmentProgress(summary);
  const party = get(parties).find(p => p.id === order.partyId);

  return {
    success: true,
    summary:
      `Order #${orderId}${party ? ` for ${party.name}` : ''}: ` +
      `${summary.overallShipmentPct}% shipped (${summary.totalShipped}/${summary.totalOrdered} items), ` +
      `${summary.deliveryNoteCount} delivery note${summary.deliveryNoteCount !== 1 ? 's' : ''}.`,
    data: {
      orderId: String(orderId),
      overallShipmentPct: summary.overallShipmentPct,
      totalOrdered: summary.totalOrdered,
      totalShipped: summary.totalShipped,
      totalRemaining: summary.totalRemaining,
      fullyShipped: summary.fullyShipped,
      deliveryNoteCount: summary.deliveryNoteCount,
      lineItems: summary.lineItems.map(li => ({
        description: li.description,
        ordered: li.quantityOrdered,
        shipped: li.quantityShipped,
        remaining: li.quantityRemaining,
        pct: li.shipmentPct,
      })),
      report: text,
    },
  };
}

// ── GRN PDF handler ──────────────────────────────────────────────────────────

async function handleGenerateGrnPdf(params: Record<string, unknown>): Promise<SkillResult> {
  return {
    success: false,
    summary: 'GRN PDF generation via AI chat is not yet wired to the live data store. Use the Operations Hub GRN tab to generate GRN PDFs.',
    error: 'not_implemented',
  };
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

      case 'parse_eh_basket':
        return await handleParseEHBasket(params);

      case 'import_eh_costing':
        return await handleImportEHCosting(params);

      case 'import_tally':
        return await handleImportTally(params);

      case 'import_bank_statement':
        return await handleImportBankStatement(params);

      case 'compute_vat_return':
        return await handleComputeVATReturn(params);

      case 'generate_sales_report':
        return await handleGenerateSalesReport(params);

      case 'generate_collections_report':
        return await handleGenerateCollectionsReport(params);

      case 'generate_payables_report':
        return await handleGeneratePayablesReport(params);

      case 'generate_contract':
        return await handleGenerateContract(params);

      case 'evaluate_alerts':
        return await handleEvaluateAlerts();

      case 'evaluate_risk_portfolio':
        return await handleEvaluateRiskPortfolio();

      case 'check_shipment_status':
        return await handleCheckShipmentStatus(params);

      case 'generate_grn_pdf':
        return await handleGenerateGrnPdf(params);

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
