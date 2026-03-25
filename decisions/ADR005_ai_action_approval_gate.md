# ADR005 — AiAction Approval Gate (Proposed → Approved → Executed)

**Status:** Decided
**Date:** 2026-03-08
**Deciders:** Commander (Sarat) + Claude

---

## Context

The previous AI integration ("Butler") in AsymmFlow V4 was a Mistral chatbot that answered questions and recommended actions — but couldn't actually DO anything. The recommendation was: "Send a reminder to Al-Rashid." The human had to then navigate to the customer, find the contact, open WhatsApp, compose the message manually. The AI added analysis, not leverage.

The reimagined AsymmFlow wants AI that acts: scan a folder, generate a PPTX, send a payment chase WhatsApp, create an invoice. But "AI that acts autonomously on business data" is high risk. One wrong action — deleting the wrong invoice, sending a chase letter to a customer who already paid — is a real business problem.

The question: how do we enable AI agency without enabling AI autonomy?

---

## Decision

**Three-tier approval model for all AI actions:**
- `auto`: AI executes immediately (read-only queries, aggregations, draft generation)
- `explicit`: AI proposes → human reviews → human approves → system executes
- `admin_only`: Like explicit but only Admin role can approve

**All `explicit` and `admin_only` actions are recorded in the `AiAction` table before execution.**

---

## Rationale

### The "120-foot moment" principle

Abhie reviews a draft payment chase letter, taps send on WhatsApp, customer pays within 24 hours. The AI did 90% of the work — researched the customer, assessed the grade, drafted the message with the right tone. Abhie made the decision and pressed the button.

This is the design target: AI does the cognitive work, human makes the consequential decision.

### Why this tier structure?

1. **`auto` for reads and drafts.**
   "What's EWA's current outstanding?" or "Draft a payment chase for Al-Rashid" — these are
   either read-only (no STDB writes) or draft generation (the draft exists only for review,
   nothing is sent or written until approved). Zero-risk actions should not require approval.
   Friction on zero-risk actions makes the AI annoying, not safe.

2. **`explicit` for writes and communications.**
   Creating an invoice, recording a payment, sending a WhatsApp draft — these have real
   business consequences. Wrong invoice created = customer confusion. Wrong payment recorded
   = books out of balance. An explicit approval card shows Abhie exactly what will happen
   before it happens. One tap to approve or cancel.

3. **`admin_only` for policy decisions.**
   Changing a customer's grade (A → D means no more credit), updating credit limits,
   approving a costing with margin below 12% — these are strategic decisions, not operational
   ones. Only Abhie (Admin) should approve these, even if a manager requests them.

### The AiAction table as audit trail

```
Every explicit/admin_only action, regardless of outcome, writes to AiAction:
- requestorId: who asked the AI
- skillName: which skill was invoked
- plan: JSON describing what the AI plans to do (shown in approval UI)
- status: Proposed → Approved → Executed (or Rejected, Failed)
- approvedBy: who approved
- result: what happened (success details, file paths, message drafts)
- errorMessage: if execution failed
```

This means: "Who approved that invoice?" "Why was that payment chase sent?" are answerable from
the AiAction table alone. No separate audit log, no reconstructing from application logs.

### Why NOT give AI full autonomy?

Three reasons from the audit:

1. **GCC business context is implicit.** The AI doesn't know that Abu Hassan at EWA prefers
   to be called, not WhatsApped. It doesn't know that ABB just undercut us on the tender.
   It doesn't know that December is the worst month for collections. This implicit knowledge
   lives in Abhie's head. The approval moment is when Abhie applies it.

2. **Irreversible actions exist.** Sending a WhatsApp message to a customer cannot be unsent.
   Creating an invoice in Tally (once the Tally integration exists) is difficult to reverse.
   For irreversible actions, the approval moment is the last chance to prevent an error.

3. **Business liability.** If AI sends a threatening payment chase to a customer who already
   paid (because the payment wasn't recorded yet), that's a business relationship problem.
   Human-in-the-loop for communications is non-negotiable.

---

## Consequences

- **F001 (STDB Schema):** `AiAction` table (10th table) with status enum and full audit fields.
- **F014 (AiAction Approval Flow):** UI renders `AiAction` rows with status `Proposed` as
  approval cards in the chat interface.
- **F016 (Intent Routing):** Intent router classifies user messages and creates AiAction
  proposals for explicit/admin_only skills.
- **All Skills:** Each skill declares its `approval` level. Skills with `explicit` or
  `admin_only` call `propose_ai_action` reducer, not the skill's execute function directly.
  The `resolve_ai_action` reducer triggers execution after approval.
- **Logging:** Every execution (success or failure) updates the AiAction row. Full audit
  trail with no extra effort.

---

## The Approval Flow in Detail

```
1. User: "Chase payments for overdue Grade C invoices"

2. AI intent router → classifies as skill `chase_payment` (approval: explicit)

3. AI queries STDB:
   - Finds 7 overdue invoices from Grade C customers
   - Total outstanding: 23,000 BHD
   - Customers: Al-Rashid (3 inv), Salim Trading (2 inv), Gulf Tech (2 inv)

4. AI calls `propose_ai_action` reducer:
   {
     skillName: "chase_payment",
     plan: {
       invoices: [101, 103, 107, 112, 115, 118, 122],
       action: "Generate WhatsApp drafts — tone: firm reminder (Grade C policy)",
       expectedDrafts: 3,          // one per customer, not per invoice
       totalOutstanding: 23000000  // in fils
     },
     status: "Proposed"
   }

5. UI shows approval card in chat with plan summary.
   [Approve] [Edit] [Cancel]

6. Abhie reads: "7 invoices, 3 customers, 23K BHD outstanding. Firm reminder tone."
   Taps [Approve].

7. `resolve_ai_action` reducer → status = Approved → triggers skill execution.

8. Skill generates 3 WhatsApp draft messages (one per customer), stores in result.

9. AiAction → status = Executed. Result stored.
   UI shows drafts in chat. Abhie reviews each, taps send on WhatsApp manually.
```

---

## References

- `ARCHITECTURE.md` §5 — Skills Architecture with approval tier table
- `ARCHITECTURE.md` §5 — Approval flow walkthrough ("The 120-foot moment")
- `audit_intelligence.md` §1.1 — Butler AI audit (grade D+, reactive only)
- `audit_intelligence.md` §3 — Proposed AiAction architecture
