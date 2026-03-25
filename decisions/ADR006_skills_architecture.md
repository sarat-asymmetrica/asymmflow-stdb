# ADR006 — Skills Architecture (Composable Atoms, 3 Approval Levels)

**Status:** Decided
**Date:** 2026-03-08
**Deciders:** Commander (Sarat) + Claude

---

## Context

The reimagined AsymmFlow needs AI to perform business actions — not just answer questions. These actions span multiple domains: reading STDB data, manipulating files via Neutralino, calling external APIs (Sarvam, Grok), and generating documents (PDF, PPTX, Excel).

The legacy "Butler" AI was a monolith: one system prompt, one LLM call, one possible output format (text). No reusable logic. Adding "generate a PPTX" would require rewriting the entire AI integration.

The question: what's the architecture for AI capabilities that can be composed, tested independently, and extended without rewriting the core?

---

## Decision

**AI capabilities are "Skills" — typed, named functions with a declared approval level and a SkillContext that provides access to STDB, Neutralino, and AI clients. Skills are registered in a `SkillRegistry`. The AI chat calls skills by name via the approval flow (see ADR005).**

---

## Rationale

### Why function-as-skill (not agent-as-pipeline)

1. **Skills are testable in isolation.**
   `ocr_document(filePath: string, ctx: SkillContext) → Promise<OcrResult>` can be tested
   with a mock `ctx`. The logic doesn't require a running LLM. OCR correctness is
   verifiable without a chat interaction.

2. **Skills are composable via natural language.**
   "Chase overdue payments for Grade C customers with active pipeline deals" is not a single
   skill — it's `filter_money_events` + `filter_pipeline` + `chase_payment`. The LLM
   interprets the request and composes the skill calls. Each skill is an atom; the LLM is
   the composer.

3. **Skills declare what they need.**
   Each skill specifies: `requiredRole` (who can invoke), `approval` (auto/explicit/admin_only),
   `category` (data/file/intelligence/communication). The approval UI and the RBAC check
   are derived from these declarations, not hardcoded.

4. **New workflow = ~50 LOC.**
   Adding "generate a sales commission report" = write one new skill with the report logic.
   No new screen. No new API route. No schema change. Just a skill function and a name.

5. **SkillContext is the bridge.**
   ```typescript
   interface SkillContext {
     stdb: SpacetimeDBConnection;  // read/write business state
     fs: NeutralinoFS;             // file system via Neutralino
     ai: AIClient;                 // Grok, Sarvam, Claude — caller's choice
     user: Member;                 // who's logged in (from ctx.sender)
   }
   ```
   Skills don't import global singletons. They receive their dependencies.
   This makes skills portable and testable.

### The 15 Core Skills (initial registry)

**Data Skills** (read/write STDB — require DB but not file system):
- `query_dashboard` (auto) — KPI aggregation
- `query_customer_360` (auto) — full party view
- `create_invoice` (explicit) — calls `record_money_event` reducer
- `record_payment` (explicit) — calls `record_money_event` reducer
- `chase_payment` (explicit) — generates WhatsApp drafts for overdue invoices
- `update_customer_grade` (admin_only) — changes party grade

**File Skills** (require Neutralino — desktop only):
- `scan_folder` (explicit) — list files matching a pattern
- `ocr_document` (auto) — PDF/image → text via Sarvam Vision
- `read_excel` (auto) — .xlsx → structured JSON
- `generate_pptx` (explicit) — structured data → PowerPoint
- `generate_pdf_invoice` (explicit) — MoneyEvent → PDF with PH letterhead
- `export_to_excel` (explicit) — STDB query → .xlsx

**Intelligence Skills** (compute-only, no writes):
- `pricing_advisor` (auto) — optimal discount given grade + competition
- `cashflow_forecast` (auto) — 30/60/90 day projection
- `payment_predictor` (auto) — when will this customer pay?
- `fraud_detector` (auto) — Benford's Law check on a set of amounts
- `win_probability` (auto) — logistic regression on a Pipeline item

**Communication Skills** (draft generation):
- `draft_whatsapp` (explicit) — draft message, user sends manually
- `draft_email` (explicit) — draft email for review
- `translate_document` (auto) — Arabic/Hindi → English via Sarvam

### Why NOT agent orchestration frameworks (LangChain, etc.)?

1. **We don't need them.** Our skill registry is 15-20 functions. LangChain is designed
   for complex multi-agent pipelines with tool routing, memory, reflection loops.
   Overkill for an 8-person trading company.

2. **They add opacity.** When a skill fails, we want to know exactly what failed and why.
   LangChain's orchestration makes this harder, not easier.

3. **STDB + AiAction IS the memory.** External agent memory frameworks solve a problem
   STDB already solves. Business state in STDB IS the agent's memory.

---

## Consequences

- **F014 (AiAction):** Intent routing extracts skill name + args from LLM response.
  Format: `{"skill": "chase_payment", "args": {"grade": "C", "daysOverdue": 30}}`
- **F016 (Intent Routing):** LLM outputs structured JSON identifying skill + args.
  Fallback: keyword matching for common patterns.
- **F017-F032 (Skills):** Each feature in Wave 3 and Wave 4 is one skill function.
- **Testing:** Each skill is unit-testable with mock SkillContext.
- **Extension:** Adding a new capability = write a skill + add to registry. No other changes.

---

## References

- `ARCHITECTURE.md` §5 — Full Skill Registry with 15 initial skills
- `ARCHITECTURE.md` §5 — Approval flow and SkillContext interface
- `ADR005` — AiAction approval gate (explains how skills get invoked)
- `audit_intelligence.md` §3 — Intelligence architecture for composable skills
