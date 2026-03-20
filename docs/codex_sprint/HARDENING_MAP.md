# AsymmFlow V5 Hardening Sprint — Review Findings Fix Map

**Sprint Start**: March 10, 2026
**Executor**: GPT-5.4 Codex
**Source**: Claude Opus 4.6 code review of Milestones 1-6
**Reviewer**: Commander Sarat

---

## How This Document Works

1. Each item has a checkbox. Mark `[x]` when COMPLETE (compiled + tested + documented).
2. After each milestone, record timestamps in `SPRINT_LOG.md` (append, don't overwrite).
3. After each milestone, run `npm test`, `npm run build`, `npm run check` — paste results.
4. Items are grouped by severity: P0 first, then P1, then P2.
5. **Measure pace**: Run `date "+%Y-%m-%d %H:%M:%S"` at milestone start and end.

---

## Architecture Context (Read Before Starting)

### Key Invariants (unchanged from PARITY_MAP.md)

1. **Outstanding = computed, NEVER stored** — `SUM(CustomerInvoice) - SUM(CustomerPayment)`
2. **Terminal states are absorbing** — no entity leaves Terminal or Cancelled
3. **All money in fils (bigint)** — 1 BHD = 1000 fils
4. **All percentages in bps (u32)** — 1% = 100 bps
5. **Every mutation logs to activityLog** — no silent state changes
6. **VAT = 10% (Bahrain)** — auto-calculated, never user-entered
7. **Grade policies are law** — C/D require advance, A/B have credit limits

### Existing Pattern to Reuse

The delivery note state machine in `milestone1_logic.ts` (`advanceDeliveryNoteImpl`) is the gold standard. It uses an explicit allowed-transitions map:

```typescript
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  Draft: ['Dispatched', 'Returned'],
  Dispatched: ['Delivered', 'Returned'],
  // Delivered and Returned are terminal — not listed = no transitions allowed
};
```

**Apply this exact pattern** to `manage_order`, `manage_purchase_order`, and `advance_pipeline`.

---

## MILESTONE 7: State Machine & Invariant Hardening (P0)

**Goal**: Every entity state machine is absorbing at terminal states. Core business invariants enforced server-side.

- [x] **7.1 — Add state machine guards to `manage_order`**
  - **File**: `module/src/index.ts` (reducer) + `module/src/milestone1_logic.ts` (logic)
  - **Problem**: `manage_order` accepts any `newStatus` for existing orders. A Cancelled or Terminal order can be set back to Active.
  - **Fix**: Add `ALLOWED_ORDER_TRANSITIONS` map. Order states: `Draft → Active → InProgress → Terminal`, `any non-terminal → Cancelled`. Terminal and Cancelled are absorbing.
  - **Extract** the status-update logic into a new `manageOrderImpl` function in `milestone1_logic.ts` (same pattern as `advanceDeliveryNoteImpl`).
  - **Tests**: Attempt `Terminal → Active` (reject), `Cancelled → InProgress` (reject), `Active → Terminal` (allow), `Active → Cancelled` (allow)

- [x] **7.2 — Add state machine guards to `manage_purchase_order`**
  - **File**: `module/src/index.ts` + `module/src/milestone1_logic.ts`
  - **Problem**: Same as 7.1 — any status accepted, Terminal POs can be re-opened.
  - **Fix**: Add `ALLOWED_PO_TRANSITIONS` map. PO states: `Draft → Active → InProgress → Terminal`, `any non-terminal → Cancelled`. Terminal and Cancelled are absorbing.
  - **Additional fix**: When a non-Draft PO update silently ignores `totalFils` changes, throw an explicit error instead: `"Cannot update totalFils on a non-Draft purchase order"`
  - **Tests**: Same pattern as 7.1 plus the totalFils guard test

- [x] **7.3 — Add state machine guards to `advance_pipeline`**
  - **File**: `module/src/index.ts` + `module/src/milestone1_logic.ts`
  - **Problem**: Pipeline accepts any `newStatus`. A Terminal (won) or Cancelled pipeline can be set to Draft.
  - **Fix**: Add `ALLOWED_PIPELINE_TRANSITIONS` map. Pipeline states: `Prospect → Qualified → Proposal → Negotiation → Terminal`, `any non-terminal → Cancelled`. Terminal and Cancelled are absorbing.
  - **Note**: `lossReason` should only be set when transitioning TO Cancelled — guard this.
  - **Tests**: Attempt `Terminal → Draft` (reject), `Cancelled → Prospect` (reject), `Prospect → Qualified` (allow)

- [x] **7.4 — Guard `resolve_ai_action` to only allow Proposed → Approved/Rejected**
  - **File**: `module/src/index.ts`
  - **Problem**: Already-Executed or Failed actions can be approved/rejected again.
  - **Fix**: Add guard: `if (existing.status.tag !== 'Proposed') throw new Error('Only Proposed actions may be resolved')`
  - **Tests**: Create action, resolve to Approved, attempt re-resolve (reject)

- [x] **7.5 — Enforce `isCreditBlocked` and Grade C/D advance payment policy**
  - **File**: `module/src/milestone1_logic.ts` — `recordMoneyEventImpl`
  - **Problem**: `isCreditBlocked` field exists on `party` but is never read. Grade C/D customers with `paymentTermsDays = 0` can still receive credit invoices without prior payment.
  - **Fix in `recordMoneyEventImpl`** (CustomerInvoice branch):
    1. Read `party` for the invoice's `partyId`
    2. If `party.isCreditBlocked === true`, throw: `"Party is credit-blocked — cannot issue invoice"`
    3. If `party.grade` is C or D: compute `totalPayments - totalInvoices` for this party. If result < invoice amount, throw: `"Grade C/D parties require advance payment covering the invoice amount"`
  - **Fix in `manage_order`** (or the new `manageOrderImpl`):
    1. When creating a new order (no existing), check `party.isCreditBlocked`
    2. If blocked, throw: `"Cannot create order for credit-blocked party"`
  - **Tests**: Grade C party with no advance → invoice rejected. Grade C party with sufficient advance → invoice allowed. Credit-blocked party → order creation rejected.

- [x] **7.6 — Fix bigint underflow in `context.ts` outstanding calculation**
  - **File**: `client/src/lib/ai/context.ts` line 212
  - **Problem**: `totalRevenueFils - totalPaymentsFils` with no guard. If payments > invoices (e.g. advance payments), bigint subtraction produces a massive positive number.
  - **Fix**: `const totalOutstandingFils = totalRevenueFils > totalPaymentsFils ? totalRevenueFils - totalPaymentsFils : 0n;`
  - **Also fix line 217**: Replace `Number(totalPaymentsFils) / Number(totalRevenueFils)` with integer arithmetic: `Number((totalPaymentsFils * 10000n) / totalRevenueFils) / 100` (same pattern as `dashboardMetrics.ts`)
  - **Tests**: Update `context.test.ts` with a case where payments exceed invoices

- [x] **7.7 — Add over-delivery guard to `deliveryNoteSkill.ts`**
  - **File**: `client/src/lib/skills/deliveryNoteSkill.ts`
  - **Problem**: Skill validates `lineItemId` belongs to the order but does NOT check `quantityDelivered <= item.quantity`.
  - **Fix**: After finding the source line item, add: `if (quantityDelivered > source.quantity) throw new Error(\`items[${index}].quantityDelivered (${quantityDelivered}) exceeds ordered quantity (${source.quantity})\`)`
  - **Tests**: Update `deliveryNoteSkill.test.ts` with over-delivery rejection case

**HANDOFF after Milestone 7**: `pnpm test` in module + `npm test` in client + `npm run build` + `npm run check` must all pass.

---

## MILESTONE 8: Business Logic Corrections (P1)

**Goal**: Fix incorrect calculations and missing audit trails that affect real business operations.

- [x] **8.1 — Fix PO Terminal state absorption in `refreshPurchaseOrderStatusFromReceipts`**
  - **File**: `module/src/milestone1_logic.ts` line 207 (approx)
  - **Problem**: Guard only bails on `Cancelled`, not `Terminal`. A Terminal PO could be flipped back to `InProgress` if a new GRN is accepted.
  - **Fix**: Change `if (!po || po.status.tag === 'Cancelled') return;` to `if (!po || po.status.tag === 'Cancelled' || po.status.tag === 'Terminal') return;`
  - **Compare to**: `refreshOrderStatusFromDeliveries` line 170 which correctly guards both — match the pattern.
  - **Tests**: Create PO, advance to Terminal, add GRN — verify PO stays Terminal

- [x] **8.2 — Fix AR aging to use FIFO payment allocation instead of proportional split**
  - **File**: `client/src/lib/business/arAging.ts`
  - **Problem**: Current algorithm distributes outstanding proportionally across invoice buckets. This masks the severity of the oldest debt. Standard accounting ages by invoice, applying payments FIFO (oldest first).
  - **Fix**: Sort each party's invoices by date ascending. Apply payments FIFO — deduct from oldest invoice first until payment exhausted. Then age each invoice's remaining balance by its own due date into the correct bucket.
  - **Tests**: Update `arAging.test.ts`:
    - Party with 2 invoices (one 91 days old, one 5 days old) + 50% payment → payment fully covers oldest invoice, remainder in d15 bucket
    - Party with one old invoice, one payment covering 80% → remaining 20% in 90+ bucket

- [x] **8.3 — Fix overdue amount in `dashboardMetrics.ts` to subtract payments**
  - **File**: `client/src/lib/business/dashboardMetrics.ts` lines 129-136
  - **Problem**: Sums gross `totalFils` of overdue invoices without subtracting partial payments. Overstates overdue exposure.
  - **Fix**: For each overdue invoice, compute `invoiceFils - allocatedPaymentFils` (using FIFO or proportional allocation). Only include the net unpaid portion in the overdue total.
  - **Alternative simpler fix**: Compute party-level outstanding (same as `computeOutstanding`) and use the `arAging` rows to determine the overdue portion. This avoids duplicating FIFO logic.
  - **Tests**: Party with overdue invoice of 1000 fils + payment of 400 fils → overdue = 600, not 1000

- [x] **8.4 — Fix payment prediction zero-day terms coercion**
  - **File**: `client/src/lib/skills/paymentPredictionLogic.ts`
  - **Problem**: `const paymentTermsDays = Number(input.customer.paymentTermsDays || 0n) || 90` — if `paymentTermsDays` is `0n` (cash-on-delivery), `|| 0n` returns `0n`, `Number(0n)` is `0`, `|| 90` gives `90`. Cash customers treated as 90-day credit.
  - **Fix**:
    ```typescript
    const paymentTermsDays =
      input.customer.paymentTermsDays != null && input.customer.paymentTermsDays > 0n
        ? Number(input.customer.paymentTermsDays)
        : 30; // sensible default for unknown terms
    ```
  - **Tests**: Customer with `paymentTermsDays = 0n` → prediction uses 30 (not 90). Customer with `paymentTermsDays = 45n` → prediction uses 45.

- [x] **8.5 — Fix PO number generation to use stored sequence number**
  - **File**: `client/src/lib/documents/purchaseOrderGenerator.ts` lines 102-106
  - **Problem**: For existing POs, fabricates number from wall-clock year + row ID. A PO from 2024 printed today shows `PO-2026-015`.
  - **Fix**: The `purchaseOrder` table should have a `poNumber` field (like `deliveryNote.dnNumber`).
    1. Check if `poNumber` exists on the `purchaseOrder` schema. If not, add it to `module/src/index.ts` and the `manage_purchase_order` reducer (auto-generate via `issueDocNumber('PO', year)` on creation).
    2. Update `purchaseOrderGenerator.ts` to use `data.purchaseOrder.poNumber`.
    3. Regenerate STDB bindings after schema change.
  - **Tests**: Generate PO PDF for an existing PO — verify number matches stored `poNumber`, not wall-clock year

- [x] **8.6 — Add activity logging to 5 unlogged core reducers**
  - **File**: `module/src/index.ts`
  - **Problem**: `upsert_party`, `upsert_contact`, `advance_pipeline`, `manage_order`, `manage_purchase_order` do not log to `activityLog`. The architecture mandates "every mutation logs."
  - **Fix**: Add `ctx.db.activityLog.insert(...)` to each reducer, following the pattern used by `create_delivery_note` and `record_money_event`.
  - **Format**: `{ action: 'upsert_party', entityType: 'party', entityId: party.id, actorIdentity: caller.identity, details: 'Created party: XYZ' / 'Updated party: XYZ', createdAt: ctx.timestamp }`
  - **Tests**: Call each reducer, verify activityLog row is created with correct action string

- [x] **8.7 — Fix grade comparison in `paymentPredictionLogic.ts`**
  - **File**: `client/src/lib/skills/paymentPredictionLogic.ts` line 176
  - **Problem**: Uses ASCII string comparison `>` on grade letters. Works by coincidence (`'D' > 'C' > 'B' > 'A'`), but is fragile and unclear.
  - **Fix**: Use explicit rank map:
    ```typescript
    const GRADE_RANK: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
    const currentRank = GRADE_RANK[currentGradeTag] ?? 2;
    const suggestedRank = GRADE_RANK[suggested.suggestedGrade] ?? 2;
    if (suggestedRank > currentRank) {
      riskFactors.push('Predicted payment behaviour is weaker than the current assigned grade.');
    }
    ```
  - **Tests**: Verify A→B triggers warning, C→C does not, D→B does not

**HANDOFF after Milestone 8**: All builds + tests green. `spacetime build` must pass (schema change in 8.5).

---

## MILESTONE 9: Security & Hardening (P2)

**Goal**: Close security gaps and eliminate type-safety escape hatches.

- [x] **9.1 — Escape HTML in Resend invite email**
  - **File**: `client/src/lib/integrations/resend.ts` line 47
  - **Problem**: `notes` field interpolated into HTML without escaping. Admin-supplied `<script>` tags would be injected into email.
  - **Fix**: Add and use an `escapeHtml` helper:
    ```typescript
    function escapeHtml(s: string): string {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    ```
    Apply to `notes` and any other user-supplied string before HTML interpolation.
  - **Tests**: Update `resend.test.ts` — verify `<script>` in notes is escaped in output HTML

- [x] **9.2 — Move Resend API key from `localStorage` to Neutralino storage**
  - **File**: `client/src/lib/integrations/resend.ts`
  - **Problem**: API key stored in plaintext `localStorage`, exposed to any XSS in the webview.
  - **Fix**: Replace `localStorage.getItem/setItem` with `Neutralino.storage.getData/setData`. These use Neutralino's app-level storage which is not accessible from the webview JS console.
  - **Fallback**: If Neutralino storage is unavailable (e.g. running in browser dev mode), fall back to `localStorage` with a console warning.
  - **Tests**: Verify config round-trips through save/load

- [x] **9.3 — Filter Terminal orders/POs from creation dropdowns in OperationsHub**
  - **File**: `client/src/lib/pages/OperationsHub.svelte`
  - **Problem**: `availableOrderOptions` and `availableDnOrders` filter out only `Cancelled`. Terminal orders (fully delivered) still appear in "create delivery note" dropdown. Server rejects them, but UX is confusing.
  - **Fix**: Change filter to `.filter((o) => o.status.tag === 'Active' || o.status.tag === 'InProgress')` for all three: DN order selector, GRN PO selector, invoice order selector.
  - **Tests**: Visual — Terminal items should not appear in dropdowns

- [x] **9.4 — Fix supplier invoice VAT consistency (Option A confirmed)**
  - **File**: `module/src/milestone1_logic.ts` — `recordMoneyEventImpl` SupplierInvoice branch
  - **Problem**: PO PDF shows a VAT 10% line, but when `SupplierInvoice` is recorded in the backend, `vatFils` is hardcoded to `0n`. These disagree.
  - **Commander confirmed Option A**: PH Trading tracks input VAT on supplier costs for reclaim purposes. Their costing master file computes VAT on both client PO value AND PH cost side.
  - **Fix**: Add VAT computation to SupplierInvoice branch (mirror the CustomerInvoice pattern):
    ```typescript
    const vatFils = (subtotalFils * 10n) / 100n;
    const totalFils = subtotalFils + vatFils;
    ```
  - **Tests**: Verify SupplierInvoice `vatFils` = 10% of subtotal, verify `totalFils` = subtotal + VAT

- [x] **9.5 — Deduplicate `issueDocNumber` — single source of truth**
  - **Files**: `module/src/index.ts` and `module/src/milestone1_logic.ts`
  - **Problem**: Two implementations of `issueDocNumber`. The `index.ts` version lacks the year bounds check (`2020-2099`) that the `milestone1_logic.ts` version has.
  - **Fix**: Remove `issueDocNumber` from `index.ts`. Import and use the `milestone1_logic.ts` version in the `next_doc_number` reducer.
  - **Tests**: Existing doc number tests should still pass

- [x] **9.6 — Replace `as never` casts in `querySkillLogic.ts` with proper type alignment**
  - **File**: `client/src/lib/skills/querySkillLogic.ts`
  - **Problem**: `computeARAgingRows(parties as never, moneyEvents as never, ...)` — hides real type mismatches. If `Party` type drifts between `db.ts` and `stdb_generated/types`, TypeScript will never catch it.
  - **Fix**: Either:
    - Import types from the same source in both files, or
    - Create an explicit interface adapter: `function toAgingParties(parties: DbParty[]): AgingParty[]`
  - **Apply same fix to**: `performanceCheck.ts` (10+ `as never` casts)
  - **Tests**: Remove `as never`, verify `npm run check` still passes with 0 errors

- [x] **9.7 — Extract shared `asPositiveBigInt` to `skills/utils.ts`**
  - **Files**: `client/src/lib/skills/deliveryNoteSkill.ts` and `purchaseOrderSkill.ts`
  - **Problem**: `asPositiveBigInt` and `parseJsonArray` are duplicated verbatim in both files.
  - **Fix**: Create `client/src/lib/skills/utils.ts`, move both functions there, import in both skill files.
  - **Tests**: Existing skill tests should still pass

- [x] **9.8 — Rename `overdueInvoiceCount` to `overdueCustomerCount` in context.ts**
  - **File**: `client/src/lib/ai/context.ts`
  - **Problem**: Field counts *parties with overdue invoices*, not individual invoices. Name is misleading.
  - **Fix**: Rename to `overdueCustomerCount`. Update the system prompt template string to match.
  - **Tests**: Update `context.test.ts` if it references the field name

**HANDOFF after Milestone 9**: All builds + tests green. Full `npm run check` with 0 errors.

---

## Summary Table

| Milestone | Items | Focus | Severity |
|-----------|-------|-------|----------|
| **M7** | 7 items | State machines, invariants, underflow | P0 |
| **M8** | 7 items | Business logic, calculations, audit | P1 |
| **M9** | 8 items | Security, type safety, dedup | P2 |
| **Total** | **22 items** | | |

---

## Milestone Completion Protocol

After completing each milestone:

1. Record completion time in `SPRINT_LOG.md` (append after Milestone 6)
2. Run all verification commands — paste results:
   - `pnpm test` in `module/`
   - `spacetime build`
   - `npm test` in `client/`
   - `npm run build` in `client/`
   - `npm run check` in `client/`
3. List all new/modified tests and their pass/fail status
4. Wait for Commander review before proceeding to next milestone

---

## Reference: Existing State Machine Pattern

Copy this pattern for items 7.1, 7.2, 7.3:

```typescript
// From advanceDeliveryNoteImpl in milestone1_logic.ts
const ALLOWED_DN_TRANSITIONS: Record<string, string[]> = {
  Draft: ['Dispatched', 'Returned'],
  Dispatched: ['Delivered', 'Returned'],
  // Delivered, Returned = terminal (not listed = no transitions)
};

function advanceDeliveryNoteImpl(ctx: any, id: bigint, newStatus: string, ...args) {
  const note = ctx.db.deliveryNote.id.find(id);
  if (!note) throw new Error('Delivery note not found');

  const allowed = ALLOWED_DN_TRANSITIONS[note.status.tag];
  if (!allowed || !allowed.includes(newStatus)) {
    throw new Error(
      `Cannot transition delivery note from ${note.status.tag} to ${newStatus}`
    );
  }
  // ... proceed with update
}
```

---

## Reference: PH Trading Costing Formula (from actual Excel MasterFile)

This is the EXACT costing model PH Trading uses. Use this to validate `lineItem` costing fields and PDF generators.

### Costing Chain (per product, columns C-L in the Excel)

```
INPUT CURRENCY (EUR or USD)
├── FOB (foreign currency)         → manual input
├── Freight = FOB × 9%            → formula: =C12*0.09
├── Exchange Rate to BHD           → EUR=0.44, USD=0.39 (per-item, adjustable)
│
CONVERTED TO BHD
├── FOB (BHD) = FOB(FC) × rate
├── Freight (BHD) = Freight(FC) × rate
├── C&F = FOB(BHD) + Freight(BHD)
├── Insurance = manual (usually 0)
├── Customs = C&F × 6%            → formula: =C17*$A$19
├── Landed Cost = C&F + Insurance + Customs
│
OVERHEADS (applied to Landed Cost)
├── Handling = Landed Cost × 4%    → formula: =C20*$A$21
├── Finance Charges = Landed Cost × 1% → formula: =C20*$A$22
├── Other Costs = manual (usually 0)
├── Total Cost = Landed + Handling + Finance + Other
│
PRICING
├── Markup = Total Cost × 20%      → formula: =C24*$A$25 (rate in A25, adjustable)
├── Selling Price = Total Cost + Markup
├── VAT = 10%                      → formula: =M28*10%
└── Grand Total = Selling Price + VAT
```

### Profit Summary (rows 31-35)

```
Total PO value expected from Client = SUM(Selling Price × Qty)
PH TRADING COST                     = SUM(Total Cost × Qty)
Profit                              = Client PO - PH Cost
Profit %                            = (Client PO - PH Cost) / PH Cost

VAT computed on BOTH sides:
  Client VAT = Client PO × 10%
  Cost VAT   = PH Cost × 10%     ← THIS confirms input VAT tracking
```

### Quotation Format (rows 16-36)

```
| Sr. No. | Item Description, Order Code | Unit Cost | Qty | Amount (BHD) |
|---------|------------------------------|-----------|-----|--------------|
| 1       | [Product]\n[Model]\n[Spec]    | X.XXX     | N   | X.XXX        |
...
                                          SUBTOTAL    X.XXX
                                          DISCOUNT    X.XXX
                                          VAT 10%     =(SUBTOTAL+DISCOUNT)*0.1
                                          TOTAL (BHD) =SUBTOTAL-DISCOUNT+VAT
```

Note: DISCOUNT is subtracted (negative value), but VAT is applied AFTER discount.

### Terms & Conditions Sidebar (Quotation G-I columns)

- Payment Terms (from dropdown): 100% Advance | 100% Against Delivery | 30 days | 60 days | LC | Stage Payments | 50%+50%
- Delivery Terms: DAP Bahrain | Ex-Works (EXW) | FCA | DDP
- Estimated Delivery: 3-5 weeks | 4-6 weeks | 5-7 weeks | ... | 16-18 weeks | TBD
- Warranty: Against Manufacturing Defects (12 months) | No warranty for spares
- Installation: Excluded / not in scope
- Commissioning: Excluded / not in scope
- Testing: Excluded / not in scope
- Test Certificate / COO / COC: selectable per quote
- Country of Origin: DE, CH, FR, UK, US, SL, GR, IT

### Customer Types (Code sheet)

| Code | Type |
|------|------|
| CO | Consultant |
| EC | End Customer |
| EP | Engineering Company, EPC/Licensor |
| IR | International Reseller |
| MB | Machine Builder, Skid Manufacturer |
| NR | National Reseller |
| OM | OEM |
| PH | PH Trading (internal) |
| PB | Plant Builder |
| SP | Service Provider, Service Company |
| SI | System Integrator |

### Principal/Supplier Codes

| Code | Principal |
|------|-----------|
| EH | Endress+Hauser (primary — authorized agency) |
| SM | Servomex (authorized agency) |
| GI | GIC & Gauges Bourdon (authorized agency) |
| LG | Landis+Gyr (authorized agency) |
| IS | Iskraemeco (authorized agency) |

### Staff (for `issuedBy` fields)

| Name | Role | Email |
|------|------|-------|
| Stanley Vaz | COO | stanley.vaz@platinumholdings.com.bh |
| Abhie Kore | Business Head | abhi.kore@platinumholdings.com.bh |
| V.M. Sundar | Manager | vm.sundar@platinumholdings.com.bh |
| Ebin Chacko | Technical Sales Engineer | ebin.chacko@platinumholdings.com.bh |
| Periyasamy N | Technical Sales Engineer | — |
| Ramya Baskaran | Sales Support | support@platinumholdings.com.bh |

---

*This map is the source of truth for the hardening sprint. Update it as you go.*
