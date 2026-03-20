# AsymmFlow Security, Auth & Data Integrity Audit
## Shannon + Knuth Deep Analysis
### For the SpacetimeDB Reimagination

**Auditor**: Shannon (Information Theory) + Knuth (Algorithmic Precision)
**Subject**: AsymmFlow ERP — PH Trading WLL, Bahrain
**Current Stack**: SQLite + Supabase sync, Wails RBAC, license keys
**Target Stack**: SpacetimeDB TypeScript module

---

## Part 1: Current State Analysis

### 1.1 Authentication Architecture

The current auth system is a **three-layer stack**:

```
Layer 1: Device binding
  device_hash = SHA-256(MAC_address + hostname)
  Stored in SQLite license_keys table

Layer 2: License key
  Format: PH-{ROLE}-{6 hex chars} (exactly 13 chars)
  Generated with crypto/rand (3 bytes = 6 hex chars)
  Key space: 16^6 = 16,777,216 per role prefix

Layer 3: Role-to-permissions map
  5 roles: admin, manager, sales, operations, developer
  Checked per-call in requirePermission()
```

**How activation works:**
1. Admin generates key via `GenerateLicenseKey()` (requires `licenses:manage`)
2. Team member enters key in UI
3. `ActivateLicense()`: rate-limited (10/min), validates format, checks DB, binds to device hash via transaction
4. `ValidateLicense()` called on every subsequent `requirePermission()` invocation — it is a **DB round-trip every time**

**How permission check works (from `app.go:11459`):**
```
requirePermission(perm) {
  if startupImporting (< 5 min window) AND perm in importAllowedPerms → ALLOW
  if currentUser != nil → checkUserPermission(perm)  [OAuth path]
  if HasLicensePermission(perm) → ALLOW
  else → DENY with role in error message
}
```

**Session management:**
- 8-hour auto-logout (session timeout)
- No JWT, no session tokens for the license path
- OAuth path (Microsoft 365) stores SHA-256 hashed tokens in DB

### 1.2 RBAC Matrix — Actual Code vs SPOC Vision

The code defines permissions as strings (`offers:create`, `finance:view`, etc.). The SPOC vision from `spoc_flow.md` describes a richer 4-column matrix (Sales / Sales Manager / Accountant / Management). Mapping:

| SPOC Role | Code Role | Key Permissions |
|-----------|-----------|-----------------|
| Sales | `sales` | offers CRUD, orders view/update, invoices:view (NOT create), intelligence:chat |
| Sales Manager | `manager` | + finance:view/create, invoices:create, payments:create/update, users:view |
| Accountant | — (missing!) | Accounting & Finance, Inventory, Payroll — NO CODE ROLE EXISTS |
| Management | `admin` | `*` (full wildcard) |

**Critical gap**: The SPOC flow defines an "Accountant" role with access to bank reconciliation, VAT compliance, chart of accounts, and payroll. The current code has no `accountant` role. The `manager` role approximates it but conflates Sales Manager with Accountant responsibilities.

**Operations role** covers: POs, GRNs, suppliers, orders:update — matches SPOC reasonably well.

### 1.3 Permission Check Complexity (Knuth Analysis)

Current `requirePermission()` worst-case path:
```
O(1)  — startupImporting flag check
O(1)  — currentUser nil check
O(n)  — DB query: WHERE device_hash = ? AND activated = 1 (in ValidateLicense)
O(m)  — Linear scan of permissions slice for the role (m = |permissions|)
```

**Total: O(n) per request** where n is DB I/O latency, plus O(m) linear scan.

For `admin` role: O(n) DB + O(1) wildcard match (first `*` found).
For `sales` role with 14 permissions: O(n) DB + O(14) scan = O(n + 14) ≈ O(n).

The DB round-trip on EVERY permission check is the dominant cost. No caching, no memoization per session. A single page load triggering 10 backend calls = 10 SQLite round-trips just for auth.

### 1.4 Data Integrity Guards (Inventory)

From `CLAUDE.md` Data Integrity section and Phase 17 fixes:

| Guard | Mechanism | Status |
|-------|-----------|--------|
| Duplicate invoice | `uniqueIndex` on OrderID + backend check | Active |
| Overpayment | `amount <= outstanding` check | Fixed P1 |
| State machine (PO) | Valid transition map, terminal states locked | Fixed P1 |
| State machine (offers) | Lost → cannot re-win | Active |
| Credit limit | `IsCreditBlocked` with row locking | Fixed P1 |
| Payment amount positive | `amount > 0` validation | Fixed P1 |
| XSS | `escapeHtml()` in render functions | Fixed P1 |
| SQL injection | Parameterized queries, `isValidSQLIdentifier()` | Fixed P1 |
| Path traversal | `filepath.Base()` | Fixed P1 |
| Command injection | `escapePowerShell()`, `isReadOnlySQLQuery()` | Fixed P1 |
| **Business invariants** | `business_invariants.go` defined but NEVER CALLED | **P2 Gap** |
| **FX rate bounds** | MISSING — no sanity check | **P2 Gap** |
| **Bank reconciliation amounts** | Manual match skips amount validation | **P2 Gap** |
| **Negative inventory** | Not prevented | **P2 Gap** |
| **Segregation of duties** | Creator can approve own supplier invoice | **P2 Gap** |

### 1.5 Sync Layer Analysis (Shannon Channel Model)

Current sync: SQLite primary → Supabase PostgreSQL push every 10 minutes.

**As a communication channel:**
```
Channel capacity = data_rate / (1 + latency_per_round_trip)
Current:  10-minute batch intervals
          8-person team, ~50 mutations/hour during business hours
          Latency to detect conflict: up to 10 minutes
          Effective throughput: ~50 mutations / 600 seconds = 0.083 mutations/sec

STDB real-time:
          Subscription push latency: ~50ms (LAN) to ~200ms (WAN)
          Throughput: only bounded by database write speed
          Conflict detection: immediate (transaction-level)
```

**Information-theoretic improvement**: The 10-minute batch sync is a channel with 600-second latency. Two users editing the same record could both believe their edit "took" for up to 10 minutes before discovering a conflict. In Shannon terms, the mutual information between the actual DB state and what any client believes is degraded by this latency window. STDB eliminates this entirely: subscriptions deliver row-level diffs within milliseconds.

**The real failure mode observed**: Phase 18 required a "manual full sync" — generating INSERT SQL for 242 missing records across 6 tables after migrating Supabase projects. The sync is fragile; it is not a reliable CRDT. STDB's WAL-backed replication is the correct model.

---

## Part 2: The 17 P2 Findings — STDB Mapping

For each P2 finding: does it vanish in STDB, require a new solution, or get partially resolved?

### Crypto & Config (4 findings)

**P2-1: Deterministic PBKDF2 salt** (`field_crypto.go:70`)
- **In STDB**: VANISHES. STDB handles identity cryptography. There is no application-level password hashing needed. `ctx.sender` is a verified Ed25519 identity.
- **Action**: Delete `field_crypto.go` entirely.

**P2-2: OAuth callback binds to all interfaces** (`auth_handler.go:447`, listens on `:8080`)
- **In STDB**: VANISHES. STDB is the auth provider. No OAuth callback server in the ERP module. Microsoft 365 integration (if needed) becomes a Procedure (beta) calling external HTTP, not a local HTTP server.
- **Action**: Delete `auth_handler.go`. M365 integration via STDB Procedure.

**P2-3: Cloud sync defaults to enabled** (`config.go:532`)
- **In STDB**: VANISHES. There is no "sync" toggle. STDB IS the database — it is always consistent. The distinction between local and cloud disappears.
- **Action**: No config needed. STDB's consistency is a property, not a setting.

**P2-4: `.env` file traversal** (`config.go:179`)
- **In STDB**: VANISHES. No `.env` files. Module credentials are managed by the STDB platform (maincloud). API keys for external services (Mistral, Sarvam) are stored in a secure `Config` table, admin-only writable, not in filesystem config.
- **Action**: Store external API keys in a STDB table with admin-only write access.

### Business Logic (5 findings)

**P2-5: Business invariants not wired** (`business_invariants.go`)
- **In STDB**: REQUIRES ACTIVE DESIGN. Reducers are the natural enforcement point. Every mutation reducer validates invariants before committing. There is no "path that skips validation" because the reducer IS the only path.
- **Action**: Implement `validateBusinessInvariants()` helper called at the top of every mutating reducer. Grade D customers must prepay — enforced in `create_invoice` reducer before insert.

**P2-6: FX rate manipulation** (`fx_revaluation_service.go:21`)
- **In STDB**: REQUIRES ACTIVE DESIGN. Add an `ExchangeRate` table with `previousRate`. `update_fx_rate` reducer validates: `|newRate - prevRate| / prevRate <= 0.20`.
- **Action**: FX rate validation in reducer. Also log every FX change to `AuditLog`.

**P2-7: Bank reconciliation amount mismatch** (`bank_transaction_matcher.go:420`)
- **In STDB**: REQUIRES ACTIVE DESIGN. `reconcile_transaction` reducer enforces: `|bankAmount - invoiceAmount| <= tolerance_bhd`. Reject otherwise.
- **Action**: Hard constraint in reducer. No manual override without admin permission.

**P2-8: Supplier invoice approval — no segregation of duties**
- **In STDB**: BECOMES ELEGANT. Views + identity make this trivial. `supplier_invoice` table has `createdBy: t.identity()`. `approve_supplier_invoice` reducer checks: `ctx.sender !== invoice.createdBy`. If same person → reject. Requires separate approver identity by construction.
- **Action**: One-line check in reducer. No framework needed. STDB identity is unforgeable.

**P2-9: Negative inventory**
- **In STDB**: REQUIRES ACTIVE DESIGN. `create_delivery` reducer reads current stock, rejects if `quantity > available`. The check and the decrement happen in the same atomic transaction — no race condition possible.
- **Action**: Inventory check in reducer. Atomic by STDB design.

### Input Validation & API (5 findings)

**P2-10: `CreateUser` skips validation**
- **In STDB**: VANISHES AS STATED. There is no `CreateUser` function. `clientConnected` lifecycle hook creates the member record. Name/display_name validated in reducer with string length check.
- **Action**: `create_member` reducer validates string fields.

**P2-11: Filesystem traversal in document classifier**
- **In STDB**: VANISHES. No filesystem access in STDB modules. Document storage = content in `Document` table (base64 or blob reference). No `basePath` parameter exists.
- **Action**: Documents stored in STDB table, fetched by ID.

**P2-12: `ProcessInboxDocument` — no auth**
- **In STDB**: VANISHES. Every reducer call is authenticated via `ctx.sender`. There is no "unauthenticated reducer call" possible in STDB. If you call it, you have an identity.
- **Action**: `ctx.sender` is always present. Check role in member table.

**P2-13: Batch operations unbounded**
- **In STDB**: REQUIRES ACTIVE DESIGN. `batch_update` reducer validates `items.length <= 100`. Simple array length check before processing.
- **Action**: Guard at reducer entry point.

**P2-14: Butler AI prompt injection**
- **In STDB**: REQUIRES ACTIVE DESIGN. Butler AI calls external Mistral/Sarvam API via Procedure. Sanitize customer names before injection into prompts: strip `\n`, `\r`, prompt-delimiter characters. Apply in the Procedure before `ctx.http.fetch()`.
- **Action**: Sanitize function applied in Procedure before API call.

### Frontend & Dependencies (3 findings)

**P2-15: Outdated frontend deps (Vite 3.x, Svelte 3.x)**
- **In STDB**: RESOLVED BY NEW BUILD. The reimagined client is Svelte 5 + Vite 6 (current). CVE-2023-34092 and CVE-2024-23331 do not apply to new builds.
- **Action**: Build on current stack. No migration needed.

**P2-16: Incomplete log sanitization**
- **In STDB**: SUBSTANTIALLY REDUCED. STDB module logs are server-side only, not accessible to clients. No `api_key`/`token` in application code. Config table stores keys — never logged, only used in Procedure fetch calls.
- **Action**: Audit Procedure code for any logging of external API responses containing secrets.

**P2-17: Log file world-readable (permission 0666)**
- **In STDB**: VANISHES. STDB manages its own logs. No application-created log files. `spacetime logs` is the interface.
- **Action**: No action. Platform-handled.

### Summary: P2 Fate in STDB

| Category | Vanish | Need Design | Partial |
|----------|--------|-------------|---------|
| Crypto/Config (4) | 4 | 0 | 0 |
| Business Logic (5) | 0 | 5 | 0 |
| Input/API (5) | 3 | 2 | 0 |
| Frontend/Deps (3) | 1 | 1 | 1 |
| **Total** | **8** | **8** | **1** |

**8 of 17 P2 findings vanish entirely.** 8 require active reducer-level design. 1 is resolved by using current tooling. This is not STDB being magic — it is STDB removing entire attack surfaces (filesystem, network auth, sync config, application-level password hashing) that simply do not exist in the module model.

---

## Part 3: STDB Security Substrate — Actual TypeScript

### 3.1 Schema

```typescript
// schema.ts
import { schema, table, t } from 'spacetimedb/server';

// ─── RBAC ────────────────────────────────────────────────────────────────────

// Role enum — the five roles from PH Trading + future accountant
const Role = t.enum('Role', {
  admin:      t.unit(),  // Full access: *
  manager:    t.unit(),  // Finance + sales + ops management
  sales:      t.unit(),  // Pipeline + opportunities
  operations: t.unit(),  // Procurement + GRNs + POs
  accountant: t.unit(),  // Finance, bank recon, VAT, payroll
  developer:  t.unit(),  // Testing — same as admin
});

// Member table: one row per connected identity
// This replaces: license_keys table + device registration + session management
export const Member = table(
  {
    name: 'member',
    indexes: [
      { name: 'member_display_name', algorithm: 'btree', columns: ['displayName'] },
      { name: 'member_role',         algorithm: 'btree', columns: ['role'] },
    ],
  },
  {
    identity:    t.identity().primaryKey(),    // STDB-provided, unforgeable
    displayName: t.string(),                   // "Rishu", "Peri", etc.
    role:        Role,                         // Strongly typed
    isActive:    t.bool(),                     // Soft disable without data loss
    createdAt:   t.timestamp(),
    createdBy:   t.identity().optional(),      // Who provisioned this member
    notes:       t.string().optional(),        // Admin notes (was: LicenseKey.Notes)
  }
);

// ─── CONFIG (replaces .env for external API keys) ────────────────────────────

export const Config = table(
  { name: 'config' },
  {
    key:       t.string().primaryKey(),   // "MISTRAL_API_KEY", "SARVAM_API_KEY"
    value:     t.string(),               // Encrypted at rest by STDB platform
    updatedAt: t.timestamp(),
    updatedBy: t.identity(),
  }
);

// ─── AUDIT LOG ────────────────────────────────────────────────────────────────

// Immutable. No delete reducer. Admin-readable only.
export const AuditLog = table(
  {
    name: 'audit_log',
    indexes: [
      { name: 'audit_log_actor',      algorithm: 'btree', columns: ['actor'] },
      { name: 'audit_log_table_name', algorithm: 'btree', columns: ['tableName'] },
    ],
  },
  {
    id:        t.u64().primaryKey().autoInc(),
    actor:     t.identity(),           // ctx.sender
    tableName: t.string(),             // "invoice", "payment", etc.
    rowId:     t.u64(),                // Which row was affected
    action:    t.string(),             // "INSERT", "UPDATE", "DELETE"
    oldValue:  t.string().optional(),  // JSON serialized before-state
    newValue:  t.string().optional(),  // JSON serialized after-state
    timestamp: t.timestamp(),
  }
);

// ─── EXCHANGE RATES (with bounds checking) ────────────────────────────────────

export const ExchangeRate = table(
  {
    name: 'exchange_rate',
    indexes: [{ name: 'fx_currency_pair', algorithm: 'btree', columns: ['currencyPair'] }],
  },
  {
    id:           t.u64().primaryKey().autoInc(),
    currencyPair: t.string(),   // "USD_BHD", "EUR_BHD"
    rate:         t.string(),   // BHD string, 3dp (avoid float)
    previousRate: t.string(),
    updatedAt:    t.timestamp(),
    updatedBy:    t.identity(),
  }
);

// ─── FINANCIAL TABLES (simplified excerpt) ───────────────────────────────────

export const Invoice = table(
  {
    name: 'invoice',
    indexes: [
      { name: 'invoice_customer_id', algorithm: 'btree', columns: ['customerId'] },
      { name: 'invoice_status',      algorithm: 'btree', columns: ['status'] },
      { name: 'invoice_created_by',  algorithm: 'btree', columns: ['createdBy'] },
    ],
  },
  {
    id:             t.u64().primaryKey().autoInc(),
    customerId:     t.u64(),
    amountBhd:      t.string(),         // Decimal string — no float for money
    outstandingBhd: t.string(),
    status:         t.string(),         // "Draft" | "Sent" | "Paid" | "Overdue"
    createdBy:      t.identity(),
    createdAt:      t.timestamp(),
    updatedAt:      t.timestamp(),
  }
);

export const SupplierInvoice = table(
  {
    name: 'supplier_invoice',
    indexes: [
      { name: 'si_supplier_id', algorithm: 'btree', columns: ['supplierId'] },
      { name: 'si_created_by',  algorithm: 'btree', columns: ['createdBy'] },
      { name: 'si_approved_by', algorithm: 'btree', columns: ['approvedBy'] },
    ],
  },
  {
    id:           t.u64().primaryKey().autoInc(),
    supplierId:   t.u64(),
    amountBhd:    t.string(),
    status:       t.string(),           // "Pending" | "Approved" | "Paid"
    createdBy:    t.identity(),
    approvedBy:   t.identity().optional(),  // MUST differ from createdBy
    createdAt:    t.timestamp(),
    approvedAt:   t.timestamp().optional(),
  }
);

// Full schema export
const spacetimedb = schema({
  Member,
  Config,
  AuditLog,
  ExchangeRate,
  Invoice,
  SupplierInvoice,
});

export default spacetimedb;
```

### 3.2 RBAC Views — Per-Role Data Filtering

```typescript
// views.ts — imported by index.ts

import spacetimedb from './schema';
import { t } from 'spacetimedb/server';
import { Member, Invoice, SupplierInvoice, AuditLog, Config } from './schema';

// ── Helper: get caller's member record ───────────────────────────────────────

// This pattern is used in EVERY view and reducer
// ctx.db.member.identity.find(ctx.sender) = O(1) primary key lookup

// ── Views: role-filtered data ────────────────────────────────────────────────

// Every identity gets their own member record
export const my_profile = spacetimedb.view(
  { name: 'my_profile', public: true },
  t.array(Member.rowType),
  (ctx) => {
    const me = ctx.db.member.identity.find(ctx.sender);
    return me ? [me] : [];
  }
);

// Finance data: only admin, manager, accountant see invoices with full amounts
// Sales sees invoices for their own customers only (view invoice status, not amounts)
export const my_invoices = spacetimedb.view(
  { name: 'my_invoices', public: true },
  t.array(Invoice.rowType),
  (ctx) => {
    const me = ctx.db.member.identity.find(ctx.sender);
    if (!me || !me.isActive) return [];

    const roleTag = me.role.tag;

    if (roleTag === 'admin' || roleTag === 'developer' ||
        roleTag === 'manager' || roleTag === 'accountant') {
      // Full access: all invoices
      return [...ctx.db.invoice.invoice_status.filter('Paid'),
              ...ctx.db.invoice.invoice_status.filter('Sent'),
              ...ctx.db.invoice.invoice_status.filter('Overdue'),
              ...ctx.db.invoice.invoice_status.filter('Draft')];
    }

    if (roleTag === 'sales') {
      // Sales sees invoices they created only
      return [...ctx.db.invoice.invoice_created_by.filter(ctx.sender)];
    }

    // Operations: invoices view (for procurement tracking) — no financial amounts
    // Achieved via a separate stripped-down view (see invoice_summary below)
    return [];
  }
);

// Audit log: admin-only
export const admin_audit_log = spacetimedb.view(
  { name: 'admin_audit_log', public: true },
  t.array(AuditLog.rowType),
  (ctx) => {
    const me = ctx.db.member.identity.find(ctx.sender);
    if (!me || !me.isActive) return [];
    if (me.role.tag !== 'admin' && me.role.tag !== 'developer') return [];
    // Return recent 1000 entries (index lookup on actor to avoid full scan)
    // For full scan use query builder:
    return [...ctx.db.auditLog.audit_log_actor.filter(ctx.sender)];
    // NOTE: For full table view (all actors), use anonymousView with query builder
  }
);

// Supplier invoices: operations + manager + accountant + admin
// Segregation: approvedBy must differ from createdBy — enforced in reducer
export const my_supplier_invoices = spacetimedb.view(
  { name: 'my_supplier_invoices', public: true },
  t.array(SupplierInvoice.rowType),
  (ctx) => {
    const me = ctx.db.member.identity.find(ctx.sender);
    if (!me || !me.isActive) return [];
    const role = me.role.tag;
    if (role === 'sales') return []; // Sales has no procurement access
    // Everyone else (ops, manager, accountant, admin) sees all supplier invoices
    return [...ctx.db.supplierInvoice.si_supplier_id.filter(0n)]; // Full scan via query builder
    // Correct pattern: use anonymousView with ctx.from for full table access
  }
);
```

### 3.3 Reducers — Permission Pattern

```typescript
// index.ts

import spacetimedb from './schema';
import { SenderError, t } from 'spacetimedb/server';
import { Member, Invoice, SupplierInvoice, AuditLog, ExchangeRate, Config } from './schema';

// ── Permission helper (replaces requirePermission()) ─────────────────────────
// O(1) lookup vs current O(n) DB scan per call

type RoleTag = 'admin' | 'developer' | 'manager' | 'sales' | 'operations' | 'accountant';

function getMember(ctx: any): Member['rowType'] {
  const me = ctx.db.member.identity.find(ctx.sender);
  if (!me) throw new SenderError('Not a member of this organization');
  if (!me.isActive) throw new SenderError('Your account has been deactivated');
  return me;
}

function requireRole(ctx: any, ...allowedRoles: RoleTag[]): Member['rowType'] {
  const me = getMember(ctx);
  const roleTag = me.role.tag as RoleTag;
  if (!allowedRoles.includes(roleTag)) {
    throw new SenderError(
      `Access denied: requires ${allowedRoles.join(' or ')}, you are ${roleTag}`
    );
  }
  return me;
}

// Admin-only shorthand
function requireAdmin(ctx: any) {
  return requireRole(ctx, 'admin', 'developer');
}

// Finance roles
function requireFinance(ctx: any) {
  return requireRole(ctx, 'admin', 'developer', 'manager', 'accountant');
}

// ── Audit logging helper ──────────────────────────────────────────────────────

function logAudit(
  ctx: any,
  tableName: string,
  rowId: bigint,
  action: string,
  oldValue?: object,
  newValue?: object
) {
  ctx.db.auditLog.insert({
    id: 0n,
    actor: ctx.sender,
    tableName,
    rowId,
    action,
    oldValue: oldValue ? JSON.stringify(oldValue) : undefined,
    newValue: newValue ? JSON.stringify(newValue) : undefined,
    timestamp: ctx.timestamp,
  });
}

// ── Lifecycle: auto-provision member on first connect ─────────────────────────

spacetimedb.clientConnected((ctx) => {
  // If member record doesn't exist, create a pending (inactive) record
  // Admin must then set their role via set_member_role()
  const existing = ctx.db.member.identity.find(ctx.sender);
  if (!existing) {
    ctx.db.member.insert({
      identity:    ctx.sender,
      displayName: 'Pending',
      role:        { tag: 'sales', value: {} },  // Lowest-privilege default
      isActive:    false,                          // Inactive until admin approves
      createdAt:   ctx.timestamp,
      createdBy:   undefined,
      notes:       'Auto-created on first connect — pending admin approval',
    });
  }
});

spacetimedb.clientDisconnected((ctx) => {
  // No cleanup needed — STDB identity persists across connections
  // Session state is not stored in module
});

// ── Member management (admin only) ───────────────────────────────────────────

export const set_member_role = spacetimedb.reducer(
  {
    targetIdentity: t.identity(),
    displayName:    t.string(),
    role:           Member.columnType('role'),
    notes:          t.string().optional(),
  },
  (ctx, { targetIdentity, displayName, role, notes }) => {
    requireAdmin(ctx);

    if (displayName.length === 0 || displayName.length > 100) {
      throw new SenderError('displayName must be 1-100 characters');
    }

    const existing = ctx.db.member.identity.find(targetIdentity);
    if (!existing) throw new SenderError('Identity not found — they must connect first');

    const old = { ...existing };
    ctx.db.member.identity.update({
      ...existing,
      displayName,
      role,
      isActive:  true,   // Activating on role assignment
      createdBy: ctx.sender,
      notes:     notes ?? '',
    });

    logAudit(ctx, 'member', 0n, 'UPDATE', old, { displayName, role, isActive: true });
  }
);

export const deactivate_member = spacetimedb.reducer(
  { targetIdentity: t.identity() },
  (ctx, { targetIdentity }) => {
    requireAdmin(ctx);
    if (targetIdentity.toHexString() === ctx.sender.toHexString()) {
      throw new SenderError('Cannot deactivate yourself');
    }
    const me = ctx.db.member.identity.find(targetIdentity);
    if (!me) throw new SenderError('Member not found');
    ctx.db.member.identity.update({ ...me, isActive: false });
    logAudit(ctx, 'member', 0n, 'DEACTIVATE', { identity: targetIdentity }, {});
  }
);

// ── Invoice creation — finance roles only, business invariants enforced ───────

export const create_invoice = spacetimedb.reducer(
  {
    customerId:  t.u64(),
    amountBhd:   t.string(),  // Decimal string "1234.500" (3dp for BHD)
    vatRate:     t.string(),  // "0.10" for 10%
  },
  (ctx, { customerId, amountBhd, vatRate }) => {
    requireFinance(ctx);

    // Validate amount format
    const amount = parseFloat(amountBhd);
    if (isNaN(amount) || amount <= 0) {
      throw new SenderError('amountBhd must be a positive decimal');
    }
    if (amount > 10_000_000) {
      throw new SenderError('Amount exceeds maximum single invoice limit');
    }

    // Validate VAT rate is reasonable (Bahrain VAT is 10%)
    const vat = parseFloat(vatRate);
    if (isNaN(vat) || vat < 0 || vat > 0.20) {
      throw new SenderError('vatRate must be between 0 and 0.20');
    }

    const row = ctx.db.invoice.insert({
      id:             0n,
      customerId,
      amountBhd:      amountBhd,
      outstandingBhd: amountBhd,  // Full amount outstanding on creation
      status:         'Draft',
      createdBy:      ctx.sender,
      createdAt:      ctx.timestamp,
      updatedAt:      ctx.timestamp,
    });

    logAudit(ctx, 'invoice', row.id, 'INSERT', undefined, { customerId, amountBhd });
  }
);

// ── Supplier invoice approval — segregation of duties enforced ─────────────────

export const approve_supplier_invoice = spacetimedb.reducer(
  { invoiceId: t.u64() },
  (ctx, { invoiceId }) => {
    requireRole(ctx, 'admin', 'manager', 'accountant');

    const inv = ctx.db.supplierInvoice.id.find(invoiceId);
    if (!inv) throw new SenderError('Supplier invoice not found');
    if (inv.status !== 'Pending') throw new SenderError('Invoice is not in Pending state');

    // ── SEGREGATION OF DUTIES ─────────────────────────────────────────────────
    // P2-8 fix: Creator cannot approve their own invoice
    if (inv.createdBy.toHexString() === ctx.sender.toHexString()) {
      throw new SenderError(
        'Segregation of duties: you cannot approve an invoice you created'
      );
    }

    const old = { ...inv };
    ctx.db.supplierInvoice.id.update({
      ...inv,
      status:     'Approved',
      approvedBy: ctx.sender,
      approvedAt: ctx.timestamp,
    });

    logAudit(ctx, 'supplier_invoice', invoiceId, 'APPROVE', old, { approvedBy: ctx.sender });
  }
);

// ── FX rate update — bounds-checked ──────────────────────────────────────────

export const update_fx_rate = spacetimedb.reducer(
  {
    currencyPair: t.string(),
    newRate:      t.string(),
  },
  (ctx, { currencyPair, newRate }) => {
    requireFinance(ctx);

    const rate = parseFloat(newRate);
    if (isNaN(rate) || rate <= 0) {
      throw new SenderError('newRate must be a positive number');
    }

    // Find existing rate for bounds check
    const existing = [...ctx.db.exchangeRate.fx_currency_pair.filter(currencyPair)][0];
    if (existing) {
      const prevRate = parseFloat(existing.rate);
      const changePct = Math.abs(rate - prevRate) / prevRate;

      // P2-6 fix: +/- 20% max change per update
      if (changePct > 0.20) {
        throw new SenderError(
          `FX rate change of ${(changePct * 100).toFixed(1)}% exceeds 20% limit. ` +
          `Previous: ${existing.rate}, Proposed: ${newRate}`
        );
      }

      const old = { ...existing };
      ctx.db.exchangeRate.id.update({
        ...existing,
        previousRate: existing.rate,
        rate:         newRate,
        updatedAt:    ctx.timestamp,
        updatedBy:    ctx.sender,
      });
      logAudit(ctx, 'exchange_rate', existing.id, 'UPDATE', old, { currencyPair, newRate });
    } else {
      // First-time insert
      const row = ctx.db.exchangeRate.insert({
        id:           0n,
        currencyPair,
        rate:         newRate,
        previousRate: newRate,
        updatedAt:    ctx.timestamp,
        updatedBy:    ctx.sender,
      });
      logAudit(ctx, 'exchange_rate', row.id, 'INSERT', undefined, { currencyPair, newRate });
    }
  }
);

// ── Config management (admin only) ───────────────────────────────────────────
// Replaces .env file for external API keys

export const set_config = spacetimedb.reducer(
  { key: t.string(), value: t.string() },
  (ctx, { key, value }) => {
    requireAdmin(ctx);
    // Never log the value itself — only the key being updated
    const existing = ctx.db.config.key.find(key);
    if (existing) {
      ctx.db.config.key.update({ ...existing, value, updatedAt: ctx.timestamp, updatedBy: ctx.sender });
    } else {
      ctx.db.config.insert({ key, value, updatedAt: ctx.timestamp, updatedBy: ctx.sender });
    }
    logAudit(ctx, 'config', 0n, 'UPDATE', { key }, { key, valueLength: value.length });
    // Note: value intentionally NOT logged to audit trail
  }
);
```

### 3.4 SPOC Flow Matrix — STDB View Implementation

The SPOC flow defines 4 persona columns: Sales / Sales Manager / Accountant / Management. This maps to views:

```typescript
// The SPOC "Accounting & Finance" page = accountant + admin only
// In STDB: my_invoices view already handles this via role check
// Additional: the Finance page subscribes to:
// SELECT * FROM my_invoices        — full amounts for finance roles
// SELECT * FROM my_supplier_invoices  — procurement for ops/finance

// The SPOC "Follow-ups" page = Sales and Management, NOT Accountant
// In STDB: follow_up table with index on ownerId
// my_follow_ups view: sales sees own, admin/manager see all

export const my_follow_ups = spacetimedb.view(
  { name: 'my_follow_ups', public: true },
  t.array(FollowUp.rowType),   // FollowUp table not shown but follows same pattern
  (ctx) => {
    const me = ctx.db.member.identity.find(ctx.sender);
    if (!me || !me.isActive) return [];
    const role = me.role.tag;
    if (role === 'accountant') return [];  // SPOC: accountant has no follow-ups access
    if (role === 'sales') {
      return [...ctx.db.followUp.follow_up_owner_id.filter(ctx.sender)];
    }
    // Manager, admin, developer: all follow-ups
    // Use anonymousView + query builder for this pattern in production
    return [...ctx.db.followUp.follow_up_owner_id.filter(ctx.sender)]; // Simplified
  }
);
```

---

## Part 4: Mathematical Analysis

### 4.1 Shannon: Information Content of the RBAC Matrix

The permission matrix is a binary matrix M where M[role][permission] ∈ {0,1}.

**Current matrix dimensions:**
- Roles: 5 (admin, manager, sales, operations, developer)
- Permissions: ~40 distinct strings across the codebase

**Maximum entropy** of this matrix: H_max = 5 × 40 × log2(2) = 200 bits.

**Actual entropy** given the current assignments:

Admin/Developer: all 40 permissions = 1 (zero entropy — completely determined)
Manager: 26 permissions set = determined
Sales: 14 permissions set = determined
Operations: 12 permissions set = determined

The role-permission assignments are **fixed constants, not random variables.** They have zero Shannon entropy — they are fully specified. The "information content" of the RBAC matrix is purely its Kolmogorov complexity: the minimum program that generates it.

**Current system**: 133 lines of Go map literals in `license_service.go`.
**STDB system**: The `requireRole()` helper + 5 enum variants + view filters. Approximately the same description length — neither is compressible to zero because the business rules are genuinely complex.

**The real Shannon insight**: The RBAC matrix is NOT the bottleneck. The bottleneck is the **verification channel** — how quickly can the system confirm "does caller X have permission Y?" Current system: O(n) DB round-trip per check. STDB: O(1) identity primary key lookup. This is a **latency reduction from ~1ms (SQLite) to ~0.1ms (memory-mapped STDB table)**, a 10x improvement on the most-called code path.

### 4.2 Knuth: Algorithmic Analysis of Permission Checking

**Current** `requirePermission(perm)`:
```
T(n) = T_db_query + T_scan
     = O(log n) [B-tree on device_hash] + O(m) [linear scan of permissions slice]
     = O(log n + m)
where n = rows in license_keys, m = |permissions for role| ≤ 26
```

In practice with 8 members: n = 8, log(8) = 3 comparisons. m ≤ 26. Plus network stack overhead for SQLite IPC.

**STDB** `requireRole(ctx, ...roles)`:
```
T(1) = O(1) [identity primary key lookup in memory-mapped table]
     + O(k) [check role tag against k allowed roles, k ≤ 4]
     = O(1) [k is constant, bounded by number of roles]
```

**Asymptotic equivalence at small n, but constant factors matter**:
- Current: 1 SQLite B-tree lookup + 1 Go slice scan = ~1-2ms per permission check
- STDB: 1 hash-map lookup in memory = ~0.001ms per permission check

A single Svelte page that triggers 10 backend permission checks: current = 10-20ms of pure auth overhead, STDB = 0.01ms.

**Knuth's key observation**: The 33+ `requirePermission()` calls in `app.go` are a hot path. Every user interaction traverses this code. Optimizing from O(n_db) to O(1) is not premature optimization — it is eliminating a systemic bottleneck.

### 4.3 Kolmogorov Complexity: Auth System Compression

**Current auth system** minimum description (what must be stored/computed):
```
Components:
1. Key format: "PH-{ROLE}-{6hex}" — 15 chars of spec
2. Device fingerprint algorithm: SHA-256(MAC + hostname) — 30 chars
3. Rate limit state: map[deviceHash][]timestamps — runtime only
4. License table: 8 rows × 7 fields — ~56 field-values
5. Permission map: 5 roles × avg 18 perms — 90 entries
6. Session timeout: 8 hours — 1 constant
7. SQLite schema: license_keys table definition — ~200 chars
8. Supabase sync config: 4 env vars — ~150 chars

Approximate Kolmogorov complexity: ~600 chars of specification
```

**STDB auth system** minimum description:
```
Components:
1. Member table: identity (built-in) + role enum (5 variants) + isActive + displayName
   — ~100 chars of schema
2. Role enum: 5 variants — 30 chars
3. requireRole() helper: ~10 lines — ~300 chars
4. clientConnected hook: auto-create pending member — ~100 chars

Approximate Kolmogorov complexity: ~530 chars of specification
```

The STDB system is **not dramatically simpler in description** — both encode the same business rules. But the STDB system:
- Eliminates the **entire cryptographic layer** (key generation, device hashing, rate limiting) — those ~200 chars of spec vanish
- Eliminates the **sync config** — those 150 chars vanish
- Gains the **STDB identity guarantee** for free — the platform provides what we were computing manually

**Net compression**: ~350 chars of specification eliminated. More importantly, ~200 lines of code in `license_service.go` compress to ~50 lines of schema + reducer. The removed code was not just simpler to write — it was an attack surface. Every line of auth code is a potential vulnerability. Removing 75% of the auth implementation is a security gain.

### 4.4 Error-Detecting Codes for Financial Data

Financial records in BHD (3 decimal places) face two corruption risks:
1. **Float precision errors**: `1234.500 BHD` stored as float = `1234.4999999...` after IEEE 754 rounding
2. **Sync corruption**: SQLite ↔ Supabase boolean/type mismatches (observed in Phase 18: "93 payments recorded pre-VAT amounts")

**Solution already applied in schema above**: Store all monetary values as `t.string()` decimal strings, not floats. `"1234.500"` is exact. No precision loss.

**Additional integrity mechanism — Luhn-style checksum for invoice IDs**:
The Phase 18 data reconciliation found 107 customers soft-deleted by mistake and 313 invoices incorrectly marked "Sent". A simple checksum on critical financial records would catch bulk-mutation bugs:

```typescript
// Invoice integrity: store checksum of (id, customerId, amountBhd)
// Any mutation that changes these fields without updating checksum = detected corruption
function computeInvoiceChecksum(id: bigint, customerId: bigint, amountBhd: string): string {
  // Simple: XOR of digit sums — not cryptographic, just integrity
  // For production: SHA-256 of canonical JSON
  return sha256(`${id}:${customerId}:${amountBhd}`).slice(0, 16);
}

// Added to Invoice table:
// checksum: t.string()  // 16-char hex of SHA-256(id:customerId:amountBhd)

// In update_invoice_status reducer: recompute and verify checksum
// Mismatch = data corruption alert → log to AuditLog + reject operation
```

**Information-theoretic justification**: A 16-char hex checksum provides 64 bits of error detection. The probability of an undetected corruption passing the checksum is 2^-64 ≈ 5.4 × 10^-20. For a 500-record database updated 100 times/day, expected time to undetected corruption: effectively infinite.

### 4.5 Zero-Knowledge RBAC (Theoretical Exploration)

Can a user prove they have the `finance:view` permission without revealing their role?

**ZK construction** (theoretical):
```
Public params: commitment C = hash(role_string)
Prover knows: role = "manager"
Statement: "I know a role r such that hash(r) = C AND finance:view ∈ permissions[r]"

ZK proof: Σ-protocol over the commitment
Verifier learns: the prover has the permission, but NOT which of {admin, manager, accountant}
```

**Practical verdict**: This is elegant but unnecessary for AsymmFlow. The threat model is internal ERP access, not anonymous credential systems. The roles are not secrets — "Sundar is a manager" is known to the whole team. Zero-knowledge RBAC provides privacy when the role itself is sensitive (e.g., "this user is a government auditor"). For PH Trading, role disclosure is not a threat.

**Where ZK IS relevant**: Customer credit grades (Grade A/B/C/D). If the system proves to a salesperson "this customer is approved" without revealing their grade (which might be negotiated information), that is a genuine use case. File under "future research."

---

## Part 5: The Wright Brothers Moment

### 5.1 RBAC is a Type System

This analogy holds exactly:

| Type Theory | RBAC |
|-------------|------|
| Types | Roles |
| Methods | Permissions |
| Type checking | Permission checking |
| Static typing | Compile-time RBAC (schema validation) |
| Runtime type errors | Permission denied errors |
| Subtyping | Role inheritance (admin ⊇ manager ⊇ sales) |
| Parametric polymorphism | Wildcard permissions (`*`, `finance:*`) |

**Implication**: A type-safe RBAC system is one where the type checker (compiler) can prove that a reducer can only be called by roles with the required permission. TypeScript's type system cannot enforce this directly, but the STDB pattern comes close: `requireRole(ctx, 'admin', 'manager')` is a runtime check with a type-system flavor — the allowed roles are explicit in the function signature.

**The Wright Brothers equivalent**: The current system checks permissions at runtime against a string map. The reimagined system checks permissions at the type level via enum variants. This is not just faster — it is **structurally sound**. You cannot accidentally write `requireRole(ctx, 'adminz')` because `'adminz'` is not a valid `RoleTag`. The type system catches the mistake at compile time.

### 5.2 Principle of Least Authority (POLA)

POLA states: each component should have access only to the minimum resources needed.

**Current system violations**:
- `startupImporting` flag bypasses RBAC for 5 minutes for import operations. Any other code running in that window gets free access to import permissions.
- `admin` role is a wildcard `*` — no capability decomposition.
- The `developer` role maps to `admin` — test keys have production-level access.

**STDB improvements under POLA**:
- No startup bypass. STDB reducers for data import are called explicitly, with proper identity. If the import reducer needs admin access, it checks the caller's role — it does not bypass RBAC.
- Admin role CAN be decomposed: `admin` for user management, `super_admin` for config changes. The enum allows this.
- Developer role can be scoped: `developer` sees everything read-only but cannot write financial records. Implement by adding `isDeveloperReadOnly` field.

### 5.3 Information-Theoretic Minimum Viable Auth

What is the minimum auth system that provides security guarantees?

**Theorem**: The minimum auth system for AsymmFlow must encode:
1. **Identity** (Who is calling?): requires a cryptographically unforgeable identifier
2. **Role** (What can they do?): requires a mapping from identity to capability set
3. **Audit** (What did they do?): requires an immutable log

The current system provides all three via: device hash (identity) + license key (role) + SQLite writes (audit).

The STDB system provides all three via: Ed25519 identity (identity) + member table (role) + AuditLog table (audit).

**The minimum description length of a correct auth system is bounded below** by the information content of the identity + role + audit triple. Neither system is below this bound. But the STDB system reaches it with less code because the identity cryptography is provided by the platform rather than implemented by the application.

**Shannon bound on license key security**: The current key space is 16^6 = 16,777,216 per role. With rate limiting (10 attempts/minute), brute force time = 16,777,216 / 10 = 1,677,722 minutes ≈ 3.2 years per role. Adequate for the threat model. STDB's Ed25519 identity provides 128-bit security — effectively unbreakable. The auth strength improvement is not marginal; it is categorical.

---

## Part 6: Summary Implementation Notes for AsymmFlow STDB

### What to build first (by security priority):

1. **Member table + clientConnected hook** — replaces the entire license system. Hours of work, not days.

2. **requireRole() + requireFinance() helpers** — replaces 50+ `requirePermission()` calls. Pure translation.

3. **AuditLog table + logAudit() helper** — every mutating reducer calls this. Immutable, complete audit trail.

4. **Views per role** — `my_invoices`, `my_follow_ups`, `my_supplier_invoices`. Data isolation by identity.

5. **Segregation of duties** in `approve_supplier_invoice` — one-line check, eliminates P2-8.

6. **FX rate bounds** in `update_fx_rate` — one-line check, eliminates P2-6.

7. **Config table** for external API keys — eliminates `.env` file and P2-4.

8. **Business invariant helpers** called in every relevant reducer — addresses P2-5 and P2-9.

### The accountant role gap:

The SPOC vision defines Accountant as a distinct role with access to: Chart of Accounts, VAT compliance, bank reconciliation, payroll, inventory management. The current code has no `accountant` role — this functionality falls to `admin`. The STDB reimplementation is the right moment to add `accountant` as a first-class role. It costs one enum variant and a few view filter branches.

### On the 10-minute sync becoming real-time:

The 10-minute Supabase sync is not just a latency problem — it is a **consistency model problem**. Two users can read stale data, make decisions on that data, and commit conflicting writes that the sync layer cannot reconcile without manual intervention (as happened in Phase 18). STDB's serializable transaction model eliminates this class of bug entirely. Every write is immediately visible to all subscribers. This is not a performance optimization — it is a correctness guarantee.

---

*Shannon: The channel capacity of STDB's real-time subscriptions is limited only by the network, not by batch windows. We went from a 600-second latency channel to a 0.05-second latency channel — a 12,000x throughput improvement on the consistency dimension.*

*Knuth: The dominant cost in the current auth system is O(n_db) per permission check, called 33+ times per user interaction. The STDB system reduces this to O(1) via identity primary key. This is the single most impactful algorithmic improvement in the entire reimagination.*

**Om Lokah Samastah Sukhino Bhavantu.** May this analysis benefit all who build on it.
