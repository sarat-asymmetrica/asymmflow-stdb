# Document Generation Parity Audit — V4 vs V5

**Date:** 2026-03-17
**Scope:** AsymmFlow V4 (Go backend, `Asymmetrica.Runtime`) vs V5 (pdfmake, client-side)
**Author:** Zen Gardener session audit

---

## Architecture Delta

| Dimension | V4 | V5 |
|-----------|----|----|
| **Execution location** | Server-side Go runtime (`Asymmetrica.Runtime`) | Client-side TypeScript (pdfmake) |
| **PDF engine** | .NET pdfsharp / iTextSharp via C# kernels | pdfmake 0.2.x (browser) |
| **Font embedding** | Server-controlled, full font set | vfs_fonts bundle (pdfmake default) |
| **Letterhead** | Server reads file from disk | Base64 PNG embedded in `letterhead.ts` (~427 KB) |
| **Trigger** | HTTP reducer call → Go kernel → PDF bytes returned | `invoiceGenerator.ts` called directly in Svelte component |
| **Audit trail** | Every doc generation logged to `Asymmetrica.Runtime.Host` | No server-side audit — generation is ephemeral |
| **Offline capability** | No (requires runtime host) | Yes (pdfmake runs fully in browser) |

---

## Template Coverage

| Template | V4 | V5 file | V5 status |
|----------|----|---------|-----------|
| Tax Invoice | `InvoiceKernel.cs` | `invoiceGenerator.ts` | Complete — correct import path |
| Quotation | `QuotationKernel.cs` | `quotationGenerator.ts` | Import path bug (see below) |
| Statement of Account | `StatementKernel.cs` | `statementGenerator.ts` | Import path bug (see below) |
| Payment Chase | Hardcoded templates in Go | `chaseGenerator.ts` | Import path bug; no PDF output (text only) |
| Purchase Order | `PurchaseOrderKernel.cs` | `purchaseOrderGenerator.ts` | Correct import path |
| Delivery Note | `DeliveryNoteKernel.cs` | `deliveryNoteGenerator.ts` | Correct import path |
| GRN (Goods Received) | `GrnKernel.cs` | Not implemented | Gap — no generator exists in V5 |
| Proforma Invoice | Present in V4 | Not implemented | Gap |

---

## Bug Inventory

### BUG-001 — Stale import paths in 4 generators (CRITICAL — breaks build)

Four generators import types from a path that does not exist in V5:

```
../../module_bindings/types   <-- WRONG (V4 path, module does not exist)
../stdb_generated/types       <-- CORRECT (V5 path)
```

**Affected files:**

| File | Line | Status |
|------|------|--------|
| `quotationGenerator.ts` | 4 | Wrong path |
| `statementGenerator.ts` | 4 | Wrong path |
| `chaseGenerator.ts` | 4 | Wrong path |
| `registry.ts` | 10 | Wrong path |

**Files with correct path (reference):**

| File | Line |
|------|------|
| `invoiceGenerator.ts` | 4 |
| `purchaseOrderGenerator.ts` | 4 |
| `deliveryNoteGenerator.ts` | 4 |

**Fix:** In each affected file, change `../../module_bindings/types` to `../stdb_generated/types`.

---

### BUG-002 — VAT calculation inconsistency in purchaseOrderGenerator.ts

`purchaseOrderGenerator.ts` computes VAT as:

```typescript
const vatFils = (subtotal * 100n) / 1000n;   // result: subtotal / 10
```

All other generators (invoiceGenerator, statementGenerator) compute VAT as:

```typescript
const vatFils = subtotal * 10n / 100n;        // result: subtotal / 10
```

Both expressions yield the same mathematical result (10% of subtotal). However the `purchaseOrderGenerator` form uses a `/ 1000n` divisor which is semantically confusing — it implies 10/1000 = 1% rather than 100/1000 = 10%. This is a latent correctness risk if the VAT rate ever needs to be parameterised.

**Recommendation:** Normalise to `subtotal * 10n / 100n` (or extract a `VAT_RATE_BPS = 1000n` constant).

---

### BUG-003 — GRN document not implemented in V5

V4 had a `GrnKernel` for generating Goods Received Note PDFs used in supplier reconciliation. V5 has a `GoodsReceivedNote` table and `GrnItem` table fully defined in `types.ts` but no corresponding generator.

**Impact:** Operations staff cannot print/export GRNs from V5. Must be addressed before production handover.

---

### BUG-004 — chaseGenerator produces text, not PDF

`chaseGenerator.ts` generates WhatsApp/email/formal letter text strings only. V4 produced a formatted PDF letter for formal payment chases.

**Impact:** Formal chase letters cannot be generated as PDFs in V5. Acceptable for MVP (WhatsApp channel preferred by PH Trading), but gap exists for formal/legal chase trail.

---

## Letterhead Accuracy

### V4 Letterhead
- Rendered server-side using `PH_LETTERHEAD` constant in `Asymmetrica.Context.*` kernels
- Contains full PH Trading W.L.L. bilingual header (English + Arabic)
- Company registration: `CR 68034-1`, TRN: `200010357800002`
- Physical address and contact details on letterhead image

### V5 Letterhead
- Stored as Base64 PNG in `letterhead.ts` (~427 KB file)
- Same visual output — image is placed at top of every pdfmake document
- **Parity: MATCHES** — same letterhead image, same placement

### Verified constants in invoiceGenerator.ts

```typescript
const SELLER = {
  name:    'PH Trading W.L.L.',
  arabic:  'شركة PH للتجارة',
  address: 'Building 1403, Road 3635, Block 436\nSalmabad, Kingdom of Bahrain',
  cr:      '68034-1',
  trn:     '200010357800002',
  phone:   '+973 1700 0000',
  email:   'info@phtrading.bh',
  warehouse: 'Warehouse 5, Salmabad Industrial Area',
};
```

**Note:** The TRN in `invoiceGenerator.ts` (`200010357800002`) matches the real V4 value. The `SettingsPage.svelte` `companyInfo` block uses placeholder values (`CR-BH-2019-7841`, `VAT-BH-100456789-001`) — these should be updated before production.

---

## VAT Calculation Parity

| Scenario | V4 behaviour | V5 behaviour |
|----------|-------------|--------------|
| VAT rate | 10% (hardcoded in kernel) | 10% (hardcoded per generator) |
| Rounding | Round half-up on fils | BigInt truncation (floor) — no rounding |
| VAT base | Subtotal before discount | Subtotal before discount |
| VAT line label | "VAT (10%)" | "VAT (10%)" |
| Total = subtotal + VAT | Yes | Yes |

**Gap:** V5 uses BigInt integer division (truncation), V4 used decimal arithmetic with half-up rounding. On large invoices (e.g. 10,000 BHD) the rounding difference is at most 1 fils (0.001 BHD) — negligible. However this should be documented for audit purposes.

---

## BHD Currency Formatting

V5 `formatBHD` function (in `format.ts`):
- Divides fils by 1000 to convert to BHD
- Formats to 3 decimal places
- Prefixes with "BHD "

This matches V4 behaviour. No gap identified.

**Numeric amounts in words** (`filsToWords`) — present in `invoiceGenerator.ts`, mirrors V4's "Amount in Words" field. Not present in `quotationGenerator.ts` or `purchaseOrderGenerator.ts`. V4 included amount-in-words on all financial documents. This is a minor presentation gap.

---

## Bilingual (Arabic) Support

| Feature | V4 | V5 |
|---------|----|----|
| Letterhead Arabic text | On letterhead image | On letterhead image (same) |
| Party/customer name in Arabic | Rendered if `arabicName` field present | Not supported — Party type has no `arabicName` field |
| RTL column layout | Supported via iText RTL | Not supported — pdfmake RTL requires explicit `direction: 'rtl'` config |
| Arabic numerals | Used where configured | Not used — Western numerals only |

**Gap:** The `Party` table in `types.ts` has no `arabicName` field. V4 stored Arabic business names for Bahraini counterparties. V5 will need either a schema addition or a freeform `notes` field convention to carry Arabic names.

pdfmake does support RTL layouts but requires explicit `direction: 'rtl'` on the document definition and an Arabic font loaded in the VFS bundle. V5 currently loads only `pdfmake/build/vfs_fonts` (Roboto). A full Arabic font (e.g. Cairo or Noto Naskh Arabic) would need to be bundled.

**Recommendation:** Arabic support is not required for Phase 1 (Abhie demo). Mark as Sprint 4 enhancement.

---

## Tally Integration References

V4 (`Asymmetrica.Runtime`) included a `TallyBridge` kernel that:
1. Exported invoices in Tally XML format (for import into TallyPrime)
2. Imported ledger entries from Tally on demand
3. Mapped `MoneyEvent.kind` → Tally voucher types (Sales, Purchase, Receipt, Payment)

V5 has no Tally integration. The `MoneyEvent` schema is compatible with the V4 mapping but no export functions exist.

**Impact:** PH Trading currently uses TallyPrime for their chartered accountant. Until V5 has Tally export, the accountant will need manual re-entry or dual-system operation.

**Recommendation:** Implement `tallyExporter.ts` in Sprint 3/4 using the same `MoneyEvent` → Tally XML mapping from V4. The schema is already correct.

---

## Summary Scorecard

| Area | Parity | Notes |
|------|--------|-------|
| Letterhead accuracy | PASS | Same base64 PNG, same placement |
| VAT calculation | PASS (with caveat) | Same 10%, BigInt truncation vs decimal rounding — max 1 fils diff |
| BHD formatting | PASS | 3dp, "BHD" prefix, fils storage |
| Invoice template | PASS | Complete, correct imports |
| Quotation template | FAIL (import bug) | Fix: `../stdb_generated/types` |
| Statement template | FAIL (import bug) | Fix: `../stdb_generated/types` |
| Chase generator | PARTIAL | Text only, no PDF, import bug |
| PO template | PASS | Complete, correct imports |
| Delivery Note template | PASS | Complete, correct imports |
| GRN template | FAIL (missing) | No generator in V5 |
| Bilingual / Arabic | FAIL | Schema gap + no Arabic font loaded |
| Tally export | FAIL (missing) | No equivalent in V5 |
| Amount in words | PARTIAL | Invoice only; missing from Quotation, PO |
| Registry import paths | FAIL | `registry.ts` uses wrong path |

---

## Recommended Fix Priority

1. **Immediate (unblocks builds):** Fix 4 stale import paths — `quotationGenerator.ts`, `statementGenerator.ts`, `chaseGenerator.ts`, `registry.ts` — one-line change each.
2. **Sprint 3:** Implement `grnGenerator.ts`. Normalise VAT calculation constants.
3. **Sprint 3:** Add `amount-in-words` to Quotation and PO generators.
4. **Sprint 3:** Update `SettingsPage` `companyInfo` placeholder CR/VAT numbers to real values.
5. **Sprint 4:** Implement `tallyExporter.ts` for accountant handover.
6. **Sprint 4:** Evaluate Arabic support — schema field, font bundle, RTL layout.
