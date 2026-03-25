# FXXX — [Feature Name]

**Status:** [📋 Specced | 🔨 Building | ✅ Live | ⏸️ Blocked]
**Wave:** [0=Foundation | 1=Core Loop | 2=Chat | 3=Skills | 4=Intelligence | 5=Documents | 6=Operations | 7=Security]
**Owner:** Commander + Claude
**Created:** YYYY-MM-DD

---

## 0. Philosophy

> [One sentence on why this feature matters to Abhie's actual work. Not technical rationale — business rationale.]

---

## 1. User Story

As **[Abhie | the system | a sales rep | the accountant]**,
I want to **[what they want to do]**,
so that **[the business outcome]**.

---

## 2. Acceptance Criteria

Format: AC1, AC2, ... — each is binary (pass/fail, not "kinda works").
When all ACs pass, the feature is done. No partial credit.

- [ ] AC1: [specific, testable criterion]
- [ ] AC2: [specific, testable criterion]
- [ ] AC3: [specific, testable criterion]

---

## 3. Full-Stack Contract

### 3a. STDB Layer (Schema changes, reducers, views)

If this feature requires schema changes or new reducers, specify them here.
If Wave 0 covered everything needed, write "No schema changes — uses existing reducers."

```typescript
// New/changed tables:
// New/changed reducers:
// New/changed views:
```

### 3b. Skill Layer (if this feature includes a Skill)

```typescript
interface [SkillName]Args {
  // What the skill takes as input
}

interface [SkillName]Result {
  // What the skill returns
}

// Approval: auto | explicit | admin_only
// Category: data | file | intelligence | communication
```

### 3c. Client Layer (Svelte components, stores, routing)

New components, modified components, store subscriptions needed.

### 3d. Neutralino Layer (if this feature uses file system)

Which Neutralino APIs are called and what they return.

### 3e. AI Layer (system prompt changes, intent routing)

If this feature changes how the AI understands requests or builds context.

---

## 4. Dependencies

- **Requires:** [F0XX, F0XX] — what must be live before this can build
- **Blocks:** [F0XX, F0XX] — what cannot start until this is live

---

## 5. Invariants This Feature Must Respect

List the BACKLOG.md invariants that apply to this feature.
Any feature touching money MUST list INV-01 through INV-07 at minimum.

- INV-XX: [name]
- INV-XX: [name]

---

## 6. Architecture Notes

Decisions, tradeoffs, and patterns that are specific to this feature.
Reference relevant ADRs.

---

## 7. Test Plan

List what needs to be verified before this feature is marked ✅ Live.

- [ ] [Specific test: happy path]
- [ ] [Specific test: edge case]
- [ ] [Specific test: invariant check]
- [ ] [Specific test: error handling]

---

## 8. Session Log

| Date | Session | What Happened | Next Step |
|------|---------|---------------|-----------|
| YYYY-MM-DD | Spec | Created contract | Build |
