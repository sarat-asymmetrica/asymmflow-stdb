# ADR001 — STDB over Traditional Backend (PostgreSQL + API Server)

**Status:** Decided
**Date:** 2026-03-08
**Deciders:** Commander (Sarat) + Claude

---

## Context

AsymmFlow V4 (the legacy system) is a Go + SQLite + Wails monolith at 156K LOC. The data layer is SQLite with manual GORM transactions, `BEGIN EXCLUSIVE` workarounds for race conditions, and a separate Go API layer handling business logic. Syncing between Abhie's desktop and any future mobile/web client requires a separate Supabase replication layer — another moving part.

The team is rebuilding this from scratch as "AsymmFlow Reimagined" targeting a radically smaller codebase (~15K LOC) with the same business capability. The data architecture choice sets the foundation for everything else.

Options considered:

| Option | Pro | Con |
|--------|-----|-----|
| PostgreSQL + Hono/Go API | Industry standard, mature tooling | Separate deployments (DB + API), manual auth, manual real-time via websockets or polling |
| SQLite + Sync (Turso/Libsql) | Edge-native, low latency | Still need API layer, sync conflicts, no multiplayer primitives |
| SpacetimeDB | Real-time multiplayer native, reducers = transactions, identity built-in | Newer platform, TypeScript SDK somewhat unstable |
| Firebase/Supabase | Managed, fast to start | Vendor lock-in, SQL-as-config is awkward for complex business rules |

---

## Decision

**Use SpacetimeDB (STDB) as the sole backend. No separate API server. No secondary database.**

---

## Rationale

### Arguments FOR STDB

1. **Real-time multiplayer is native, not bolted on.**
   Every table change propagates to all subscribed clients in <100ms via WebSocket push.
   Abhie on desktop, a salesperson on laptop, accountant at home — same numbers, same instant.
   Building this in PostgreSQL requires PostgreSQL LISTEN/NOTIFY, an API layer translating those
   to WebSocket connections, and client-side state management. STDB gives it for free.

2. **Reducers ARE transactions.**
   In the legacy system, `business_invariants.go` defines 23 invariant assertions — and
   `ValidateAll()` is never called in production paths. Invariants are documentation, not enforcement.
   In STDB, a reducer that throws = zero DB writes. The invariant check IS the reducer. This is
   the Phase 18 lesson: if the invariant isn't enforced in the write path, it will be violated.

3. **Identity and RBAC are built-in.**
   Every reducer receives `ctx.sender` — the cryptographic identity of the caller.
   No JWT, no session management, no auth middleware. `ctx.sender` IS auth.

4. **One deployment target instead of two (or three).**
   `spacetimedb publish` deploys the module. The client connects via SDK.
   No Docker, no PM2, no Nginx reverse proxy, no managed API layer. One thing to deploy.

5. **Pattern proven by 001-Ledger and Rythu Mitra.**
   Both prior experiments (family expense tracker and farmer platform) used STDB successfully.
   The STDB gotchas are documented in `001-ledger/STDB_LEARNINGS.md`. We've paid the learning
   curve. Applying that knowledge here gives us a head start.

### Arguments AGAINST (risks we accept)

1. **SpacetimeDB is newer platform.** API can change. The TypeScript SDK has had breaking changes.
   - Mitigation: Pin SDK version. The schema is in a standalone `schema.ts` — the table
     definitions are language-agnostic. If STDB were to fail, the schema migrates to PostgreSQL
     with a weekend of work.

2. **Complex queries require subscription composition.**
   STDB subscriptions are per-table or per-query pattern. Complex JOIN-style aggregations
   require client-side composition or server-side Views.
   - Mitigation: The 10-table schema was designed specifically to minimize joins (Party unification,
     MoneyEvent pattern). Views handle the common aggregations (outstanding, overdue count).

3. **TypeScript module, not Rust.**
   TypeScript STDB modules are slightly more overhead than Rust. For a trading company ERP
   (not a gaming server), this is irrelevant — the bottleneck will never be reducer throughput.

---

## Consequences

- **F001 (STDB Schema):** Module is the entire backend. 10 tables, 10 reducers, views.
- **F002 (Neutralino Shell):** Client connects via `@clockworklabs/spacetimedb-sdk`. No API calls.
- **F003 (STDB Wiring):** One connection object. Svelte stores subscribe to STDB tables directly.
- **All Features:** Business logic lives in reducers, not in a service layer.
- **Fallback:** If STDB proves unreliable in production, extract reducer logic to a Hono API.
  The reducer signatures become route signatures — one week of rework.

---

## References

- `ARCHITECTURE.md` §3 — STDB schema (10 unified tables)
- `ARCHITECTURE.md` §4 — Universal state machine (8 reducers)
- `001-ledger/STDB_LEARNINGS.md` — Gotchas from prior STDB work
- `audit_finance.md` — Ramanujan+Hamilton analysis that motivated the MoneyEvent pattern
- `audit_unification.md` — Mirzakhani+Grothendieck analysis that reduced 17 tables to 10
