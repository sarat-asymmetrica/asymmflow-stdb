# ADR008 — Universal State Machine (All 6 State Machines as Partial Monoid)

**Status:** Decided
**Date:** 2026-03-08
**Deciders:** Commander (Sarat) + Claude (Mirzakhani+Grothendieck audit)

---

## Context

The legacy AsymmFlow has 6 separate state machines with explicit transition logic:
- Invoice lifecycle (Draft → Sent → PartiallyPaid → Paid → Cancelled)
- PO lifecycle (Draft → Approved → Sent → Received → Cancelled)
- Offer lifecycle (RFQ → Quoted → Won → Lost → Expired)
- Order lifecycle (Draft → Confirmed → Processing → Shipped → Delivered → Invoiced → Complete)
- Opportunity lifecycle (Lead → Qualified → Proposal → Negotiation → Won → Lost)
- SupplierInvoice lifecycle (Draft → Received → Paid → Cancelled)

Each has its own Go service file, its own status enum, its own update function, its own UI state rendering. The Mirzakhani+Grothendieck audit proved these are algebraically identical: all six are a finite directed acyclic graph of states, all share the terminal states (Terminal, Cancelled), all have a "in progress" middle state.

---

## Decision

**One universal state machine with 5 states: Draft → Active → InProgress → Terminal | Cancelled. One generic `advance_entity` reducer enforces valid transitions per entity type. Stored in `TRANSITIONS` table — not hardcoded.**

---

## Rationale

### The Algebraic Proof (Mirzakhani+Grothendieck)

All 6 state machines are partial monoids over a transition graph:
```
States: {Draft, Active, InProgress, Terminal, Cancelled}
Transitions: {(s1, s2) | transition is valid for entity type E}
Composition: (s1, s2) ∘ (s2, s3) = (s1, s3) when both are valid
Identity: s ∘ s = s (no-op)
Partial: not all pairs have valid composition (can't go Draft → Terminal directly)
```

The state machine IS a partial monoid. The 6 different machines are 6 different subsets of the same state space.

### Mapping of legacy states to universal states

| Universal | Invoice | PO | Offer | Order | Opportunity |
|-----------|---------|----|----|-------|-------------|
| Draft | Draft | Draft | RFQ | Draft | Lead |
| Active | Sent | Approved/Sent | Quoted/Sent | Confirmed | Qualified/Proposal |
| InProgress | PartiallyPaid | PartiallyReceived | Negotiation | Processing/Shipped | Negotiation |
| Terminal | Paid | Received | Won | Delivered/Complete | Won |
| Cancelled | Cancelled | Cancelled | Lost/Expired | Cancelled | Lost |

### Why one reducer instead of six?

1. **Transition validation is data, not code.**
   The `TRANSITIONS` constant defines which transitions are valid per entity type.
   Adding a new entity type = adding one entry to `TRANSITIONS`. No new reducer.

2. **UI renders state consistently.**
   A "Draft" badge looks the same whether it's an Invoice or a PO.
   One CSS class, one color, one icon. No 6x duplication in Svelte components.

3. **ActivityLog unification.**
   "Entity 42 (Pipeline) transitioned from Draft to Active" — one log format for
   all entity types. Time-travel queries ("what was the state of all open opportunities
   on Jan 1?") work uniformly.

4. **One reducer = one correctness proof.**
   If `advance_entity` is correct, all 6 state machines are correct.
   Six separate reducers each need their own correctness proof.

### The Transition Table

```typescript
const TRANSITIONS: Record<string, Record<string, string[]>> = {
  Pipeline: {
    Draft: ['Active', 'Cancelled'],      // created → sent (offer)
    Active: ['InProgress', 'Terminal', 'Cancelled'],  // sent → negotiating → won/lost
    InProgress: ['Terminal', 'Cancelled'],
  },
  Order: {
    Draft: ['Active', 'Cancelled'],      // created → confirmed
    Active: ['InProgress', 'Cancelled'], // confirmed → processing/shipped
    InProgress: ['Terminal'],            // shipped → delivered (no cancellation after ship)
  },
  PurchaseOrder: {
    Draft: ['Active', 'Cancelled'],
    Active: ['InProgress', 'Cancelled'],
    InProgress: ['Terminal'],
  },
  MoneyEvent: {
    Draft: ['Active', 'Cancelled'],      // created → sent
    Active: ['InProgress', 'Terminal', 'Cancelled'],  // sent → partial payment → paid
    InProgress: ['Terminal'],
  },
};
```

---

## Consequences

- **F001 (STDB Schema):** `entityStatus` enum with 5 values used on Pipeline, Order, PurchaseOrder, MoneyEvent.
- **F007 (Sales Pipeline):** Pipeline status uses universal enum. UI shows consistent badges.
- **F008 (Finance Hub):** MoneyEvent status uses universal enum.
- **F039 (Operations Hub):** PurchaseOrder status uses universal enum.
- **F046 (Audit Trail UI):** All transitions in ActivityLog use same format.
- **New entity types:** Add one entry to `TRANSITIONS` constant. No new reducer needed.

---

## References

- `audit_unification.md` — Full Mirzakhani+Grothendieck proof of state machine equivalence
- `ARCHITECTURE.md` §4 — Universal State Machine with 8 reducers
- `audit_crm_pipeline.md` §1.1 — Legacy CRM state machine graph
- `audit_operations.md` §1.1 — Legacy PO state machine DFA
