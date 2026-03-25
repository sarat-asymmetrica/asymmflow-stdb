# AsymmFlow STDB — Feature Backlog

**Last updated:** 2026-03-20
**Status key:** 📋 Specced | 🔨 Building | ✅ Live | ⏸️ Blocked | — Not yet specced
**Product:** Chat-first agentic ERP for PH Trading WLL (Bahrain — BHD, 10% VAT, 8-person team)
**SPOC:** Abhie (process instrumentation, meters, sensors — B2B trading)

> "If you make a bad business model function more optimally, you're not really doing anything to get them towards profitability. You just have a nice interface to watch yourself bleed." — The Paradigm Shift

---

## Wave 0: Foundation

Load-bearing infrastructure. Nothing else can be built without this.

| ID | Feature | Status | Depends On | Contract |
|----|---------|--------|------------|----------|
| F001 | STDB Schema + Module (10 tables, 10 reducers, views) | ✅ Live | — | [F001](F001_stdb_schema.md) |
| F002 | Neutralino Desktop Shell + Svelte 5 App | ✅ Live | — | [F002](F002_neutralino_shell.md) |
| F003 | STDB SDK Wiring + Svelte Stores + Auth | ✅ Live | F001, F002 | [F003](F003_stdb_wiring.md) |
| F004 | Living Geometry V4 Design System Integration | ✅ Live | F002 | — |

**Wave 0 exit criteria:** `spacetimedb publish` succeeds with 10 tables + 10 reducers. Neutralino .exe launches showing home screen with STDB connection status green. Living Geometry tokens applied globally (Space Grotesk, warm clay surface, gold accents).

---

## Wave 1: Core Business Loop

The minimum viable ERP: create a party, build a pipeline, raise an invoice, record a payment. Proves the thesis.

| ID | Feature | Status | Depends On | Contract |
|----|---------|--------|------------|----------|
| F005 | Dashboard Hub (KPIs: outstanding, pipeline, overdue) | ✅ Live | F001, F003 | — |
| F006 | Party Hub (Customer + Supplier unified view) | ✅ Live | F001, F003 | [F006](F006_party_hub.md) |
| F007 | Sales Pipeline Hub (Opportunity → Costing → Offer) | ✅ Live | F001, F003, F006 | — |
| F008 | Finance Hub (Invoice + Payment views) | ✅ Live | F001, F003, F006 | — |
| F009 | Create/Edit Modals (Invoice, Payment, Party) | ✅ Live | F005, F006, F007, F008 | — |
| F010 | PDF Invoice Generator (PH letterhead, VAT, BHD-to-words) | ✅ Live | F009 | — |
| F011 | Seed Data (2,529 real PH Trading records from legacy SQLite) | ✅ Live | F001 | — |

**Wave 1 exit criteria:** Abhie can search for a customer, see their outstanding balance, raise an invoice, record a payment, and download a PDF. All in <5 taps. Data from real PH Trading records.

---

## Wave 2: AI Chat Core

The paradigm shift: chat IS the product, hub pages are views.

| ID | Feature | Status | Depends On | Contract |
|----|---------|--------|------------|----------|
| F012 | Chat Interface (persistent, sidebar, markdown rendering) | ✅ Live | F003 | [F012](F012_chat_interface.md) |
| F013 | AI Context Builder (live STDB data in system prompt) | ✅ Live | F012, F003 | — |
| F014 | AiAction Approval Flow (Proposed → Approved → Executed) | 📋 Specced | F012, F001 | [F014](F014_ai_action_approval.md) |
| F015 | Grok Integration (reasoning model for business decisions) | ✅ Live | F012 | — |
| F016 | Intent Routing (query / action / document / analysis) | 📋 Specced | F012, F014 | — |

**Wave 2 exit criteria:** Abhie types "show me overdue invoices" — AI responds with a list from live STDB data. Abhie types "chase payment for EWA" — AI proposes an action, Abhie approves, system executes. Full audit trail in AiAction table.

---

## Wave 3: Skills Layer

AI that acts — file ops, document generation, payment chasing.

| ID | Feature | Status | Depends On | Contract |
|----|---------|--------|------------|----------|
| F017 | Skill: `query_dashboard` (live KPI aggregation) | — | F014 | — |
| F018 | Skill: `query_customer_360` (party view with history) | — | F014 | — |
| F019 | Skill: `create_invoice` (guided by AI, confirmed by human) | — | F014, F009 | — |
| F020 | Skill: `record_payment` (with invariant enforcement) | — | F014, F009 | — |
| F021 | Skill: `chase_payment` (WhatsApp drafts by grade) | — | F014 | [F021](F021_skill_chase_payment.md) |
| F022 | Skill: `scan_folder` (Neutralino file system access) | — | F014, F002 | — |
| F023 | Skill: `ocr_document` (Sarvam Vision — Arabic + English) | — | F014, F022 | [F023](F023_skill_ocr_document.md) |
| F024 | Skill: `read_excel` (parse Excel into structured data) | — | F014, F022 | — |
| F025 | Skill: `generate_pptx` (PowerPoint from STDB data) | — | F014, F022 | — |
| F026 | Skill: `translate_document` (Arabic → English via Sarvam) | — | F014 | — |

**Wave 3 exit criteria:** Abhie says "Take the Q1 invoices folder, pull the Excel files, and generate a PowerPoint showing revenue by customer grade" — AI scans the folder, OCRs, aggregates, generates PPTX, requests approval once, delivers file to Desktop.

---

## Wave 4: Intelligence Layer

Mathematical substrate earns its keep — prediction, analysis, risk scoring.

| ID | Feature | Status | Depends On | Contract |
|----|---------|--------|------------|----------|
| F027 | Skill: `payment_predictor` (Markov chain — when will they pay?) | — | F014, F003 | — |
| F028 | Skill: `cashflow_forecast` (30/60/90 day Euler ODE projection) | — | F014, F003 | — |
| F029 | Skill: `pricing_advisor` (optimal discount given grade + competition) | — | F014 | — |
| F030 | Skill: `win_probability` (logistic regression on pipeline) | — | F014 | — |
| F031 | Skill: `fraud_detector` (Benford's Law + digital root on amounts) | — | F014 | — |
| F032 | Skill: `customer_risk` (spectral scoring from payment history) | — | F014, F003 | — |

**Wave 4 exit criteria:** Dashboard shows "EWA predicted to pay in 47 days (±8 days)" based on payment history pattern. Pricing advisor recommends exact discount for a costing. Fraud detector flags if supplier invoices deviate from Benford distribution.

---

## Wave 5: Document Genome

Every PH Trading document has invariant DNA. Wave 5 encodes all of it.

| ID | Feature | Status | Depends On | Contract |
|----|---------|--------|------------|----------|
| F033 | Document: Quotation/Offer PDF (grade-based terms, letterhead) | — | F014, F007 | — |
| F034 | Document: Statement of Account (aging buckets, running balance) | — | F014, F008 | — |
| F035 | Document: Payment Chase Letter (tone by grade) | — | F014, F021 | — |
| F036 | Document: Purchase Order PDF (supplier terms, delivery schedule) | — | F014 | — |
| F037 | Document: Excel Export (any hub table → formatted .xlsx) | — | F014, F024 | — |
| F038 | MVC Checklist System (Hard/Soft/Auto context for doc generation) | — | F014 | — |

**Wave 5 exit criteria:** All 5 core documents generated with correct PH Trading letterhead, VAT calculation, BHD-to-words. Statement of Account shows aging buckets (0-30, 31-60, 61-90, 90+ days) correctly from MoneyEvent sum.

---

## Wave 6: Operations Layer

Purchase Orders, GRN, inventory, supplier payment reconciliation.

| ID | Feature | Status | Depends On | Contract |
|----|---------|--------|------------|----------|
| F039 | Operations Hub (PO status, GRN, delivery tracking) | — | F001, F003 | — |
| F040 | PO Approval Workflow (under 5K BHD: auto, over: manager approval) | — | F039, F014 | — |
| F041 | GRN Processing (received qty, accepted qty, rejection notes) | — | F040 | — |
| F042 | Inventory State (stock-on-hand per product, computed not stored) | — | F041 | — |
| F043 | Skill: `generate_pdf_invoice` with linked PO reference | — | F014, F040 | — |

**Wave 6 exit criteria:** A purchase order flows from Draft → Approved → Sent → Received with GRN. Inventory reflects correct quantities. Supplier invoice linked to PO. No negative inventory possible (reducer enforces INV-OP-01).

---

## Wave 7: Security, RBAC, and Multi-User

Hardening for the full 8-person PH Trading team.

| ID | Feature | Status | Depends On | Contract |
|----|---------|--------|------------|----------|
| F044 | RBAC Enforcement (Admin/Manager/Sales/Operations/Accountant) | — | F001, F003 | — |
| F045 | RLS on STDB tables (per-role visibility) | — | F044 | — |
| F046 | Audit Trail UI (who did what, when, from which terminal) | — | F044 | — |
| F047 | Skill: `update_customer_grade` (admin-only, financial impact warning) | — | F014, F044 | — |
| F048 | Multi-user real-time conflict resolution (STDB handles, UI shows) | — | F044, F045 | — |

**Wave 7 exit criteria:** Sales user cannot access Finance hub. Accountant cannot approve costings. Admin can change customer grade with a confirmation screen showing financial impact. All operations show actor identity in audit trail.

---

## Cross-Cutting Decisions

Architectural choices affecting multiple features. See `decisions/` directory.

| ID | Decision | Status | Ref |
|----|----------|--------|-----|
| ADR001 | STDB over Traditional Backend (PostgreSQL + API server) | Decided | [ADR001](../decisions/ADR001_stdb_over_traditional_backend.md) |
| ADR002 | Neutralino over Wails + Electron | Decided | [ADR002](../decisions/ADR002_neutralino_over_wails.md) |
| ADR003 | Unified Party Schema (Customer + Supplier in one table) | Decided | [ADR003](../decisions/ADR003_unified_party_schema.md) |
| ADR004 | MoneyEvent Pattern (outstanding never stored) | Decided | [ADR004](../decisions/ADR004_money_event_pattern.md) |
| ADR005 | AiAction Approval Gate (proposed → approved → executed) | Decided | [ADR005](../decisions/ADR005_ai_action_approval_gate.md) |
| ADR006 | Skills Architecture (composable atoms, 3 approval levels) | Decided | [ADR006](../decisions/ADR006_skills_architecture.md) |
| ADR007 | Grok for Reasoning, Sarvam for Multilingual | — | — |
| ADR008 | Universal State Machine (all 6 state machines as partial monoid) | Decided | [ADR008](../decisions/ADR008_universal_state_machine.md) |
| ADR009 | BHD in Integer Fils (1 BHD = 1000 fils, no floats) | Decided | [ADR009](../decisions/ADR009_bhd_fils_arithmetic.md) |
| ADR010 | Chat-First UI (hub pages are views, chat is interaction) | Decided | [ADR010](../decisions/ADR010_chat_first_ui.md) |

---

## Invariants (Apply to ALL features)

Non-negotiable across every feature contract. Derived from Phase 18 production learnings and the 6 mathematical audits.

### Financial
1. **Outstanding is NEVER stored** — always `sum(invoices) - sum(payments)` from MoneyEvent. Phase 18 bug = 313 invoices drifted. Never again.
2. **All BHD amounts in integer fils** — `1 BHD = 1000 fils`. No float64 in any reducer touching money. Conversion at display boundary only.
3. **Amount > 0 for any payment** — zero/negative amounts rejected before any DB write.
4. **Payment <= outstanding at write time** — atomic check inside the reducer (STDB transaction). No TOCTOU.
5. **Outstanding floored at zero** — `max(0, invoiced - paid)`. No negative outstanding.
6. **VAT = 10%** — always `Math.round(subtotal * 0.1)` in fils. No rounding at intermediate steps.
7. **Idempotency on all financial writes** — SHA256(partyId|amount|date|reference) as unique key. Duplicate rejected.
8. **Paid invoices are immutable** — once MoneyEvent status = Terminal, no modification allowed.

### Operations
9. **Inventory never goes negative** — reducer rejects if `qty_shipped > qty_available`.
10. **PO financial fields lock at Approved** — subtotal, VAT, total cannot change once approved.
11. **GRN accepted <= received** — `qty_accepted = qty_received - qty_rejected`, always.

### AI/Skills
12. **AiAction audit trail** — every AI action has proposedBy, approvedBy, executedAt, result. Nothing executes without a trace.
13. **Human approval before execution** — skills with `approval: 'explicit'` NEVER auto-execute. No exceptions.
14. **Vyapti before alerting** — check all defeating conditions before surfacing an alert to the user.

### Identity
15. **ctx.sender is the actor** — never trust client-supplied actor identity. STDB identity = truth.
16. **Identity === via BigInt** — never compare STDB Identity objects with `===`. Use `.toHexString()` equality.
17. **Enum wire format** — STDB CLI lowercase, SDK PascalCase. Always check the generated bindings.

### Architecture
18. **No materialized derived state** — balance, outstanding, win_rate, inventory_level are computed from events. Never cached in a column.
19. **Skills are pure functions** — same args → same DB state transition. No side effects outside the skill contract.
20. **Reducer = transaction** — if a reducer throws, NOTHING it wrote is committed. Use this as invariant enforcement.

---

## Stats

| Metric | Current Value |
|--------|---------------|
| Waves complete | Waves 0-2 (partial) |
| Features live | ~12 |
| Features specced | 4 |
| Features remaining | ~32 |
| STDB tables | 10 |
| STDB reducers | 10 |
| LOC (current) | ~7,230 |
| Target LOC | ~15,000 |
| Legacy LOC replaced | 156K → ~15K (10x reduction) |
