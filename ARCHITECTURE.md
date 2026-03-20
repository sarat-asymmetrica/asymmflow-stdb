# AsymmFlow Reimagined — Architecture Document (SSOT)
## Chat-First Agentic ERP on Neutralino + SpacetimeDB + Living Geometry

**Date**: 2026-03-08
**Status**: Architecture Complete — Ready for Build
**Author**: Commander (Sarat) + Claude
**Origin**: 5hr SPOC meetings + 6 parallel mathematical audits + asset mapping

---

## 1. The Paradigm Shift

> "If you make a bad business model function more optimally, you're not really
> doing anything to get them towards profitability. You just have a nice
> interface to watch yourself bleed."

### What Changes

| Traditional ERP | AsymmFlow Reimagined |
|----------------|---------------------|
| System of record | System of action |
| AI answers questions | AI performs tasks (with approval) |
| Users navigate 43 screens | Users talk to a chat that knows everything |
| Desktop .exe via Wails (156K LOC) | Desktop .exe via Neutralino (~6,500 LOC) |
| SQLite + Supabase sync | STDB multiplayer (zero sync layer) |
| Fixed templates, fixed workflows | Skills-based, delegatable, adaptive |
| Organize chaos | Hold invariants, let agents handle chaos |

### The SPOC's Dream (Abhie's User Journey)

```
Abhie: "Take the Q1 invoices folder, pull the Excel files,
        and generate a PowerPoint showing revenue by customer grade"

AI: "I'll do that. Here's my plan:
     1. Scan Q1_Invoices/ folder (23 files found)
     2. OCR + extract amounts and customer references
     3. Cross-reference customer grades from our database
     4. Aggregate: Grade A = 45K, B = 23K, C = 12K, D = 3K BHD
     5. Generate PowerPoint with bar charts

     [Approve]  [Edit Plan]  [Cancel]"

Abhie: [Approve]

AI: "Done! Saved to Desktop/Q1_Revenue_by_Grade.pptx
     Total: 83K BHD across 23 invoices.
     Note: 3 invoices from D-grade customers — recommend
     stopping service per our policy."
```

This isn't a feature request. This is the WHOLE PRODUCT.

---

## 2. Architecture — Three Concentric Rings

```
+================================================================+
|                     NEUTRALINO SHELL                            |
|  Native .exe (Windows/Mac/Linux) — ~2MB binary                 |
|  File system access, process spawning, native dialogs           |
|  System webview (no Chromium bundled)                           |
|                                                                 |
|  +============================================================+|
|  |              SVELTE 5 + LIVING GEOMETRY UI                  ||
|  |  Chat-first interface with Hub pages behind it              ||
|  |  Living Geometry tokens: Fibonacci spacing, phi typography  ||
|  |  Wabi-sabi aesthetic: warm, human, mathematically grounded  ||
|  |  ~30 components (distilled from AsymmFlow's 177)            ||
|  |                                                              ||
|  |  +========================================================+||
|  |  |            STDB INVARIANT SUBSTRATE                     |||
|  |  |  10 tables (unified from audit's 17)                    |||
|  |  |  8 reducers (universal state machine)                   |||
|  |  |  Business rules that MUST hold                          |||
|  |  |  Real-time multiplayer, zero sync                       |||
|  |  +========================================================+||
|  |                                                              ||
|  |  +========================================================+||
|  |  |            AI AGENT + SKILLS LAYER                      |||
|  |  |  Chat model: Grok (reasoning) + Sarvam (multilingual)  |||
|  |  |  Skills: file ops, OCR, PPTX gen, payment chasing      |||
|  |  |  Approval gate: pending -> approved -> executed          |||
|  |  |  Full audit trail in AiAction table                     |||
|  |  +========================================================+||
|  +============================================================+|
+================================================================+
```

### Why Neutralino (Not Wails, Not Electron, Not Browser-Only)

| Factor | Neutralino | Wails | Electron | Browser |
|--------|-----------|-------|----------|---------|
| Binary size | ~2MB | ~10MB | ~150MB | 0 |
| File system | Yes (native API) | Yes (Go) | Yes (Node) | No |
| Process spawn | Yes | Yes (Go) | Yes (Node) | No |
| System webview | Yes | Yes | No (Chromium) | N/A |
| Multi-platform | Win/Mac/Linux/ARM | Win/Mac/Linux | Win/Mac/Linux | All |
| Build complexity | npm scripts | Go toolchain | npm + rebuild | npm |
| **Existing code** | **001-ledger desktop** | Current AsymmFlow | None | 001-ledger web |

**Key**: Neutralino gives us file system access (Abhie's folder scanning dream)
without bundling Chromium (150MB → 2MB). We already have a working Neutralino
config from 001-ledger that we can adapt.

### Why STDB Stays as Source of Truth

The Neutralino shell provides *capabilities* (files, processes, dialogs).
STDB provides *truth* (business state, multiplayer sync, invariants).

```
Neutralino APIs:                STDB:
- os.scanDir()                  - Invoice table (truth)
- os.readFile()                 - Payment table (truth)
- os.showOpenDialog()           - Customer table (truth)
- Neutralino.process.spawn()    - Reducers (invariants)
- Neutralino.clipboard.*        - Views (RBAC)
                                - Real-time subscriptions
```

The AI agent bridges both: reads STDB for context, uses Neutralino for actions.

---

## 3. STDB Schema — Unified 10 Tables

The Mirzakhani+Grothendieck audit proved: 17 tables reduce to 10 via the
universal state machine pattern. All 6 state machines (Invoice, PO, Offer,
Order, Opportunity, SupplierInvoice) are algebraically identical — partial
monoid over directed transition graph.

### Enums

```typescript
// schema.ts — The Invariant Substrate

import { table, reducer, t, spacetimedb } from '@clockworklabs/spacetimedb-sdk/server';

// --- State Machine Enum (Universal) ---
// Each entity type uses a SUBSET of these states.
// The reducer enforces which transitions are valid per entity type.

const entityStatus = t.enum('EntityStatus', {
  Draft: t.unit(),
  Active: t.unit(),        // Sent, Approved, Confirmed, Qualified
  InProgress: t.unit(),    // PartiallyPaid, PartiallyReceived, InProduction
  Terminal: t.unit(),      // Paid, Received, Delivered, ClosedWon
  Cancelled: t.unit(),     // Cancelled, Rejected, ClosedLost
});

const entityType = t.enum('EntityType', {
  Invoice: t.unit(),
  Payment: t.unit(),
  PurchaseOrder: t.unit(),
  Offer: t.unit(),
  Order: t.unit(),
  Opportunity: t.unit(),
  Customer: t.unit(),
  Supplier: t.unit(),
  CostingSheet: t.unit(),
  FollowUp: t.unit(),
});

const customerGrade = t.enum('CustomerGrade', {
  A: t.unit(),  // Pay within 45 days — max 7% discount
  B: t.unit(),  // Pay within 90 days — max 3% discount
  C: t.unit(),  // Pay when they feel like it — 0%, 50% advance
  D: t.unit(),  // Chase 6+ months — 100% advance or decline
});

const userRole = t.enum('UserRole', {
  Admin: t.unit(),       // Abhie — full access
  Manager: t.unit(),     // Sales managers — approve costings
  Sales: t.unit(),       // Sales team — pipeline + customers
  Operations: t.unit(),  // POs, GRNs, delivery
  Accountant: t.unit(),  // Finance — invoices, payments, bank recon
});

const aiActionStatus = t.enum('AiActionStatus', {
  Proposed: t.unit(),    // AI suggests action
  Approved: t.unit(),    // Human approves
  Executed: t.unit(),    // Action completed
  Rejected: t.unit(),    // Human rejects
  Failed: t.unit(),      // Execution failed
});
```

### Tables (10 Unified)

```typescript
// --- 1. Member (authentication + RBAC) ---
const Member = table({ public: true }, {
  identity: t.identity().primaryKey(),
  nickname: t.string(),
  fullName: t.string(),
  role: userRole,
  joinedAt: t.timestamp(),
});

// --- 2. Party (Customer + Supplier unified) ---
// Insight: Customers and Suppliers share 80% of fields.
// A Party can be BOTH (e.g., a company that buys AND sells to us).
const Party = table({
  public: true,
  indexes: [
    { accessor: 'by_grade', algorithm: 'btree', columns: ['grade'] },
  ],
}, {
  id: t.u64().primaryKey().autoInc(),
  name: t.string(),
  isCustomer: t.bool(),
  isSupplier: t.bool(),
  grade: customerGrade,              // only meaningful if isCustomer
  creditLimitFils: t.u64(),          // 1 BHD = 1000 fils
  isCreditBlocked: t.bool(),
  paymentTermsDays: t.u64(),
  productTypes: t.string(),          // for suppliers: "E+H,Servomex"
  annualGoalFils: t.u64(),           // for suppliers: annual target
  notes: t.string(),
  createdAt: t.timestamp(),
  updatedAt: t.timestamp(),
});

// --- 3. Contact (linked to Party) ---
const Contact = table({
  public: true,
  indexes: [
    { accessor: 'by_party', algorithm: 'btree', columns: ['partyId'] },
  ],
}, {
  id: t.u64().primaryKey().autoInc(),
  partyId: t.u64(),
  name: t.string(),
  designation: t.string(),
  phone: t.string(),
  email: t.string(),
  isWhatsApp: t.bool(),
});

// --- 4. Pipeline (Opportunity + CostingSheet + Offer unified) ---
// Insight: These three are stages of the SAME business flow.
// An opportunity becomes a costing becomes an offer becomes an order.
const Pipeline = table({
  public: true,
  indexes: [
    { accessor: 'by_party', algorithm: 'btree', columns: ['partyId'] },
    { accessor: 'by_owner', algorithm: 'btree', columns: ['ownerId'] },
    { accessor: 'by_status', algorithm: 'btree', columns: ['status'] },
  ],
}, {
  id: t.u64().primaryKey().autoInc(),
  partyId: t.u64(),                  // customer
  ownerId: t.identity(),             // sales person
  title: t.string(),
  status: entityStatus,
  // Opportunity fields
  estimatedValueFils: t.u64(),
  winProbabilityBps: t.u64(),        // basis points (5000 = 50%)
  competitorPresent: t.string(),     // "ABB", "none", etc.
  // Costing fields
  oemPriceFils: t.u64(),
  markupBps: t.u64(),
  additionalCostsFils: t.u64(),
  costingApproved: t.bool(),
  costingApprovedBy: t.identity().optional(),
  // Offer fields
  offerTotalFils: t.u64(),
  offerSentAt: t.timestamp().optional(),
  lossReason: t.string().optional(),
  // Metadata
  nextFollowUp: t.timestamp().optional(),
  revision: t.u64(),
  createdAt: t.timestamp(),
  updatedAt: t.timestamp(),
});

// --- 5. Order (customer orders) ---
const Order = table({
  public: true,
  indexes: [
    { accessor: 'by_party', algorithm: 'btree', columns: ['partyId'] },
    { accessor: 'by_status', algorithm: 'btree', columns: ['status'] },
  ],
}, {
  id: t.u64().primaryKey().autoInc(),
  partyId: t.u64(),                  // customer
  pipelineId: t.u64(),              // from which pipeline item
  status: entityStatus,
  totalFils: t.u64(),
  poReference: t.string(),
  expectedDelivery: t.timestamp().optional(),
  createdAt: t.timestamp(),
  updatedAt: t.timestamp(),
});

// --- 6. LineItem (shared by Order, PO, Invoice) ---
const LineItem = table({
  public: true,
  indexes: [
    { accessor: 'by_parent', algorithm: 'btree', columns: ['parentType', 'parentId'] },
  ],
}, {
  id: t.u64().primaryKey().autoInc(),
  parentType: entityType,            // Order, PurchaseOrder, Invoice
  parentId: t.u64(),
  description: t.string(),
  quantity: t.u64(),
  unitPriceFils: t.u64(),
  totalPriceFils: t.u64(),
});

// --- 7. PurchaseOrder (supplier orders) ---
const PurchaseOrder = table({
  public: true,
  indexes: [
    { accessor: 'by_party', algorithm: 'btree', columns: ['partyId'] },
    { accessor: 'by_status', algorithm: 'btree', columns: ['status'] },
  ],
}, {
  id: t.u64().primaryKey().autoInc(),
  partyId: t.u64(),                  // supplier
  orderId: t.u64().optional(),       // linked customer order
  status: entityStatus,
  totalFils: t.u64(),
  createdBy: t.identity(),
  createdAt: t.timestamp(),
  updatedAt: t.timestamp(),
});

// --- 8. MoneyEvent (Invoice + Payment + SupplierInvoice + SupplierPayment) ---
// Insight from Ramanujan+Hamilton audit: All financial events are the same
// structure — an amount, a direction (in/out), linked to a party.
// "outstanding" is NEVER stored — it's computed from sum of money events.
const MoneyEvent = table({
  public: true,
  indexes: [
    { accessor: 'by_party', algorithm: 'btree', columns: ['partyId'] },
    { accessor: 'by_kind', algorithm: 'btree', columns: ['kind'] },
    { accessor: 'by_status', algorithm: 'btree', columns: ['status'] },
  ],
}, {
  id: t.u64().primaryKey().autoInc(),
  partyId: t.u64(),
  orderId: t.u64().optional(),       // linked order or PO
  kind: t.string(),                  // "customer_invoice", "customer_payment",
                                     // "supplier_invoice", "supplier_payment"
  status: entityStatus,
  subtotalFils: t.u64(),
  vatFils: t.u64(),                  // 10% VAT (Bahrain)
  totalFils: t.u64(),
  reference: t.string(),            // invoice number, payment ref, cheque #
  dueDate: t.timestamp().optional(),
  paidAt: t.timestamp().optional(),
  createdBy: t.identity(),
  createdAt: t.timestamp(),
  updatedAt: t.timestamp(),
});

// --- 9. ActivityLog (audit trail + follow-ups) ---
const ActivityLog = table({
  public: true,
  indexes: [
    { accessor: 'by_entity', algorithm: 'btree', columns: ['entityType', 'entityId'] },
    { accessor: 'by_actor', algorithm: 'btree', columns: ['actorId'] },
    { accessor: 'by_due', algorithm: 'btree', columns: ['followUpDue'] },
  ],
}, {
  id: t.u64().primaryKey().autoInc(),
  actorId: t.identity(),
  entityType: entityType,
  entityId: t.u64(),
  action: t.string(),               // "created", "status_changed", "payment_received"
  detail: t.string(),               // human-readable description
  followUpDue: t.timestamp().optional(),  // if this is a follow-up
  followUpDone: t.bool(),
  createdAt: t.timestamp(),
});

// --- 10. AiAction (agent proposals with approval gate) ---
const AiAction = table({
  public: true,
  indexes: [
    { accessor: 'by_status', algorithm: 'btree', columns: ['status'] },
    { accessor: 'by_requestor', algorithm: 'btree', columns: ['requestorId'] },
  ],
}, {
  id: t.u64().primaryKey().autoInc(),
  requestorId: t.identity(),        // who asked the AI
  skillName: t.string(),            // "invoice_ocr", "payment_chase", "pptx_generate"
  plan: t.string(),                 // JSON: what the AI plans to do
  status: aiActionStatus,
  approvedBy: t.identity().optional(),
  result: t.string(),               // JSON: what happened
  errorMessage: t.string().optional(),
  createdAt: t.timestamp(),
  updatedAt: t.timestamp(),
});
```

### Key Design Decisions

**"outstanding" is NEVER stored**: The Phase 18 reconciliation bug (313 invoices
drifted from reality) proved that materialized derived state corrupts. Instead:

```typescript
// COMPUTED, not stored:
function outstandingForParty(partyId: u64, ctx: ReducerContext): bigint {
  let invoiced = 0n;
  let paid = 0n;
  for (const me of ctx.db.moneyEvent.by_party.filter(partyId)) {
    if (me.kind === 'customer_invoice') invoiced += me.totalFils;
    if (me.kind === 'customer_payment') paid += me.totalFils;
  }
  return invoiced - paid;
}
```

**Party unification**: A company like "Al Ezzel Power" might be both a customer
(they buy meters from us) AND a supplier (they provide commissioning services).
One Party row, two booleans: `isCustomer`, `isSupplier`.

**Pipeline unification**: Opportunity → Costing → Offer is one continuous flow,
not three separate tables. The `revision` field tracks costing iterations.
When an offer is accepted, an Order is created from the Pipeline item.

**MoneyEvent pattern**: Every financial transaction is a MoneyEvent with a `kind`
discriminator. This makes bank reconciliation trivial — just match MoneyEvents
to bank statement rows by amount + date range.

---

## 4. Universal State Machine — 8 Reducers

From the Mirzakhani+Grothendieck audit: all state machines are algebraically
identical. One generic transition reducer handles all entity types.

```typescript
// Valid transitions per entity type
const TRANSITIONS: Record<string, Record<string, string[]>> = {
  // Pipeline: Draft -> Active (sent) -> Terminal (won) or Cancelled (lost)
  Pipeline: {
    Draft: ['Active', 'Cancelled'],
    Active: ['InProgress', 'Terminal', 'Cancelled'],  // negotiation, won, lost
    InProgress: ['Terminal', 'Cancelled'],
  },
  // Order: Draft -> Active (confirmed) -> InProgress (shipped) -> Terminal (delivered)
  Order: {
    Draft: ['Active', 'Cancelled'],
    Active: ['InProgress', 'Cancelled'],
    InProgress: ['Terminal'],
  },
  // PurchaseOrder: same shape as Order
  PurchaseOrder: {
    Draft: ['Active', 'Cancelled'],
    Active: ['InProgress', 'Cancelled'],
    InProgress: ['Terminal'],
  },
  // MoneyEvent (invoice): Draft -> Active (sent) -> InProgress (partial) -> Terminal (paid)
  MoneyEvent: {
    Draft: ['Active', 'Cancelled'],
    Active: ['InProgress', 'Terminal', 'Cancelled'],
    InProgress: ['Terminal'],
  },
};
```

### The 8 Reducers

```
1. join_member          — Register user with role (Admin creates first, then invites)
2. upsert_party         — Create/update customer or supplier (with grade logic)
3. upsert_contact       — Create/update contact for a party
4. advance_pipeline     — Move opportunity through stages (costing, offer, close)
5. manage_order         — Create order from pipeline, update status
6. manage_purchase_order — Create PO linked to order, update status
7. record_money_event   — Create invoice, record payment (with invariant checks)
8. log_activity         — Record any action, create follow-ups
```

Plus 2 system reducers:
```
9. propose_ai_action    — AI submits a plan for approval
10. resolve_ai_action   — Human approves/rejects, system executes
```

---

## 5. Skills Architecture — AI That Acts

### The Skill Registry

```typescript
interface Skill {
  name: string;
  description: string;         // shown in approval UI
  category: 'data' | 'file' | 'intelligence' | 'communication';
  approval: 'auto' | 'explicit' | 'admin_only';
  requiredRole: UserRole[];    // who can invoke this skill
  execute: (args: SkillArgs, ctx: SkillContext) => Promise<SkillResult>;
}

// SkillContext provides access to both STDB and Neutralino
interface SkillContext {
  stdb: SpacetimeDBConnection;  // read/write business state
  fs: NeutralinoFS;             // file system operations
  ai: AIClient;                 // Grok, Sarvam, Claude
  user: Member;                 // who's logged in
}
```

### Skill Categories

#### Data Skills (STDB operations)
| Skill | Approval | Description |
|-------|----------|-------------|
| `query_dashboard` | auto | Aggregate KPIs from STDB tables |
| `query_customer_360` | auto | Full customer view with history |
| `create_invoice` | explicit | Create invoice (calls reducer) |
| `record_payment` | explicit | Record payment (calls reducer) |
| `chase_payment` | explicit | Generate WhatsApp draft for overdue invoices |
| `update_customer_grade` | admin_only | Change customer grade (financial impact) |

#### File Skills (Neutralino operations)
| Skill | Approval | Description |
|-------|----------|-------------|
| `scan_folder` | explicit | List files in a folder |
| `ocr_document` | auto | OCR a PDF/image via Sarvam Vision |
| `read_excel` | auto | Parse Excel file into structured data |
| `generate_pptx` | explicit | Create PowerPoint from data |
| `generate_pdf_invoice` | explicit | Render invoice as PDF |
| `export_to_excel` | explicit | Export query results to Excel |

#### Intelligence Skills (AI analysis)
| Skill | Approval | Description |
|-------|----------|-------------|
| `pricing_advisor` | auto | Optimal discount given customer + competition |
| `win_probability` | auto | Logistic regression on pipeline item |
| `cashflow_forecast` | auto | 30/60/90 day projection via Euler ODE |
| `payment_predictor` | auto | When will this customer pay? (Markov chain) |
| `fraud_detector` | auto | Benford's Law + digital root on amounts |
| `customer_risk` | auto | Spectral scoring from payment history |

#### Communication Skills
| Skill | Approval | Description |
|-------|----------|-------------|
| `draft_whatsapp` | explicit | Draft WhatsApp message (user sends manually) |
| `draft_email` | explicit | Draft email for review |
| `translate_document` | auto | Arabic/Hindi translation via Sarvam |

### Approval Flow

```
User: "Chase payments for overdue invoices"

1. AI queries STDB → finds 7 overdue invoices
2. AI creates AiAction {
     skillName: "chase_payment",
     plan: JSON.stringify({
       invoices: [101, 103, 107, 112, 115, 118, 122],
       action: "Generate WhatsApp drafts per customer grade",
       gradeA: "Gentle reminder with reference",
       gradeB: "Firm reminder with payment terms",
       gradeC: "Stop service warning",
       gradeD: "Final notice — service suspended"
     }),
     status: "Proposed"
   }
3. UI shows approval card with plan details
4. User clicks [Approve]
5. System calls resolve_ai_action reducer → status = "Approved"
6. Skill executes → generates 7 WhatsApp draft messages
7. Status → "Executed", result stored in AiAction row
8. User reviews each draft, sends manually from phone
```

**The "120-foot moment"**: Abhie reviews a draft, taps send on WhatsApp,
customer pays within 24 hours. The AI did 90% of the work; Abhie made
the decision and pressed the button.

---

## 6. UI Architecture — Chat-First + Hub Pages

### Layout

```
+-----------------------------------------------------------+
|  Header: Logo + User + Role + Connection Status            |
+--------+--------------------------------------------------+
|        |                                                   |
| Side   |  MAIN AREA                                        |
| Nav    |                                                   |
|        |  Default: Chat Interface                           |
| [Chat] |  ┌──────────────────────────────────────────┐    |
| [Dash] |  │ Messages + AI responses + approval cards  │    |
| [Sales]|  │                                           │    |
| [Ops]  |  │                                           │    |
| [$$]   |  │                                           │    |
| [CRM]  |  └──────────────────────────────────────────┘    |
| [Intel]|  ┌──────────────────────────────────────────┐    |
| [Set]  |  │ Input: "Chase overdue payments..."        │    |
|        |  └──────────────────────────────────────────┘    |
+--------+--------------------------------------------------+
```

When user clicks a Hub page (Dashboard, Sales, etc.), the main area switches
to the traditional ERP view. But the chat is always accessible — it's the
PRIMARY interface, not a sidebar feature.

### Design System — Living Geometry Tokens

Borrowed from `living_geometry/02_DESIGN_TOKENS.md`, adapted for business:

```css
:root {
  /* Paper & Ink (warm, not stark) */
  --paper: #fdfbf7;              /* warm white (wabi-sabi) */
  --paper-elevated: #f5f3ef;     /* subtle elevation */
  --ink: #1c1c1c;                /* warm black */
  --ink-60: rgba(28,28,28,0.6);  /* secondary text */
  --ink-30: rgba(28,28,28,0.3);  /* tertiary text */
  --ink-12: rgba(28,28,28,0.12); /* borders */
  --ink-06: rgba(28,28,28,0.06); /* subtle backgrounds */

  /* Accent: Kintsugi Gold (sole accent — marks where intentions meet) */
  --gold: #c5a059;
  --gold-soft: rgba(197,160,89,0.15);

  /* Semantic (from Living Geometry, aligned with AsymmFlow) */
  --sage: #7a9f80;               /* success, positive cash flow */
  --coral: #c4796b;              /* warning, overdue, ABB competitor */
  --stone: #8b8680;              /* neutral, disabled */

  /* Typography (4 fonts, one role each) */
  --font-display: 'Cinzel', serif;        /* headers, logo */
  --font-body: 'Lora', serif;             /* body text, messages */
  --font-ui: 'Outfit', sans-serif;        /* labels, buttons, nav */
  --font-data: 'Courier Prime', monospace; /* numbers, amounts, dates */

  /* Spacing (Fibonacci scale) */
  --sp-0: 0; --sp-1: 1px; --sp-2: 2px; --sp-3: 3px;
  --sp-4: 4px; --sp-6: 6px; --sp-8: 8px; --sp-10: 10px;
  --sp-12: 12px; --sp-14: 14px; --sp-16: 16px; --sp-20: 20px;
  --sp-24: 24px; --sp-28: 28px; --sp-32: 32px; --sp-40: 40px;
  --sp-48: 48px; --sp-60: 60px; --sp-80: 80px;

  /* Animation (Fibonacci timing — feels organic) */
  --dur-instant: 89ms;
  --dur-fast: 144ms;
  --dur-normal: 233ms;
  --dur-slow: 377ms;
  --dur-slower: 610ms;
  --dur-breath: 6000ms;

  /* Easing */
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-smooth: cubic-bezier(0.25, 0.1, 0.25, 1);

  /* Currency */
  --currency-decimals: 3;       /* BHD has 3 decimal places */
  --currency-symbol: 'BHD';
  --vat-rate: 0.10;             /* 10% Bahrain VAT */
}
```

### Component Inventory (~30 essential)

Distilled from AsymmFlow's 177 components + polished with Living Geometry:

| Component | Source | Living Geometry Polish |
|-----------|--------|----------------------|
| **ChatMessage** | New | Gold left-border for AI, italic for user |
| **ApprovalCard** | New | Kintsugi seam, approve/reject buttons |
| **SkillProgress** | New | Step-by-step execution with status dots |
| **AppShell** | AsymmFlow PageLayout | CSS Grid with named areas |
| **Sidebar** | AsymmFlow EnterpriseSidebar | Simplified, gold active indicator |
| **Header** | AsymmFlow EnterpriseHeader | Glassmorphism, breathing status dot |
| **DataTable** | AsymmFlow DataTable | BHD formatting, sticky header |
| **KPICard** | AsymmFlow KPICard | Cinzel numbers, sparkline optional |
| **Button** | AsymmFlow Button | Outfit font, pill radius, gold primary |
| **Input** | AsymmFlow Input | Brush stroke focus indicator |
| **Select** | AsymmFlow Select | Dropdown with search |
| **Modal** | AsymmFlow Modal | Centered, glassmorphism backdrop |
| **Badge** | AsymmFlow StatusBadge | Sage/coral/gold semantic |
| **Toast** | AsymmFlow WabiSabiToast | Top-right, auto-dismiss |
| **Card** | AsymmFlow WabiCard | Warm paper bg, subtle shadow |
| **FormGroup** | AsymmFlow FormGroup | Label + input + error |
| **CurrencyInput** | AsymmFlow CurrencyInput | 3 decimal BHD, Courier Prime |
| **DatePicker** | AsymmFlow DatePicker | Calendar popup |
| **Tabs** | AsymmFlow Tabs | Underline style, gold active |
| **EmptyState** | AsymmFlow WabiEmptyState | Unicode glyph + message |
| **Skeleton** | AsymmFlow WabiSkeleton | Loading placeholder |
| **Spinner** | AsymmFlow WabiSpinner | Gold accent |
| **Avatar** | AsymmFlow WabiAvatar | Initials, role color |
| **Tooltip** | AsymmFlow WabiTooltip | Simple hover |
| **Divider** | AsymmFlow WabiDivider | Ink-12 opacity |
| **QuickCapture** | AsymmFlow QuickCapture | Voice/text, routes to chat |
| **FileChip** | Living Geometry | Unicode glyph per file type |
| **RegimeBadge** | AsymmFlow RegimeBadge | Three-regime indicator |
| **ConfidenceMeter** | AsymmFlow | For AI confidence display |
| **ButlerCharacter** | AsymmFlow | AI avatar in chat |

### Hub Pages (7)

| Hub | Content | Role Access |
|-----|---------|-------------|
| **Chat** (default) | AI conversation + approval cards | All |
| **Dashboard** | KPIs, follow-ups, calendar, quick actions | All (role-filtered) |
| **Sales** | Pipeline, costings, offers (tabs) | Sales, Manager, Admin |
| **Operations** | Orders, POs, GRNs, delivery (tabs) | Operations, Manager, Admin |
| **Finance** | Invoices, payments, bank recon (tabs) | Accountant, Manager, Admin |
| **CRM** | Customers, suppliers, 360 views | All |
| **Settings** | User management, config | Admin |

---

## 7. AI Agent Architecture

### Model Routing

| Task | Model | Why |
|------|-------|-----|
| Chat reasoning | Grok (via AIMLAPI) | Fast, good at structured tasks |
| Arabic OCR | Sarvam Vision | Indian/Arabic multilingual |
| Translation | Sarvam Mayura | 23 languages, quality glossary |
| Validation | Claude (via Anthropic) | Best at nuanced judgment |
| Embeddings | Local (digital root) | Zero-cost, O(1) |

### Context Building

The AI doesn't have a vector database. It has STDB.

```typescript
function buildContext(user: Member, stdb: SpacetimeDBConnection): string {
  const customers = stdb.db.party.iter().filter(p => p.isCustomer);
  const overdue = stdb.db.moneyEvent.iter().filter(me =>
    me.kind === 'customer_invoice' &&
    me.status.tag === 'Active' &&
    me.dueDate && me.dueDate < now()
  );
  const pipeline = stdb.db.pipeline.by_owner.filter(user.identity);

  return `You are AsymmFlow Butler, the AI assistant for PH Trading WLL (Bahrain).
Current user: ${user.fullName} (${user.role.tag})

BUSINESS STATE:
- ${customers.length} customers (A:${gradeA}, B:${gradeB}, C:${gradeC}, D:${gradeD})
- ${overdue.length} overdue invoices totaling ${formatBHD(overdueTotal)}
- ${pipeline.length} pipeline items (${activePipeline} active)
- Cash position: ${formatBHD(cashPosition)}

You can use these skills: ${availableSkills(user.role).join(', ')}
When you need to perform an action, describe your plan clearly.
The user will approve before execution.`;
}
```

### AMCE Pattern (Customer Intelligence)

From the Ananta Memory Compression spec, adapted for business:

```
Each customer relationship = a quaternion orientation on S3

Components:
  w = payment reliability (0-1, from grade + history)
  x = order frequency (normalized, last 12 months)
  y = margin quality (average margin on their orders)
  z = relationship trajectory (improving/stable/declining)

SLERP between quarterly snapshots:
  Q_current = SLERP(Q_last_quarter, Q_this_quarter, t=0.3)

This gives smooth evolution, not jagged step functions.
The AI can say: "Customer Al Ezzel is rotating toward higher reliability
(w increased 0.4 → 0.6 over 3 quarters)" rather than "they paid 2 invoices."
```

---

## 8. Neutralino Integration

### Config (adapted from 001-ledger)

```json
{
  "applicationId": "com.asymm.flow",
  "version": "0.1.0",
  "defaultMode": "window",
  "port": 0,
  "documentRoot": "/client/dist/",
  "url": "/",
  "enableServer": true,
  "enableNativeAPI": true,
  "tokenSecurity": "one-time",
  "logging": { "enabled": true, "writeToLogFile": true },
  "nativeAllowList": [
    "app.*", "os.*", "clipboard.*", "window.*",
    "filesystem.*", "debug.log"
  ],
  "modes": {
    "window": {
      "title": "AsymmFlow",
      "width": 1280,
      "height": 800,
      "minWidth": 900,
      "minHeight": 600,
      "resizable": true,
      "center": true,
      "enableInspector": false
    }
  },
  "cli": {
    "binaryName": "asymmflow",
    "resourcesPath": "/client/dist/",
    "extensionsPath": "/extensions/",
    "clientLibrary": "/client/dist/neutralino.js"
  }
}
```

### File System Bridge

```typescript
// neutralino-bridge.ts — File operations for AI skills

import { filesystem, os } from '@aspect/neutralino-api';

export async function scanFolder(path: string): Promise<FileEntry[]> {
  const entries = await filesystem.readDirectory(path);
  return entries.map(e => ({
    name: e.entry,
    type: e.type,       // 'FILE' | 'DIRECTORY'
    path: `${path}/${e.entry}`,
  }));
}

export async function readExcelFile(path: string): Promise<any[][]> {
  const data = await filesystem.readBinaryFile(path);
  // Parse with SheetJS (xlsx) in browser
  const workbook = XLSX.read(data, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet);
}

export async function pickFile(filters?: string[]): Promise<string | null> {
  const result = await os.showOpenDialog('Select file', {
    filters: filters || [
      { name: 'Documents', extensions: ['pdf', 'xlsx', 'docx', 'png', 'jpg'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  return result?.[0] || null;
}

export async function generatePowerPoint(data: SlideData[]): Promise<string> {
  // Use PptxGenJS in browser
  const pptx = new PptxGenJS();
  for (const slide of data) {
    const s = pptx.addSlide();
    s.addText(slide.title, { x: 0.5, y: 0.5, fontSize: 24 });
    if (slide.chart) s.addChart(slide.chart.type, slide.chart.data);
    if (slide.table) s.addTable(slide.table);
  }
  const buffer = await pptx.write({ outputType: 'arraybuffer' });

  // Save via Neutralino
  const savePath = await os.showSaveDialog('Save Presentation');
  if (savePath) {
    await filesystem.writeBinaryFile(savePath, buffer);
    return savePath;
  }
  return '';
}
```

---

## 9. Build Sequence

### Sprint 1: The Substrate (STDB + Basic UI)
- [ ] STDB module: schema.ts with 10 tables + enums
- [ ] Core reducers: join_member, upsert_party, record_money_event
- [ ] Publish to STDB maincloud as `asymm-flow`
- [ ] Neutralino project setup (from 001-ledger config)
- [ ] Svelte 5 + Living Geometry tokens
- [ ] AppShell: header + sidebar + main area
- [ ] Chat interface (static, no AI yet)
- [ ] Connect STDB: see members list in real-time
- **Deliverable**: Working desktop app with real-time data

### Sprint 2: Business Logic (State Machines + Finance)
- [ ] advance_pipeline reducer (opportunity → costing → offer)
- [ ] manage_order reducer (order lifecycle)
- [ ] manage_purchase_order reducer (PO lifecycle)
- [ ] Universal state machine transitions
- [ ] Invoice creation with VAT invariant
- [ ] Payment with cannot-exceed-outstanding invariant
- [ ] D-grade customer blocking
- [ ] Hub pages: Sales, Finance, Operations (DataTable views)
- **Deliverable**: Full business logic with invariants enforced

### Sprint 3: AI Integration (Chat + Skills)
- [ ] Grok chat via AIMLAPI (streaming SSE)
- [ ] Context builder (STDB state → prompt)
- [ ] AiAction table + propose/resolve reducers
- [ ] ApprovalCard component
- [ ] 3 data skills: query_dashboard, chase_payment, pricing_advisor
- [ ] Skill execution pipeline with logging
- **Deliverable**: AI that can query and propose actions

### Sprint 4: File Operations (Neutralino Powers)
- [ ] File system bridge (scan, read, pick, save)
- [ ] OCR skill (Sarvam Vision via procedure)
- [ ] Excel read/export skills
- [ ] PowerPoint generation skill
- [ ] Arabic translation skill (Sarvam Mayura)
- [ ] QuickCapture: drop file → OCR → route to entity
- **Deliverable**: Abhie's dream — "take these folders and generate a report"

### Sprint 5: Polish + Ship
- [ ] Dashboard Hub with role-specific KPIs
- [ ] CRM Hub (Party 360 view)
- [ ] Settings Hub (user management)
- [ ] Keyboard shortcuts (Ctrl+K chat, Alt+1-9 hubs)
- [ ] Responsive layout (sidebar collapse at 1024px)
- [ ] Data migration tool (AsymmFlow SQLite → STDB)
- [ ] Neutralino build (Windows .exe)
- **Deliverable**: Production-ready for PH Trading team

---

## 10. Size Estimate (Revised from Audit)

| Component | LOC |
|-----------|-----|
| schema.ts (10 tables + enums) | ~300 |
| index.ts (8 reducers + 2 system) | ~1,200 |
| Svelte components (~30) | ~3,000 |
| Hub pages (7) | ~1,500 |
| Skills (15 skills) | ~800 |
| Neutralino bridge | ~200 |
| AI integration (chat, context) | ~400 |
| Design tokens + utilities | ~300 |
| **Total** | **~7,700** |

**vs current AsymmFlow: ~156,000 LOC → 20x reduction**

The unification audit estimated ~6,500 LOC for the minimal viable version.
With the skills architecture and Neutralino bridge, we're at ~7,700 — still
a massive 20x reduction with significantly MORE capability.

---

## 11. What We're Borrowing (Asset Map)

| Asset | Source | What We Take |
|-------|--------|-------------|
| Neutralino config | `001-ledger/desktop/` | neutralino.config.json, build scripts |
| STDB patterns | `001-ledger/module/` | Table/reducer patterns, CLAUDE.md rules |
| Design tokens | `living_geometry/02_DESIGN_TOKENS.md` | Full :root block, typography, spacing |
| Chat UI | `living_geometry/06_chat_atelier.html` | Message bubbles, input bar |
| 3-panel layout | `living_geometry/07_runtime_full.html` | CSS Grid with named areas |
| ERP logic | `asymmetrica-runtime/Kernels/Erp/` | Invoice, Payment, PO patterns |
| Sarvam AI | `asymmetrica-runtime/SarvamIntelligenceKernel.cs` | 7-mode integration |
| Skills pattern | `.claude/skills/` | Capability-as-documentation, YAML frontmatter |
| AMCE pattern | `ananta_memory_compression_work.md` | Quaternion customer state |
| UI components | `ph-final/frontend/src/lib/components/` | DataTable, KPI, Button, etc. |
| Hub architecture | `ph-final/frontend/src/lib/screens/` | Tab-based hub navigation |
| Business rules | `ph-final/CRITICAL_PH_CONTEXT_SSOT/` | Pricing, grades, invariants |
| Agent governance | `asymmetrica-runtime/.claude/agents/` | BEACON, modal logic |

---

## 12. Open Source Decomposition

```
@asymm/kernel        — Universal state machine, reducers, STDB patterns
  @asymm/ledger      — MoneyEvent, invoices, payments, bank recon
  @asymm/pipeline    — Pipeline (opportunity→costing→offer), orders
  @asymm/crm         — Party (customer+supplier), contacts, 360 view
  @asymm/procurement — PurchaseOrder, GRN, supplier management
@asymm/ui            — Living Geometry components for Svelte 5
@asymm/skills        — Skill registry, approval flow, AI bridge
@asymm/neutralino    — File system bridge, desktop integration
```

---

*"The ERP doesn't organize chaos. It holds the invariants.*
*The agents handle the chaos. The humans make the decisions.*
*The gold lines mark where intentions meet."*

**Om Lokah Samastah Sukhino Bhavantu**
