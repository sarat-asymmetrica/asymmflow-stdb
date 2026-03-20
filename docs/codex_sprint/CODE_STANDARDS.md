# Code Standards — AsymmFlow V5 Codex Sprint

**Effective**: March 10, 2026
**Applies to**: All code written during the V4→V5 parity sprint

---

## 1. Production Code From Line One

Every line of code written in this sprint ships to production. There are no "prototype" passes.

- No TODO comments that defer real work
- No stub functions that return hardcoded values
- No `console.log` debugging left in committed code
- No `any` types in TypeScript (use proper types or `unknown` with narrowing)
- No disabled lint rules without a comment explaining why

---

## 2. Architecture Rules

### 2.1 STDB Module (`module/src/index.ts`)

**Single file**: All tables, enums, and reducers live in `index.ts`. This is by design — STDB compiles the module as one unit.

**Table design principles**:
- Use the unified pattern: `Party` (not separate Customer/Supplier tables), `MoneyEvent` (not separate Invoice/Payment tables)
- Discriminate with enums: `MoneyEventKind`, `BankMatchStatus`, etc.
- All monetary values in `fils` (bigint) — 1 BHD = 1000 fils. Column name suffix: `Fils`
- All percentages in basis points (u32) — 1% = 100 bps. Column name suffix: `Bps`
- Timestamps use STDB's `Timestamp` type
- Every table gets `createdAt: Timestamp`

**Reducer design principles**:
- Reducers are the ONLY way to mutate state (STDB enforces this)
- Every reducer must call `requireMember(ctx)` to identify the actor
- Every mutation must log to `activityLog` table
- Validate ALL business rules server-side (client-side is for UX, not security)
- Use `ctx.timestamp` for all time values (deterministic replay)

**Naming conventions**:
```typescript
// Tables: camelCase Row suffix
@table({ name: "delivery_note", public: true })
class deliveryNoteRow { ... }

// Enums: PascalCase
enum DeliveryStatus { Draft = "Draft", Dispatched = "Dispatched", ... }

// Reducers: snake_case verbs
@reducer("create_delivery_note")
static createDeliveryNote(ctx: ReducerContext, ...) { ... }

// Indexes: table_column pattern
@index({ btree: columns: ["orderId"] })
```

### 2.2 Svelte Frontend (`client/src/`)

**Component organization**:
```
lib/
  components/   # Reusable UI (Button, Modal, DataTable, etc.)
  pages/        # Hub pages (one per nav item)
  ai/           # AI client, context builder
  skills/       # Skill registry, executor
  documents/    # PDF/Excel generators
  business/     # Business rules, invariants
  chat/         # Chat UI components and stores
  db.ts         # STDB subscription stores
  stores.ts     # App-level stores (navigation, toasts)
  format.ts     # Display formatting (BHD, dates, %)
```

**Svelte 5 patterns**:
- Use `$state()` and `$derived()` runes (not legacy `$:` reactive)
- Use `{#snippet}` blocks for reusable template fragments
- Props via `let { prop1, prop2 } = $props()`
- Events via callback props (not `createEventDispatcher`)

**Styling**:
- Design tokens from Living Geometry (Fibonacci spacing, phi ratios)
- Colors: paper/ink/gold/sage/coral/stone palette
- No Tailwind — use semantic CSS custom properties
- Fonts: Cinzel (headings), Lora (body), Outfit (UI labels), Courier Prime (amounts)

### 2.3 Business Logic

**The Outstanding Invariant** (CRITICAL):
```
Outstanding = SUM(CustomerInvoice totals) - SUM(CustomerPayment totals)
```
Outstanding is NEVER stored. It is ALWAYS computed. Storing it caused Phase 18's worst bug in V4.

**Grade-based policies** (hardcoded in `lib/business/invariants.ts`):
- Grade A: 45-day terms, 7% max discount, no advance
- Grade B: 90-day terms, 3% max discount, no advance
- Grade C: Cash only, 0% discount, 50% advance
- Grade D: Cash only, 0% discount, 100% advance

**State machine transitions** (universal for all entities):
```
Draft → Active → InProgress → Terminal
                            → Cancelled
```
Terminal and Cancelled are absorbing states. No entity can leave them.

---

## 3. Testing Requirements

### 3.1 Every Feature Gets Tests

No feature is complete without tests. Period.

**STDB Module tests** (`module/src/__tests__/` or inline):
- Every reducer: happy path + at least 2 error cases
- Business rule enforcement: grade limits, credit checks, state transitions
- Invariant preservation: outstanding computation, VAT calculation

**Svelte component tests** (if applicable):
- Rendering with mock data
- User interaction (click, type, select)
- Edge cases (empty state, error state, loading state)

### 3.2 Test Result Documentation

After running tests, document results in the parity map:
```markdown
| Test | Result | Duration | Notes |
|------|--------|----------|-------|
| create_delivery_note happy path | PASS | 12ms | |
| create_delivery_note missing order | PASS | 8ms | Returns error |
| create_delivery_note duplicate DN# | PASS | 9ms | Sequence prevents |
```

### 3.3 Manual Verification Checklist

For UI features, document what was manually verified:
- [ ] Renders correctly with seed data
- [ ] Handles empty state gracefully
- [ ] BHD amounts display with 3 decimal places
- [ ] State transitions update UI in real-time (STDB subscription)
- [ ] Role-based visibility works (hide from unauthorized roles)

---

## 4. Compilation & Build Verification

### 4.1 STDB Module

```bash
# MUST pass before marking any task complete
cd module
spacetime generate --lang typescript --out-dir ../client/src/lib/stdb_generated
spacetime build
```

If `spacetime build` fails, the task is NOT done.

### 4.2 Svelte Client

```bash
# MUST pass before marking any task complete
cd client
npm run build    # Vite production build
npm run check    # Svelte type checking (if configured)
```

Zero TypeScript errors. Zero Svelte warnings on build.

### 4.3 Publish (HANDOFF TO COMMANDER)

```bash
# This requires interactive terminal — DO NOT run autonomously
spacetime publish asymm-flow --server maincloud --delete-data
```

When a STDB schema change needs publishing, create a handoff note:
```markdown
## HANDOFF: Schema publish needed
**Reason**: Added deliveryNote table + reducers
**Command**: `cd module && spacetime publish asymm-flow --server maincloud --delete-data`
**Breaking changes**: None (additive only) / Yes (use --delete-data, mock data can be re-seeded)
```

---

## 5. Documentation Standards

### 5.1 Parity Map Updates

After completing each item, update `PARITY_MAP.md`:
1. Check the box: `- [ ]` → `- [x]`
2. Add completion timestamp
3. Add test results summary
4. Note any deviations from V4 behavior (intentional simplifications)

### 5.2 Code Comments

- DO add comments for business rules that aren't obvious
- DO add comments explaining WHY a validation exists
- DO NOT add comments that restate what the code does
- DO NOT add JSDoc to every function (only exported APIs)

```typescript
// GOOD: Business rule comment
// Grade C/D customers require advance payment before invoicing.
// This prevents credit exposure on historically unreliable payers.
if (grade === 'C' || grade === 'D') { ... }

// BAD: Restating the code
// Check if grade is C or D
if (grade === 'C' || grade === 'D') { ... }
```

---

## 6. Git Discipline

### 6.1 Commit Messages

Format: `feat|fix|refactor|test|docs(scope): description`

```
feat(stdb): add delivery_note table and create_delivery_note reducer
fix(finance): correct VAT calculation for partial invoices
test(stdb): add 8 tests for delivery note lifecycle
docs(parity): mark 1.3 Delivery Notes complete
```

### 6.2 Commit Granularity

One logical change per commit. NOT:
- "implement delivery notes, GRN, and fix invoice bug" (too broad)
- "add field" / "add another field" / "fix typo" (too granular)

### 6.3 No Force Pushes

Ever. If you mess up, create a new commit to fix it.

---

## 7. Performance Budgets

- STDB reducer execution: < 10ms per call
- Svelte page render (with data): < 100ms
- PDF generation: < 2 seconds
- No N+1 query patterns (use STDB table scans with filters, not loops)

---

## 8. Pace Measurement Protocol

At the START of each milestone:
```bash
date "+%Y-%m-%d %H:%M:%S"  # Record start time
```

At the END of each milestone:
```bash
date "+%Y-%m-%d %H:%M:%S"  # Record end time
```

Log in `SPRINT_LOG.md`:
```markdown
## Milestone 1: Core Tables & Reducers
- Started: 2026-03-10 04:30:00
- Completed: 2026-03-10 06:15:00
- Duration: 1h 45m
- Items completed: 4/4
- Tests passing: 12/12
- Build status: CLEAN
```

---

## 9. Handoff Protocol

### To Commander (Interactive Operations)
When you need Commander's terminal:
```markdown
## HANDOFF REQUEST
**What**: spacetime publish / npm deploy / API key configuration
**Why**: Schema changed, needs republish to maincloud
**Command(s)**:
  1. `cd module && spacetime publish asymm-reimagined --server maincloud`
  2. Verify: `spacetime logs asymm-reimagined --server maincloud`
**Blocking**: Yes — next milestone depends on new schema being live
```

### Clarification Requests
When business logic is ambiguous:
```markdown
## CLARIFICATION NEEDED
**Context**: Implementing delivery note partial delivery
**Question**: Can a single order have multiple delivery notes to different addresses?
**V4 behavior**: Yes — delivery_notes has `delivery_address` field per DN
**Proposed V5**: Same — add `deliveryAddress` to deliveryNote table
**Blocking**: Milestone 2, item 2.1
```

Commander is always at the terminal. Ask immediately, don't guess.

---

## 10. File Paths Reference

### V4 Legacy (READ ONLY — never modify)
```
legacy_asymmflow_ph_holdings_reference_only/
  app.go                          # Main controller (11K+ LOC)
  database.go                     # 84 GORM models
  business_invariants.go          # Grade policies, costing rules
  *_service.go                    # Domain services (35 files)
  *_pdf_service.go                # PDF generators
  frontend/src/lib/screens/       # 50 Svelte pages
  frontend/src/lib/components/    # 100+ components
  CRITICAL_PH_CONTEXT_SSOT/       # Business context docs
```

### V5 Target (WRITE HERE)
```
module/src/index.ts               # STDB tables + reducers
client/src/lib/components/        # Reusable UI
client/src/lib/pages/             # Hub pages
client/src/lib/skills/            # AI skill definitions
client/src/lib/documents/         # PDF/Excel generators
client/src/lib/business/          # Business rules
client/src/lib/db.ts              # STDB stores
```

---

*Production code. Tested code. Documented code. That's the standard.*
