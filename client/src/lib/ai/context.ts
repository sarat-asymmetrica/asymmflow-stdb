/**
 * AsymmFlow AI — System Prompt Builder
 *
 * Constructs the context-rich system prompt injected at the start of every
 * AI conversation. The prompt tells the model who the user is, what the
 * business looks like right now, and exactly which skills it may invoke.
 *
 * Two entry points are exported:
 *   buildBusinessState()   — read STDB stores → BusinessState snapshot
 *   buildSystemPrompt()    — Member + BusinessState → string system prompt
 *
 * IMPORTANT: "outstanding" is NEVER stored in the database.
 * It is always computed as: sum(CustomerInvoice.totalFils) - sum(CustomerPayment.totalFils)
 * for a given party. This is an invariant of the schema design.
 */

import { get } from 'svelte/store';
import {
  parties,
  pipelines,
  orders,
  purchaseOrders,
  deliveryNotes,
  grns,
  moneyEvents,
  activityLogs,
  type Member,
  type Party,
  type Pipeline,
  type Order,
  type MoneyEvent,
} from '../db';
import { getSkillsForRole, canExecuteSkill } from '../skills/registry';
import type { UserRole } from '../skills/types';
import { formatBHD } from '../format';
import { getInvariantsSummary } from '../business/invariants';

// ── Business state snapshot ───────────────────────────────────────────────────

export interface GradeBreakdown {
  A: number;
  B: number;
  C: number;
  D: number;
  unknown: number;
}

/** Top overdue customer entry for the system prompt. */
export interface OverdueCustomer {
  name: string;
  outstandingBHD: string;   // e.g. "12,450.500"
  overdueDays: number;
}

export interface BusinessState {
  /**
   * True when the state was built from mock/demo data because STDB was not
   * connected at build time. The chat UI should show an offline warning banner
   * and the system prompt will include a prominent disclaimer to the AI.
   */
  isMockData: boolean;

  // Counts
  customerCount: number;
  supplierCount: number;
  gradeBreakdown: GradeBreakdown;

  // Customer AR (accounts receivable) — all computed from MoneyEvents
  /** Total invoiced to customers (all active CustomerInvoices), in fils. */
  totalRevenueFils: bigint;
  /** Total payments received from customers (all CustomerPayments), in fils. */
  totalPaymentsFils: bigint;
  /**
   * Total outstanding = totalRevenueFils - totalPaymentsFils.
   * NEVER stored — always computed. This is the canonical outstanding balance.
   */
  totalOutstandingFils: bigint;
  /**
   * Amount past due date today — sum of outstanding balances on invoices
   * where dueDate < now.
   */
  totalOverdueFils: bigint;
  /** Number of customers with overdue balances. */
  overdueCustomerCount: number;
  /** Collection rate as a percentage string, e.g. "87.5%". */
  collectionRatePct: string;

  // Pipeline
  /** Sum of estimatedValueFils across Active/InProgress pipelines. */
  pipelineValueFils: bigint;
  /** Count of Active/InProgress pipelines. */
  openPipelineCount: number;
  /** Count of Active orders (delivery in progress). */
  activeOrderCount: number;
  /** Count of purchase orders in the system. */
  purchaseOrderCount: number;
  /** Count of delivery notes in the system. */
  deliveryNoteCount: number;
  /** Count of GRNs in the system. */
  grnCount: number;

  // Top overdue customers (up to 5) for the prompt
  topOverdueCustomers: OverdueCustomer[];

  // Recent activity
  recentActivitySummary: string;
}

// ── STDB-backed computation ───────────────────────────────────────────────────

/**
 * Reads from the live STDB stores and computes an aggregated BusinessState.
 *
 * Falls back gracefully when stores are empty (STDB not yet connected or
 * module_bindings not generated): returns realistic mock data so the AI
 * can still have a meaningful conversation during development.
 */
export function buildBusinessState(): BusinessState {
  const allParties: Party[]         = get(parties);
  const allPipelines: Pipeline[]    = get(pipelines);
  const allOrders: Order[]          = get(orders);
  const allPurchaseOrders           = get(purchaseOrders);
  const allDeliveryNotes            = get(deliveryNotes);
  const allGrns                     = get(grns);
  const allMoneyEvents: MoneyEvent[] = get(moneyEvents);
  const allActivityLogs             = get(activityLogs);

  // Detect offline / dev mode (no data yet)
  const isOffline =
    allParties.length === 0 &&
    allPipelines.length === 0 &&
    allOrders.length === 0;

  if (isOffline) {
    return buildMockBusinessState();
  }

  const nowMs = Date.now();
  const nowMicros = BigInt(nowMs) * 1000n;

  // ── Party segmentation ───────────────────────────────────────────────────
  // Party uses isCustomer / isSupplier boolean flags (not a type.tag enum).
  const customers = allParties.filter((p) => p.isCustomer);
  const suppliers = allParties.filter((p) => p.isSupplier);

  // Party.grade is a CustomerGrade enum: { tag: 'A' | 'B' | 'C' | 'D' }
  const gradeBreakdown: GradeBreakdown = { A: 0, B: 0, C: 0, D: 0, unknown: 0 };
  for (const c of customers) {
    const tag = (c.grade as { tag: string } | undefined)?.tag;
    if (tag === 'A' || tag === 'B' || tag === 'C' || tag === 'D') {
      gradeBreakdown[tag]++;
    } else {
      gradeBreakdown.unknown++;
    }
  }

  // ── MoneyEvent aggregation ───────────────────────────────────────────────
  // kind.tag values: CustomerInvoice | CustomerPayment | SupplierInvoice | SupplierPayment
  // status.tag values: Draft | Active | InProgress | Terminal | Cancelled
  // Outstanding = CustomerInvoice totals - CustomerPayment totals (NEVER stored)

  let totalRevenueFils = 0n;
  let totalPaymentsFils = 0n;

  // Per-party outstanding tracking for overdue computation
  // partyId → { invoicedFils, paidFils, overdueInvoices: [{totalFils, dueDate}] }
  const partyAR = new Map<
    bigint,
    { invoicedFils: bigint; paidFils: bigint; overdueInvoiceFils: bigint; earliestDueDateMs: number }
  >();

  for (const ev of allMoneyEvents) {
    const kind = (ev.kind as { tag: string } | undefined)?.tag;
    const status = (ev.status as { tag: string } | undefined)?.tag;

    // Skip draft and cancelled events — they don't affect real balances
    if (status === 'Draft' || status === 'Cancelled') continue;

    const pid = ev.partyId as bigint;

    if (kind === 'CustomerInvoice') {
      totalRevenueFils += ev.totalFils as bigint;

      // Track per-party invoiced amount
      const ar = partyAR.get(pid) ?? { invoicedFils: 0n, paidFils: 0n, overdueInvoiceFils: 0n, earliestDueDateMs: Infinity };
      ar.invoicedFils += ev.totalFils as bigint;

      // Check if overdue: dueDate exists and is in the past
      const dueTs = ev.dueDate as { microsSinceUnixEpoch: bigint } | undefined;
      if (dueTs) {
        const dueMicros = dueTs.microsSinceUnixEpoch;
        if (dueMicros < nowMicros) {
          ar.overdueInvoiceFils += ev.totalFils as bigint;
          const dueDateMs = Number(dueMicros / 1000n);
          if (dueDateMs < ar.earliestDueDateMs) {
            ar.earliestDueDateMs = dueDateMs;
          }
        }
      }
      partyAR.set(pid, ar);
    } else if (kind === 'CustomerPayment') {
      totalPaymentsFils += ev.totalFils as bigint;

      const ar = partyAR.get(pid) ?? { invoicedFils: 0n, paidFils: 0n, overdueInvoiceFils: 0n, earliestDueDateMs: Infinity };
      ar.paidFils += ev.totalFils as bigint;
      partyAR.set(pid, ar);
    }
    // SupplierInvoice / SupplierPayment affect AP (accounts payable) —
    // not included in customer outstanding calculations.
  }

  // Total outstanding is always computed, never stored
  const totalOutstandingFils =
    totalRevenueFils > totalPaymentsFils ? totalRevenueFils - totalPaymentsFils : 0n;

  // Collection rate: what fraction of invoiced has been collected
  const collectionRatePct =
    totalRevenueFils > 0n
      ? `${Number((totalPaymentsFils * 10000n) / totalRevenueFils) / 100}%`
      : '0.0%';

  // ── Overdue computation ───────────────────────────────────────────────────
  // An overdue invoice contributes to overdue only to the extent it is
  // still outstanding (invoiced - paid for that party). We use a
  // proportional approach: if a party has paid 70% of their invoices,
  // only 30% of their overdue invoice amount is still actually overdue.

  let totalOverdueFils = 0n;
  let overdueCustomerCount = 0;

  const partyIdToName = new Map<bigint, string>();
  for (const p of allParties) {
    partyIdToName.set(p.id as bigint, p.name);
  }

  // For top overdue customers: [{ partyId, outstandingFils, overdueDays }]
  const overdueEntries: Array<{ name: string; outstandingFils: bigint; overdueDays: number }> = [];

  for (const [pid, ar] of partyAR) {
    const partyOutstanding = ar.invoicedFils - ar.paidFils;
    if (partyOutstanding <= 0n || ar.overdueInvoiceFils <= 0n) continue;

    // The actual overdue portion is the minimum of what's overdue and what's outstanding
    const actualOverdueFils = partyOutstanding < ar.overdueInvoiceFils
      ? partyOutstanding
      : ar.overdueInvoiceFils;

    totalOverdueFils += actualOverdueFils;
    overdueCustomerCount++;

    const overdueDays =
      ar.earliestDueDateMs < Infinity
        ? Math.floor((nowMs - ar.earliestDueDateMs) / 86_400_000)
        : 0;

    overdueEntries.push({
      name: partyIdToName.get(pid) ?? `Party #${pid}`,
      outstandingFils: partyOutstanding,
      overdueDays,
    });
  }

  // Sort by outstanding descending, take top 5
  overdueEntries.sort((a, b) => (b.outstandingFils > a.outstandingFils ? 1 : -1));
  const topOverdueCustomers: OverdueCustomer[] = overdueEntries.slice(0, 5).map((e) => ({
    name: e.name,
    outstandingBHD: formatBHD(e.outstandingFils),
    overdueDays: e.overdueDays,
  }));

  // ── Pipeline ─────────────────────────────────────────────────────────────
  // Pipeline.status is EntityStatus: Draft | Active | InProgress | Terminal | Cancelled
  const openPipelines = allPipelines.filter((p) => {
    const s = (p.status as { tag: string } | undefined)?.tag;
    return s === 'Active' || s === 'InProgress';
  });
  const pipelineValueFils = openPipelines.reduce(
    (sum, p) => sum + (p.estimatedValueFils as bigint ?? 0n),
    0n
  );

  // ── Active orders ─────────────────────────────────────────────────────────
  const activeOrderCount = allOrders.filter((o) => {
    const s = (o.status as { tag: string } | undefined)?.tag;
    return s === 'Active' || s === 'InProgress';
  }).length;

  // ── Recent activity ───────────────────────────────────────────────────────
  const latestLog = allActivityLogs[allActivityLogs.length - 1];
  const recentActivitySummary = latestLog
    ? `Last action: ${latestLog.action} on ${latestLog.entityType} #${String(latestLog.entityId)}`
    : 'No recent activity recorded.';

  return {
    isMockData: false,
    customerCount: customers.length,
    supplierCount: suppliers.length,
    gradeBreakdown,
    totalRevenueFils,
    totalPaymentsFils,
    totalOutstandingFils,
    totalOverdueFils,
    overdueCustomerCount,
    collectionRatePct,
    pipelineValueFils,
    openPipelineCount: openPipelines.length,
    activeOrderCount,
    purchaseOrderCount: allPurchaseOrders.length,
    deliveryNoteCount: allDeliveryNotes.length,
    grnCount: allGrns.length,
    topOverdueCustomers,
    recentActivitySummary,
  };
}

// ── Mock data (dev / offline mode) ────────────────────────────────────────────

/**
 * Returns representative mock data matching PH Trading WLL's approximate scale.
 * Used when STDB is not connected so the AI still has a coherent business picture.
 */
function buildMockBusinessState(): BusinessState {
  return {
    isMockData: true,
    customerCount: 247,
    supplierCount: 132,
    gradeBreakdown: { A: 18, B: 112, C: 98, D: 19, unknown: 0 },
    totalRevenueFils:      51_800_000n,  // ~51,800 BHD invoiced
    totalPaymentsFils:     45_230_000n,  // ~45,230 BHD collected
    totalOutstandingFils:   6_570_000n,  // ~6,570 BHD outstanding
    totalOverdueFils:       2_140_000n,  // ~2,140 BHD overdue
    overdueCustomerCount:   14,
    collectionRatePct:     '87.3%',
    pipelineValueFils:     18_500_000n,  // ~18,500 BHD in pipeline
    openPipelineCount:     23,
    activeOrderCount:      11,
    purchaseOrderCount:    16,
    deliveryNoteCount:     12,
    grnCount:              9,
    topOverdueCustomers: [
      { name: 'Gulf Petrochemicals Co.', outstandingBHD: '1,450.000', overdueDays: 47 },
      { name: 'Aluminium Bahrain (ALBA)', outstandingBHD: '890.500',  overdueDays: 31 },
      { name: 'National Oil & Gas Authority', outstandingBHD: '620.250', overdueDays: 18 },
    ],
    recentActivitySummary: '(Offline mode — connect to SpacetimeDB for live data)',
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Format a bigint fils value as a human-readable BHD string.
 * Delegates to the shared formatBHD helper from format.ts.
 * e.g. 4200000n → "4,200.000"
 */
function filsToBhd(fils: bigint): string {
  return formatBHD(fils) + ' BHD';
}

/**
 * Convert a STDB timestamp (or raw bigint microseconds) to a relative
 * human-readable string like "today", "yesterday", or "N days ago".
 *
 * NOTE: We intentionally do NOT use formatDate() from format.ts here because
 * that helper takes a StdbTimestamp and returns a formatted date string, not a
 * relative time string. This local helper handles both raw bigint microseconds
 * and StdbTimestamp objects with a microsSinceUnixEpoch field.
 */
function formatRelativeTime(timestamp: any): string {
  const ms = typeof timestamp === 'bigint'
    ? Number(timestamp / 1000n)
    : Number(timestamp?.microsSinceUnixEpoch ? timestamp.microsSinceUnixEpoch / 1000n : 0);
  const diffMs = Date.now() - ms;
  const days = Math.floor(diffMs / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/**
 * Build a concise memory section for the system prompt from an array of
 * AiMemory rows. Groups entries by category so the model sees structured
 * shared team knowledge (party patterns, user preferences, etc.).
 */
export function buildMemoryContext(memories: any[]): string {
  if (!memories || memories.length === 0) return '';
  const grouped: Record<string, any[]> = {};
  for (const mem of memories) {
    const cat = mem.category || 'general';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(mem);
  }
  let section = '\n\n=== THINGS I REMEMBER (shared team knowledge) ===\n';
  if (grouped['party_pattern']?.length) {
    section += '\nCustomer/Supplier Patterns:\n';
    for (const m of grouped['party_pattern']) section += `- ${m.subject}: ${m.content}\n`;
  }
  if (grouped['user_preference']?.length) {
    section += '\nUser Preferences:\n';
    for (const m of grouped['user_preference']) section += `- ${m.subject}: ${m.content}\n`;
  }
  if (grouped['business_insight']?.length) {
    section += '\nBusiness Insights:\n';
    for (const m of grouped['business_insight']) section += `- ${m.content}\n`;
  }
  if (grouped['workflow_note']?.length) {
    section += '\nActive Workflow Notes:\n';
    for (const m of grouped['workflow_note']) section += `- ${m.subject}: ${m.content}\n`;
  }
  return section;
}

// ── System prompt builder ─────────────────────────────────────────────────────

/**
 * Builds the full system prompt string to inject at position 0 of every
 * API call. The prompt includes:
 *   1. Identity and persona
 *   2. Current user context (name + role)
 *   3. Live business metrics with real numbers
 *   4. Top overdue customers by outstanding balance
 *   5. Available skill list with descriptions and parameters
 *   6. Skill invocation protocol (JSON block format)
 *   7. Behavioural guardrails
 */
export function buildSystemPrompt(
  user: Member,
  state: BusinessState,
  memories?: any[]
): string {
  const role = (user.role as { tag: string } | undefined)?.tag ?? 'Staff';
  const userName = user.nickname || user.fullName || 'User';

  // Filter skills to what this role may trigger
  const availableSkills = getSkillsForRole(role as UserRole);
  const executableSkills = availableSkills.filter((s) => canExecuteSkill(s, role as UserRole));
  const viewOnlySkills   = availableSkills.filter((s) => !canExecuteSkill(s, role as UserRole));

  const skillList = executableSkills
    .map(
      (s) =>
        `  • ${s.name} — ${s.displayName}: ${s.description}` +
        (s.approval === 'explicit' ? ' [requires user approval]' : '') +
        (s.parameters.length > 0
          ? `\n    params: ${s.parameters.map((p) => `${p.name}(${p.type}${p.required ? '' : '?'})`).join(', ')}`
          : '')
    )
    .join('\n');

  const viewOnlyList =
    viewOnlySkills.length > 0
      ? `\nSkills visible but NOT executable with your role (mention as options only):\n` +
        viewOnlySkills.map((s) => `  • ${s.name} — ${s.displayName}`).join('\n')
      : '';

  // Grade distribution string, skip zeros
  const gradeStr = Object.entries(state.gradeBreakdown)
    .filter(([k, v]) => k !== 'unknown' && v > 0)
    .map(([k, v]) => `Grade ${k}: ${v}`)
    .join(', ');
  const unknownStr = state.gradeBreakdown.unknown > 0
    ? `, Ungraded: ${state.gradeBreakdown.unknown}`
    : '';

  // Top overdue customers block
  let overdueBlock = '';
  if (state.topOverdueCustomers.length > 0) {
    const rows = state.topOverdueCustomers
      .map((c) => `    - ${c.name}: BHD ${c.outstandingBHD} outstanding (${c.overdueDays}d overdue)`)
      .join('\n');
    overdueBlock = `\nTOP OVERDUE CUSTOMERS (by outstanding balance)\n${rows}`;
  }

  // Enhanced pipeline detail block — up to 5 open deals with last activity
  const allOpenPipelines: Pipeline[] = get(pipelines).filter((p) => {
    const s = (p.status as { tag: string } | undefined)?.tag;
    return s === 'Active' || s === 'InProgress';
  });
  let pipelineDetailBlock = '';
  if (allOpenPipelines.length > 0 && !state.isMockData) {
    const allPartyRows: Party[] = get(parties);
    const partyNameById = new Map<bigint, string>();
    for (const p of allPartyRows) partyNameById.set(p.id as bigint, p.name);

    // Sort by estimated value descending (largest deal first)
    const sorted = [...allOpenPipelines].sort((a, b) => {
      const av = a.estimatedValueFils as bigint ?? 0n;
      const bv = b.estimatedValueFils as bigint ?? 0n;
      return bv > av ? 1 : bv < av ? -1 : 0;
    });

    const rows = sorted.slice(0, 5).map((p) => {
      const partyName = partyNameById.get(p.partyId as bigint) ?? `Party #${String(p.partyId)}`;
      const status = (p.status as { tag: string } | undefined)?.tag ?? 'Unknown';
      const valueBhd = filsToBhd(p.estimatedValueFils as bigint ?? 0n);
      const lastActivity = p.updatedAt ? formatRelativeTime(p.updatedAt) : 'unknown';
      const title = p.title || `Pipeline #${String(p.id)}`;
      return `    - [${status}] ${title} | ${partyName} | ${valueBhd} | last activity: ${lastActivity}`;
    }).join('\n');

    pipelineDetailBlock = `\nOPEN PIPELINE DEALS (top ${Math.min(5, sorted.length)} by value)\n${rows}`;
  }

  const today = new Date().toLocaleDateString('en-BH', { dateStyle: 'full' });

  // RC-16: prepend a prominent offline/mock-data warning so the AI cannot
  // present fabricated numbers as live business data.
  const mockDataWarning = state.isMockData
    ? `\u26a0\ufe0f IMPORTANT: You are currently using DEMONSTRATION DATA because the database is not connected.
All figures below are FICTIONAL and must NOT be used for business decisions.
Inform the user clearly at the start of every response that you are working with demo data, not live numbers.
Do not allow the user to act on any financial figures, customer balances, or pipeline values until the connection is restored.

`
    : '';

  return `${mockDataWarning}You are AsymmFlow Butler, the AI assistant for PH Trading WLL — a process instrumentation and industrial chemicals distributor based in Bahrain.

CURRENT USER
  Name: ${userName}
  Role: ${role}

LIVE BUSINESS SNAPSHOT (${today})
  Customers: ${state.customerCount} active  |  Suppliers: ${state.supplierCount} active
  Grade mix: ${gradeStr}${unknownStr}

  ACCOUNTS RECEIVABLE (customer money)
    Total invoiced (all time): ${filsToBhd(state.totalRevenueFils)}
    Total collected:           ${filsToBhd(state.totalPaymentsFils)}
    Outstanding (unpaid):      ${filsToBhd(state.totalOutstandingFils)}
    Overdue (past due date):   ${filsToBhd(state.totalOverdueFils)} across ${state.overdueCustomerCount} customer(s)
    Collection rate:           ${state.collectionRatePct}

  PIPELINE & ORDERS
    Open pipeline deals: ${state.openPipelineCount}  |  Total value: ${filsToBhd(state.pipelineValueFils)}
    Active orders (in delivery): ${state.activeOrderCount}
    Purchase orders: ${state.purchaseOrderCount}  |  Delivery notes: ${state.deliveryNoteCount}  |  GRNs: ${state.grnCount}
${overdueBlock}
${pipelineDetailBlock}

  ${state.recentActivitySummary}

IMPORTANT ACCOUNTING NOTE
  "Outstanding" is NEVER stored in the database. It is always computed as:
    outstanding = sum(CustomerInvoice.totalFils) - sum(CustomerPayment.totalFils)
  This is a fundamental invariant. When answering questions about what a customer owes,
  always frame it as this computed difference - never as a stored field.

PRICING AND CREDIT POLICY
${getInvariantsSummary()}

AVAILABLE SKILLS (you may invoke these for ${userName})
${skillList || '  (no executable skills for this role)'}
${viewOnlyList}

SKILL INVOCATION PROTOCOL
When you need to perform a data action or run a skill, include a JSON block
at the END of your reply in exactly this format — no markdown fences, just the block:

{"skill":"<skill_name>","params":{"<param1>":"<value1>","<param2>":42}}

Rules:
  1. Only use skill names from the list above.
  2. Include ALL required parameters; omit optional ones if unknown.
  3. Include AT MOST ONE skill invocation per reply.
  4. Never fabricate data — if you need information you don't have, ask the user.
  5. After proposing a skill, wait for user approval before assuming it executed.
  6. Numeric IDs must be numbers (not strings) in the JSON.
  7. BHD amounts must be expressed in fils (integer, multiply BHD × 1000).
     Example: BHD 1,450.500 → 1450500

BEHAVIOURAL GUIDELINES
  • Be concise. PH Trading staff are busy — no lengthy preambles.
  • Currency: always BHD (Bahraini Dinar). 1 BHD = 1000 fils. Never say "dollars".
  • BHD is quoted to 3 decimal places: 1,450.500 BHD.
  • VAT: Bahrain standard rate is 10%. Apply automatically where relevant.
  • Customer grades affect credit terms:
      A = excellent payer, 45-day credit
      B = standard, 90-day credit (use carefully)
      C = cash-only or 50% advance required
      D = chronic late payer, 100% advance required
  • If asked "what is our total outstanding?" or for a single aggregate figure, answer from the snapshot above — it is live.
  • If asked "who owes us the most?", "show outstanding balances", "top debtors", or any ranked list of customer balances, invoke the query_top_debtors skill (not query_dashboard).
  • If asked about a SPECIFIC customer's balance, invoke the query_customer_360 skill with that customer's name.
  • If asked when a customer or invoice is likely to pay, invoke the predict_payment_date skill.
  • If asked for live order fulfilment progress, delivered quantities, or invoicing readiness, invoke the query_order_status skill.
  • If a customer is in the top overdue list, proactively mention them when discussing collections.
  • If the user asks about something outside your skills, answer from general business knowledge — but never invent STDB data.
  • Shared team knowledge is injected under "THINGS I REMEMBER" when available — treat it as fact unless contradicted by live STDB data.
  • You can save new knowledge with the remember skill and delete stale entries with the forget skill.
  • When asked to generate a document, ALWAYS check context completeness first. Never generate a document with fabricated data.
  • When presenting numbers, distinguish between live STDB data and computed/inferred values.

DOCUMENT GENERATION PROTOCOL
You can generate the following document types for PH Trading:
  1. Tax Invoice — skill: create_invoice
     requires: customer, amount, reference
  2. Quotation — skill: generate_quotation
     requires: customer, products, quantities, unit prices
     Pass items as a JSON string: '[{"description":"...","quantity":2,"unitPriceFils":500000}]'
     NOTE: generate_quotation automatically sets a 7-day follow-up reminder on the customer's active pipeline deal.
     Always tell the user this so they know the deal is tracked.
  3. Statement of Account — skill: generate_statement
     requires: customer name
  4. Payment Chase — skill: chase_payment
     requires: customer name
  5. Purchase Order — skill: generate_purchase_order
     requires: supplier, items, delivery terms
  6. Delivery Note — skill: generate_delivery_note
     requires: order, delivery address, item quantities
  7. Email Draft — skill: generate_email_draft
     variant: rfq_response | offer_submission | follow_up | revision_notice | po_acknowledgment
     requires: partyId, variant (and pipelineId for offer_submission/follow_up)
  8. Offer Cover Letter — skill: generate_cover_letter
     requires: partyId, pipelineId
  9. Technical Submittal — skill: generate_technical_submittal
     requires: pipelineId, documents (JSON array of document references)

Status Transitions:
  • skill: update_pipeline_status — params: pipelineId, newStatus
    Tier 2: requires explicit user confirmation before executing.
    Valid transitions: Draft→Active, Active→InProgress, InProgress→Terminal, any→Cancelled

Memory Skills:
  • skill: remember — params: category, subject, content
    categories: party_pattern | user_preference | business_insight | workflow_note
  • skill: forget — params: memoryId

Before generating ANY document:
  1. Check which required fields you HAVE from the conversation or STDB data
  2. Check which fields you can AUTO-FILL from business rules
  3. ASK the user for any MISSING required fields
  4. For optional fields, mention them but proceed with defaults if not provided

Example interaction for a quotation:
  User: "Send a quote to BAPCO for flow meters"
  You: "I can see BAPCO is a Grade C customer (50% advance terms).
        To complete the quotation I need:
        1. Which flow meter models? (E+H Promag? Prowirl?)
        2. Quantity per model
        3. Unit price per item (BHD)
        I'll auto-apply: 50% advance terms, 10% VAT, 30-day validity, PH letterhead."

CONTEXT AWARENESS RULES
  1. State what you KNOW and cite the source (e.g., "BAPCO is Grade C — from customer database")
  2. State what you're INFERRING and ask for confirmation (e.g., "Based on last 3 quotes, unit price was ~820 BHD — correct?")
  3. State what you NEED from the user — be explicit about missing fields
  4. NEVER fabricate prices, quantities, dates, or customer details
  5. If a customer exists in the database, use their real grade, terms, and history
  6. If a customer doesn't exist, ask if they should be created first
  7. For amounts: always use BHD with 3 decimal places (1 BHD = 1000 fils)
  8. When all required context is gathered, summarize what you'll generate and ask for approval
  9. After generating, present the document for review — don't assume it's final

CONFIDENCE INDICATORS
When discussing business data, indicate your confidence:
  - Data from the live database: state it as fact
  - Computed values (outstanding, collection rate): explain how computed
  - Historical patterns: mention the timeframe and sample size
  - External knowledge: clearly label as general knowledge, not company data${memories ? buildMemoryContext(memories) : ''}`;
}
