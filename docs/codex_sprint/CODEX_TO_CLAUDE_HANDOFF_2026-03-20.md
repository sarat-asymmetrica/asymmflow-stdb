# Codex to Claude Handoff

**Date:** 2026-03-20
**Repo slice:** `experiments/003-asymmflow-reimagined`
**Branch state at handoff:** `main` ahead of `origin/main` by 5 commits

## What I completed in this pass

### 1. Client `npm run check` debt cleanup
- Commit: `58bdb8f`
- Summary:
  - Cleared all client `svelte-check` errors and warnings.
  - Fixed accessibility/type issues in `Card.svelte`, `Modal.svelte`, `Select.svelte`, `MotionShowcase.svelte`, `CRMHub.svelte`, and `seed.ts`.
- Verification:
  - `client/npm run check` -> 0 errors / 0 warnings
  - `client/npm test` passed

### 2. AR aging Excel export parity slice
- Commit: `3507f42`
- Summary:
  - Added real `.xlsx` export for AR aging.
  - Wired `export_to_excel` in the skill executor for AR aging.
  - Added `Export Aging` action in `FinanceHub`.
- Main files:
  - `client/src/lib/documents/excelExport.ts`
  - `client/src/lib/documents/excelExport.test.ts`
  - `client/src/lib/skills/executor.ts`
  - `client/src/lib/pages/FinanceHub.svelte`

### 3. Tally importer parity slice
- Commit: `5665539`
- Summary:
  - Added a new `Tally Import` tab in `FinanceHub`.
  - Implemented preview-first import for:
    - customer invoices
    - supplier invoices
    - supplier payments
  - Added flexible column matching, BHD-only validation, duplicate detection, auto-party creation, and posting into `MoneyEvent`.
- Main files:
  - `client/src/lib/business/tallyImport.ts`
  - `client/src/lib/business/tallyImport.test.ts`
  - `client/src/lib/pages/FinanceHub.svelte`
  - `client/package.json`
- Verification:
  - `client/npm test` passed
  - `client/npm run check` passed
  - `client/npm run build` passed

## Current verification baseline

Latest confirmed-good commands:
- `client/npm test`
- `client/npm run check`
- `client/npm run build`
- Earlier in sprint: `module/npm test` passed

Known non-blocking build note:
- Vite still emits the existing chunk-size warning during client build.

## What is already done from the original parity asks

These parity items are already landed in code now:
- amount-in-words on PDFs
- cash runway / follow-up dashboard intelligence
- product markup rules in AI context
- PO approval threshold
- bank reconciliation UI and CSV import
- AR aging export
- Tally importer, first practical tranche

## Remaining parity gaps to close comprehensively

### Highest-value remaining gap
1. **E+H XML basket parser**
   - This is still the biggest true P1 gap.
   - Matrix/handoff callout says this is a PH Trading killer workflow.
   - Recommended V5 shape:
     - parser utility in client business layer
     - skill wiring for explicit import / costing proposal
     - map XML lines into pricing/costing-ready structures
     - optionally prefill quotation / pipeline costing flow

### Tally importer follow-on work still open
The new importer is useful, but it is not yet the full legacy breadth. Remaining work:

1. **Chat/skill integration**
   - There is still no `import_tally` skill in `client/src/lib/skills/registry.ts` and no executor route for AI-triggered import.
   - Current entry point is UI-only via `FinanceHub`.

2. **Additional Tally data types**
   - Not implemented:
     - customer payments
     - AR defaulters import
     - batch/year orchestration like legacy `ImportAllTallyData`
   - Legacy reference: `legacy_asymmflow_ph_holdings_reference_only/tally_importer.go`

3. **Importer audit persistence**
   - Current importer posts directly to `Party`/`MoneyEvent` and returns in-memory summary.
   - No persisted batch log / import table / import report artifact yet.

4. **Stronger duplicate/idempotency guarantees**
   - Current duplicate detection is pragmatic:
     - `(kind, party, normalized reference, totalFils)`
   - It is good enough for this tranche, but not a perfect batch-idempotency design.
   - If hardened, add explicit import fingerprinting or import-batch metadata.

5. **Date fidelity**
   - Imported events use reducer `ctx.timestamp` as `createdAt` because current reducers do not accept source transaction date.
   - We set due dates for invoice rows from party payment terms, but not original event timestamps.
   - If historical exactness matters, module changes are needed.

6. **Grade C/D invoice caveat**
   - Customer invoice import can fail for grade `C`/`D` parties because reducer logic requires advance coverage.
   - This is correct according to current invariants, but it means some historical Tally imports may reject.
   - Claude should decide whether to:
     - keep that strictness
     - add a migration/import bypass path
     - or import those rows as review-only proposals

7. **Non-BHD rows**
   - Current importer rejects non-BHD rows.
   - That matches current V5 money assumptions, but legacy/handoff does mention some USD/EUR supplier scenarios.

### Other parity items still open or partial
1. **Cash position / bank balance view**
   - Runway is done, but a cleaner bank-balance/current-cash-position surface is still worth auditing.

2. **Supplier dashboard depth**
   - Matrix still calls supplier dashboard parity partial compared with customer side.

3. **Bank statement import as skill**
   - FinanceHub supports CSV bank import directly.
   - If full parity requires AI-triggered import skill, that still needs wiring.

4. **Manual PDF review**
   - Milestone 6 automated checks passed, but commander-side manual PDF review remains open.

5. **Long-tail contractual items from the matrix**
   - VAT return
   - cheque register
   - supplier bank details (structured)
   - supplier issues log
   - FX revaluation
   - contract generation
   - inventory / stock
   - Microsoft Graph integration last

## Suggested next move for Claude

### Recommended order
1. E+H XML basket parser
2. Tally importer hardening / chat skill integration
3. Supplier dashboard parity pass
4. Cash position / bank balance widget
5. Resume deeper P2/P3 finance/ops/security gaps

### If Claude takes E+H next
Recommended output shape:
- `client/src/lib/business/ehBasketParser.ts`
- test file beside it
- optional UI hook in Sales/Finance/Chat flow
- optional skill names:
  - `parse_eh_basket`
  - `import_eh_costing`

## Important implementation notes

### Tally importer assumptions
- Uses `xlsx` in browser/client.
- Flexible header matching works off normalized headers.
- Current supported import modes:
  - `customer_invoices`
  - `supplier_invoices`
  - `supplier_payments`
- New unmatched parties are auto-created with:
  - grade `B`
  - 30-day terms
  - notes marking Tally import origin

### Why importer is client-side
- Current architecture and available seams made this the fastest parity-safe route.
- It reuses existing reducers instead of inventing a sidecar import path.
- This keeps STDB invariants in force.

## Files most relevant for continuation

- `client/src/lib/business/tallyImport.ts`
- `client/src/lib/business/tallyImport.test.ts`
- `client/src/lib/pages/FinanceHub.svelte`
- `client/src/lib/skills/executor.ts`
- `client/src/lib/skills/registry.ts`
- `client/src/lib/ai/context.ts`
- `legacy_asymmflow_ph_holdings_reference_only/tally_importer.go`
- `docs/V4_V5_PARITY_MATRIX.md`
- `docs/CODEX_HANDOFF.md`

## Working tree note

At handoff, these user/docs items remain untracked and were intentionally left alone:
- `decisions/`
- `docs/CODEX_HANDOFF.md`
- `docs/V4_V5_PARITY_MATRIX.md`
- `features/`

Do not clean those up unless Commander asks.
