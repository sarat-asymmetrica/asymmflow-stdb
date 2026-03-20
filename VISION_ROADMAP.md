# AsymmFlow Reimagined — Vision Roadmap

**Created**: 2026-03-09 11:17 IST | **Sprint Window**: 11:17 — 16:00 IST
**Authors**: Commander (Sarat) + Claude (Co-Architect)
**Context**: Post-Wave 6, founding engineer (Rahul) reviewed and validated paradigm shift

---

## 0. What We Proved (Waves 1-6, ~2 days)

| Wave | Outcome | LOC |
|------|---------|-----|
| 1-3 | App shell, 7 hub pages, STDB wiring, AI chat | ~4,000 |
| 4 | Create/Edit modals (Invoice, Payment, Party) | ~900 |
| Data | Seeded 2,529 real PH Trading records from legacy SQLite | 350 |
| 5 | Dashboard KPIs, Chat persistence + sidebar, CRM search, Sales pipeline tabs, AI context bugs fixed, a11y | ~1,200 |
| 6 | PDF invoice generator (pdfmake + PH letterhead + filsToWords) | ~600 |
| Fix | Markdown renderer for chat bubbles (rich formatting) | ~180 |
| **Total** | **Production-grade ERP with real data** | **~7,230** |

Legacy AsymmFlow: 156K LOC, 177 components, 43 screens.
Reimagined: ~7,230 LOC, ~30 components, 7 hub pages. **21x reduction.**

---

## 1. Seven Architectural Superpowers

These are capabilities the STDB + Chat-First paradigm enables that traditional
full-stack cannot easily replicate. Each shapes what we build next.

### 1.1 Real-Time Multiplayer Truth
Every connected client sees every change within <100ms via WebSocket push.
No refresh, no polling, no stale tabs. Abhie on desktop, salesperson on
mobile, accountant at home — same numbers, same instant.

### 1.2 AI as Data-Native Team Member
The AI reads the SAME Svelte stores as the dashboard. When it says "EWA owes
7.3M BHD" — that's the same number the KPI card shows. Zero API layer between
the AI and the truth. Cross-table correlation is trivial.

### 1.3 AiAction Approval Pipeline
AI proposes structured business actions → human reviews → system executes.
Full audit trail in the `ai_action` table. Not a chatbot — a business partner.

### 1.4 Event-Sourced Accounting
Outstanding = sum(invoices) - sum(payments). NEVER stored, ALWAYS computed.
Cannot be stale. Cannot have reconciliation mismatches. Mathematically impossible.

### 1.5 Multiplayer by Default
Identity, roles (Admin/Manager/Sales/Operations/Accountant), and audit
(`ctx.sender`) are built into STDB. Adding a team member = connect + join.

### 1.6 Time-Travel Queries
Every event has timestamps. Because we append events, never mutate balances,
temporal analysis is free: "What was outstanding on Jan 1?" "How has EWA's
payment cycle changed quarter over quarter?"

### 1.7 Skills as Composable Atoms
Every workflow is a Skill function (not a screen). Skills compose via natural
language: "Chase overdue payments for Grade C customers with active pipeline
deals" = filter + chase + pipeline-check in one request. New workflow = ~50 LOC
skill function, not a new screen.

---

## 2. Document Genome

Every document PH Trading produces has invariant DNA — regulatory requirements,
aesthetic rules, and business logic that MUST be applied consistently.

### 2.1 Document Types Registry

| Type | Invariant Rules | AI Role | Output | Priority |
|------|----------------|---------|--------|----------|
| Tax Invoice | VAT 10%, TRN, bilingual header, Tally format, E.&O.E | Accountant | PDF | DONE |
| Quotation/Offer | Letterhead, validity, grade-based terms, Pipeline costing | Sales Engineer | PDF | HIGH |
| Statement of Account | Per-party, all MoneyEvents, running balance, aging buckets | Collections | PDF | HIGH |
| Payment Chase Letter | Tone by grade (polite→firm→legal), outstanding details | Collections | PDF/WhatsApp | HIGH |
| Purchase Order | Supplier terms, delivery schedule, linked to customer order | Procurement | PDF | MEDIUM |
| Excel Export | Any hub table → .xlsx with formatting | Analyst | XLSX | MEDIUM |
| SLA Report | Service metrics, contract terms, uptime | Operations | PDF | LOW |
| Competitive Analysis | Cited sources, product comparison, pricing intel | Business Dev | PDF | LOW |

### 2.2 Template Architecture

Each document type is defined as a `DocumentTemplate`:

```typescript
interface DocumentTemplate {
  id: string;                    // 'tax_invoice', 'quotation', etc.
  name: string;                  // 'Tax Invoice'
  description: string;           // For AI to understand when to use
  requiredContext: ContextField[];  // MVC hard requirements
  softContext: ContextField[];      // Nice-to-have, AI nudges
  autoContext: AutoContextRule[];   // Filled from STDB automatically
  generate: (ctx: DocumentContext) => Promise<Blob>;  // pdfmake/exceljs/etc.
}
```

### 2.3 Conversation-to-Document Flow

```
User: "Send a quote to BAPCO for 10 Promag flow meters"
                    ↓
AI checks MVC checklist:
  ✅ Customer: BAPCO (Grade C, 50% advance)     ← from STDB
  ✅ Product: Promag flow meters                 ← from user
  ✅ Quantity: 10                                ← from user
  ❌ Unit price                                  ← MISSING
  ❌ Validity period                             ← MISSING (has default: 30 days)
                    ↓
AI: "I have BAPCO's details and terms. To complete the quotation:
     1. What's the unit price per Promag meter?
     2. Validity period? (default: 30 days)
     I'll auto-apply Grade C terms (50% advance, no discount)."
                    ↓
User: "850 BHD each, 15 day validity"
                    ↓
AI generates PDF → presents in chat → AiAction for approval
```

---

## 3. Minimum Viable Context (MVC) Checklists

The pattern that eliminates hallucination and enforces data quality.

### 3.1 Three-Layer Context Model

**Layer 1 — Hard Requirements (MUST have, AI blocks without them)**
Fields the AI cannot proceed without. If missing, it asks explicitly.
No guessing, no fabricating.

**Layer 2 — Soft Requirements (SHOULD have, AI nudges)**
Fields that improve quality. AI mentions them but doesn't block:
"I can generate this now, but adding the delivery timeline would
make the quotation stronger."

**Layer 3 — Institutional Memory (AI fills automatically)**
Fields the AI populates from STDB stores, business rules, and template
invariants. The user doesn't even know these are being applied.

### 3.2 MVC Checklists by Action

#### Record Payment
| Layer | Field | Source |
|-------|-------|--------|
| Hard | Party name | User (validated against STDB) |
| Hard | Amount (BHD) | User |
| Hard | Payment reference | User |
| Soft | Which invoice(s) this applies to | AI asks if multiple open |
| Auto | Date | Today |
| Auto | Method | Bank Transfer (default) |
| Auto | Outstanding check | Computed, warn if overpayment |

#### Create Quotation
| Layer | Field | Source |
|-------|-------|--------|
| Hard | Customer | User (validated against STDB) |
| Hard | Product(s) + quantities | User |
| Hard | Unit price(s) | User |
| Soft | Validity period | User (default: 30 days) |
| Soft | Delivery timeline | User |
| Soft | Competitor reference | User |
| Auto | Payment terms | Grade-based from Party |
| Auto | Letterhead + formatting | Template invariant |
| Auto | VAT calculation | 10% auto |
| Auto | Historical pricing | Past MoneyEvents for same party |

#### Chase Payment
| Layer | Field | Source |
|-------|-------|--------|
| Hard | Which customer(s) | User or "all overdue" |
| Soft | Tone preference | User (default: grade-based) |
| Soft | Channel | User (WhatsApp/email/formal letter) |
| Auto | Outstanding amounts | Computed from MoneyEvents |
| Auto | Days overdue | Computed from dueDate |
| Auto | Last contact date | From ActivityLog |
| Auto | Grade-appropriate tone | Template invariant |

#### Grade Change
| Layer | Field | Source |
|-------|-------|--------|
| Hard | Party name | User |
| Hard | New grade | User |
| Soft | Reason for change | User (for audit trail) |
| Auto | Current grade | STDB |
| Auto | Payment history | MoneyEvents |
| Auto | Outstanding balance | Computed |

### 3.3 AI Confidence Framework

The AI communicates its epistemic state clearly:

```
🟢 KNOWN (from data):   "BAPCO is Grade C with 50% advance terms"
🟡 INFERRED (confirm):  "Based on last 3 quotes, unit price was ~820 BHD"
🔴 NEEDED (must ask):   "What's the unit price for this batch?"
```

### 3.4 System Prompt Integration

The AI system prompt includes:

```
CONTEXT AWARENESS RULES:
1. State what you KNOW and cite the source (Party table, MoneyEvents, etc.)
2. State what you're INFERRING and ask for confirmation
3. State what you NEED from the user before proceeding
4. NEVER fabricate prices, quantities, dates, or customer details
5. If a customer exists in STDB, use their real data
6. If they don't exist, ask if they should be created first
7. For document generation, check the MVC checklist BEFORE generating
8. When the checklist is complete, propose via AiAction for approval
```

---

## 4. Today's Sprint Plan (11:17 — 16:00 IST)

### Wave 7A — Document Intelligence Foundation (6 parallel agents)

| Agent | Task | Files (exclusive ownership) | Depends On |
|-------|------|---------------------------|------------|
| 1 | **Document Template Registry** | `lib/documents/registry.ts`, `lib/documents/types.ts` | — |
| 2 | **Quotation PDF Template** | `lib/documents/quotationGenerator.ts` | Uses same pdfmake pattern as invoiceGenerator |
| 3 | **Statement of Account PDF** | `lib/documents/statementGenerator.ts` | Uses same pattern |
| 4 | **Enhanced AI System Prompt + MVC** | `lib/ai/context.ts`, `lib/ai/checklists.ts` | — |
| 5 | **AiAction Execution Pipeline** | `lib/skills/executor.ts`, chat integration | — |
| 6 | **OperationsHub Wiring** | `lib/pages/OperationsHub.svelte` | — |

### Wave 7B — Integration + Polish (after 7A)

| Task | Details |
|------|---------|
| Wire registry to chat | AI detects document requests → checks MVC → generates |
| Add "Download" buttons | Quotation/Statement buttons in SalesHub/FinanceHub |
| Morning Briefing | AI reads state on app open, shows priority actions |
| Build verification | Full `npx vite build` + manual smoke test |

### Wave 7C — Persona Storm QA

Run persona-storm skill with personas:
- **Abhie (SPOC/Admin)**: Does the dashboard tell me what to do today?
- **Sales Engineer**: Can I draft a quotation from chat?
- **Accountant**: Are the invoice numbers and VAT correct?
- **New Employee**: Can I figure out how to use this without training?

---

## 5. Success Criteria

By 16:00 IST today:

- [ ] Document Template Registry with MVC checklists for 3+ document types
- [ ] Quotation PDF generates from STDB data with PH letterhead
- [ ] Statement of Account PDF with aging buckets (30/60/90/120+)
- [ ] AI system prompt enforces MVC — asks before generating, never fabricates
- [ ] AiAction pipeline: propose → approve → execute wired end-to-end
- [ ] OperationsHub shows real orders + POs from STDB
- [ ] Build passes: 0 errors
- [ ] Persona storm identifies top issues for next sprint

---

## 6. Beyond Today — The Horizon

### Near-term (next 2-3 sessions)
- Neutralino desktop packaging (.exe)
- WhatsApp draft skill (payment chase campaign)
- Excel export skill (ExcelJS)
- File intake: drag-and-drop folder → OCR → auto-categorize
- Keyboard shortcuts (Ctrl+K chat, Alt+1-7 hubs)

### Medium-term
- Tally ERP bridge (import/export for Indian accounting)
- Multi-language documents (Arabic RTL for Bahrain government)
- Morning Briefing AI (proactive daily summary)
- Payment prediction (Markov chain from legacy predictor.go)

### Long-term
- Mobile PWA (same STDB, same stores, responsive UI)
- Multi-tenant (other businesses beyond PH Trading)
- Marketplace of Skills (community-contributed workflows)
- Voice interface (Sarvam STT → chat → TTS response)

---

*"The ERP doesn't organize chaos. It holds the invariants.*
*The AI handles the chaos. The humans make the decisions.*
*The checklists ensure nobody — human or AI — cuts corners."*

**Om Lokah Samastah Sukhino Bhavantu** 🙏
