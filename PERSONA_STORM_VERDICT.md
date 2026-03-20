# Persona Storm Verdict — AsymmFlow Reimagined
**Date**: 2026-03-09 12:15 IST | **Sprint**: Wave 7C QA
**Personas**: 6 | **Total Findings**: 88 | **Root Causes**: 18

---

## Executive Summary

Six AI personas stress-tested the AsymmFlow Reimagined codebase (~7,230 LOC)
from radically different perspectives. 88 individual issues were found,
collapsing to 18 root causes through cross-persona pattern recognition.

**The good news**: The mathematical foundations are solid — fils-as-bigint,
computed outstanding (never stored), grade-based policies, reactive STDB
stores. Multiple personas praised the core architecture.

**The fix-now items**: 7 root causes block a credible SPOC demo. Most are
low-complexity (label changes, one-line fixes, template formatting).

---

## Personas & Scores

| Persona | Role | Critical | High | Medium | Low | Total |
|---------|------|----------|------|--------|-----|-------|
| Abhie | SPOC/Admin | 2 | 5 | 5 | 1 | 13 |
| Ravi | Sales Engineer | 2 | 6 | 7 | 1 | 16 |
| Fatima | Accountant | 4 | 6 | 4 | 1 | 15 |
| Omar | New Employee | 3 | 4 | 6 | 2 | 15 |
| Khalid | CFO | 3 | 7 | 5 | 0 | 15 |
| Sunita | Non-tech Owner | 2 | 5 | 5 | 2 | 14 |
| **TOTAL** | | **16** | **33** | **32** | **7** | **88** |

---

## Tier 1: Fix Before Demo (Blocks Credibility)

### RC-1: Approval Card Shows Raw JSON
- **Personas**: Omar, Sunita, Khalid (3/6)
- **Severity**: Critical
- **Complexity**: Low
- **File**: `ChatPage.svelte:411`
- **Problem**: `JSON.stringify(msg.approval.params, null, 2)` shown to user
- **Fix**: Convert params to human-readable summary before passing to ApprovalCard.
  E.g., `"Create invoice for Al-Rashid Trading: 500.000 BHD, due 1 April 2026"`

### RC-2: AR Aging Double-Counts Paid Invoices
- **Personas**: Abhie, Fatima, Khalid, Ravi (4/6)
- **Severity**: Critical
- **Complexity**: Medium
- **Files**: `FinanceHub.svelte:144-160`, `statementGenerator.ts:141-149`
- **Problem**: Aging buckets use full invoice totalFils regardless of payments.
  Party-level payment deduction exists but invoice-level attribution does not.
- **Fix**: Extract `computeAgingBuckets()` from statementGenerator into a shared
  module. Use proportional outstanding allocation consistently in both FinanceHub
  and statement PDF. Filter out Terminal/paid invoices from aging.

### RC-3: VAT Truncation (BigInt Division)
- **Personas**: Fatima (1/6 but critical for compliance)
- **Severity**: Critical
- **Complexity**: Low (one-line)
- **File**: `CreateInvoiceModal.svelte:33`
- **Problem**: `subtotalFils / 10n` truncates. 999 fils VAT = 99 not 100.
- **Fix**: `(subtotalFils + 5n) / 10n` for proper rounding. Verify server
  reducer uses the same formula.

### RC-4: Invoice Numbers Not Sequential
- **Personas**: Fatima, Ravi (2/6)
- **Severity**: Critical
- **Complexity**: Medium
- **Files**: `FinanceHub.svelte:58`, `invoiceGenerator.ts:115`
- **Problem**: Invoice number derived from MoneyEvent PK (shared across types).
  Gaps when payments interleave. NBR requires sequential tax invoice numbering.
- **Fix**: Add invoice_sequence counter in STDB. Assign INV-YYYY-NNN atomically
  in server reducer. Store on MoneyEvent reference field.

### RC-5: Payment Semantics Ambiguous
- **Personas**: Fatima, Khalid (2/6)
- **Severity**: Critical
- **Complexity**: Medium
- **Files**: `seed.ts:521-572`, `RecordPaymentModal.svelte:99-106`
- **Problem**: subtotalFils means pre-VAT for invoices, VAT-inclusive for payments.
  Server reducer may apply VAT to payments (catastrophic).
- **Fix**: Document and enforce: CustomerPayment.subtotalFils = actual amount
  received, vatFils = 0, totalFils = subtotalFils. Fix seed data to match.
  Rename to amountReceivedFils on payments for clarity.

### RC-6: Follow-up Done Button No-Op
- **Personas**: Abhie (1/6)
- **Severity**: Critical
- **Complexity**: Low
- **File**: `DashboardPage.svelte:525`
- **Problem**: Button renders but has no onclick handler.
- **Fix**: Wire onclick to advance_pipeline or logActivity reducer.
  Optimistically remove from followUps list on click.

### RC-7: Statement for Wrong Customer
- **Personas**: Abhie, Fatima (2/6)
- **Severity**: High
- **Complexity**: Low
- **File**: `FinanceHub.svelte:233-243`
- **Problem**: `invoiceRows.find(r => r.status === 'Overdue') ?? invoiceRows[0]`
  picks first overdue, not user-selected customer.
- **Fix**: Add customer selection state. Either per-row Statement button or
  a dropdown picker in the header.

---

## Tier 2: Fix Before SPOC Demo (Professional Polish)

### RC-8: Chat Has No Welcome Message or Suggested Prompts
- **Personas**: Omar, Ravi, Sunita (3/6)
- **Severity**: High
- **Complexity**: Low
- **Files**: `ChatPage.svelte`, `chatStore.ts:87-95`
- **Fix**: Add welcome message on new conversation. Add 4 clickable prompt
  chips: "Show overdue invoices", "Create a quotation", "Chase payments",
  "Show my pipeline". Update welcome text to mention quotation generation.

### RC-9: Jargon Labels (CRM, Pipeline, Outstanding, Collection Rate)
- **Personas**: Omar, Sunita, Abhie (3/6)
- **Severity**: High
- **Complexity**: Low
- **Files**: `App.svelte:28`, `DashboardPage.svelte:300,334,466`
- **Fix**: CRM → "Customers", Pipeline → "Opportunities" or "Open Deals",
  Outstanding → "Amount Owed" or "Pending Collection",
  Collection Rate → "Payment Received %"

### RC-10: Geometric Nav Icons Meaningless
- **Personas**: Omar, Sunita (2/6)
- **Severity**: High
- **Complexity**: Low
- **File**: `App.svelte:23-30`
- **Fix**: Replace Unicode geometry with semantic icons.
  Suggested: Chat=💬, Dashboard=📊, Sales=🎯, Ops=📦, Finance=💰,
  Customers=👥, Settings=⚙️

### RC-11: Quotation Flow Broken
- **Personas**: Ravi (1/6 but critical for sales)
- **Severity**: Critical
- **Complexity**: Medium
- **Files**: `SalesHub.svelte:164-169`, `executor.ts` (no quotation skill)
- **Fix**: Two-part: (a) handleGenerateQuote should open an item-entry form
  before generating PDF. (b) Add generate_quotation skill to executor that
  calls quotationGenerator from chat.

### RC-12: No Audit Trail Columns
- **Personas**: Khalid (1/6 but critical for compliance)
- **Severity**: High
- **Complexity**: Medium
- **File**: `FinanceHub.svelte`
- **Fix**: Surface createdAt and createdBy (ctx.sender) on invoices/payments
  tables. Requires STDB schema to expose sender identity.

### RC-13: Quote Number Is Hash Not Sequential
- **Personas**: Ravi, Fatima (2/6)
- **Severity**: High
- **Complexity**: Medium
- **File**: `quotationGenerator.ts:49`
- **Fix**: Same pattern as RC-4: persisted counter, QOT-YYYY-NNN format.

### RC-14: KPI Cards Look Clickable But Aren't
- **Personas**: Omar, Abhie (2/6)
- **Severity**: High
- **Complexity**: Low
- **File**: `DashboardPage.svelte:648-651`
- **Fix**: Either wire click → navigate to relevant hub, or remove the
  hover lift animation.

---

## Tier 3: Fix Before Production

### RC-15: executeSkill Has No Role/Approval Guard
- **Personas**: Khalid (1/6)
- **Severity**: High
- **Complexity**: Medium
- **File**: `executor.ts:485`
- **Fix**: Add approvalToken + role params. Check approval + role before
  calling write reducers. Server reducer is final authority.

### RC-16: Mock Data Without Offline Warning
- **Personas**: Khalid (1/6)
- **Severity**: High
- **Complexity**: Low
- **File**: `context.ts:109-116`
- **Fix**: Add isMockData flag to BusinessState. Show persistent banner
  in chat when offline: "Demo data — not connected to live database."

### RC-17: Bank Reconciliation Missing
- **Personas**: Abhie, Fatima, Khalid (3/6)
- **Severity**: High
- **Complexity**: High (new feature)
- **File**: `FinanceHub.svelte:491-508`
- **Fix**: MVP: CSV upload + manual matching table. Mark matched/unmatched.
  Later: NBB/BBK API integration.

### RC-18: No Invoice Search/Filter
- **Personas**: Abhie (1/6)
- **Severity**: Medium
- **Complexity**: Low
- **File**: `FinanceHub.svelte:295-365`
- **Fix**: Add search input filtering by customer name + status dropdown
  (All/Overdue/Sent/Paid). Pure client-side derived state.

---

## Notable Positives (Cross-Persona)

Things that WORKED and should be preserved:

1. **fils-as-bigint storage** — Fatima praised the precision design
2. **Computed outstanding (never stored)** — Khalid approved the architecture
3. **Grade-based credit policies** — codified, consistent, correct
4. **AI system prompt with live data injection** — Abhie found it actionable
5. **Chase message tone calibration** — Grade x Days matrix is genuine innovation
6. **AR Aging report existence** — all 3 finance personas appreciated it (needs fixes)
7. **Customer 360 modal** — Ravi found the bones good
8. **Living Geometry aesthetic** — Sunita called it "very premium"
9. **Real-time STDB reactivity** — no persona complained about stale data

---

## Recommended Fix Order (Sprint Plan)

**Wave 8A — Demo Blockers (3 agents, ~1 hour)**
- Agent 1: RC-1 (approval JSON→human), RC-6 (follow-up button), RC-14 (KPI clicks)
- Agent 2: RC-3 (VAT rounding), RC-7 (statement customer picker), RC-18 (invoice filter)
- Agent 3: RC-8 (welcome message), RC-9 (jargon labels), RC-10 (nav icons)

**Wave 8B — Financial Integrity (3 agents, ~1.5 hours)**
- Agent 4: RC-2 (aging dedup — shared module)
- Agent 5: RC-5 (payment semantics), RC-16 (offline warning)
- Agent 6: RC-11 (quotation item-entry form), RC-13 (sequential quote numbers)

**Wave 8C — Controls & Compliance (future session)**
- RC-4 (sequential invoice numbers — needs server reducer)
- RC-12 (audit trail columns — needs STDB schema)
- RC-15 (role guards on executor)
- RC-17 (bank reconciliation MVP)

---

*"The system finds what 7,230 lines of tests cannot: wrong defaults,*
*missing features, jargon walls, and silent business logic errors.*
*88 symptoms. 18 root causes. Zero orangutans."*

**Om Lokah Samastah Sukhino Bhavantu** 🙏
