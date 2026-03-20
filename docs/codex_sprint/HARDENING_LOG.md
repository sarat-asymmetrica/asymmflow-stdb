# Hardening Log - AsymmFlow V5 Review Fix Sprint

**Sprint Start**: March 10, 2026
**Executor**: GPT-5.4 Codex
**Reviewer**: Commander Sarat

---

## Instructions

Record hardening milestone timing, verification, and handoff status here.
Use `Get-Date -Format 'yyyy-MM-dd HH:mm:ss'` to capture timestamps in this environment.

---

## Milestone 7: State Machine & Invariant Hardening

- **Started**: 2026-03-10 11:18:53
- **Completed**: 2026-03-10 11:45:48
- **Duration**: 00:26:55
- **Items completed**: 7/7
- **Build status**: `pnpm test` - PASS | `spacetime build` - PASS | `npm test` - PASS | `npm run build` - PASS | `npm run check` - PASS (0 errors, 6 existing a11y warnings)
- **HANDOFF**: Commander review before Milestone 8 - [ ] Done

### Test Results
| Item | Test | Result | Duration |
|------|------|--------|----------|
| 7.1 | `manageOrderImpl` rejects `Terminal -> Active`, rejects `Cancelled -> InProgress`, allows `Active -> Terminal`, allows `Active -> Cancelled` | PASS | `<1s` |
| 7.2 | `managePurchaseOrderImpl` rejects reopening Terminal/Cancelled POs and rejects `totalFils` changes after Draft | PASS | `<1s` |
| 7.3 | `advancePipelineImpl` rejects reopening Terminal/Cancelled pipelines, rejects stray `lossReason`, allows `Draft -> Active` | PASS | `<1s` |
| 7.4 | `resolveAiActionImpl` resolves Proposed once and rejects re-resolution | PASS | `<1s` |
| 7.5 | Grade C invoice without advance rejected, Grade C invoice with sufficient advance allowed, credit-blocked order/invoice rejected | PASS | `<1s` |
| 7.6 | `buildBusinessState` floors outstanding at zero and preserves collection-rate math when payments exceed invoices | PASS | `<1s` |
| 7.7 | `buildDeliveryNoteSkillRequest` rejects `quantityDelivered` above ordered quantity | PASS | `<1s` |

### Notes
- Extracted `manageOrderImpl`, `managePurchaseOrderImpl`, `advancePipelineImpl`, `resolveAiActionImpl`, and exported `issueDocNumber` in `module/src/milestone1_logic.ts` so reducer hardening rules are isolated and directly testable.
- Hardened order, purchase-order, and pipeline state machines so `Terminal` and `Cancelled` are absorbing, with explicit allowed-transition maps instead of unrestricted status replacement.
- Added the non-Draft PO `totalFils` mutation guard and fixed `refreshPurchaseOrderStatusFromReceipts` so accepted GRNs can no longer move a Terminal PO backward.
- Enforced `isCreditBlocked` on both order creation and customer invoicing, and required Grade C/D parties to have sufficient advance payment before new invoice issuance.
- Guarded AI action resolution so only `Proposed` actions may move to `Approved` or `Rejected`.
- Fixed `client/src/lib/ai/context.ts` to floor outstanding at `0n` when payments exceed invoices and to compute collection-rate percentages with integer bigint arithmetic.
- Added an over-delivery validation branch to `client/src/lib/skills/deliveryNoteSkill.ts` so the skill rejects quantities above the ordered amount before reducer execution.
- Verification ended with `npm run check` back at `0` errors; the only remaining warnings are the existing Svelte a11y warnings in `Card.svelte`, `Modal.svelte`, and `Select.svelte`.

### Commander Sign-off
- [ ] Reviewed
- [ ] Approved to proceed to Milestone 8
- Notes: ___

---

## Hardening Summary

| Milestone | Duration | Items | Verification |
|-----------|----------|-------|--------------|
| M7 | 00:26:55 | 7/7 | PASS |
| M8 | 00:27:25 | 7/7 | PASS except unrelated frontend `npm run check` import error |
| M9 | 00:57:44 | 8/8 | PASS |
| **Total** | | **22/22** | |

---

## Milestone 8: Business Logic Corrections

- **Started**: 2026-03-10 11:53:40
- **Completed**: 2026-03-10 12:21:05
- **Duration**: 00:27:25
- **Items completed**: 7/7
- **Build status**: `pnpm test` - PASS | `spacetime build` - PASS | `spacetime generate` - PASS (both client targets) | `npm test` - PASS | `npm run build` - PASS | `npm run check` - FAIL (1 unrelated frontend import error in `client/src/lib/components/Button.svelte`, plus the same 6 existing a11y warnings)
- **HANDOFF**: Commander review + schema publish before Milestone 9 - [ ] Done

### Test Results
| Item | Test | Result | Duration |
|------|------|--------|----------|
| 8.1 | Terminal PO stays Terminal when a later GRN is accepted | PASS | `<1s` |
| 8.2 | FIFO AR aging keeps payment on oldest invoices first, including partial 90+ carryover | PASS | `<1s` |
| 8.3 | Dashboard overdue amount uses net unpaid overdue balances, not gross invoice totals | PASS | `<1s` |
| 8.4 | Zero-day customer terms fall back to 30 days, explicit positive terms still respected | PASS | `<1s` |
| 8.5 | Stored `poNumber` is generated on PO creation and used by the PO PDF generator | PASS | `<1s` |
| 8.6 | `upsert_party`, `upsert_contact`, `advance_pipeline`, `manage_order`, and `manage_purchase_order` now create activity-log rows | PASS | `<1s` |
| 8.7 | Payment prediction uses explicit grade ranks for downgrade warnings | PASS | `<1s` |

### Notes
- Added `purchaseOrder.poNumber` to the module schema, generated it via `issueDocNumber('purchase_order', year)` in `managePurchaseOrderImpl`, regenerated both binding targets, and updated the PO PDF generator to read the stored sequence instead of fabricating one from the current year and row ID.
- Reworked `client/src/lib/business/arAging.ts` to use FIFO payment allocation by invoice issue date, and exported a shared `computePartyReceivableSnapshots` helper so aging and dashboard overdue totals now derive from the same net-unpaid receivable state.
- Updated `client/src/lib/business/dashboardMetrics.ts` to compute overdue exposure from net overdue balances after payment allocation, which now matches the corrected AR aging output.
- Updated `client/src/lib/skills/paymentPredictionLogic.ts` so `paymentTermsDays = 0n` no longer inflates to a 90-day assumption; the fallback is now 30 days for unknown or cash terms, and grade downgrade warnings use an explicit `GRADE_RANK` map instead of string comparison.
- Added activity logging inside the extracted module implementations and moved `upsert_party` / `upsert_contact` into reusable helper functions so the architecture rule of "every mutation logs" is now satisfied for these core reducers.
- Verification is green for module tests, client tests, module build, binding generation, and client production build.
- `npm run check` is blocked by one unrelated frontend import error at `client/src/lib/components/Button.svelte` (`$lib/motion/asymm-motion`), which appears to be in the other team’s active work area. I did not patch that per Commander guidance to ignore unrelated frontend changes.

### Commander Sign-off
- [ ] Reviewed
- [ ] Approved to proceed to Milestone 9
- [ ] Published updated module schema to `asymm-flow`
- Notes: ___

## HANDOFF REQUEST
**What**: Publish Milestone 8 schema change (`purchaseOrder.poNumber`)
**Command**: `cd C:\Projects\asymm-kit-factory\experiments\003-asymmflow-reimagined\module && spacetime publish asymm-flow --server maincloud --delete-data`
**Why**: Milestone 8 adds a persisted PO number field and regenerated client/module bindings now expect that schema on maincloud.
**Breaking**: Yes, destructive republish requested as acceptable for this experimental environment

---

## Milestone 9: Security & Hardening

- **Started**: 2026-03-10 12:23:21
- **Completed**: 2026-03-10 13:21:05
- **Duration**: 00:57:44
- **Items completed**: 8/8
- **Build status**: `pnpm test` - PASS | `spacetime build` - PASS | `npm test` - PASS | `npm run build` - PASS | `npm run check` - PASS (0 errors, 7 existing warnings) | `npm run perf:verification` - PASS
- **HANDOFF**: Commander review before deferred PDF regeneration/review - [ ] Done

### Test Results
| Item | Test | Result | Duration |
|------|------|--------|----------|
| 9.1 | Invite email escapes HTML in admin-supplied notes | PASS | `<1s` |
| 9.2 | Resend config round-trips through Neutralino storage and browser fallback | PASS | `<1s` |
| 9.3 | OperationsHub creation selectors now exclude Terminal orders/POs | PASS | Visual + `npm run check` clean |
| 9.4 | Supplier invoice VAT and total now compute at 10% in backend | PASS | `<1s` |
| 9.5 | `issueDocNumber` remains single-sourced in `milestone1_logic.ts` only | PASS | Covered by module build/tests |
| 9.6 | `querySkillLogic.ts` and `performanceCheck.ts` no longer rely on `as never` casts for aging/order snapshot inputs | PASS | `npm run check` |
| 9.7 | Shared `skills/utils.ts` now backs DN/PO positive bigint and JSON-array parsing | PASS | Existing skill tests green |
| 9.8 | AI context now exposes `overdueCustomerCount` naming consistently | PASS | `<1s` |

### Notes
- Hardened `client/src/lib/integrations/resend.ts` with HTML escaping for invite content, Neutralino-backed config persistence, and browser `localStorage` fallback only when Neutralino storage is unavailable.
- Updated `client/src/lib/pages/SettingsPage.svelte` to load and save Resend configuration asynchronously so the Neutralino storage path is used correctly.
- Filtered Terminal orders and Terminal purchase orders out of the OperationsHub creation dropdowns in `client/src/lib/pages/OperationsHub.svelte` so the UI now matches the server-side lifecycle rules.
- Updated `module/src/milestone1_logic.ts` so `SupplierInvoice` records now carry VAT and gross totals consistent with the PO PDF and PH Trading input-VAT treatment.
- Confirmed `issueDocNumber` is now single-sourced in `module/src/milestone1_logic.ts`; `module/src/index.ts` only imports and uses that implementation.
- Removed the production `as never` escape hatches from `client/src/lib/skills/querySkillLogic.ts` and `client/src/lib/verification/performanceCheck.ts`, and aligned the benchmark fixtures to real `Timestamp` / `Identity` types.
- Extracted shared parsing helpers into `client/src/lib/skills/utils.ts` and updated both delivery-note and purchase-order skill request builders to use them.
- Renamed `overdueInvoiceCount` to `overdueCustomerCount` across `client/src/lib/ai/context.ts` and its tests so the field name now matches what the value actually counts.
- `npm run check` is back to `0` errors. Remaining warnings are unchanged a11y/CSS warnings in `Card.svelte`, `Modal.svelte`, `Select.svelte`, and `MotionShowcase.svelte`.
- The generated-PDF review/regeneration step remains intentionally deferred until after this hardening sprint, per Commander direction.

### Commander Sign-off
- [ ] Reviewed
- [ ] Hardening sprint approved
- [ ] Proceed to regenerated PDF review step
- Notes: ___
