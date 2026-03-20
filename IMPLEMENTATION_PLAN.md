# AsymmFlow Reimagined — Implementation Plan
## From 156K LOC Monolith to Invariant Substrate + Agent Intelligence

**Date**: 2026-03-07
**Status**: Vision & Architecture — Ready for Build
**Origin**: 5 hours of SPOC meetings + experiments 001-ledger + 002-midday

---

## The Core Insight

> "If you make a bad business model function more optimally, you're not really doing anything
> to get them towards profitability. You just have a nice interface to watch yourself bleed."

Traditional ERP/CRM adds features to organize chaos. It doesn't work for bleeding orgs.
The shift: **the system of record becomes a system of action.**

- **Invariant Substrate** = rules that MUST hold (SpacetimeDB reducers)
- **Shared Visibility** = everyone sees the same truth (STDB subscriptions)
- **Agent Intelligence** = AI that can ACT, not just report (freed from template constraints)

Ramya doesn't process invoices according to a fixed template anymore.
The agent processes them. Ramya handles exceptions. 8 people making decisions, not drowning in process.

---

## Architecture: Three Layers

```
+---------------------------------------------------------------+
|  LAYER 3: Intelligence / Agency                                |
|                                                                |
|  AI agents that ACT — process invoices, chase payments,        |
|  translate Arabic docs, recommend pricing, route work,         |
|  adapt to chaos instead of trying to organize it               |
|                                                                |
|  Models: Grok (chat/reasoning), Sarvam (translate/TTS),        |
|          Claude (validation/synthesis), Mistral (existing)      |
+---------------------------------------------------------------+
|  LAYER 2: Visibility / Thin UI                                 |
|                                                                |
|  Svelte 5 + Tailwind — browser-first (Vercel/Cloudflare)      |
|  Neutralino for desktop feel where needed                      |
|  RENDERS state only. No business logic in the frontend.        |
|  useTable(tables.X) — reactive, real-time, zero plumbing       |
+---------------------------------------------------------------+
|  LAYER 1: Invariant Substrate (SpacetimeDB)                    |
|                                                                |
|  Tables   = shared state (the truth, multiplayer, real-time)   |
|  Reducers = business rules that MUST hold (transactional)      |
|  Views    = derived data, per-user visibility (RBAC)           |
|  Procedures = side effects (email, PDF, OCR, file I/O)         |
|                                                                |
|  Hosted on STDB maincloud — zero DevOps, zero sync layer       |
+---------------------------------------------------------------+
```

---

## What Dies, What Lives, What's Born

### DIES (Current AsymmFlow code that disappears)

| Component | Current LOC | Why It Dies |
|---|---|---|
| SQLite schema + migrations + GORM | ~5,000 | STDB tables replace all of this |
| Supabase sync layer | ~3,000 | STDB is multiplayer natively — no sync needed |
| Wails API bindings (Go->JS bridge) | ~15,000 | Clients call reducers directly, no API layer |
| Auth/session/license/device system | ~8,000 | STDB has built-in identity + reducer-level auth |
| Data fetching + caching + pagination | ~5,000 | Subscriptions are reactive — useTable() done |
| Frontend data plumbing (stores, fetches) | ~15,000 | STDB generated bindings handle everything |
| COM automation (Windows-only) | ~3,000 | Procedures with HTTP calls (platform-agnostic) |
| **Total eliminated** | **~54,000** | |

### LIVES (Migrates to STDB reducers)

| Component | Current LOC | STDB LOC (est.) | Notes |
|---|---|---|---|
| Payment state machine | ~2,000 | ~200 | Reducer with validation |
| Invoice reconciliation | ~1,500 | ~150 | Reducer + view |
| PO state machine | ~1,200 | ~150 | State transitions in reducer |
| Customer grade/credit logic | ~800 | ~80 | Reducer enforces grade rules |
| Business invariants | ~2,000 | ~200 | Actually enforced now (they weren't before!) |
| Costing sheet logic | ~1,500 | ~200 | Markup approval thresholds |
| Offer lifecycle | ~1,000 | ~120 | Accept/reject/ongoing state |
| Order lifecycle | ~1,200 | ~150 | Created -> delivered pipeline |
| GRN/Delivery | ~800 | ~100 | Partial receiving logic |
| Bank reconciliation | ~1,500 | ~200 | Transaction matching |
| **Total** | **~13,500** | **~1,550** | **~9x reduction** |

### BORN (New capabilities unlocked)

| Capability | How | Impact |
|---|---|---|
| Real-time multiplayer | STDB native | All 8 team members see changes instantly |
| AI invoice processing | Procedure + Sarvam OCR/translate | Arabic invoices auto-processed |
| AI payment chasing | Procedure + chat model | Agent recommends actions per customer grade |
| AI pricing advisor | Reducer context + chat model | Win probability, optimal discount, ABB warning |
| Browser-first access | Svelte on Vercel | Works on any device, no .exe distribution |
| Offline capability | STDB client SDK cache | Works without internet, syncs when back |
| Open source modules | asymm-kit packages | Reusable by any GCC business |
| Multilingual support | Sarvam Mayura integration | English/Arabic/Hindi document pipeline |

---

## STDB Schema Design — The 17 Tables

### Master Data

```typescript
// schema.ts — Layer 1: The Invariant Substrate

import { schema, table, t } from 'spacetimedb/server';

// --- Enums ---

const customerGrade = t.enum('CustomerGrade', {
  A: t.unit(),  // Pay within 45 days — max 7% discount
  B: t.unit(),  // Pay within 90 days — max 3% discount
  C: t.unit(),  // Pay when they feel like it — 0% discount, 50% advance
  D: t.unit(),  // Chase 6+ months — 100% advance or decline
});

const invoiceStatus = t.enum('InvoiceStatus', {
  Draft: t.unit(),
  Sent: t.unit(),
  PartiallyPaid: t.unit(),
  Paid: t.unit(),
  Overdue: t.unit(),
  Cancelled: t.unit(),
});

const poStatus = t.enum('POStatus', {
  Draft: t.unit(),
  Approved: t.unit(),
  Sent: t.unit(),
  PartiallyReceived: t.unit(),
  Received: t.unit(),    // Terminal
  Cancelled: t.unit(),   // Terminal
});

const offerStatus = t.enum('OfferStatus', {
  Draft: t.unit(),
  Sent: t.unit(),
  Ongoing: t.unit(),
  Accepted: t.unit(),    // -> becomes Order
  Rejected: t.unit(),    // Terminal, log reason
  Lost: t.unit(),        // Terminal, cannot re-win
});

const orderStatus = t.enum('OrderStatus', {
  Created: t.unit(),
  Confirmed: t.unit(),
  InProduction: t.unit(),
  Shipped: t.unit(),
  Delivered: t.unit(),   // Terminal
  Cancelled: t.unit(),   // Terminal
});

const opportunityStage = t.enum('OpportunityStage', {
  Lead: t.unit(),
  Qualified: t.unit(),
  Proposal: t.unit(),
  Negotiation: t.unit(),
  ClosedWon: t.unit(),
  ClosedLost: t.unit(),
});

const userRole = t.enum('UserRole', {
  Admin: t.unit(),
  Manager: t.unit(),
  Sales: t.unit(),
  Operations: t.unit(),
  Accountant: t.unit(),
});

const eventKind = t.enum('EventKind', {
  InvoiceCreated: t.unit(),
  PaymentReceived: t.unit(),
  POStatusChanged: t.unit(),
  OfferSent: t.unit(),
  OrderDelivered: t.unit(),
  FollowUpDue: t.unit(),
  AgentAction: t.unit(),
  SystemAlert: t.unit(),
});
```

### Tables — Mapped from AsymmFlow's 17

```typescript
// --- Master Data ---

const Member = table({ public: true }, {
  identity: t.identity().primaryKey(),
  nickname: t.string(),
  fullName: t.string(),
  role: userRole,
  joinedAt: t.timestamp(),
});

const Customer = table({
  public: true,
  indexes: [
    { accessor: 'by_grade', algorithm: 'btree', columns: ['grade'] },
  ],
}, {
  id: t.u64().primaryKey().autoInc(),
  name: t.string(),
  grade: customerGrade,
  creditLimitBhd: t.u64(),       // in fils (1 BHD = 1000 fils)
  isCreditBlocked: t.bool(),
  paymentTermsDays: t.u64(),
  notes: t.string(),
  createdAt: t.timestamp(),
  updatedAt: t.timestamp(),
});

const CustomerContact = table({
  public: true,
  indexes: [
    { accessor: 'by_customer', algorithm: 'btree', columns: ['customerId'] },
  ],
}, {
  id: t.u64().primaryKey().autoInc(),
  customerId: t.u64(),
  name: t.string(),
  designation: t.string(),
  phone: t.string(),
  email: t.string(),
  isWhatsApp: t.bool(),
});

const Supplier = table({ public: true }, {
  id: t.u64().primaryKey().autoInc(),
  name: t.string(),               // Endress+Hauser, Servomex, etc.
  productTypes: t.string(),       // Comma-separated
  annualGoalBhd: t.u64(),
  currentYearSalesBhd: t.u64(),
  createdAt: t.timestamp(),
});

const Product = table({
  public: true,
  indexes: [
    { accessor: 'by_supplier', algorithm: 'btree', columns: ['supplierId'] },
  ],
}, {
  id: t.u64().primaryKey().autoInc(),
  supplierId: t.u64(),
  name: t.string(),
  sku: t.string(),
  typicalMarginBps: t.u64(),      // basis points (2500 = 25%)
  unitPriceBhd: t.u64(),          // fils
});

// --- CRM Pipeline ---

const Opportunity = table({
  public: true,
  indexes: [
    { accessor: 'by_customer', algorithm: 'btree', columns: ['customerId'] },
    { accessor: 'by_stage', algorithm: 'btree', columns: ['stage'] },
    { accessor: 'by_owner', algorithm: 'btree', columns: ['ownerId'] },
  ],
}, {
  id: t.u64().primaryKey().autoInc(),
  customerId: t.u64(),
  ownerId: t.identity(),          // Sales person
  title: t.string(),
  stage: opportunityStage,
  estimatedValueBhd: t.u64(),
  winProbabilityBps: t.u64(),     // basis points (5000 = 50%)
  competitorPresent: t.string(),  // "ABB", "none", etc.
  lossReason: t.string().optional(),
  nextFollowUp: t.timestamp().optional(),
  createdAt: t.timestamp(),
  updatedAt: t.timestamp(),
});

const CostingSheet = table({
  public: true,
  indexes: [
    { accessor: 'by_opportunity', algorithm: 'btree', columns: ['opportunityId'] },
  ],
}, {
  id: t.u64().primaryKey().autoInc(),
  opportunityId: t.u64(),
  revision: t.u64(),
  oemPriceBhd: t.u64(),
  markupBps: t.u64(),             // basis points
  additionalCostsBhd: t.u64(),
  totalBhd: t.u64(),
  isApproved: t.bool(),
  approvedBy: t.identity().optional(),
  createdBy: t.identity(),
  createdAt: t.timestamp(),
});

const Offer = table({
  public: true,
  indexes: [
    { accessor: 'by_customer', algorithm: 'btree', columns: ['customerId'] },
    { accessor: 'by_status', algorithm: 'btree', columns: ['status'] },
  ],
}, {
  id: t.u64().primaryKey().autoInc(),
  customerId: t.u64(),
  costingSheetId: t.u64(),
  status: offerStatus,
  totalBhd: t.u64(),
  sentAt: t.timestamp().optional(),
  lossReason: t.string().optional(),
  createdBy: t.identity(),
  createdAt: t.timestamp(),
  updatedAt: t.timestamp(),
});

// --- Orders & Delivery ---

const Order = table({
  public: true,
  indexes: [
    { accessor: 'by_customer', algorithm: 'btree', columns: ['customerId'] },
    { accessor: 'by_status', algorithm: 'btree', columns: ['status'] },
  ],
}, {
  id: t.u64().primaryKey().autoInc(),
  customerId: t.u64(),
  offerId: t.u64(),
  status: orderStatus,
  totalBhd: t.u64(),
  poReference: t.string(),
  expectedDelivery: t.timestamp().optional(),
  createdAt: t.timestamp(),
  updatedAt: t.timestamp(),
});

const OrderItem = table({
  public: true,
  indexes: [
    { accessor: 'by_order', algorithm: 'btree', columns: ['orderId'] },
  ],
}, {
  id: t.u64().primaryKey().autoInc(),
  orderId: t.u64(),
  productId: t.u64(),
  quantity: t.u64(),
  unitPriceBhd: t.u64(),
  totalPriceBhd: t.u64(),
});

// --- Procurement ---

const PurchaseOrder = table({
  public: true,
  indexes: [
    { accessor: 'by_supplier', algorithm: 'btree', columns: ['supplierId'] },
    { accessor: 'by_status', algorithm: 'btree', columns: ['status'] },
  ],
}, {
  id: t.u64().primaryKey().autoInc(),
  supplierId: t.u64(),
  orderId: t.u64().optional(),     // linked customer order
  status: poStatus,
  totalBhd: t.u64(),
  createdBy: t.identity(),
  createdAt: t.timestamp(),
  updatedAt: t.timestamp(),
});

// --- Finance ---

const Invoice = table({
  public: true,
  indexes: [
    { accessor: 'by_customer', algorithm: 'btree', columns: ['customerId'] },
    { accessor: 'by_status', algorithm: 'btree', columns: ['status'] },
  ],
}, {
  id: t.u64().primaryKey().autoInc(),
  customerId: t.u64(),
  orderId: t.u64(),
  status: invoiceStatus,
  subtotalBhd: t.u64(),
  vatBhd: t.u64(),                 // 10% VAT
  totalBhd: t.u64(),
  outstandingBhd: t.u64(),
  dueDate: t.timestamp(),
  createdAt: t.timestamp(),
  updatedAt: t.timestamp(),
});

const Payment = table({
  public: true,
  indexes: [
    { accessor: 'by_invoice', algorithm: 'btree', columns: ['invoiceId'] },
    { accessor: 'by_customer', algorithm: 'btree', columns: ['customerId'] },
  ],
}, {
  id: t.u64().primaryKey().autoInc(),
  invoiceId: t.u64(),
  customerId: t.u64(),
  amountBhd: t.u64(),
  reference: t.string(),
  receivedAt: t.timestamp(),
  createdAt: t.timestamp(),
});

const SupplierInvoice = table({
  public: true,
  indexes: [
    { accessor: 'by_supplier', algorithm: 'btree', columns: ['supplierId'] },
    { accessor: 'by_po', algorithm: 'btree', columns: ['purchaseOrderId'] },
  ],
}, {
  id: t.u64().primaryKey().autoInc(),
  supplierId: t.u64(),
  purchaseOrderId: t.u64(),
  status: invoiceStatus,
  totalBhd: t.u64(),
  outstandingBhd: t.u64(),
  dueDate: t.timestamp(),
  createdAt: t.timestamp(),
});

const SupplierPayment = table({
  public: true,
  indexes: [
    { accessor: 'by_supplier_invoice', algorithm: 'btree', columns: ['supplierInvoiceId'] },
  ],
}, {
  id: t.u64().primaryKey().autoInc(),
  supplierInvoiceId: t.u64(),
  amountBhd: t.u64(),
  reference: t.string(),
  paidAt: t.timestamp(),
  createdAt: t.timestamp(),
});

// --- System ---

const ActivityEvent = table({ public: true }, {
  id: t.u64().primaryKey().autoInc(),
  kind: eventKind,
  actor: t.identity(),
  entityType: t.string(),         // "invoice", "order", "payment", etc.
  entityId: t.u64(),
  description: t.string(),
  createdAt: t.timestamp(),
});

const FollowUp = table({
  public: true,
  indexes: [
    { accessor: 'by_owner', algorithm: 'btree', columns: ['ownerId'] },
    { accessor: 'by_due', algorithm: 'btree', columns: ['dueAt'] },
  ],
}, {
  id: t.u64().primaryKey().autoInc(),
  ownerId: t.identity(),
  entityType: t.string(),
  entityId: t.u64(),
  note: t.string(),
  dueAt: t.timestamp(),
  completedAt: t.timestamp().optional(),
  createdAt: t.timestamp(),
});
```

### Key Reducers — The Invariant Rules

```typescript
// --- Reducer examples (index.ts) ---

// INVARIANT: D-grade customers need 100% advance
// INVARIANT: Credit-blocked customers cannot create new orders
// INVARIANT: PO financial fields locked after Approved
// INVARIANT: Lost offers cannot be re-won
// INVARIANT: Payment cannot exceed outstanding
// INVARIANT: VAT is always 10%
// INVARIANT: Costing markup < 20% needs manager approval
// INVARIANT: Costing markup < 12% needs owner approval

export const create_invoice = spacetimedb.reducer({
  orderId: t.u64(),
  lineItems: t.array(t.object('InvoiceLineItem', {
    productId: t.u64(),
    quantity: t.u64(),
    unitPriceBhd: t.u64(),
  })),
}, (ctx, args) => {
  const member = ctx.db.member.identity.find(ctx.sender);
  if (!member) throw new SenderError('Not a member');

  // Permission check — only Accountant, Manager, Admin
  if (member.role.tag !== 'Accountant' &&
      member.role.tag !== 'Manager' &&
      member.role.tag !== 'Admin') {
    throw new SenderError('Insufficient permissions');
  }

  const order = ctx.db.order.id.find(args.orderId);
  if (!order) throw new SenderError('Order not found');

  const customer = ctx.db.customer.id.find(order.customerId);
  if (!customer) throw new SenderError('Customer not found');

  // INVARIANT: Credit-blocked customers
  if (customer.isCreditBlocked) {
    throw new SenderError('Customer is credit-blocked');
  }

  // Calculate totals
  let subtotal = 0n;
  for (const item of args.lineItems) {
    subtotal += item.quantity * item.unitPriceBhd;
  }
  const vat = subtotal / 10n;     // INVARIANT: 10% VAT
  const total = subtotal + vat;

  // INVARIANT: D-grade with outstanding? Reject.
  if (customer.grade.tag === 'D') {
    // Check for any unpaid invoices
    for (const inv of ctx.db.invoice.by_customer.filter(customer.id)) {
      if (inv.outstandingBhd > 0n) {
        throw new SenderError('D-grade customer has unpaid invoices — 100% advance required');
      }
    }
  }

  // Calculate due date from customer payment terms
  const dueMicros = ctx.timestamp.microsSinceUnixEpoch +
    BigInt(customer.paymentTermsDays) * 86_400_000_000n;

  const invoice = ctx.db.invoice.insert({
    id: 0n,
    customerId: customer.id,
    orderId: args.orderId,
    status: { tag: 'Sent' },
    subtotalBhd: subtotal,
    vatBhd: vat,
    totalBhd: total,
    outstandingBhd: total,
    dueDate: { microsSinceUnixEpoch: dueMicros },
    createdAt: ctx.timestamp,
    updatedAt: ctx.timestamp,
  });

  // Emit event
  ctx.db.activityEvent.insert({
    id: 0n,
    kind: { tag: 'InvoiceCreated' },
    actor: ctx.sender,
    entityType: 'invoice',
    entityId: invoice.id,
    description: `Invoice created for ${customer.name}: ${Number(total) / 1000} BHD`,
    createdAt: ctx.timestamp,
  });
});

// PO State Machine — INVARIANT: terminal states can't revert
export const update_po_status = spacetimedb.reducer({
  poId: t.u64(),
  newStatus: poStatus,
}, (ctx, args) => {
  const po = ctx.db.purchaseOrder.id.find(args.poId);
  if (!po) throw new SenderError('PO not found');

  // Terminal states
  if (po.status.tag === 'Received' || po.status.tag === 'Cancelled') {
    throw new SenderError(`PO is in terminal state: ${po.status.tag}`);
  }

  // Valid transitions
  const VALID: Record<string, string[]> = {
    Draft: ['Approved', 'Cancelled'],
    Approved: ['Sent', 'Cancelled'],
    Sent: ['PartiallyReceived', 'Received', 'Cancelled'],
    PartiallyReceived: ['Received'],
  };

  const allowed = VALID[po.status.tag] ?? [];
  if (!allowed.includes(args.newStatus.tag)) {
    throw new SenderError(
      `Cannot transition PO from ${po.status.tag} to ${args.newStatus.tag}`
    );
  }

  // INVARIANT: financial fields locked after Approved
  // (enforced by NOT having a reducer that changes them post-approval)

  ctx.db.purchaseOrder.id.update({
    ...po,
    status: args.newStatus,
    updatedAt: ctx.timestamp,
  });
});

// Payment — INVARIANT: cannot exceed outstanding
export const record_payment = spacetimedb.reducer({
  invoiceId: t.u64(),
  amountBhd: t.u64(),
  reference: t.string(),
}, (ctx, args) => {
  if (args.amountBhd === 0n) throw new SenderError('Amount must be > 0');

  const invoice = ctx.db.invoice.id.find(args.invoiceId);
  if (!invoice) throw new SenderError('Invoice not found');

  // INVARIANT: payment cannot exceed outstanding
  if (args.amountBhd > invoice.outstandingBhd) {
    throw new SenderError(
      `Payment ${args.amountBhd} exceeds outstanding ${invoice.outstandingBhd}`
    );
  }

  ctx.db.payment.insert({
    id: 0n,
    invoiceId: args.invoiceId,
    customerId: invoice.customerId,
    amountBhd: args.amountBhd,
    reference: args.reference,
    receivedAt: ctx.timestamp,
    createdAt: ctx.timestamp,
  });

  // Update invoice
  const newOutstanding = invoice.outstandingBhd - args.amountBhd;
  const newStatus = newOutstanding === 0n
    ? { tag: 'Paid' as const }
    : { tag: 'PartiallyPaid' as const };

  ctx.db.invoice.id.update({
    ...invoice,
    outstandingBhd: newOutstanding,
    status: newStatus,
    updatedAt: ctx.timestamp,
  });

  ctx.db.activityEvent.insert({
    id: 0n,
    kind: { tag: 'PaymentReceived' },
    actor: ctx.sender,
    entityType: 'payment',
    entityId: 0n,
    description: `Payment of ${Number(args.amountBhd) / 1000} BHD received for invoice #${args.invoiceId}`,
    createdAt: ctx.timestamp,
  });
});
```

---

## Implementation Sequence

### Sprint 1: Foundation (The Substrate)
- [ ] STDB module: schema.ts with all tables + enums
- [ ] Core reducers: member join, customer CRUD, supplier CRUD
- [ ] Invoice + payment reducers with all invariants
- [ ] PO state machine reducer
- [ ] Publish to STDB maincloud
- [ ] Svelte 5 client: connect, subscribe, render members
- [ ] **Deliverable**: Working data layer with invariants enforced

### Sprint 2: CRM Pipeline
- [ ] Opportunity CRUD + stage transitions
- [ ] Costing sheet with markup approval logic
- [ ] Offer lifecycle (Draft -> Sent -> Accepted/Rejected/Lost)
- [ ] Order creation from accepted offers
- [ ] Follow-up system with due dates
- [ ] **Deliverable**: Full sales pipeline, multiplayer

### Sprint 3: Finance & Operations
- [ ] Invoice creation from orders (with VAT)
- [ ] Payment recording + reconciliation
- [ ] Supplier invoices + payments
- [ ] PO lifecycle with financial field protection
- [ ] GRN / partial receiving
- [ ] Activity event log (all mutations emit events)
- [ ] **Deliverable**: Full finance + procurement

### Sprint 4: Intelligence Layer
- [ ] AI chat (Grok via AIMLAPI) with full ledger context
- [ ] Win probability calculator (ABB presence, customer grade, product type)
- [ ] Payment predictor (grade-based, seasonal adjustments)
- [ ] Pricing advisor (optimal discount per customer/competition)
- [ ] Arabic document processing (Sarvam OCR + translate)
- [ ] **Deliverable**: AI that acts, not just reports

### Sprint 5: Polish & Ship
- [ ] Role-based views (Sales sees pipeline, Accountant sees finance)
- [ ] Dashboard per role (SPOC flow spec)
- [ ] PDF generation (invoices, costing sheets, reports)
- [ ] Data migration tool (AsymmFlow SQLite -> STDB)
- [ ] Neutralino desktop wrapper (optional)
- [ ] **Deliverable**: Production-ready for PH Trading team

---

## Key Decisions

### Currency: BHD in Fils
All monetary amounts stored as u64 in **fils** (1 BHD = 1000 fils).
This gives us integer math throughout — no floating point currency bugs.
Display: `(amount / 1000).toFixed(3)` for BHD with 3 decimal places.

### RBAC: Identity + Role in Member Table
STDB identity is the primary key. Role stored in member table.
Every reducer checks `ctx.sender` -> member lookup -> role check.
No separate auth system needed. No license keys. No device fingerprinting.

Views filter data per-role:
- Sales: sees their own opportunities + shared customers
- Accountant: sees finance tables
- Manager: sees everything except admin
- Admin: sees everything

### State Machines: Enforced by Reducer Logic
No separate state machine service. The reducer IS the state machine.
Invalid transitions throw SenderError. Terminal states are checked first.
Financial fields on POs are immutable after approval because there's
simply no reducer that allows changing them post-approval.

### AI Integration: Client-Side + Procedures
- Chat/reasoning: client-side (browser calls AI API directly)
- OCR/translation: STDB procedures (server-side, has HTTP access)
- Context building: client reads tables, builds prompt, sends to AI

### Open Source: asymm-kit Modules
Each functional area becomes a reusable module:
- `@asymm/ledger` — invoices, payments, reconciliation
- `@asymm/crm` — customers, opportunities, offers, orders
- `@asymm/procurement` — suppliers, POs, GRN
- `@asymm/intelligence` — AI chat, predictors, advisors

---

## Size Estimate

| Component | Estimated LOC |
|---|---|
| schema.ts (all tables + enums) | ~400 |
| index.ts (all reducers) | ~2,000 |
| Svelte frontend (all screens) | ~8,000 |
| AI integration (chat, translate) | ~500 |
| Utilities (formatting, PDF) | ~1,000 |
| **Total** | **~12,000** |

**vs current AsymmFlow: ~156,000 LOC**

That's a **13x reduction** with MORE functionality (real-time multiplayer,
AI agents, browser-first, multilingual, open source).

---

## Why STDB Community Will Love This

1. **Real business** — not a todo app, an actual ERP serving a real company in Bahrain
2. **Showcases advanced patterns** — state machines, financial invariants, RBAC via views
3. **Multi-model AI integration** — Grok + Sarvam + Claude working with STDB
4. **Open source** — other businesses can fork and adapt
5. **156K -> 12K LOC story** — that's a headline

---

## Tomorrow's Kick-Off Checklist

- [ ] Create STDB module in `003-asymmflow-reimagined/module/`
- [ ] Write schema.ts (start from the tables above)
- [ ] Write first 3 reducers (member_join, create_customer, create_invoice)
- [ ] Publish to maincloud as `asymm-flow`
- [ ] Generate bindings, connect Svelte client
- [ ] See first data flowing in real-time
- [ ] Celebrate

---

*"The ERP doesn't organize chaos. It holds the invariants.*
*The agents handle the chaos. The humans make the decisions."*

**Om Lokah Samastah Sukhino Bhavantu**
