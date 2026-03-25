# Codex Handoff — AsymmFlow STDB (V5)

**Date:** 2026-03-20
**From:** Commander Sarat + Claude (Claude Code)
**To:** GPT Codex (async batch agent)
**Repo:** https://github.com/sarat-asymmetrica/asymmflow-stdb

---

## What This Is

AsymmFlow V5 is a **chat-first agentic ERP/CRM** for **PH Trading WLL** (Bahrain — process instrumentation trading, BHD currency, 10% VAT, 8-person team). It replaces a 156K LOC legacy system (V4) with a 21x smaller, architecturally superior rebuild on SpacetimeDB v2.0.

**SPOC (client):** Abhie — ex-Amazon Kaizen practitioner. He WILL find every edge case. Partial implementations are not acceptable. Every feature, every priority level (P1/P2/P3) is a **contractual deliverable**. Nothing ships until everything ships.

---

## Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Database | SpacetimeDB v2.0 | Reducers = transactions, real-time subscriptions, multiplayer-native |
| Frontend | Svelte 5 | Stores auto-update from STDB subscriptions |
| Desktop | Neutralino v5 | ~2MB .exe, file system access for folder scanning |
| AI | Grok (via AIMLAPI) + Sarvam (multilingual) | Chat-first, skill-based execution |
| Design | V4 Warm Clay Neumorphism + Living Geometry | Space Grotesk font, #ede8df surface, gold #c5a059 accent |
| Currency | BHD (Bahraini Dinar) | **ALL amounts in integer fils** (1 BHD = 1000 fils). NO FLOATS FOR MONEY. |

---

## Critical Architecture Documents (READ THESE FIRST)

1. **`ARCHITECTURE.md`** — Single Source of Truth for schema, reducers, state machine, UI structure
2. **`docs/V4_V5_PARITY_MATRIX.md`** — Complete gap analysis between V4 and V5 with approach notes
3. **`features/BACKLOG.md`** — 48 features across 8 waves, 20 invariants, exit criteria per wave
4. **`decisions/`** — 9 Architecture Decision Records explaining WHY each choice was made

### ADRs You MUST Read Before Writing Code:
- **ADR004** (MoneyEvent Pattern) — outstanding is NEVER stored, ALWAYS computed. Phase 18 bug killed this in V4.
- **ADR009** (BHD in Fils) — all money as `BigInt` fils. `1000n` = 1 BHD. Float = instant reject.
- **ADR005** (AiAction Approval Gate) — AI proposes, human approves, system executes. No auto-execution for `explicit` skills.
- **ADR008** (Universal State Machine) — one transition reducer, not 6 separate machines.
- **ADR006** (Skills Architecture) — skills are composable atoms, not agent pipelines.

---

## What's Already Built (Waves 0-2 partial)

### Module (SpacetimeDB — `module/src/`)
- `index.ts` — Schema: 10 tables (Party, Pipeline, LineItem, MoneyEvent, PurchaseOrder, BankTransaction, AiAction, AiMemory, ActivityLog, ChatMessage)
- `milestone1_logic.ts` — Core reducers: manage_party, manage_pipeline, manage_line_item, manage_money_event, manage_purchase_order
- `memory_logic.ts` — AI memory CRUD reducers
- `auth_logic.ts` — STDB identity-based auth
- Tests: `milestone1.test.ts`, `memory.test.ts`, `auth_flow.test.ts`

### Client (Svelte 5 — `client/src/`)
- 7 hub pages (Dashboard, Party, Pipeline, Finance, Operations, Documents, Settings)
- Chat interface with Grok integration
- AI context builder (live STDB data in system prompt)
- PDF invoice generator (PH Trading letterhead, VAT, BHD)
- Living Geometry V4 design tokens applied
- STDB SDK wiring + reactive Svelte stores

### What's NOT Built Yet
See `docs/V4_V5_PARITY_MATRIX.md` for the complete gap analysis. Key remaining work:

**Wave 2 completion:** F014 (AiAction Approval Flow), F016 (Intent Routing)
**Wave 3 (Skills):** F017-F026 — 10 skills (query, create, chase, scan, OCR, Excel, PPTX, translate)
**Wave 4 (Intelligence):** F027-F032 — payment predictor, cashflow forecast, pricing, fraud detection
**Wave 5 (Documents):** F033-F038 — quotation PDF, statement, chase letter, PO PDF, Excel export, MVC checklist
**Wave 6 (Operations):** F039-F043 — operations hub, PO approval workflow, GRN, inventory
**Wave 7 (Security):** F044-F048 — RBAC, RLS, audit trail UI, multi-user conflict

**P1 Gaps from Parity Matrix (highest priority):**
- E+H XML basket parser (auto-costing from supplier pricing files)
- Bank reconciliation UI
- Tally Excel importer (critical for GCC market)
- Amount-in-words on PDFs ("Three Thousand Four Hundred Bahraini Dinars and Five Hundred Fils")
- Cash runway / survival intelligence widget
- Product markup rules in AI context (E+H=15%, Servomex=25%, etc.)

---

## 20 Invariants (NEVER VIOLATE)

These are non-negotiable. See `features/BACKLOG.md` for the full list. Top 5:

1. **Outstanding is NEVER stored** — always `sum(invoices) - sum(payments)` from MoneyEvent
2. **All BHD amounts in integer fils** — `BigInt`, no `float64`, no `number` for money
3. **Payment <= outstanding at write time** — atomic check inside reducer
4. **AiAction audit trail** — every AI action has proposedBy, approvedBy, executedAt, result
5. **Human approval before execution** — skills with `approval: 'explicit'` NEVER auto-execute

---

## Feature Contracts (Detailed Specs)

Three features already have full contracts with acceptance criteria, STDB layer specs, UI wireframes, and edge cases:

1. **`features/F014_ai_action_approval.md`** — The AiAction approval flow (proposed → approved → executed)
2. **`features/F021_skill_chase_payment.md`** — WhatsApp payment chase drafts by customer grade
3. **`features/F023_skill_ocr_document.md`** — Arabic + English OCR via Sarvam Vision

Use **`features/FEATURE_CONTRACT_TEMPLATE.md`** for any new features you spec.

---

## How to Work

### Build Commands
```bash
# Module (SpacetimeDB)
cd module && npm install && npm run build
spacetimedb publish asymm-flow  # deploys to maincloud

# Client
cd client && npm install && npm run dev

# Tests
cd module && npm test
```

### Workflow per Feature
1. Read the feature contract in `features/FXXX_*.md` (if it exists)
2. If no contract exists, read the wave description in `BACKLOG.md` + relevant audit doc
3. Schema changes go in `module/src/index.ts`, logic in `module/src/*_logic.ts`
4. Write tests in `module/src/*.test.ts` BEFORE implementation
5. Client components in `client/src/lib/` following existing patterns
6. Update feature status in `BACKLOG.md` when done

### Code Patterns
- **Reducers** are the transaction boundary — if a reducer throws, nothing commits
- **Skills** are TypeScript functions in `client/src/lib/skills/` — they call reducers
- **All amounts** display as `(fils / 1000).toFixed(3)` + " BHD" — conversion at display boundary ONLY
- **STDB Identity** is the actor — never trust client-supplied identity (`ctx.sender` is truth)
- **State transitions** go through the universal state machine — don't create per-entity transition logic

### Edge Cases to Always Consider (Abhie WILL test these)
- Zero-amount invoices/payments
- Arabic text in party names, addresses, notes
- Multi-currency scenarios (most are BHD but some suppliers invoice in USD/EUR)
- Concurrent users editing same record (STDB handles serialization, UI must show conflicts)
- Offline → reconnect (STDB SDK handles, but UI must recover gracefully)
- PDF generation with very long line items, very short line items, exactly 1 page, 2+ pages
- Negative edge: what happens when payment > outstanding? (reducer must reject)
- Empty state: new install with zero data — every screen must handle empty gracefully

---

## Reference Material

### Legacy V4 Code (for understanding business logic, NOT for copying)
`legacy_asymmflow_ph_holdings_reference_only/` — the old 156K LOC system. Use this to understand WHAT business logic is needed, but implement it the V5 way (STDB reducers + skills, not Go services).

### Audit Documents (deep domain analysis)
- `audit_finance.md` — invoicing, payments, bank recon, VAT, aging
- `audit_crm_pipeline.md` — opportunities, costing, offers, follow-ups
- `audit_operations.md` — POs, GRN, inventory, delivery
- `audit_security.md` — RBAC, RLS, audit trail
- `audit_intelligence.md` — AI skills, prediction, fraud detection
- `audit_unification.md` — cross-cutting concerns, the partial-monoid insight

---

## Success Criteria

When Abhie (the Kaizen SPOC) can:
1. Open the app, see his real business dashboard (outstanding, pipeline, overdue)
2. Chat with AI: "Chase all Grade C customers with overdue > 30 days" → AI proposes actions → Abhie approves → WhatsApp drafts generated
3. Scan a folder of supplier invoices → AI OCRs, extracts amounts, creates MoneyEvents
4. Generate any business document (invoice, quotation, statement, PO, chase letter) with correct letterhead and BHD formatting
5. See real-time updates when his team (8 people) work simultaneously
6. Export any report to Excel/PPTX
7. Have the system predict when a customer will pay based on history

...and when he tries every weird edge case his Kaizen brain can conjure and **nothing breaks** — then V5 is done.

---

**Om Lokah Samastah Sukhino Bhavantu** — May all beings benefit from simpler, more correct software. 🙏
