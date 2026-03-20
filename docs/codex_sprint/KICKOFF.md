# Codex Sprint Kickoff — AsymmFlow V4→V5 Parity

**Read this first. Then read the other docs in order.**

---

## What You're Doing

You are porting business capabilities from AsymmFlow V4 (156K LOC, Go + Svelte + SQLite) to AsymmFlow V5 (7,230 LOC, SpacetimeDB + Svelte 5). The V4 code is in this repo at `legacy_asymmflow_ph_holdings_reference_only/` — it is READ-ONLY reference. You write code ONLY in the V5 codebase.

This is a real production system for **PH Trading WLL** (Bahrain, process instrumentation, 8-person team). The code you write ships to a real customer.

---

## Reading Order

1. **This file** (you're here)
2. **`PARITY_MAP.md`** — The work order. 32 items across 6 milestones. Your checklist.
3. **`CODE_STANDARDS.md`** — How to write code. Naming, testing, build verification, git discipline.
4. **`SPRINT_LOG.md`** — Where you record timing, test results, and milestone proposals.
5. **`../../ARCHITECTURE.md`** — The V5 architecture (paradigm, schema design, skills system).
6. **`../../module/src/index.ts`** — The current STDB schema (tables, enums, reducers). START HERE for code.
7. **`../../client/src/lib/business/invariants.ts`** — Business rules (grade policies, costing, validation).

---

## Your Workflow Loop

```
FOR each milestone:
  1. Run: date "+%Y-%m-%d %H:%M:%S"  → record in SPRINT_LOG.md
  2. FOR each item in milestone:
     a. Read V4 reference files listed in PARITY_MAP.md
     b. Implement in V5 (module/src/index.ts for STDB, client/src/ for UI)
     c. Compile: spacetime build (module) AND/OR npm run build (client)
     d. Test: write tests, run them, record results
     e. Check box in PARITY_MAP.md, add completion timestamp
  3. Run: date "+%Y-%m-%d %H:%M:%S"  → record completion in SPRINT_LOG.md
  4. Run final build: spacetime build && cd client && npm run build
  5. Paste build output in SPRINT_LOG.md
  6. Propose next 5 items for Commander review
  7. STOP. Wait for Commander sign-off before next milestone.
```

---

## Handoff Points (STOP and ask Commander)

These operations require Commander's interactive terminal:

| Operation | When | Why |
|-----------|------|-----|
| `spacetime publish` | After schema changes | Deploys STDB module to maincloud |
| API key configuration | Milestone 5 (Resend) | Commander provides keys |
| `npm run dev` for visual testing | After UI changes | Commander checks in browser |
| Any destructive operation | Always | Commander approves |

When you need a handoff, write a clear block in SPRINT_LOG.md:

```markdown
## HANDOFF REQUEST
**What**: [operation]
**Command**: [exact command to run]
**Why**: [what depends on this]
**Breaking**: [Yes/No]
```

---

## Clarification Protocol

Commander is ALWAYS at the terminal. If you're unsure about:
- Business logic (how does PH Trading handle X?)
- Architecture decisions (should this be a new table or extend existing?)
- Priority (should I skip this item and do something more important?)

Ask immediately. Don't guess. Write:

```markdown
## CLARIFICATION NEEDED
**Item**: [parity map item ID]
**Question**: [specific question]
**V4 behavior**: [what V4 does, from reading the reference]
**My proposal**: [what you'd do if no answer]
```

---

## Build Commands

```bash
# STDB Module (Rust/TypeScript → Wasm)
cd module
spacetime build                    # Must pass — zero errors
spacetime generate --lang typescript --out-dir ../client/src/lib/stdb_generated

# Svelte Client
cd client
npm run build                      # Vite production build — zero errors
npm run check                      # Type checking (if configured)

# Development (HANDOFF — Commander runs this)
cd client
npm run dev                        # Local dev server

# Publishing (HANDOFF — Commander runs this)
# IMPORTANT: Database name is "asymm-flow" (NOT "asymm-reimagined")
# During dev, breaking schema changes are OK with --delete-data (mock data, can re-seed)
cd module
spacetime publish asymm-flow --server maincloud --delete-data
```

---

## Key Business Context (PH Trading WLL)

- **Location**: Bahrain
- **Currency**: BHD (Bahraini Dinar), 3 decimal places, stored as fils (1 BHD = 1000 fils)
- **VAT**: 10% (effective 2025)
- **Team size**: 8 people
- **Business**: Process instrumentation (flow meters, level sensors, pressure gauges, temperature instruments)
- **Key OEMs**: E+H, Servomex, GIC India, Hengesbach, others
- **Customer grading**: A (best payers) → D (highest risk), determines terms + credit + advance requirements
- **Unique moat**: TallyPrime integration (connects to 7M+ Indian SMBs) — NOT in scope for this sprint
- **SPOC**: Abhie (sales + operations, wants AI that says "no" when numbers are bad)

---

## What "Done" Looks Like

At the end of this sprint:

1. A PH Trading employee can: create a quotation → win it → create order → deliver partially → invoice → receive payment → see updated outstanding — ALL through the chat interface or hub pages
2. PDFs look professional: company letterhead, all fields populated, VAT calculated, totals in words
3. Bank statements can be imported and reconciled
4. Every action is logged (who did what, when)
5. Role-based access prevents unauthorized operations
6. AI understands the full business state and can answer questions, generate documents, and propose actions

---

*Now go read PARITY_MAP.md and start Milestone 1. Good luck!*
