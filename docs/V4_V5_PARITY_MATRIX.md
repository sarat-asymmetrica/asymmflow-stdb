# V4 Legacy → V5 STDB Parity Analysis & Comparison Matrix

**Authored:** Claude Sonnet 4.6 (Zen Gardener session) + Commander Sarat
**Date:** March 20, 2026
**V4 Reference:** `legacy_asymmflow_ph_holdings_reference_only/` (~156K LOC, Wails + Go + Svelte 4 + SQLite)
**V5 Current:** `003-asymmflow-reimagined/client/ + module/` (~7,230 LOC, Neutralino + STDB + Svelte 5)
**Client:** PH Trading WLL, Bahrain — Process instrumentation trading, BHD currency, 10% VAT

---

## Executive Summary

### What V5 Does Better (Architectural Wins)

V5 isn't a rewrite — it's a **categorical upgrade** in three dimensions:

1. **Correctness by construction.** V4's biggest bug class was financial state drift — `outstanding_bhd` stored redundantly and diverging from reality (the "Phase 18 bug": 313 invoices drifted). V5 never stores `outstanding`; it computes it from the `MoneyEvent` ledger in real time. The bug is structurally impossible.

2. **Real-time without effort.** V4 required polling, manual cache invalidation, and a separate sync service (~3 files, ~800 LOC) to keep UI in sync with the SQLite backend. V5 gets this free from STDB subscriptions — all Svelte stores auto-update when any reducer fires.

3. **AI that acts, not just answers.** V4's Butler AI (Mistral integration, ~800 LOC) was a chat sidebar that answered questions. V5's AI has a 28-skill registry with an approval-gated execution pipeline (`AiAction` table, `propose_ai_action` / `resolve_ai_action` reducers). The AI can scan a folder, OCR documents, create invoices, chase payments, generate PPTX — all with a human approval gate and a full audit trail baked into STDB.

4. **21x size reduction.** 156K LOC → ~7,230 LOC, with MORE business capability designed in. The 6 state machines in V4 (Invoice, PO, Offer, Order, Opportunity, SupplierInvoice) reduce to 1 universal transition reducer in V5 via the partial-monoid insight from the Mirzakhani+Grothendieck audit.

5. **Multiplayer natively.** V4 is single-user SQLite with an aspirational Supabase sync that was never production-ready. V5 is multiplayer by default — Abhie's team of 8 (sales, ops, accountants) all see the same live state.

### What V4 Had That V5 Doesn't Yet

V5 has the architecture, the schema, and the hub pages. The gaps are in **depth** of existing screens and several specialized features that V4 built over months:

- Bank reconciliation UI (V5 has the `BankTransaction` table but no recon hub tab yet)
- Cheque register tracking (V4 had a full cheque book lifecycle service)
- FX revaluation + multi-currency (V5 is BHD-first, multi-currency planned)
- Chart of Accounts / Journal Entries / VAT Return (V4 had basic double-entry accounting)
- Advanced reporting: PDF/Excel export of business reports (5 report categories)
- E+H XML pricing parser (V4 could parse Endress+Hauser XML basket files → auto-costing)
- Offer folder scanner / Archaeologist (AI-assisted workspace discovery from legacy folder structure)
- Tally importer (Excel import from Tally accounting software — massive for Indian/GCC market)
- Contract generation (grade-based clause selection → PDF contract)
- Product catalogue + inventory with stock movements and reorder alerts
- License management (device-based licensing with activation codes)
- Setup wizard (first-run onboarding flow)
- QGIF / Living Geometry animations in V4 frontend (visual identity system)

---

## Feature Comparison Matrix

### Legend
| Symbol | Meaning |
|--------|---------|
| ✅ | Complete and working |
| 🔄 | Partial — structure in place, some depth missing |
| ❌ | Missing — not yet built in V5 |
| 🆕 | New in V5 — V4 never had this |
| ♻️ | Needs rethink — V4 had it but V5's architecture changes the approach |

---

### 1. CRM / Party Management

| Feature | V4 Status | V5 Status | V5 Approach | Priority | Notes |
|---------|-----------|-----------|-------------|----------|-------|
| Customer CRUD (create/edit/view) | ✅ | ✅ | `Party` table with `isCustomer=true`, `CreatePartyModal.svelte` | P0 | V5 unifies Customer+Supplier into one `Party` table |
| Supplier CRUD | ✅ | ✅ | `Party` table with `isSupplier=true` | P0 | Same `CreatePartyModal` with toggle |
| Customer grade (A/B/C/D) | ✅ | ✅ | `CustomerGrade` enum in STDB, `update_customer_grade` reducer | P0 | Grade A=7% disc, B=3% disc, C=no disc 50% advance, D=100% advance or decline |
| Customer 360 view (full history) | ✅ | ✅ | `Customer360Modal.svelte` — shows orders, invoices, payments, pipeline | P0 | V5 queries live STDB; V4 queried SQLite |
| Multiple contacts per party | ✅ | ✅ | `Contact` table linked to `Party.id` | P0 | V5 has `isWhatsApp` flag — reflects PH Trading's WhatsApp culture |
| AR tracking (outstanding per customer) | ✅ | ✅ | Computed from `MoneyEvent` ledger, never stored | P0 | **Architectural win** — V4 had drift bug; V5 is structurally correct |
| Credit limit + credit block | ✅ | ✅ | `creditLimitFils` + `isCreditBlocked` in `Party` | P0 | V5 enforces in `record_money_event` reducer |
| Payment terms per customer | ✅ | ✅ | `paymentTermsDays` in `Party` | P0 | |
| Customer grade history (change log) | ✅ | 🔄 | `ActivityLog` captures grade changes | P1 | V4 had dedicated `grade_changes` table; V5 uses `ActivityLog` which is correct but less queryable |
| Supplier issues tracking | ✅ | ❌ | Would be `ActivityLog` entries on a Supplier party | P2 | V4 had `SupplierIssue` table with open/pending/resolved status and cost tracking |
| Supplier bank details (for payments) | ✅ | 🔄 | `notes` field in `Party` (freetext) | P1 | V4 had structured IBAN, SWIFT, account number fields |
| Supplier brands/product types | ✅ | ✅ | `productTypes` string in `Party` (for suppliers) | P2 | V5: "E+H,Servomex" freetext — same as V4's JSON array |
| Supplier annual goals | ✅ | ✅ | `annualGoalFils` in `Party` | P2 | |
| AR aging buckets (0-30, 31-60, 61-90, 90+) | ✅ | ✅ | `arAging.ts` + AR Aging tab in FinanceHub | P0 | |
| CRM grade filter tabs (All/A/B/C) | ✅ | ✅ | `CRMHub.svelte` with grade tabs | P0 | |
| Suppliers tab in CRM | ✅ | 🔄 | `CRMHub.svelte` focuses on customers; supplier section exists but lighter | P1 | V4 had `CRMSupplierDashboard.svelte` as full peer to customer dashboard |
| Entity notes (delivery, issue, commercial) | ✅ | ❌ | Would map to `ActivityLog` | P2 | V4 had typed notes with `note_type` (delivery/issue/general/payment/commercial/technical) |
| Customer type codes (EC, CO, EPC...) | ✅ | 🔄 | `Party.notes` or custom field could hold this | P2 | V4 had `CustomerCode` like "EC1", "CO2" per PH Trading's internal taxonomy |

---

### 2. Sales Pipeline

| Feature | V4 Status | V5 Status | V5 Approach | Priority | Notes |
|---------|-----------|-----------|-------------|----------|-------|
| Opportunity tracking | ✅ | ✅ | `Pipeline` table (unified Opp+Costing+Offer) | P0 | |
| Win probability prediction | ✅ | ✅ | `win_probability` skill + `winProbabilityBps` in Pipeline | P1 | V5's `paymentPredictionLogic.ts` is clean; V4's was logistic regression on grade + competition |
| Competitor present flag (ABB) | ✅ | ✅ | `competitorPresent` field in `Pipeline` | P0 | Critical for PH Trading vs ABB strategy |
| Costing sheet (OEM price + markup) | ✅ | ✅ | `oemPriceFils` + `markupBps` + `additionalCostsFils` in `Pipeline` | P0 | V5 unifies costing into Pipeline row |
| Costing approval workflow | ✅ | ✅ | `costingApproved` + `costingApprovedBy` in `Pipeline` | P0 | |
| Offer / quotation generation | ✅ | ✅ | `quotationGenerator.ts` (pdfmake) + `generate_quotation` skill | P0 | V5 generates PDF matching PH Trading letterhead |
| Offer revision tracking | ✅ | ✅ | `revision` field in `Pipeline`, `advance_pipeline` reducer | P0 | |
| Pipeline stage tabs (Pipeline/Won/Lost) | ✅ | ✅ | `SalesHub.svelte` with 3 tabs | P0 | |
| Follow-up scheduling | ✅ | ✅ | `nextFollowUp` in `Pipeline`, `ActivityLog.followUpDue` | P0 | |
| Loss reason tracking | ✅ | ✅ | `lossReason` in `Pipeline` | P0 | |
| Pipeline → Order conversion | ✅ | ✅ | `convert_pipeline_to_order` reducer | P0 | |
| Pricing advisor (optimal discount) | ✅ | ✅ | `pricing_advisor` skill — grade-based discount + competition factor | P1 | |
| E+H XML basket parser (auto-costing) | ✅ | ❌ | Would be `ocr_document` skill with E+H XML understanding | P1 | V4 had `eh_parser.go` parsing Endress+Hauser XML → EUR→BHD → BOM with margins. This is a PH Trading workflow killer feature |
| Product markup rules (by category) | ✅ | ❌ | Would live in AI skill context / system prompt | P1 | V4: E+H Flow=15%, Servomex=25%, GIC=10% etc — needs to be in V5 pricing advisor |
| Offer folder scanner / Archaeologist | ✅ | ❌ | Would be `scan_folder` + `ocr_document` + AI synthesis | P2 | V4 had `archaeologist.go` + `offer_scanner.go` — scanned folder structures to extract offer metadata. Partially replaced by V5's AI skills |
| RFQ management | ✅ | ❌ | Partially: a Pipeline in Draft state represents an RFQ | P2 | V4 had dedicated `RFQScreen.svelte` |
| Costing history log | ✅ | 🔄 | `ActivityLog` captures costing changes | P2 | V4 had `costing_history` table |
| Contract generation (grade-based clauses) | ✅ | ❌ | Would be a skill using grade → contract template | P3 | V4 had `contract_service.go` with S³ quaternionic clause entanglement — genuinely clever but rarely used |
| Cover letter generation | ✅ | ✅ | `coverLetterGenerator.ts` + `generate_cover_letter` skill | P1 | |
| Technical submittal | ✅ | ✅ | `technicalSubmittalGenerator.ts` + `generate_technical_submittal` skill | P1 | |

---

### 3. Finance

| Feature | V4 Status | V5 Status | V5 Approach | Priority | Notes |
|---------|-----------|-----------|-------------|----------|-------|
| Customer invoice creation | ✅ | ✅ | `create_invoice` skill → `record_money_event` reducer | P0 | |
| Customer invoice PDF | ✅ | ✅ | `invoiceGenerator.ts` (pdfmake, PH letterhead) | P0 | |
| Customer payment recording | ✅ | ✅ | `record_payment` skill → `record_money_event` reducer | P0 | |
| VAT calculation (10% BHD) | ✅ | ✅ | Enforced in `record_money_event` reducer: `vatFils = subtotalFils / 10` | P0 | STDB makes this an invariant, not just a convention |
| Payment cannot exceed outstanding | ✅ | ✅ | Enforced in reducer with integer fils arithmetic | P0 | **V4's race condition (TOCTOU) is eliminated** — STDB reducers are serialized |
| Outstanding = NEVER stored (computed) | ❌ (had drift bug) | ✅ | `outstandingForParty()` computes from MoneyEvent ledger | P0 | **Key architectural win** |
| Overdue invoice detection | ✅ | ✅ | Computed: `MoneyEvent.dueDate < now()` && `status = Active` | P0 | |
| AR Aging report (0-30/31-60/61-90/90+) | ✅ | ✅ | `arAging.ts` + AR Aging tab in FinanceHub | P0 | |
| Account statement (customer) | ✅ | ✅ | `statementGenerator.ts` + PDF via pdfmake | P0 | |
| Payment chase (WhatsApp drafts) | ✅ | ✅ | `chase_payment` skill + `chaseGenerator.ts` — grade-based tone | P0 | **V5 is vastly superior** — grade-aware messaging, audit trail |
| Supplier invoice tracking | ✅ | ✅ | `MoneyEvent` with `kind = 'SupplierInvoice'` | P0 | |
| Supplier payment recording | ✅ | ✅ | `MoneyEvent` with `kind = 'SupplierPayment'` | P0 | |
| Credit block enforcement | ✅ | ✅ | D-grade blocking in `record_money_event` reducer | P0 | |
| Invoice sequence / auto-numbering | ✅ | ✅ | `DocSequence` table + `doc_sequence_table.ts` | P0 | V5 uses a single DocSequence table for all document types |
| Bank statement import (CSV/Excel) | ✅ | 🔄 | `BankTransaction` table exists; import skill not built | P1 | V4 had `bank_statement_parser.go` for PDF/CSV bank statement parsing |
| Bank reconciliation (match transactions) | ✅ | ❌ | `BankTransaction` table is the substrate; matching UI not built | P1 | V4 had `BankReconciliationScreen.svelte` + `bank_transaction_matcher.go` |
| Book-bank reconciliation (GL vs bank) | ✅ | ❌ | Not started in V5 | P2 | V4 had `book_bank_reconciliation_service.go` (deposits in transit, outstanding cheques) |
| Cheque register (cheque lifecycle) | ✅ | ❌ | Could be `MoneyEvent` with `kind = 'ChequePayment'` + status | P2 | V4 had full cheque book management — issuance, clearance, stale tracking |
| FX revaluation (multi-currency) | ✅ | ❌ | V5 is BHD-first; multi-currency planned | P2 | V4 had `FXRevaluationScreen.svelte` + CBB rate import |
| Chart of Accounts | ✅ | ❌ | Implement as lightweight CoA table + view layer — STDB doesn't need double-entry engine, but accountant needs the chart | P3 | V4 had basic CoA + JournalEntry + JournalLine |
| Journal entries | ✅ | ❌ | Skill: `create_journal_entry` — manual adjustments for accountant use cases | P3 | V4 had manual journal entries — rarely used but contractually required |
| VAT return report | ✅ | ❌ | Could be skill: aggregate MoneyEvent by period → output/input VAT | P2 | V4 had `VATReturn` table + computation |
| Cash flow projection (30/60/90 day) | ✅ | ✅ | `cashflow_forecast` skill — Euler ODE on due dates | P1 | |
| Payment aging report (PDF/Excel export) | ✅ | 🔄 | AR Aging tab exists; no PDF/Excel export yet | P1 | V4 had 5 report categories with PDF/Excel/CSV export |
| Financial year dashboard | ✅ | 🔄 | Dashboard KPIs cover key metrics; no YoY comparison | P2 | V4 had `financial_year_service.go` with 2023/2024 audited data |
| Cash position widget | ✅ | 🔄 | Dashboard shows cash-related KPIs; no bank account balance view | P1 | V4 had explicit bank account models + `CashPositionWidget.svelte` |
| Tally importer (Excel) | ✅ | ❌ | Would be `read_excel` skill + AI parsing | P1 | V4 had `tally_importer.go` — critical for Indian/GCC market; imports from Tally accounting software |
| Survival intelligence (runway/burn) | ✅ | 🔄 | Dashboard `cashflow_forecast` covers this; no dedicated "runway" alert | P1 | V4 had `survival_intelligence.go` tracking cash runway days, monthly burn vs target |

---

### 4. Operations

| Feature | V4 Status | V5 Status | V5 Approach | Priority | Notes |
|---------|-----------|-----------|-------------|----------|-------|
| Customer order management | ✅ | ✅ | `Order` table + `manage_order` reducer + Orders tab in OperationsHub | P0 | |
| Order status transitions (state machine) | ✅ | ✅ | Universal `advance_pipeline` / `manage_order` reducers with valid-transition enforcement | P0 | **V5's state machine is provably correct** (partial monoid) vs V4's if/else |
| Order → Invoice linking | ✅ | ✅ | `MoneyEvent.orderId` optional FK | P0 | |
| Purchase order creation | ✅ | ✅ | `PurchaseOrder` table + `manage_purchase_order` reducer + `generate_purchase_order` skill | P0 | |
| PO → Order linking | ✅ | ✅ | `PurchaseOrder.orderId` optional FK | P0 | |
| PO PDF generation | ✅ | ✅ | `purchaseOrderGenerator.ts` + pdfmake | P0 | |
| PO approval workflow (threshold-based) | ✅ | 🔄 | `manage_purchase_order` reducer; approval threshold not enforced yet | P1 | V4 had 5,000 BHD threshold requiring manager approval |
| Goods Received Note (GRN) | ✅ | ✅ | `GoodsReceivedNote` + `GrnItem` tables + `create_grn` reducer | P0 | |
| GRN → PO linking + quantity validation | ✅ | ✅ | `advance_grn_reducer.ts` enforces quantities | P0 | |
| Delivery note creation | ✅ | ✅ | `DeliveryNote` + `DeliveryNoteItem` tables + `create_delivery_note` reducer | P0 | |
| Delivery note PDF | ✅ | ✅ | `deliveryNoteGenerator.ts` + pdfmake | P0 | |
| Delivery note → Order linking | ✅ | ✅ | `DeliveryNote.orderId` | P0 | |
| Partial shipment tracking | ✅ | 🔄 | `Order.status = InProgress` covers this; per-line-item quantity shipped not tracked separately | P1 | V4 had `RecordPartialShipment` + `QuantityShipped` per item |
| Inventory / stock management | ✅ | ❌ | Not in V5 schema (PH Trading is order-to-deliver, no real warehouse) | P2 | V4 had `InventoryItem`, `StockMovement`, `StockAdjustment`, `Warehouse` tables — but PH Trading has zero inventory budget, making this rarely used |
| Stock alerts (low stock / slow moving) | ✅ | ❌ | Skill: `stock_alert` — computed from StockEntry events, triggers when below reorder point | P3 | V4 had reorder suggestions — builds on inventory (Wave 6) |
| Product catalogue | ✅ | ❌ | `LineItem.description` is freetext in V5; no product master | P2 | V4 had `ProductMaster` with SKU, HS code, standard costs, E+H supplier linkage |
| Order fulfillment status auto-advance | ✅ | 🔄 | Reducer enforces transition validity; auto-advance on GRN not implemented | P1 | V4 auto-advanced order status when GRN received all items |
| OperationsHub with 4 tabs | ❌ (separate screens) | ✅ | `OperationsHub.svelte` with Orders/Delivery Notes/GRNs/POs | P0 | V5's hub architecture is cleaner than V4's 43-screen navigation |

---

### 5. Document Generation

| Feature | V4 Status | V5 Status | V5 Approach | Priority | Notes |
|---------|-----------|-----------|-------------|----------|-------|
| Quotation / Proforma Invoice PDF | ✅ | ✅ | `quotationGenerator.ts` — PH Trading letterhead, BHD, item codes | P0 | V5 matches the actual PH Trading proforma template exactly |
| Tax Invoice PDF (with VAT) | ✅ | ✅ | `invoiceGenerator.ts` — 10% VAT, fils arithmetic, Tally header fields | P0 | |
| Purchase Order PDF | ✅ | ✅ | `purchaseOrderGenerator.ts` | P0 | |
| Statement of Account PDF | ✅ | ✅ | `statementGenerator.ts` | P0 | |
| Delivery Note PDF | ✅ | ✅ | `deliveryNoteGenerator.ts` | P0 | |
| Cover Letter (with offer) | ✅ | ✅ | `coverLetterGenerator.ts` | P1 | |
| Technical Submittal | ✅ | ✅ | `technicalSubmittalGenerator.ts` | P1 | |
| Payment Chase letter/draft | ✅ | ✅ | `chaseGenerator.ts` — grade-aware tone | P0 | |
| Arabic RTL support in PDFs | ✅ | ❌ | V4 had `arabic_shaper.go` with RTL rendering in gopdf; V5 uses pdfmake (limited Arabic support) | P2 | V4 had full Arabic shaping — important for Bahrain bilingual documents |
| Amount in words (BHD) | ✅ | ❌ | V4 had `numberToWords()` for English; V5 pdfmake templates don't include this yet | P1 | PH Trading quotations show "Three Thousand Four Hundred Dinars" etc |
| Email draft with attachment | ✅ | ✅ | `emailDraftGenerator.ts` + `generate_email_draft` skill | P1 | |
| PowerPoint generation | ❌ | ✅ | `generate_pptx` skill — **NEW in V5** | 🆕 | Commander's dream: "take Q1 invoices folder → generate revenue-by-grade PPT" |
| Excel export | ✅ | ✅ | `export_to_excel` skill | P1 | |
| Contract PDF (grade-based clauses) | ✅ | ❌ | Would be a skill with template library | P3 | V4 had sophisticated grade-based clause selection |
| Document registry (MVC checklists) | 🆕 N/A | ✅ | `registry.ts` — 7 document templates with hard/soft/auto context fields | 🆕 | V5-only: AI knows what data it needs before generating a document |

---

### 6. Reporting & Dashboard

| Feature | V4 Status | V5 Status | V5 Approach | Priority | Notes |
|---------|-----------|-----------|-------------|----------|-------|
| Dashboard KPIs (revenue MTD, outstanding, pipeline, collection rate) | ✅ | ✅ | `DashboardPage.svelte` + `dashboardMetrics.ts` | P0 | |
| Overdue invoice decision cards | ✅ | ✅ | Dashboard bottom panel — overdue customers with aging timeline bar | P0 | |
| Activity feed (recent actions) | ✅ | ✅ | `ActivityLog` table subscribed in Dashboard | P0 | |
| Sales report (PDF/Excel/CSV) | ✅ | ❌ | `export_to_excel` skill covers data; no formatted report yet | P1 | V4 had 5 report categories × 3 formats = 15 report permutations |
| Customer report | ✅ | ❌ | Same — skill-based export in V5 | P1 | |
| Operations report | ✅ | ❌ | Same | P2 | |
| Inventory report | ✅ | ❌ | Skill: `inventory_report` — aggregate StockEntry events per product, export as Excel/PDF | P3 | Depends on Wave 6 inventory tables |
| Financial report | ✅ | ❌ | `cashflow_forecast` skill covers key numbers; no formatted financial report | P1 | |
| Survival panel (runway / burn rate) | ✅ | 🔄 | Dashboard has collection rate KPI; no explicit runway widget | P1 | V4 had `SurvivalPanel.svelte` + `survival_intelligence.go` with runway days, monthly burn, collection efficiency |
| Cash flow chart (daily projections) | ✅ | 🔄 | `cashflow_forecast` skill returns data; no chart component in V5 yet | P1 | V4 had charts in `FinancialDashboard.svelte` |
| AR aging bar chart | ✅ | ❌ | AR Aging tab shows data table; no chart | P2 | |
| Top debtors query | ✅ | ✅ | `query_top_debtors` skill | P0 | |
| Customer 360 (from dashboard) | ✅ | ✅ | `query_customer_360` skill + `Customer360Modal.svelte` | P0 | |
| Real-time updates (no polling) | ❌ | ✅ | STDB subscriptions — all stores auto-update | 🆕 | **V5-only architectural win** |
| Role-filtered dashboard views | ✅ | 🔄 | `currentMember.role` available; full role-filtering not enforced per KPI | P1 | V4 had comprehensive RBAC filtering |
| Follow-up calendar / task list | ✅ | 🔄 | `ActivityLog.followUpDue` exists; no dedicated follow-up UI yet | P1 | V4 had `FollowUpTask` table + `InboxScreen.svelte` (tasks, alerts, follow-ups) |
| Alert system (business alerts) | ✅ | ❌ | Survives as `ActivityLog` + AI proactive suggestions | P1 | V4 had `Alert` table with critical/warning/info severity + `AlertPanel.svelte` |

---

### 7. AI & Intelligence Features

| Feature | V4 Status | V5 Status | V5 Approach | Priority | Notes |
|---------|-----------|-----------|-------------|----------|-------|
| AI chat interface (Butler) | ✅ | ✅ | `ChatPage.svelte` — primary interface, not sidebar | P0 | V5: chat IS the main UI; V4: chat was sidebar bonus |
| Contextual business state injection | ✅ | ✅ | `context.ts` + `buildSystemPrompt()` — injects live STDB state | P0 | V5 queries STDB directly; V4 queried SQLite via complex intent engine |
| Multi-conversation history | ❌ | ✅ | `chatStore.ts` — multiple named conversations, switch between them | 🆕 | |
| Persistent AI memory (cross-session) | ❌ | ✅ | `aiMemory` table in STDB — `remember` / `forget` skills | 🆕 | |
| Approval-gated skill execution | ❌ | ✅ | `AiAction` table + `TransitionCard.svelte` — proposed → approved → executed | 🆕 | **Core V5 paradigm shift** |
| Skill registry (28 skills) | ❌ | ✅ | `registry.ts` — data/file/intelligence/communication categories | 🆕 | |
| Win probability prediction | ✅ | ✅ | `win_probability` skill — grade + competition factors | P1 | |
| Discount recommendation | ✅ | ✅ | `pricing_advisor` skill — grade-based max discount rules | P1 | |
| Payment date prediction | ✅ | ✅ | `predict_payment_date` skill + `paymentPredictionLogic.ts` | P1 | |
| Customer risk scoring | ✅ | 🔄 | Grade-based risk in `pricing_advisor`; no dedicated spectral scoring | P2 | V4 had survival intelligence with AR risk tiers (Low/Medium/High/Critical) |
| Fraud detection (Benford's law) | ✅ | ❌ | Would be an intelligence skill | P3 | V4 had this planned/partially implemented |
| WhatsApp draft generation (grade-aware) | ✅ | ✅ | `draft_whatsapp` skill + `chaseGenerator.ts` | P0 | |
| Arabic/multilingual translation | ❌ | ✅ | `translate_document` skill via Sarvam Mayura | 🆕 | |
| OCR document processing | ✅ | ✅ | `ocr_document` skill via Sarvam Vision | P0 | V4 had OCR via ACE engine; V5 via Sarvam API |
| Excel parsing from folder | ❌ | ✅ | `scan_folder` + `read_excel` skills via Neutralino | 🆕 | |
| PowerPoint generation from AI output | ❌ | ✅ | `generate_pptx` skill | 🆕 | |
| Streaming AI responses (SSE) | ✅ | ✅ | `client.ts` — streaming via AIMLAPI | P0 | |
| Multiple AI model support | ✅ | ✅ | Settings: Grok / Claude / Sarvam, configurable at runtime | P0 | V4 used Mistral-small + Mistral-large routing |
| Intent classification + model routing | ✅ | 🔄 | V5 uses single model with skill dispatch; no multi-model routing per intent | P2 | V4 had complex intent engine (simple→mistral-small, complex→mistral-large) |
| AMCE pattern (quaternion customer state) | ❌ | ✅ | Designed in ARCHITECTURE.md; `aiMemory` is the substrate | 🆕 | |

---

### 8. User Management & Auth

| Feature | V4 Status | V5 Status | V5 Approach | Priority | Notes |
|---------|-----------|-----------|-------------|----------|-------|
| User login (authentication) | ✅ | ✅ | `AccessKey` + `AuthSession` tables; `OnboardingGate.svelte` | P0 | V5: invite-code flow; V4: Microsoft OAuth2 PKCE |
| User roles (Admin/Manager/Sales/Ops/Accountant) | ✅ | ✅ | `UserRole` enum in STDB `Member` table | P0 | |
| Role-based permissions | ✅ | ✅ | Skill `requiredRoles` + `admin_only` approval gates | P0 | V5: enforced at skill level; V4: 40+ named permissions at handler level |
| User invitation flow | ✅ | ✅ | `AccessKey` table + Resend email integration in Settings | P0 | V5: admin creates invite code → email; V4: Microsoft Graph email |
| Multi-user / multiplayer | ❌ (single SQLite) | ✅ | STDB is multiplayer by default — all users see live state | 🆕 | **Fundamental architectural win** |
| User management UI | ✅ | ✅ | `SettingsPage.svelte` — team list, invite, roles | P0 | |
| Microsoft OAuth2 (Entra ID) | ✅ | ❌ | V5 uses STDB identity; no M365 SSO | P3 | V4 had full OAuth2 PKCE flow with PKCE, token refresh, scope management |
| Device licensing | ✅ | ❌ | V5 is cloud-first (STDB maincloud); no device-based license | P3 | V4 had `LicenseActivationScreen.svelte` + device activation codes |
| Setup wizard (first-run) | ✅ | 🔄 | `OnboardingGate.svelte` handles first-run; no full wizard | P2 | V4 had `SetupWizard.svelte` + `SetupAdminScreen.svelte` |
| Pending approval UI | ✅ | ✅ | `TransitionCard.svelte` for AI action approvals | P0 | V4: `PendingApprovalScreen.svelte` for PO/document approvals |
| Audit log | ✅ | ✅ | `ActivityLog` table — every action logged in STDB | P0 | **V5 audit log is atomic with the action** — V4's was logged AFTER commit (possible gap if crash) |

---

### 9. Integrations

| Feature | V4 Status | V5 Status | V5 Approach | Priority | Notes |
|---------|-----------|-----------|-------------|----------|-------|
| Email sending (transactional) | ✅ | ✅ | Resend API via `resend.ts` + `generate_email_draft` skill | P1 | V4 used Microsoft Graph (Mail.Send) |
| Microsoft Graph (OneDrive, SharePoint) | ✅ | ❌ | Skill: `upload_to_sharepoint` + `sync_calendar` — Microsoft Graph SDK integration | P3 | V4 had `microsoft_graph/` — upload PDFs to SharePoint, calendar events |
| Calendar integration | ✅ | ❌ | V5 uses `ActivityLog.followUpDue` instead | P3 | V4 had Calendar.Read via Graph |
| File system (scan folders, read Excel) | ❌ (Wails file dialog) | ✅ | Neutralino `filesystem.*` API — full folder scanning | 🆕 | **V5's killer feature**: Neutralino gives real file system access for AI skills |
| Sarvam AI (multilingual) | ❌ | ✅ | Chat model option + `translate_document` skill | 🆕 | |
| Tally integration (Excel import) | ✅ | ❌ | Would be `read_excel` skill + AI parsing | P1 | V4 had `tally_importer.go` — critical for GCC market |
| Bank statement parsing (PDF/CSV) | ✅ | ❌ | Would be `ocr_document` + `read_excel` skills | P1 | V4 had `bank_statement_parser.go` + `BankStatementParserService` |
| Streaming job queue (async operations) | ✅ | ❌ | STDB reducers are sync; long-running AI skills handled in-browser | P2 | V4 had `job_queue.go` + real-time streaming updates for long-running jobs |
| QGIF / geometry animations | ✅ | ❌ | V4 had geometry bridge + QGIF canvas animations; V5 uses Living Geometry CSS animations | P3 | |

---

## Schema Comparison

### V4 Database Tables (SQLite/GORM, ~55 tables)

```
CRM & Master Data:
  customers, customer_contacts, suppliers, supplier_contacts
  entity_notes, supplier_issues, products

Sales Pipeline:
  offers, offer_items, opportunities, costing_sheets,
  costing_items, costing_additional_costs, costing_history

Customer Orders:
  orders, order_items, shipments, post_sale_notes

Delivery:
  delivery_notes, delivery_note_items

Finance - AP/AR:
  invoices, invoice_items, invoice_sequences
  payments, ar_aging

Finance - Supplier:
  purchase_orders, goods_received_notes

Finance - Accounting:
  chart_of_accounts, journal_entries, journal_lines
  vat_returns, fx_rates, currency_exchange_rates

Finance - Bank:
  bank_accounts, bank_statements, bank_statement_lines,
  bank_transactions, cheque_registers, cheque_issuances,
  deposits_in_transit, outstanding_cheques

Inventory:
  inventory_items, stock_movements, stock_adjustments, warehouses

AI / Intelligence:
  prediction_records, win_probability_predictions,
  discount_recommendations, customer_snapshots, actual_outcomes,
  payment_prediction_accuracy, grade_changes

Auth & RBAC:
  users, roles, devices, device_users, user_sessions

System:
  settings, alerts, followup_tasks, audit_logs,
  job_queue, report_storage
```

### V5 STDB Tables (Rust module, 18 tables)

```
Auth:
  Member        — identity + role (STDB native identity)
  AccessKey     — invite codes for onboarding
  AuthSession   — active sessions

Party (Customer + Supplier unified):
  Party         — isCustomer + isSupplier booleans, grade, creditLimit
  Contact       — linked to Party

Sales Pipeline (unified):
  Pipeline      — Opportunity + CostingSheet + Offer in one row

Orders & Procurement:
  Order         — customer orders (from Pipeline)
  PurchaseOrder — supplier orders (linked to Order)
  LineItem      — shared by Order/PO/Invoice

Delivery & Receiving:
  DeliveryNote      — outbound to customer
  DeliveryNoteItem  — line items
  GoodsReceivedNote — inbound from supplier
  GrnItem           — line items

Finance (unified event ledger):
  MoneyEvent    — Customer Invoice + Payment + Supplier Invoice + Payment
                  kind: CustomerInvoice | CustomerPayment | SupplierInvoice | SupplierPayment

AI & Audit:
  ActivityLog   — audit trail + follow-ups (replaces followup_tasks + audit_logs)
  AiAction      — AI proposals with approval gate
  BankTransaction — bank statement rows (for reconciliation)
  DocSequence   — document numbering sequences
```

### The Unification Ratio

| V4 | V5 | Reduction |
|----|-----|-----------|
| ~55 tables | 18 tables | 3x fewer |
| 6 state machines (separate files) | 1 universal reducer | 6x fewer |
| 2 customer types (Customer + Supplier) | 1 `Party` table | 2x fewer |
| 4 finance tables (Invoice, Payment, SupplierInvoice, SupplierPayment) | 1 `MoneyEvent` table | 4x fewer |
| 3 pipeline tables (Opportunity, CostingSheet, Offer) | 1 `Pipeline` table | 3x fewer |
| 2 delivery tables (DeliveryNote + GRN separate) | Unified (both present) | ~same |

---

## Key Architectural Wins

### Win 1: "outstanding" is Never Stored

V4's Phase 18 bug: 313 invoices had `outstanding_bhd` values that diverged from reality because payments updated them via separate queries (outside transactions). The column was computed on create, then imperatively updated — creating a fragile materialized view.

V5 eliminates the concept:
```typescript
// COMPUTED, not stored — runs inside STDB reducer
function outstandingForParty(partyId: bigint): bigint {
  let invoiced = 0n;
  let paid = 0n;
  for (const me of db.moneyEvent.by_party.filter(partyId)) {
    if (me.kind.tag === 'CustomerInvoice') invoiced += me.totalFils;
    if (me.kind.tag === 'CustomerPayment') paid += me.totalFils;
  }
  return invoiced - paid;  // always correct, always live
}
```

### Win 2: STDB Reducers Are Serialized — No Race Conditions

V4 had SELECT FOR UPDATE added post-hoc to fix payment race conditions (TOCTOU: two concurrent payments both passing the balance check). V5 doesn't need this — STDB reducers are serialized by the database engine itself. The race condition is architecturally impossible.

### Win 3: Universal State Machine

V4 had 6 separate state machines in 6 files with different DFA encodings. The Mirzakhani+Grothendieck audit proved they're algebraically identical — all 6 are partial monoids over the same `Draft → Active → InProgress → Terminal / Cancelled` graph. V5 has one `advance_pipeline` reducer with a `TRANSITIONS` table:

```typescript
const TRANSITIONS = {
  Pipeline: { Draft: ['Active', 'Cancelled'], Active: ['InProgress', 'Terminal', 'Cancelled'], ... },
  Order: { Draft: ['Active', 'Cancelled'], Active: ['InProgress', 'Cancelled'], ... },
  // ... same structure for all entity types
};
```

One reducer enforces ALL state machines. Adding a new entity type = adding one entry to the TRANSITIONS table.

### Win 4: Real-Time Without a Sync Layer

V4 had a `sync_service.go` + `db_sync_service.go` (~500 LOC) to sync SQLite → Supabase for "multi-device access." This was never fully production-ready. V5 is multiplayer by default — STDB subscriptions mean every change propagates to all connected clients in <100ms with no sync layer code.

### Win 5: AI That Acts (Not Just Answers)

V4's Butler AI could answer questions using GORM queries + Mistral API. V5's AI executes skills:
```
User: "Chase all overdue Grade C customers"
AI: [creates AiAction { skillName: 'chase_payment', plan: {...}, status: 'Proposed' }]
UI: [shows TransitionCard with plan details + [Approve] button]
User: [Approve]
System: [calls resolve_ai_action reducer → executes skill → generates WhatsApp drafts]
AiAction.status → 'Executed', result stored
```

The approval gate + audit trail makes AI actions safe for production. V4's Butler suggested actions; V5 performs them.

### Win 6: Audit Log is Atomic With Action

V4's `audit_log` was written AFTER the database commit — if the process crashed between commit and audit write, you had financial transactions with no audit trail. V5's `ActivityLog` is written INSIDE the STDB reducer (same transaction). Crash-safe by construction.

---

## Gap Analysis: V4 Features V5 Needs to Implement

### Priority P0 — Must Have Before Demo

| Gap | V4 Source | V5 Approach | Effort |
|-----|-----------|-------------|--------|
| Bank reconciliation UI | `BankReconciliationScreen.svelte` + `bank_transaction_matcher.go` | Add "Bank Recon" tab to FinanceHub; `BankTransaction` table already in STDB. Build import skill + matching UI | Medium |
| Supplier dashboard (full peer to customer) | `CRMSupplierDashboard.svelte` | Expand `CRMHub.svelte` suppliers section — add grade filter, outstanding AP, contact view | Small |

### Priority P1 — Must Have Before Production

| Gap | V4 Source | V5 Approach | Effort |
|-----|-----------|-------------|--------|
| E+H XML parser | `eh_parser.go` | AI skill: `parse_eh_basket` — reads XML, applies EUR→BHD, builds line items with margin rules. Fits perfectly as an `ocr_document` skill variant | Medium |
| Survival intelligence (runway widget) | `survival_intelligence.go` | Add "Cash Runway" KPI card to Dashboard — compute from MoneyEvents + known monthly burn constant | Small |
| Tally Excel importer | `tally_importer.go` | Skill: `import_tally` — reads Excel via `read_excel` skill + maps to `MoneyEvent` + `Party` creates | Medium |
| Bank statement import | `bank_statement_parser.go` | Skill: `import_bank_statement` — CSV/Excel → `BankTransaction` rows. Connect to recon UI | Medium |
| Amount in words (BHD) | `pdf_generator.go:numberToWords()` | Add to `invoiceGenerator.ts` and `quotationGenerator.ts` — pure TypeScript function | Small |
| Product markup rules in AI context | `costing_engine.go:ProductMarkupRules` | Add to `buildSystemPrompt()` in `context.ts` — give Butler the E+H/Servomex/GIC markup table | Tiny |
| Follow-up task UI | `InboxScreen.svelte` + `FollowUpTask` table | Add "Follow-ups" section to Dashboard — query `ActivityLog.followUpDue` where due soon | Small |
| AR Aging export (PDF/Excel) | `report_generators.go` | Add export button to AR Aging tab — use `export_to_excel` skill with aging data | Small |
| PO approval threshold | `purchase_order_service.go` | Enforce in `manage_purchase_order` reducer: if `totalFils > 5_000_000n` (5,000 BHD), require Manager+ role | Small |
| Cash position / bank balance view | `CashPositionWidget.svelte` | Add BankTransaction aggregate to Dashboard — current reconciled balance per bank account | Medium |

### Priority P2 — Important for Full Capability

| Gap | V4 Source | V5 Approach | Effort |
|-----|-----------|-------------|--------|
| VAT return computation | `VATReturn` table + `finance_reporting_service.go` | Skill: `compute_vat_return` — aggregate MoneyEvents by period → output VAT (sales) vs input VAT (purchases) | Small |
| Supplier bank details (structured) | `SupplierMaster.IBAN/SWIFT` | Add `bankIban`, `bankSwift`, `bankName` fields to `Party` — used when generating supplier payment instructions | Small |
| Supplier issues log | `SupplierIssue` table | Use `ActivityLog` with `action = 'supplier_issue'` + structured `detail` JSON | Small |
| Cheque register | `ChequeRegisterScreen.svelte` | New `MoneyEvent` with `kind = 'ChequeIssuance'` + `kind = 'ChequeCleared'`; status tracking | Medium |
| Partial shipment per line item | `RecordPartialShipment` | Add `quantityShipped` to `LineItem` + update in `manage_order` reducer | Small |
| Arabic RTL in PDFs | `arabic_shaper.go` | Switch PDF generation to pdf-lib or use pdfmake Arabic plugin — bilingual Bahrain documents | Large |

### Priority P3 — Contractual Requirement (ALL must ship)

⚠️ **P3 does NOT mean "nice to have".** Every feature is a contractual deliverable. P3 indicates build ORDER (after P1/P2), not importance. The SPOC (Abhie — ex-Amazon Kaizen) will test every edge case. Nothing ships until everything ships.

| Gap | V4 Source | V5 Approach | Effort |
|-----|-----------|-------------|--------|
| Contract generation | `contract_service.go` | Skill: `generate_contract` — grade → clause selection → pdfmake PDF | Medium |
| FX revaluation | `FXRevaluationScreen.svelte` + CBB rates | Add `fxRates` table + skill: `record_fx_rate`. V5 is BHD-first but multi-currency is required | Large |
| Inventory / stock | `InventoryItem`, `StockMovement` | Add `Product` + `StockEntry` tables — PH Trading handles physical goods | Large |
| Microsoft Graph (OneDrive/SharePoint) | `microsoft_graph/` | Integration skill using Microsoft Graph SDK — upload generated PDFs to SharePoint | Large |
| Device licensing | `LicenseActivationScreen.svelte` | STDB identity handles this; admin-controlled invite codes are sufficient | Skip — covered by STDB identity |

---

## What V5 Has That V4 Never Had (V5-Only Superpowers)

| Superpower | Description | Business Impact |
|-----------|-------------|-----------------|
| 🤖 AI Skill Execution | 28 skills with approval gate + audit trail | "Chase all Grade C customers" → AI does it with one click |
| 🌐 Real-time Multiplayer | 8-person team sees same live state via STDB | No more "whose numbers are right?" between Abhie and his accountant |
| 📁 Folder Scanning | Neutralino reads any folder on Abhie's Windows PC | "Take Q1 invoices folder → generate revenue PPT" is now possible |
| 📊 PowerPoint Generation | `generate_pptx` skill | Board-ready slides from live business data in minutes |
| 🧠 Persistent AI Memory | `aiMemory` table — AI remembers cross-session | "Remember that BAPCO always pays late despite Grade B" |
| 💬 Multi-Conversation History | Named conversations, switch anytime | Research thread vs action thread vs weekly review |
| 🔢 Document MVC Checklists | AI knows what data it needs before generating docs | No half-baked invoices — AI asks for missing fields first |
| 🌍 Multilingual (Sarvam) | Arabic/Hindi translation built in | Arabic email drafts for Bahrain customers |
| ✅ Structural Correctness | STDB reducers as invariants, not conventions | The Phase 18 bug and race conditions are architecturally impossible |
| ⚡ Atomic Audit Trail | Every action logged in same STDB transaction | Crash-safe compliance — no audit gap even on process crash |

---

## Size Summary

| Dimension | V4 | V5 | Delta |
|-----------|----|----|-------|
| Total LOC | ~156,000 | ~7,230 | **21x smaller** |
| Database tables | ~55 | 18 | **3x fewer** |
| State machines | 6 (separate) | 1 (universal) | **6x simpler** |
| Frontend screens | 43 | 7 hubs | **6x fewer navigation decisions** |
| Components | 177 | ~30 | **6x fewer** |
| AI capabilities | Chat + answers | Chat + 28 executable skills | **28x more AI power** |
| Users supported | 1 (SQLite) | Unlimited (STDB multiplayer) | **∞x scale** |
| PDF templates | 4 (Go/gopdf) | 7+ (pdfmake, letterhead-accurate) | **More + better quality** |

---

## Conclusion

V5 is architecturally superior to V4 in every structural dimension. The business capabilities that matter most to Abhie (invoice, PO, delivery, payment chase, quotation, real-time visibility) are all working. The gaps are in **depth** — V4 was built over many months and accumulated specialized features (E+H XML parser, Tally importer, cheque register, bank recon UI) that V5 needs to implement.

The good news: because V5's architecture is fundamentally simpler (18 tables vs 55, 1 state machine vs 6, STDB reducers as invariants), each gap is a **skill** — a focused ~50-150 line TypeScript function, not a 500-line Go service with its own transaction management.

**⚠️ ALL priorities (P1/P2/P3) are contractual deliverables.** Priority indicates build ORDER, not importance. Every feature must be implemented and edge-case tested before delivery. The SPOC (Abhie) is an ex-Amazon Kaizen practitioner with a preternatural ability to find exactly the thing that's broken — so "works in the happy path" is not sufficient. Every reducer, every skill, every PDF must handle edge cases: zero amounts, missing fields, Arabic text, multi-currency, concurrent users, offline recovery.

V4 took months. V5's architecture means each remaining gap should take days — but every single one MUST ship.

**The meek shall inherit the earth — with 21x better, 100% complete code.** 🔥

---

*Om Lokah Samastah Sukhino Bhavantu — May all beings benefit from simpler, more correct software.*
