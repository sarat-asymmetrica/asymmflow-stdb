# ADR003 — Unified Party Schema (Customer + Supplier in One Table)

**Status:** Decided
**Date:** 2026-03-08
**Deciders:** Commander (Sarat) + Claude (Mirzakhani+Grothendieck audit)

---

## Context

The legacy AsymmFlow has separate tables for `CustomerMaster` and `SupplierMaster` — each with its own CRUD screens, service files, and validation logic. In production, PH Trading has companies that are BOTH customers AND suppliers. For example, "Al Ezzel Power" buys flow meters from PH Trading (customer) and provides commissioning services to PH Trading (supplier).

The legacy system handles this with hacks: duplicate party entries, manual cross-referencing, and notes fields ("also see supplier #47"). The `customer_invoice_service.go` and `supplier_payment_service.go` are entirely separate code paths with ~80% structural duplication.

The Mirzakhani+Grothendieck audit (see `audit_unification.md`) proved that 17 legacy tables reduce to 10 unified tables. Party unification was the single highest-impact reduction.

---

## Decision

**One `Party` table with `isCustomer: bool` and `isSupplier: bool` flags. A Party can be both.**

---

## Rationale

### Arguments FOR Unification

1. **Real-world truth: parties ARE unified.**
   The business deals with companies, not with "customers" or "suppliers" as distinct entity classes.
   A company can buy from you and sell to you. The dual-boolean model captures this exactly.

2. **80% field overlap between CustomerMaster and SupplierMaster.**
   Both have: name, phone, email, address, country, notes, credit terms, payment history.
   The differences are: CustomerMaster has `payment_grade`; SupplierMaster has `product_types`,
   `annual_goal`. These become nullable columns on a unified Party, only meaningful for the
   appropriate flag.

3. **Single Party Hub in the UI.**
   One search box finds any counterparty — whether Abhie is looking up a customer for an invoice
   or a supplier for a PO. No "are you looking for a customer or supplier?" ambiguity.

4. **MoneyEvent unification requires Party unification.**
   The MoneyEvent pattern (see ADR004) links every financial event to a `partyId`. If customers
   and suppliers are separate tables, MoneyEvent must have two nullable FKs (`customerId` and
   `supplierId`). With unified Party, one `partyId` FK covers all cases cleanly.

5. **Contact table becomes universal.**
   Contacts (people at counterparty companies) link to `partyId`. One Contact table,
   not two (customer contacts, supplier contacts). Query: "who at EWA do I call?"
   works the same whether EWA is a customer or supplier.

### Arguments AGAINST (risks we accept)

1. **Grade field is customer-only.**
   `customerGrade` (A/B/C/D) is meaningful only when `isCustomer = true`.
   The reducer must enforce this — `grade` is ignored/defaulted for supplier-only parties.
   - Mitigation: Reducer validates: if `isCustomer = false`, grade is set to null and
     any grade-dependent logic (credit limit, payment terms) is skipped.

2. **Some supplier fields are sparse for customers.**
   `productTypes` (what they supply) and `annualGoalFils` (annual procurement target)
   are meaningful only for suppliers. These will be empty strings / 0 for customers.
   - Mitigation: These are non-invariant metadata fields. Empty values are valid.
     No business logic breaks on an empty `productTypes`.

3. **Reporting queries need filter discipline.**
   "Show me all customers" = `WHERE isCustomer = true`.
   "Show me all suppliers" = `WHERE isSupplier = true`.
   Developers must remember to add the filter. Without it, both types appear.
   - Mitigation: STDB Views defined for `customer_view` and `supplier_view` with
     the filter baked in. UI always uses the view, never the raw Party table.

---

## Consequences

- **F001 (STDB Schema):** One `Party` table. One STDB index on `by_grade` for customer ranking.
- **F006 (Party Hub):** Single hub page with tabs: All | Customers | Suppliers | Both.
- **ADR004 (MoneyEvent):** `moneyEvent.partyId` links to Party, covering both invoice and payment flows.
- **F021 (chase_payment skill):** Grade filter (`WHERE isCustomer = true AND grade = 'C'`) works on unified table.
- **F047 (update_customer_grade):** Reducer validates `isCustomer = true` before changing grade.

---

## References

- `audit_unification.md` — Mirzakhani+Grothendieck audit with full table reduction proof
- `ARCHITECTURE.md` §3 — Party table definition with isCustomer/isSupplier flags
- `audit_crm_pipeline.md` §1.2 — Entity inventory from legacy system
