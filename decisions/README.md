# AsymmFlow STDB — Architecture Decision Records

**Format:** Lightweight ADR (Context → Decision → Rationale → Consequences)
**Numbering:** ADR001, ADR002, ... (sequential, never reuse a number)
**Status values:** `Proposed` | `Decided` | `Deprecated` | `Superseded by ADR00X`

---

## How to Write an ADR

Every significant architectural decision gets an ADR. "Significant" means:
- You can't easily reverse it later without substantial rework
- It affects more than one feature
- Someone on the team might reasonably have chosen differently

### Template

```markdown
# ADRXXX — [Short Title]

**Status:** [Proposed | Decided | Deprecated]
**Date:** YYYY-MM-DD
**Deciders:** Commander (Sarat) + Claude

---

## Context

[Why is this decision needed? What's the problem, the forces in tension?]

## Decision

[The decision in one sentence.]

## Rationale

[Why this option over alternatives? What did we consider and reject?]

## Consequences

[What becomes easier? What becomes harder? What are we accepting?]

## References

[Links to relevant docs, audit files, prior art]
```

---

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [ADR001](ADR001_stdb_over_traditional_backend.md) | STDB over Traditional Backend | Decided |
| [ADR002](ADR002_neutralino_over_wails.md) | Neutralino over Wails + Electron | Decided |
| [ADR003](ADR003_unified_party_schema.md) | Unified Party Schema (Customer + Supplier) | Decided |
| [ADR004](ADR004_money_event_pattern.md) | MoneyEvent Pattern (outstanding never stored) | Decided |
| [ADR005](ADR005_ai_action_approval_gate.md) | AiAction Approval Gate | Decided |
| [ADR006](ADR006_skills_architecture.md) | Skills Architecture | Decided |
| [ADR008](ADR008_universal_state_machine.md) | Universal State Machine | Decided |
| [ADR009](ADR009_bhd_fils_arithmetic.md) | BHD in Integer Fils | Decided |
| [ADR010](ADR010_chat_first_ui.md) | Chat-First UI | Decided |
