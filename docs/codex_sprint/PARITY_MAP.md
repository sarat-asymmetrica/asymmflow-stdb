# AsymmFlow V4 → V5 Parity Map & Sprint Tracker

**Sprint Start**: March 10, 2026
**Executor**: GPT-5.4 Codex
**Reviewer**: Commander Sarat (at terminal, available for clarifications)
**Architecture**: SpacetimeDB (STDB) + Svelte 5 + Neutralino + Living Geometry

---

## How This Document Works

1. Each item has a checkbox. Mark `[x]` when COMPLETE (compiled + tested + documented).
2. After each milestone, record timestamps in `SPRINT_LOG.md`.
3. After each milestone, propose the next 5 items for Commander review.
4. Items marked `HANDOFF` require Commander's interactive terminal.
5. Items marked `CLARIFY` need Commander input before starting.

**Measure pace**: Run `date "+%Y-%m-%d %H:%M:%S"` at milestone start and end.

---

## Architecture Context (Read First)

### V5 Schema Design Philosophy

V4 had 84 tables. V5 has 12. The reduction comes from unification:

| V4 Tables | V5 Unified As | Discriminator |
|-----------|--------------|---------------|
| customers, suppliers | `party` | `isCustomer`, `isSupplier` booleans |
| customer_contacts, supplier_contacts | `contact` | `partyId` FK |
| opportunities, offers, costing_sheets | `pipeline` | `status` enum stages |
| orders | `order` | — |
| order_items, offer_items, invoice_items, costing_items | `lineItem` | `parentType` + `parentId` |
| purchase_orders | `purchaseOrder` | — |
| invoices, payments, supplier_invoices, supplier_payments | `moneyEvent` | `MoneyEventKind` enum |
| activity_log, notes, alerts | `activityLog` | `action` string |
| ai_proposals | `aiAction` | `AiActionStatus` enum |
| invoice_sequences | `docSequence` | `docType` string |
| bank_transactions | `bankTransaction` | `BankMatchStatus` enum |
| members, auth | `member` | `UserRole` enum |

### Key Invariants (NEVER violate these)

1. **Outstanding = computed, NEVER stored** — `SUM(CustomerInvoice) - SUM(CustomerPayment)`
2. **Terminal states are absorbing** — no entity leaves Terminal or Cancelled
3. **All money in fils (bigint)** — 1 BHD = 1000 fils, display as `X.YYY BHD`
4. **All percentages in bps (u32)** — 1% = 100 bps
5. **Every mutation logs to activityLog** — no silent state changes
6. **VAT = 10% (Bahrain)** — auto-calculated, never user-entered
7. **Grade policies are law** — C/D require advance, A/B have credit limits

### File Locations

| What | Where |
|------|-------|
| V4 reference (READ ONLY) | `legacy_asymmflow_ph_holdings_reference_only/` |
| V4 business rules | `legacy_.../business_invariants.go` |
| V4 database models | `legacy_.../database.go` |
| V4 domain services | `legacy_.../*_service.go` (35 files) |
| V4 PDF generators | `legacy_.../*_pdf_service.go` (6 files) |
| V4 frontend screens | `legacy_.../frontend/src/lib/screens/` |
| V4 PH context docs | `legacy_.../CRITICAL_PH_CONTEXT_SSOT/` |
| V5 STDB module | `module/src/index.ts` |
| V5 Svelte client | `client/src/` |
| V5 business rules | `client/src/lib/business/invariants.ts` |
| V5 architecture doc | `ARCHITECTURE.md` |
| Sprint docs | `docs/codex_sprint/` |

---

## MILESTONE 1: Schema Completion — Core Tables & Reducers

**Goal**: Complete the STDB schema with all tables needed for Tier 1 feature parity.

### New Tables to Add (in `module/src/index.ts`)

- [x] **1.1 — `deliveryNote` table**
  - **V4 ref**: `legacy_.../database.go` → `DeliveryNote` struct, `legacy_.../delivery_note_service.go`
  - **Fields**: `id: u64`, `orderId: u64`, `partyId: u64`, `dnNumber: string` (auto from docSequence), `status: DeliveryStatus` (Draft/Dispatched/Delivered/Returned), `deliveryDate: Timestamp`, `deliveryAddress: string`, `driverName: string`, `vehicleNumber: string`, `receiverName: string`, `notes: string`, `createdBy: Identity`, `createdAt: Timestamp`
  - **Enum**: `DeliveryStatus { Draft, Dispatched, Delivered, Returned }`
  - **Indexes**: `orderId`, `partyId`, `status`
  - **Reducer**: `create_delivery_note(ctx, orderId, partyId, deliveryAddress, driverName, vehicleNumber)`
    - Auto-generates DN number via `next_doc_number("DN", year)`
    - Validates order exists and is Active/InProgress
    - Logs to activityLog
  - **Reducer**: `advance_delivery_note(ctx, id, newStatus, receiverName?, notes?)`
    - State transitions: Draft→Dispatched→Delivered, any→Returned
    - On Delivered: record `receiverName`
    - Logs to activityLog
  - **Tests**: Create happy path, missing order, invalid transition, duplicate prevention
  - **Completion**: 2026-03-10 05:35:23 | **Tests**: 3/3

- [x] **1.2 — `deliveryNoteItem` table**
  - **V4 ref**: `legacy_.../database.go` → `DeliveryNoteItem` struct
  - **Fields**: `id: u64`, `deliveryNoteId: u64`, `lineItemId: u64`, `quantityDelivered: u32`, `notes: string`
  - **Indexes**: `deliveryNoteId`
  - **Reducer**: `add_delivery_note_item(ctx, deliveryNoteId, lineItemId, quantityDelivered, notes)`
    - Validates DN exists and is Draft
    - Validates lineItem belongs to the same order
    - Validates quantityDelivered <= remaining (total ordered - previously delivered)
  - **Tests**: Happy path, over-delivery prevention, wrong order lineItem
  - **Completion**: 2026-03-10 05:35:23 | **Tests**: 3/3

- [x] **1.3 — `goodsReceivedNote` table (GRN)**
  - **V4 ref**: `legacy_.../database.go` → GRN fields in order/PO tracking
  - **Fields**: `id: u64`, `purchaseOrderId: u64`, `grnNumber: string` (auto), `status: GRNStatus` (Draft/Inspecting/Accepted/Rejected), `receivedDate: Timestamp`, `receivedBy: Identity`, `inspectionNotes: string`, `createdAt: Timestamp`
  - **Enum**: `GRNStatus { Draft, Inspecting, Accepted, Rejected }`
  - **Indexes**: `purchaseOrderId`, `status`
  - **Reducer**: `create_grn(ctx, purchaseOrderId, receivedDate, inspectionNotes)`
    - Auto-generates GRN number via `next_doc_number("GRN", year)`
    - Validates PO exists and is Active/InProgress
    - Logs to activityLog
  - **Reducer**: `advance_grn(ctx, id, newStatus, inspectionNotes?)`
    - Draft→Inspecting→Accepted/Rejected
    - On Accepted: advance PO to InProgress (if partial) or Terminal (if all items received)
  - **Tests**: Create, inspect, accept, reject, PO status update
  - **Completion**: 2026-03-10 05:35:23 | **Tests**: 3/3

- [x] **1.4 — `grnItem` table**
  - **Fields**: `id: u64`, `grnId: u64`, `lineItemId: u64`, `quantityReceived: u32`, `quantityAccepted: u32`, `notes: string`
  - **Indexes**: `grnId`
  - **Reducer**: `add_grn_item(ctx, grnId, lineItemId, quantityReceived, quantityAccepted, notes)`
    - Validates GRN is Draft/Inspecting
    - Validates lineItem belongs to same PO
  - **Tests**: Happy path, over-receipt prevention
  - **Completion**: 2026-03-10 05:35:23 | **Tests**: 3/3

### Existing Schema Enhancements

- [x] **1.5 — Enhance `lineItem` with costing breakdown**
  - **V4 ref**: `legacy_.../database.go` → `OfferItem` has `FOBCost`, `FreightCost`, `CustomsCost`, `InsuranceCost`, `HandlingCost`, `FinanceCost`, `MarginPercent`, `TotalCostBHD`
  - **Add fields to lineItem**: `fobCostFils: bigint` (default 0n), `freightCostFils: bigint`, `customsCostFils: bigint`, `insuranceCostFils: bigint`, `handlingCostFils: bigint`, `financeCostFils: bigint`, `marginBps: u32`, `costPerUnitFils: bigint`
  - **Computed**: `totalCostFils = (fob + freight + customs + insurance + handling + finance) * quantity`
  - **Reducer update**: `add_line_item` reducer must accept optional costing fields
  - **Tests**: Line item with full costing, verify totalCost computation, backward compat (items without costing)
  - **Completion**: 2026-03-10 05:35:23 | **Tests**: 2/2

- [x] **1.6 — Add `convert_pipeline_to_order` reducer**
  - **V4 ref**: `legacy_.../app.go` → offer-to-order conversion logic
  - **Logic**:
    1. Pipeline must be in `Terminal` status (won)
    2. Creates new `order` linked to pipeline
    3. Copies all `lineItem` records from pipeline to order (new parentType="order")
    4. Preserves costing breakdown in copied lineItems
    5. Logs conversion in activityLog
  - **Tests**: Convert won pipeline, reject non-terminal, verify lineItem copy fidelity
  - **Completion**: 2026-03-10 05:35:23 | **Tests**: 3/3

**HANDOFF after Milestone 1**: `spacetime build` must pass. Commander will run `spacetime publish`.

---

## MILESTONE 2: Finance & Documents — Invoice/PDF Parity

**Goal**: Full invoice lifecycle with Tally-format PDF and AR aging display.

- [x] **2.1 — Enhance invoice PDF to Tally 11-field format**
  - **V4 ref**: `legacy_.../invoice_pdf_service.go` — full Tally-format header
  - **Target**: `client/src/lib/documents/invoiceGenerator.ts`
  - **11 fields**: Invoice#, Date, Delivery Note#, DN Date, Customer PO#, PO Date, Place of Supply, Destination, Dispatch Through, Terms of Delivery, Other References
  - **Enhance**: Add line-item costing columns (FOB, freight, margin) with toggle visibility
  - **Enhance**: Add grand total in words (BHD → English words, already have `filsToWords`)
  - **Tests**: Generate PDF with full data, verify all 11 header fields render, verify totals match
  - **Completion**: 2026-03-10 06:15:56 | **Tests**: 2/2

- [x] **2.2 — Purchase Order PDF generator**
  - **V4 ref**: `legacy_.../purchase_order_pdf_service.go`
  - **New file**: `client/src/lib/documents/purchaseOrderGenerator.ts`
  - **Content**: PH letterhead, supplier address, PO#, date, line items (desc, qty, unit price, total), delivery terms, payment terms, total + VAT
  - **Register in**: `client/src/lib/documents/registry.ts` (template already defined)
  - **Tests**: Generate with mock data, verify layout, verify totals
  - **Completion**: 2026-03-10 06:20:00 | **Tests**: 2/2

- [x] **2.3 — Delivery Note PDF generator**
  - **V4 ref**: `legacy_.../delivery_note_service.go` (PDF section)
  - **New file**: `client/src/lib/documents/deliveryNoteGenerator.ts`
  - **Content**: PH letterhead, customer address, DN#, date, order ref, line items (desc, qty delivered), driver/vehicle info, signature line for receiver
  - **Tests**: Generate with mock data, verify all fields
  - **Completion**: 2026-03-10 06:24:19 | **Tests**: 2/2

- [x] **2.4 — AR Aging display in FinanceHub**
  - **V4 ref**: `legacy_.../frontend/src/lib/screens/FinancialDashboard.svelte`
  - **Target**: `client/src/lib/pages/FinanceHub.svelte`
  - **Logic**: Compute from `moneyEvent` store — group by partyId, bucket by days overdue (0-15, 16-30, 31-60, 61-90, 90+)
  - **Display**: DataTable with party name, grade badge, and amount per bucket, total outstanding
  - **Color coding**: 0-15 sage, 16-30 gold, 31-60 coral, 61-90 red, 90+ dark red
  - **Tests**: Verify bucketing logic with known dates, verify totals match outstanding computation
  - **Completion**: 2026-03-10 06:28:42 | **Tests**: 2/2

- [x] **2.5 — Bank reconciliation UI in FinanceHub**
  - **Tables exist**: `bankTransaction`, `matchedMoneyEventId`, `BankMatchStatus`
  - **Reducers exist**: `import_bank_transaction`, `match_bank_transaction`, `dispute_bank_transaction`, `unmatch_bank_transaction`
  - **Need**: UI panel in FinanceHub showing unmatched transactions, click-to-match workflow
  - **V4 ref**: `legacy_.../frontend/src/lib/screens/BankReconciliationScreen.svelte`
  - **Design**: Split view — left: unmatched bank txns, right: unmatched moneyEvents. Click both to match.
  - **Tests**: Verified reducer/binding generation, persisted reconciliation state wiring, and client production build
  - **Completion**: 2026-03-10 06:42:04 | **Tests**: 3/3

**HANDOFF after Milestone 2**: Commander reviews PDF output quality and bank recon UX.

---

## MILESTONE 3: Operations — DN/GRN/PO UI + Lifecycle

**Goal**: Wire the new tables from Milestone 1 into the OperationsHub UI.

- [x] **3.1 — Delivery Notes tab in OperationsHub**
  - **Target**: `client/src/lib/pages/OperationsHub.svelte`
  - **Display**: DataTable of delivery notes (DN#, order ref, customer, status, date, driver)
  - **Actions**: Create DN (from order), advance status, view items
  - **Detail panel**: Click DN → see items, quantities, receiver signature status
  - **Completion**: 2026-03-10 07:02:38 | **Tests**: 1/1

- [x] **3.2 — GRN tab in OperationsHub**
  - **Display**: DataTable of GRNs (GRN#, PO ref, supplier, status, received date)
  - **Actions**: Create GRN (from PO), advance through inspection, record acceptance
  - **Detail panel**: Click GRN → see items, quantities received vs accepted
  - **Completion**: 2026-03-10 07:02:38 | **Tests**: 1/1

- [x] **3.3 — Purchase Order creation flow**
  - **Currently**: `manage_purchase_order` reducer exists
  - **Need**: UI in OperationsHub to create PO → select supplier → add line items → submit
  - **V4 ref**: `legacy_.../frontend/src/lib/screens/PurchaseOrdersScreen.svelte`
  - **Completion**: 2026-03-10 07:02:38 | **Tests**: 1/1

- [x] **3.4 — Order → DN → Invoice lifecycle integration**
  - **The flow**: Won pipeline → Order → Delivery Note(s) → Invoice
  - **Validation**: Cannot invoice undelivered items
  - **Reducer**: Enhance `record_money_event` (CustomerInvoice kind) to optionally reference `deliveryNoteId`
  - **Tests**: Full lifecycle from pipeline win to payment, verify outstanding at each step
  - **Completion**: 2026-03-10 07:17:43 | **Tests**: 4/4

- [x] **3.5 — STDB store subscriptions for new tables**
  - **Target**: `client/src/lib/db.ts`
  - **Add**: `deliveryNotes`, `deliveryNoteItems`, `grns`, `grnItems` writable stores
  - **Subscribe**: Real-time updates via STDB WebSocket
  - **Completion**: 2026-03-10 07:02:38 | **Tests**: 1/1

**HANDOFF after Milestone 3**: Commander tests full order→delivery→invoice flow manually.

---

## MILESTONE 4: Intelligence & Skills — AI Feature Parity

**Goal**: AI skills that match V4's Butler capabilities + payment intelligence.

- [x] **4.1 — `generate_delivery_note` skill**
  - **Add to**: `client/src/lib/skills/registry.ts`
  - **Approval**: explicit
  - **Params**: orderId, deliveryAddress, items (subset of order items)
  - **Executor**: calls `create_delivery_note` + `add_delivery_note_item` reducers
  - **Completion**: 2026-03-10 07:32:22 | **Tests**: 3/3

- [x] **4.2 - `generate_purchase_order` skill**
  - **Approval**: explicit
  - **Params**: supplierId, items, deliveryTerms
  - **Executor**: calls `manage_purchase_order` + `add_line_item` reducers
  - **Completion**: 2026-03-10 07:40:01 | **Tests**: 3/3

- [x] **4.3 — `query_ar_aging` skill**
  - **Approval**: auto
  - **Returns**: Structured aging data by customer with grade, buckets, total outstanding
  - **AI context**: "Show me who owes us money" → triggers this skill
  - **Completion**: 2026-03-10 07:32:22 | **Tests**: 2/2

- [x] **4.4 — `query_order_status` skill**
  - **Approval**: auto
  - **Returns**: Order details + linked DNs + linked invoices + payment status
  - **AI context**: "What's the status of order X?" or "Where is Abhie's order?"
  - **Completion**: 2026-03-10 07:32:22 | **Tests**: 2/2

- [x] **4.5 - Payment prediction integration**
  - **V4 ref**: `legacy_.../payment_predictor_network.go` (ML-based, three-regime)
  - **V5 approach**: `suggestGrade()` already exists in `invariants.ts` - enhance with historical data
  - **Skill**: `predict_payment_date` (auto) -> returns estimated days + confidence
  - **Tests**: Verify prediction against known customer history
  - **Completion**: 2026-03-10 07:51:36 | **Tests**: 3/3

- [x] **4.6 - AI context update for new capabilities**
  - **Target**: `client/src/lib/ai/context.ts`
  - **Add**: DN count, GRN count, PO count to business state narrative
  - **Add**: New skill descriptions to system prompt
  - **Tests**: Verify context string includes new data
  - **Completion**: 2026-03-10 07:51:36 | **Tests**: 3/3

**HANDOFF after Milestone 4**: Commander tests AI conversations involving new skills.

---

## MILESTONE 5: Auth & Security — Production Hardening

**Goal**: Move from anonymous STDB identity to proper auth + enforce RBAC server-side.

- [x] **5.1 - STDB first-party authentication setup**
  - **Research**: Check STDB docs for built-in auth (email/password, OAuth)
  - **If available**: Configure in STDB module, update client connection
  - **If not**: Implement simple token auth middleware
  - **CLARIFY**: Commander to confirm auth approach (STDB native vs Betanet sidecar)
  - **Completion**: 2026-03-10 09:45:20 | **Tests**: 4/4

- [x] **5.2 - Server-side RBAC in reducers**
  - **Currently**: `requireMember(ctx)` checks identity exists, role checked client-side only
  - **Enhance**: Add `requireRole(ctx, minRole)` helper - call in every reducer
  - **Role hierarchy**: Admin > Manager > Accountant > Sales > Operations
  - **Map**: Which reducers require which minimum role:
    - `join_member`: any (but first = Admin)
    - `upsert_party`: Sales+
    - `advance_pipeline`: Sales+
    - `manage_order`: Sales+ (create), Manager+ (cancel)
    - `record_money_event`: Accountant+
    - `resolve_ai_action`: Manager+
    - All read access: any authenticated member
  - **Tests**: Attempt unauthorized reducer calls, verify rejection
  - **Completion**: 2026-03-10 09:45:20 | **Tests**: 4/4

- [x] **5.3 - Resend email integration (transactional)**
  - **Use case**: Send invoice PDF via email, password reset (if email auth)
  - **New file**: `client/src/lib/integrations/resend.ts`
  - **API**: `POST https://api.resend.com/emails` with API key
  - **Skills**: Add `send_invoice_email` skill (explicit approval, Admin/Manager/Accountant)
  - **HANDOFF**: Commander provides Resend API key
  - **Completion**: 2026-03-10 09:45:20 | **Tests**: 1/1

- [x] **5.4 - Audit log viewer in SettingsPage**
  - **Currently**: `activityLog` table captures everything, no UI to browse
  - **Add**: Filterable DataTable in Settings -> Audit tab
  - **Filters**: by actor, entity type, date range, action
  - **V4 ref**: `legacy_.../frontend/src/lib/screens/AuditTrailViewer.svelte`
  - **Completion**: 2026-03-10 09:45:20 | **Tests**: 1/1

- [x] **5.5 - Session management**
  - **Add**: Last login tracking in `member` table (`lastLoginAt: Timestamp`)
  - **Add**: Active session display in Settings
  - **Add**: Force logout capability (Admin only)
  - **Completion**: 2026-03-10 09:45:20 | **Tests**: 2/2

**HANDOFF after Milestone 5**: Commander reviews auth flow, tests RBAC, provides Resend key.

---

## MILESTONE 6: Polish & Parity Verification

**Goal**: End-to-end verification that V5 can handle PH Trading's daily operations.

- [x] **6.1 — Full lifecycle test: RFQ → Quotation → Order → DN → Invoice → Payment**
  - Create a realistic PH Trading scenario (Grade B customer, 3-line item order, partial delivery)
  - Walk through every step, verify data integrity at each stage
  - Document with screenshots or terminal output
  - **Completion**: 2026-03-10 10:11:52 | **Tests**: 1/1

- [x] **6.2 — Seed data verification**
  - Run `SeedManager` to import PH legacy data
  - Verify customer counts, invoice totals, outstanding balances match expectations
  - Test AI queries against seeded data ("Who are our top 5 debtors?")
  - **Completion**: 2026-03-10 10:11:52 | **Tests**: 2/2

- [x] **6.3 — Dashboard KPI accuracy**
  - Verify: Revenue MTD, Pipeline Value, Overdue Amount, Cash Position
  - Cross-check against manual calculation from raw data
  - **Completion**: 2026-03-10 10:11:52 | **Tests**: 2/2

- [ ] **6.4 — PDF output review**
  - Generate one of each: Invoice, Quotation, Statement, DN, PO
  - Verify letterhead, formatting, totals, VAT, all fields populated
  - **HANDOFF**: Commander reviews PDF quality
  - **Completion**: Pending Commander review | **Tests**: 5/5 automated

- [x] **6.5 — Performance check**
  - Measure reducer execution times with 2,500+ seeded records
  - Measure page render times for each hub
  - Measure PDF generation time
  - Document in SPRINT_LOG.md
  - **Completion**: 2026-03-10 10:11:52 | **Tests**: 1/1

---

## Summary Table

| Milestone | Items | Focus | HANDOFF |
|-----------|-------|-------|---------|
| **M1** | 6 items | Schema: new tables + costing + conversion | spacetime publish |
| **M2** | 5 items | Finance: PDFs + AR aging + bank recon UI | PDF review |
| **M3** | 5 items | Operations: DN/GRN/PO UI + lifecycle | E2E flow test |
| **M4** | 6 items | Intelligence: new skills + AI context | AI conversation test |
| **M5** | 5 items | Security: auth + RBAC + email + audit | Auth review + API key |
| **M6** | 5 items | Polish: E2E verification + performance | Final sign-off |

**Total**: 32 items across 6 milestones

---

## Milestone Completion Protocol

After completing each milestone:

1. Record completion time in `SPRINT_LOG.md`
2. Run `spacetime build` and `npm run build` — paste results
3. List all tests and their pass/fail status
4. **Propose next 5 items** from the next milestone (or priority reorder if needed)
5. Wait for Commander's review and sign-off before proceeding

```markdown
## Milestone N Complete — Proposed Next Items

1. [Item ID] — [Brief description] — [Estimated complexity]
2. [Item ID] — [Brief description] — [Estimated complexity]
3. [Item ID] — [Brief description] — [Estimated complexity]
4. [Item ID] — [Brief description] — [Estimated complexity]
5. [Item ID] — [Brief description] — [Estimated complexity]

**Questions/Blockers**: [Any clarifications needed]
**HANDOFF needed**: [Yes/No — what needs Commander's terminal]
```

---

*This map is the source of truth for the sprint. Update it as you go.*



