# ADR004 — MoneyEvent Pattern (Outstanding Never Stored)

**Status:** Decided
**Date:** 2026-03-08
**Deciders:** Commander (Sarat) + Claude (Ramanujan+Hamilton audit)

---

## Context

The legacy AsymmFlow had a catastrophic reconciliation incident called "Phase 18": 313 customer invoices had their stored `outstanding_balance` field drift out of sync with reality. The balance was stored as a materialized column, updated on each payment. A bug in `UpdatePayment` (which lacked a transaction) meant that concurrent payment updates could leave the balance in an inconsistent state.

The result: customers were shown incorrect balances, some were asked to pay amounts already paid, some had balances waived that weren't. Recovery required a manual audit of all 313 invoices. This took days.

The legacy system also had separate entities for: `CustomerInvoice`, `CustomerPayment`, `SupplierInvoice`, `SupplierPayment`, `BankRecon` — 5 separate tables with ~70% structural overlap. The Ramanujan+Hamilton audit proved all five are algebraically the same structure: an amount, a direction (in/out), linked to a party, with a lifecycle status.

---

## Decision

**One `MoneyEvent` table covers all financial events. Outstanding balance is NEVER stored — always computed as `sum(invoices) - sum(payments)` from MoneyEvents.**

---

## Rationale

### Arguments FOR MoneyEvent Pattern

1. **Phase 18 cannot happen.**
   If outstanding is never stored, it cannot drift. Every query for outstanding recomputes
   from the ground truth events. The recomputation is deterministic and atomic.
   `outstanding = sum(me.totalFils where kind='customer_invoice') - sum(me.totalFils where kind='customer_payment')`
   This is mathematically impossible to be wrong if the individual events are correct.

2. **Bank reconciliation is trivially easy.**
   Bank recon = "match MoneyEvents to bank statement rows by amount + date range."
   Because every payment IS a MoneyEvent (not a join across Invoice + Payment + ReconciliationFlag),
   the recon query is simple and auditable.

3. **Temporal analysis is free.**
   "What was EWA's outstanding on January 1?" = filter MoneyEvents where `createdAt < Jan 1`.
   Because we append events, never mutate balances, any point-in-time snapshot is a free query.
   The legacy system could not answer this question without a separate audit log.

4. **Five tables become one.**
   CustomerInvoice + CustomerPayment + SupplierInvoice + SupplierPayment + BankRecon
   → MoneyEvent with a `kind` discriminator.
   The `kind` values: `customer_invoice`, `customer_payment`, `supplier_invoice`, `supplier_payment`.
   This eliminates four tables and all their separate CRUD paths, service files, and UI screens.

5. **Event sourcing is the correct model for accounting.**
   Double-entry bookkeeping has been append-only since 1494 (Luca Pacioli). We are not
   innovating — we are returning to the original correct model. Ledgers are event logs.
   Balances are computed from those logs. This is not debatable.

### Arguments AGAINST (risks we accept)

1. **Computed outstanding is a query, not a lookup.**
   In the legacy system, `outstanding` is a column — O(1) to read.
   In the MoneyEvent system, `outstanding` is a sum over all MoneyEvents for that party — O(n).
   For a company with 10,000 invoices and 10,000 payments, this is 20,000 rows.
   - Mitigation: STDB Views can pre-aggregate. The `party_outstanding` View runs the sum
     server-side and is subscribable. Clients subscribe to the View, not the raw table.
     The View updates automatically when MoneyEvents are written. O(1) to subscribe.

2. **MoneyEvent `kind` discriminator requires discipline.**
   Developers must remember to filter by `kind`. A query for "invoices" without a `kind` filter
   returns payments too.
   - Mitigation: STDB Views for `customer_invoice_view`, `customer_payment_view`, etc.
     Application code uses the view, never the raw table. Reducer names are explicit:
     `record_customer_invoice`, `record_customer_payment`.

3. **Deletion is semantically different.**
   In the legacy system, you "delete" a payment. In MoneyEvent, you append a reversal event
   (`kind: 'reversal'`, `amount: -originalAmount`). This is more correct (audit trail) but
   requires developers to think differently about "delete."
   - Mitigation: The `reverse_money_event` reducer creates a reversal entry and marks
     the original as reversed. UI shows "reversed" state. No rows are ever deleted.

---

## Consequences

- **F001 (STDB Schema):** MoneyEvent table with 4 `kind` values. No `outstanding` column anywhere.
- **F008 (Finance Hub):** All financial views compute outstanding from MoneyEvent sum.
- **F009 (Create Invoice):** `record_money_event` reducer with `kind: 'customer_invoice'`.
- **F009 (Record Payment):** `record_money_event` reducer with `kind: 'customer_payment'`.
- **F034 (Statement of Account):** Aging buckets computed from MoneyEvent timestamps.
- **INV-01 (Financial Invariants):** "Outstanding is NEVER stored" is a cross-cutting invariant enforced in all reducers.
- **Phase 18:** Cannot happen. Ever.

---

## The Proof

```typescript
// WRONG (legacy — can drift):
invoice.outstandingFils = invoice.totalFils - sumPayments;
await db.save(invoice);  // If process dies here after payments but before save...

// CORRECT (MoneyEvent — cannot drift):
function outstandingForParty(partyId: bigint, ctx: ReducerContext): bigint {
  let invoiced = 0n;
  let paid = 0n;
  for (const me of ctx.db.moneyEvent.by_party.filter(partyId)) {
    if (me.kind === 'customer_invoice' && me.status !== 'reversed') {
      invoiced += me.totalFils;
    }
    if (me.kind === 'customer_payment' && me.status !== 'reversed') {
      paid += me.totalFils;
    }
  }
  return invoiced - paid < 0n ? 0n : invoiced - paid;  // floor at 0
}
// This function has no mutable state. It is always correct by construction.
```

---

## References

- `audit_finance.md` — Full Ramanujan+Hamilton analysis with Phase 18 post-mortem
- `ARCHITECTURE.md` §3 — MoneyEvent table definition
- `ARCHITECTURE.md` §3 — "outstanding is NEVER stored" note with proof
- `ph-final/ph_holdings/payment_service.go` — Legacy race condition that caused Phase 18
