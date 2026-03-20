# AsymmFlow Reimagined — Implementation Roadmap & Agent Field Manual

**Created**: 2026-03-09 | **Status**: Living Document (update as waves complete)
**SSOT For**: All agents working on experiment 003-asymmflow-reimagined

---

## 0. Philosophy — The Ramanujan-Hamilton Compact

Every agent working on this codebase operates under two spirits:

**Ramanujan** (intuitive elegance): The simplest code that works IS the best code.
No abstractions for one-time operations. No helpers until the third use.
Three similar lines > one premature abstraction. If the code reads like a story,
it doesn't need comments.

**Margaret Hamilton** (production from day one): Every line ships.
No stubs, no TODOs, no "we'll wire this up later." If you write a button,
it calls a real reducer. If you write a table, it reads real stores.
The build must pass after every change. The app must work after every wave.

### The Rules (Non-Negotiable)

1. **MINIMAL CODE** — Write the least code that fully solves the task.
   - No docstrings on obvious functions
   - No type annotations the compiler can infer
   - No error handling for impossible states
   - No feature flags or backwards-compat shims

2. **PRODUCTION FROM LINE ONE** — Every component is wired to real data.
   - Buttons call real STDB reducers (named object args, not positional)
   - Tables read real Svelte stores (`$parties`, `$pipelines`, etc.)
   - AI calls go to real AIMLAPI endpoints
   - No mock data in components (seed.ts exists for that)

3. **BUILD MUST PASS** — After every file you touch, verify with `npx vite build`.
   - 0 errors, 0 warnings that break the build
   - If you introduced a `$derived(() => {...})()` IIFE pattern → FIX IT → use `$derived.by(() => {...})`

4. **ONE FILE, ONE OWNER** — When multiple agents run in parallel, each agent
   gets exclusive ownership of specific files. NEVER edit another agent's files.

5. **LIVING GEOMETRY** — Use the design tokens. No hardcoded colors, fonts, or spacing.
   - Colors: `var(--gold)`, `var(--sage)`, `var(--coral)`, `var(--ink-60)`
   - Fonts: `var(--font-display)` for headers, `var(--font-data)` for numbers
   - Spacing: `var(--sp-8)`, `var(--sp-13)`, `var(--sp-21)` (Fibonacci)
   - See `client/src/styles/tokens.css` for the full token set

---

## 1. What Exists (Completed Infrastructure)

### STDB Module — FULLY IMPLEMENTED ✅
**File**: `module/src/index.ts` (1,310 LOC)
- 10 tables with indexes
- 5 enums (EntityStatus, CustomerGrade, UserRole, AiActionStatus, MoneyEventKind)
- 10 reducers with FULL business logic:
  - `join_member` — first member auto-Admin, nickname uniqueness
  - `upsert_party` — grade-based credit defaults, role-gated
  - `upsert_contact` — party existence validation
  - `advance_pipeline` — state machine transitions, costing approval thresholds
  - `manage_order` — PO reference required, linked to pipeline
  - `manage_purchase_order` — financial immutability after Active
  - `record_money_event` — 10% VAT auto-calc, credit block, D-grade enforcement,
    payment-cannot-exceed-outstanding, digital root fraud flags
  - `log_activity` — free-form audit trail
  - `propose_ai_action` — AI skill proposals
  - `resolve_ai_action` — human approval gate (Admin/Manager only)
- Helpers: `digitalRoot()`, `amountFlag()`, `computeOutstanding()`, `computeOfferTotal()`,
  `requireMember()`, `requireRole()`
- **Published to**: `wss://maincloud.spacetimedb.com` as `asymm-flow`

### Client Infrastructure — COMPLETE ✅
| File | LOC | Purpose |
|------|-----|---------|
| `App.svelte` | 620 | Shell, sidebar, header, routing, toast |
| `lib/db.ts` | 174 | STDB connection, 10 table stores, sync |
| `lib/stores.ts` | 82 | Navigation, role derivations, toast |
| `lib/format.ts` | 187 | BHD currency, dates, digital root, colors |
| `lib/seed.ts` | 672 | 10 parties, 9 contacts, 5 pipelines, etc. |
| `styles/tokens.css` | 109 | Living Geometry design system |

### AI System — FUNCTIONAL ✅
| File | LOC | Purpose |
|------|-----|---------|
| `lib/ai/client.ts` | 433 | AIClient: streaming SSE, skill extraction |
| `lib/ai/context.ts` | 200+ | System prompt from live STDB state |
| `lib/ai/types.ts` | 50 | AIConfig, ChatMessage, AIResponse |
| `lib/skills/registry.ts` | 387 | 15 skills defined with approval levels |
| `lib/skills/types.ts` | 129 | SkillDefinition, SkillPlan, SkillResult |

### Pages — WIRED TO LIVE STDB ✅
| Page | Status | Data Source |
|------|--------|-------------|
| DashboardPage | ✅ Live | `$members`, `$pipelines`, `$moneyEvents`, `$activityLogs` |
| ChatPage | ✅ Live | AIClient streaming, buildSystemPrompt() |
| SettingsPage | ✅ Live | `$members`, AI config in localStorage |
| CRMHub | ✅ Live | `$parties`, `$contacts` |
| SalesHub | ✅ Live | `$pipelines`, `$orders`, `$nicknameMap` |
| FinanceHub | ✅ Live | `$moneyEvents` |
| OperationsHub | 🟡 Mock | Needs wiring to `$orders`, `$purchaseOrders` |
| OnboardingGate | ✅ Live | `joinMember` reducer |

### Module Bindings — AUTO-GENERATED ✅
- `module_bindings/types.ts` — All TypeScript types
- `module_bindings/index.ts` — DbConnection, reducers
- 10 table files + 10 reducer files

---

## 2. Implementation Waves

### ~~Wave 1~~ ✅ COMPLETE — App Shell + Page Stubs
### ~~Wave 2~~ ✅ COMPLETE — Onboarding, Seed Data, Dashboard, Chat Wiring
### ~~Wave 3~~ ✅ COMPLETE — Settings AI Config, CRM/Sales/Finance Wiring

### Wave 4 — Operations Hub + Create/Edit Modals (NEXT)

**Goal**: Wire OperationsHub to live STDB + add create/edit modals to hub pages
so users can actually CREATE entities, not just view them.

**Tasks**:
1. **OperationsHub wiring** — Wire to `$orders`, `$purchaseOrders`, `$lineItems`
   with party lookups. Replace mock data.
2. **Create Pipeline Modal** — Form to call `advance_pipeline` reducer (Draft status)
3. **Create Order Modal** — Form to call `manage_order` reducer
4. **Create Invoice Modal** — Form to call `record_money_event` (CustomerInvoice)
5. **Record Payment Modal** — Form to call `record_money_event` (CustomerPayment)
6. **Create Party Modal** — Form to call `upsert_party` reducer

**Reducer calling convention** (CRITICAL — agents MUST follow this):
```typescript
// CORRECT — single named object:
conn.reducers.recordMoneyEvent({
  partyId: BigInt(selectedPartyId),
  orderId: undefined,
  kind: { tag: 'CustomerInvoice' } as MoneyEventKind,
  subtotalFils: BigInt(Math.round(amount * 1000)),
  reference: invoiceRef,
  dueDate: Timestamp.fromDate(dueDate),
});

// WRONG — positional args:
conn.reducers.recordMoneyEvent(partyId, orderId, kind, subtotal, ref, due);
```

### Wave 5 — Approval Card + Skill Execution Pipeline

**Goal**: Complete the AI → approve → execute loop.

**Tasks**:
1. **ApprovalCard component** — Renders AI's proposed plan, approve/reject buttons
2. **Skill Executor** — Routes approved skills to execution functions
3. **SkillProgress component** — Shows step-by-step execution
4. **Wire chat to AiAction table** — Chat detects skill blocks → proposes via reducer
5. **Result rendering** — Show skill results in chat after execution

### Wave 6 — Document Generation (AI Gets Hands)

**Goal**: Generate real business documents from STDB data.

**Libraries to install** (all browser-compatible, zero Node.js deps):
- `pdfmake` (~3.7 MB) — Invoices, quotations, statements
- `exceljs` (~1.5 MB) — Financial reports, data exports
- `pptxgenjs` (~500 KB) — Client presentations
- `docxtemplater` + `pizzip` (~1.3 MB) — Word documents from templates

**Tasks**:
1. **Invoice PDF skill** — pdfmake renders invoice from MoneyEvent + LineItems
2. **Excel export skill** — ExcelJS exports any hub table to .xlsx
3. **Statement of Account** — pdfmake renders party's full financial history
4. **PowerPoint skill** — PptxGenJS generates pipeline presentation

**File I/O pattern** (when Neutralino is available):
```typescript
// Generate → Write → Open
const blob = pdfmake.createPdf(docDefinition).getBlob();
const arrayBuffer = await blob.arrayBuffer();
await Neutralino.filesystem.writeBinaryFile(savePath, arrayBuffer);
await Neutralino.os.open(savePath); // opens in default PDF viewer
```

### Wave 7 — Neutralino Desktop Integration

**Goal**: Package as .exe with file system access.

**Tasks**:
1. **neutralino-bridge.ts** — Wrap filesystem, os, clipboard APIs (~200 LOC)
2. **File picker integration** — Native open/save dialogs for document skills
3. **Folder watcher** — Auto-intake from `C:\AsymmFlow\inbox\`
4. **System tray** — Background notifications for overdue invoices
5. **Build .exe** — `neu build` for Windows distribution

### Wave 8 — Polish + Ship

**Goal**: Production-ready for PH Trading WLL.

**Tasks**:
1. **Morning Briefing** — AI reads state on app open, shows priority actions
2. **Keyboard shortcuts** — Ctrl+K (chat), Alt+1-7 (hubs)
3. **Data migration** — Import from legacy SQLite (AsymmFlow Phase 18)
4. **WhatsApp draft skill** — Generate chase messages per customer grade
5. **Responsive polish** — Mobile sidebar collapse, touch targets

---

## 3. STDB Gotchas — Mandatory Reading

Source: `experiments/001-ledger/STDB_LEARNINGS.md` (18 hard-won lessons)

### The Top 10 That Will Bite You

| # | Gotcha | Fix |
|---|--------|-----|
| 1 | **Client reducers need named object args** | `conn.reducers.join({ nickname: 'X' })` NOT positional |
| 2 | **Identity comparison with `===` always fails** | Use `String(a) !== String(b)` |
| 3 | **Enum format**: wire=`{"variant":{}}`, SDK=`{tag:"Variant"}` | Client sends `{ tag: 'Admin' }` |
| 4 | **`throw new Error()` = WASM panic = "fatal error"** | Error message is LOST on client side |
| 5 | **CLI/SDK/Generate versions must ALL match** | Both must be `spacetimedb@2.0.3` |
| 6 | **`withDatabaseName()` not `withModuleName()`** | SDK v2.0.3 naming inconsistency |
| 7 | **Register callbacks BEFORE subscribing** | `onInsert` before `subscribe()` |
| 8 | **No ORDER BY in STDB SQL** | Sort client-side in Svelte stores |
| 9 | **BigInt requires `n` suffix** | `0n`, `1000n`, `BigInt(value)` |
| 10 | **Optional fields = `undefined` not `null`** | STDB expects `undefined` for unset optionals |

### Svelte 5 Gotchas

| # | Gotcha | Fix |
|---|--------|-----|
| 1 | **`$derived(() => {...})()`** is WRONG | Use `$derived.by(() => {...})` for block bodies |
| 2 | **`$derived(expression)`** for simple expressions | `$derived($parties.filter(p => p.isCustomer))` |
| 3 | **`$state` for local mutable state** | `let x = $state(0)` |
| 4 | **Store access in .svelte files** | `$members` (auto-subscribed), NOT `members` |
| 5 | **Timestamp handling** | `import { Timestamp } from 'spacetimedb'` for STDB timestamps |

---

## 4. Reference File Paths

### This Project
```
C:\Projects\asymm-kit-factory\experiments\003-asymmflow-reimagined\
├── ARCHITECTURE.md              ← Design vision (SSOT)
├── IMPLEMENTATION_ROADMAP.md    ← THIS FILE (progress tracker)
├── module/src/index.ts          ← STDB schema + 10 reducers (1,310 LOC)
├── client/
│   ├── src/App.svelte           ← App shell + routing
│   ├── src/lib/db.ts            ← STDB connection + stores
│   ├── src/lib/stores.ts        ← Navigation + role derivations
│   ├── src/lib/format.ts        ← BHD, dates, colors
│   ├── src/lib/seed.ts          ← Reference seed data
│   ├── src/lib/ai/client.ts     ← AIClient (streaming SSE)
│   ├── src/lib/ai/context.ts    ← System prompt builder
│   ├── src/lib/skills/registry.ts ← 15 skill definitions
│   ├── src/styles/tokens.css    ← Living Geometry tokens
│   └── src/module_bindings/     ← Auto-generated STDB types
└── desktop/neutralino.config.json ← Neutralino desktop config
```

### Legacy PH Holdings (Port Business Logic From Here)
```
C:\Projects\ph-final\ph_holdings\
├── app.go                       ← Main backend (15,433 LOC) — margin thresholds at L12054-12093
├── business_invariants.go       ← Three-regime dynamics per grade
├── predictor.go                 ← Payment prediction (Markov chain)
├── costing_engine.go            ← Full cost build-up pipeline
├── invoice_pdf_service.go       ← PDF invoice template (964 LOC)
├── purchase_order_pdf_service.go ← PDF PO template
├── supplier_invoice_service.go  ← 3-way matching logic (969 LOC)
├── excel_costing_parser.go      ← Costing sheet parser (750+ LOC)
├── tally_importer.go            ← Tally ERP import (1,045 LOC)
├── CRITICAL_PH_CONTEXT_SSOT/
│   ├── PH_VISION_SSOT.md       ← Business vision
│   └── PH_TRADING_BUSINESS_REALITY_DOC.md ← Pricing, grades, invariants
└── frontend/src/lib/
    ├── screens/                 ← 50 Svelte screens (patterns to reference)
    └── components/              ← 104 Svelte components (patterns to reference)
```

### SpacetimeDB Repos (SDK Docs & Examples)
```
C:\Projects\spacetimedb_stuff\
├── SpacetimeDB/                 ← Core STDB repo
│   └── docs/                    ← Official docs (TypeScript SDK, auth, migrations)
├── spacetimedb-typescript-sdk/  ← TypeScript SDK source
└── (other repos)
```

### STDB Learnings
```
C:\Projects\asymm-kit-factory\experiments\001-ledger\
├── STDB_LEARNINGS.md            ← 18 hard-won gotchas (MANDATORY READING)
├── module/src/index.ts          ← Working ledger module (reference patterns)
└── desktop/                     ← Working Neutralino config
```

### Living Geometry Design System
```
C:\Projects\git_versions\asymm_all_math\asymm_mathematical_organism\
  geometric_consciousness_imaging\living_geometry\
├── 02_DESIGN_TOKENS.md          ← Full token spec (colors, fonts, spacing)
├── 06_chat_atelier.html         ← Chat UI reference
└── 07_runtime_full.html         ← 3-panel layout reference
```

### Asymmetrica Runtime (ERP Kernels)
```
C:\Projects\asymmetrica-runtime\
├── Asymmetrica.Kernels/Erp/     ← 14 ERP kernels (Invoice, Payment, Ledger, etc.)
└── Asymmetrica.Kernels/Intelligence/
    └── SarvamIntelligenceKernel.cs ← 7-mode Sarvam integration
```

---

## 5. Provider Configuration

| Provider | Base URL | Auth Header | Default Model |
|----------|----------|-------------|---------------|
| Grok | `https://api.aimlapi.com` | `Authorization: Bearer <key>` | `x-ai/grok-4-fast-non-reasoning` |
| Claude | `https://api.aimlapi.com` | `Authorization: Bearer <key>` | `claude-sonnet-4-5` |
| Sarvam | `https://api.sarvam.ai` | `api-subscription-key: <key>` | `sarvam-m` |

**AIMLAPI Key**: `bf395c42f717475798bdfdd56891c208`

---

## 6. Business Context (PH Trading WLL)

- **Location**: Bahrain
- **Industry**: Process instrumentation (E+H, Servomex, Yokogawa, GIC)
- **Currency**: BHD (3 decimal places, 1 BHD = 1000 fils)
- **VAT**: 10% (applied to customer invoices only)
- **Team**: 8 people, led by Abhie (Admin/SPOC)
- **Customer Grades**: A (45d pay, 7% max discount), B (90d, 3%), C (unpredictable, 0%), D (advance only)
- **Key Invariant**: "outstanding" is NEVER stored — always computed from sum(MoneyEvents)

---

## 7. Document Generation Stack (Wave 6 Reference)

| Document | Library | Browser? | Bundle | Arabic? |
|----------|---------|----------|--------|---------|
| PDF (invoices, statements) | pdfmake | ✅ Native | ~3.7 MB | Custom font needed |
| PDF (fill templates) | pdf-lib (@cantoo fork) | ✅ Native | ~1.1 MB | Manual |
| Word (.docx) | docxtemplater + pizzip | ✅ Native | ~1.3 MB | Template-based |
| Excel (.xlsx) | ExcelJS | ✅ Native | ~1.5 MB | Cell-level RTL |
| PowerPoint (.pptx) | PptxGenJS | ✅ Native | ~500 KB | Built-in RTL |
| Email (HTML) | mjml-browser + Handlebars | ✅ Native | ~580 KB | dir="rtl" |

---

## 8. Neutralino Capabilities (Wave 7 Reference)

| API | Key Methods | ERP Use |
|-----|-------------|---------|
| `filesystem` | readFile, writeFile, writeBinaryFile, readDirectory, createWatcher | Doc save, folder intake |
| `os` | execCommand, spawnProcess, showOpenDialog, showSaveDialog, showNotification, open | Print, email, alerts |
| `clipboard` | readText, writeText | Paste-to-parse |
| `window` | create, setTray, print | Multi-window, tray |
| `storage` | setData, getData | Settings persistence |

**Security**: `tokenSecurity: "one-time"`, API allowlist in neutralino.config.json.
**Limitation**: No Node.js runtime — all libraries must be browser-compatible.

---

## 9. Progress Log

Update this section as waves complete. Each entry = date + wave + outcome.

| Date | Wave | Outcome |
|------|------|---------|
| 2026-03-08 | Wave 1 | App shell, sidebar, header, page stubs, tokens.css, format.ts |
| 2026-03-08 | Wave 2 | OnboardingGate, seed.ts, DashboardPage wired, ChatPage wired |
| 2026-03-08 | Bug fix | STDB reducer calling convention (positional → named object) |
| 2026-03-08 | Bug fix | Svelte 5 `$derived.by` vs `$derived` IIFE pattern |
| 2026-03-09 | Wave 3 | SettingsPage AI config, CRMHub, SalesHub, FinanceHub wired |
| 2026-03-09 | Fix | Grok model name: `grok-3-fast` → `x-ai/grok-4-fast-non-reasoning` |
| 2026-03-09 | Research | 5 parallel agents: legacy audit, STDB deep dive, Neutralino, doc libs, current state |
| 2026-03-09 | Wave 4 | Create modals (Invoice, Payment, Party) wired to STDB reducers |
| 2026-03-09 | Data | Legacy PH Trading SQLite → 2,529 records seeded (379 parties, 535 contacts, 1615 money events) |
| 2026-03-09 | Wave 5 | Dashboard KPIs, chat persistence + sidebar, CRM search, Sales pipeline tabs, AI context fix, a11y |
| 2026-03-09 | Wave 6 | PDF invoice generator (pdfmake + PH letterhead + filsToWords), PDF button in FinanceHub |
| 2026-03-09 | Fix | Markdown renderer for chat bubbles (rich formatting, no more raw asterisks) |
| 2026-03-09 | Vision | VISION_ROADMAP.md — 7 superpowers, Document Genome, MVC Checklists, sprint plan |
| | Wave 7A | _(in progress — 6 parallel agents)_ |
| | Wave 7B | _(pending — integration + polish)_ |
| | Wave 7C | _(pending — persona storm QA)_ |
| | Wave 8 | _(pending — Neutralino desktop)_ |

---

## 10. Build Verification

After EVERY change, run:
```bash
cd "C:/Projects/asymm-kit-factory/experiments/003-asymmflow-reimagined/client"
npx vite build
```

Expected: `✓ 172+ modules transformed. ✓ built in ~3s. 0 errors.`

If it fails: FIX IT before reporting success. Common causes:
- `$derived(() => {...})()` IIFE → use `$derived.by(() => {...})`
- Missing import → add the import
- Type error → fix the type (read `module_bindings/types.ts` for correct shapes)

---

*"The ERP doesn't organize chaos. It holds the invariants.*
*The agents handle the chaos. The humans make the decisions."*

**Om Lokah Samastah Sukhino Bhavantu** 🙏
