# Conversation-First Document Flows for AsymmFlow V5

**Date**: 2026-03-19
**Status**: Approved
**Author**: Commander + Claude
**Context**: PH Trading WLL (Bahrain) — process instrumentation, 350+ offers/year

---

## 1. Problem Statement

PH Trading employees (Ramya, Abhie, others) spend 4-5 hours per document type, manually pulling data from Excel files and navigating folder hierarchies spanning 80,000+ files across 5 years. The offer lifecycle — from receiving an RFQ to sending a quotation to invoicing — involves 6-8 document types per offer, organized in folder structures like:

```
EH-XX-26 CUSTOMER/
├── RFQ/           (incoming enquiry)
├── OFFER/REV-0/   (first quotation attempt)
├── OFFER/REV-1/   (negotiation revision)
└── EXECUTION/     (post-PO: invoice, delivery)
```

Each revision contains a costing sheet (XLSX), commercial offer (DOCX), final PDF, and technical documentation bundles.

## 2. Vision

**The AI is a knowledgeable colleague, not a manager.**

Ramya logs in, sees pending work, and has a natural conversation with the AI about her tasks. The AI has full context of STDB data (parties, pipelines, money events, contacts) and uses that to have intelligent discussions about pricing strategy, customer history, and margin analysis.

Documents and status changes are **natural outcomes** of conversations, triggered ONLY when Ramya explicitly requests them. The system empowers employees to be expert generalists — following company-approved templates while having the freedom to bring their own ideas and pursue new business opportunities using their accumulated knowledge.

### The Three-Layer Flow

```
LAYER 1: FREE CONVERSATION (no writes, no docs)
  AI has live context from STDB. Ramya discusses pricing, strategy, customer needs.
  AI can suggest, analyze, compare — but writes NOTHING.

LAYER 2: DOCUMENT GENERATION (explicit request + Tier 1 confirm)
  Ramya says: "Generate the techno-commercial offer"
  AI extracts skill + params from conversation context.
  ConfirmCard shows what will be generated.
  On confirm: document produced and downloaded.
  NO status change occurs.

LAYER 3: STATUS TRANSITION (explicit request + Tier 2 confirm + identity)
  Ramya says: "I've sent the quotation to BAPCO"
  AI extracts transition request.
  Tier 2 ConfirmCard shows: pipeline, customer, amount, old→new status.
  On confirm: STDB reducer fires, ActivityLog entry created, signed with Ramya's identity.
```

### Core Principles

- **Human drives, AI assists**: No automatic state changes. Ramya decides when a quotation is "sent" — that's her judgment, not a software guard.
- **Documents are byproducts of conversation**: The discussion IS the work. Documents emerge when the conversation reaches natural conclusion points.
- **Multi-stage guardrails**: Document generation and status transitions are separate, deliberate acts — each requiring explicit confirmation.
- **Empowerment over enforcement**: The system follows company templates naturally, but doesn't constrain employees. Same data that helps finish existing work also helps spot new opportunities.
- **Costing lives in reducers**: No more painful XLSX-per-folder. Costing calculations (OEM price + markup + margin) are computed in Pipeline reducers, discussed conversationally.

## 3. Document Types

### Already Built (6 generators)

| # | Document | Generator File | Output |
|---|----------|---------------|--------|
| 1 | Quotation / Techno-Commercial Offer | `quotationGenerator.ts` | PDF |
| 2 | Tax Invoice | `invoiceGenerator.ts` | PDF |
| 3 | Purchase Order | `purchaseOrderGenerator.ts` | PDF |
| 4 | Delivery Note | `deliveryNoteGenerator.ts` | PDF |
| 5 | Statement of Account | `statementGenerator.ts` | PDF |
| 6 | Payment Chase | `chaseGenerator.ts` | Text/PDF |

### New Document Types (3 generators)

#### 3A. Email Draft Generator

**File**: `emailDraftGenerator.ts` (~200 LOC)
**Output**: Plain text / HTML (copy-paste into Outlook, NOT PDF)

**Variants** (determined by conversation context):

| Email Type | When Used | Tone |
|------------|-----------|------|
| RFQ Response | Responding to customer enquiry | Professional, acknowledging requirements |
| Offer Submission | Sending techno-commercial offer | Formal, attachment reference + validity |
| Follow-Up | Checking on pending offer | Friendly-to-firm based on Party grade + elapsed days |
| Revision Notice | Sending updated pricing/specs | Brief, highlighting what changed |
| PO Acknowledgment | Confirming receipt of customer PO | Grateful, with delivery timeline |

**Context model**:
- **Hard**: recipient (from Party), subject context (from Pipeline)
- **Soft**: specific points to mention, urgency level
- **Auto**: greeting style, signature block, reference numbers, amounts from Pipeline

**Key behavior**: AI already knows from the conversation what the email is about. "Draft the email" pulls context from chat history + STDB data to produce something Ramya only needs to tweak.

#### 3B. Offer Cover Letter Generator

**File**: `coverLetterGenerator.ts` (~250 LOC)
**Output**: PDF (pdfMake, PH Trading letterhead — same as Invoice/Quotation)

**Structure** (derived from real PH Trading offer patterns):

```
[PH Trading Letterhead]

Date: [today]
Ref: EH-[seq]-26

To: [Customer Name]
Attn: [Contact Name]

Subject: Techno-Commercial Offer for [instrument description]

Dear [Name],

With reference to your enquiry [RFQ ref], we are pleased to
submit our techno-commercial offer for the following:

[Item summary table — brief, not the full quotation]

Total: [amount] BHD (exclusive/inclusive of VAT)
Validity: [days] days
Delivery: [terms]
Payment: [grade-based terms]

We look forward to your favorable response.

[Signature block]
```

**Context model**:
- **Hard**: partyId, pipelineId (links to the offer)
- **Soft**: specific notes, delivery promises
- **Auto**: amounts from Pipeline costing, payment terms from Party grade, contact name from Contact table

#### 3C. Technical Submittal Generator

**File**: `technicalSubmittalGenerator.ts` (~180 LOC)
**Output**: PDF (simple table format with PH Trading letterhead)

**Purpose**: Index/checklist of technical documentation included with the offer. NOT the documents themselves (those come from E+H), but the professional reference list.

**Structure**:

```
[PH Trading Letterhead]

TECHNICAL SUBMITTAL
Ref: EH-[seq]-26 | Customer: [name]

Document List:
┌────┬──────────────────────────────────┬────────┬───────┐
│ #  │ Document                          │ Type   │ Pages │
├────┼──────────────────────────────────┼────────┼───────┤
│ 1  │ Promag 10W Flow Sensor            │ TI     │ 24    │
│ 2  │ 2D Drawing - TM131                │ DWG    │ 1     │
│ 3  │ Sizing Report - FLO 5W4C          │ Sizing │ 3     │
│ 4  │ Product Specification EN           │ Spec   │ 12    │
└────┴──────────────────────────────────┴────────┴───────┘

Total documents: 4
Prepared by: [Employee name]
Date: [today]
```

**Context model**:
- **Hard**: pipelineId (which offer this is for)
- **Soft**: document entries (AI suggests from conversation, Ramya confirms list)
- **Auto**: customer name, reference number, date, preparer name from identity

**V1 limitation**: The document list is ephemeral — it lives in conversation context. If Ramya needs to regenerate, she re-specifies the list in chat. A future `TechnicalSubmittal` table in STDB could persist this, but for V1 the conversational approach is sufficient.

### Handled by Reducers (No Document Generation)

- **Costing calculations**: OEM price + markup + margin live in Pipeline reducers. Discussed conversationally, stored in STDB, never exported as standalone XLSX.

## 4. Two-Tier Confirmation System

### Tier 1 — Document Generation (Light Confirm)

Used for all 9 document generators. Same pattern as current V5 ConfirmCard:

```
┌─────────────────────────────────────────────┐
│ 📄 Generate Techno-Commercial Offer          │
│                                              │
│ Customer: BAPCO Refining                     │
│ Items: 3 pressure transmitters               │
│ Amount: 4,200 BHD + VAT                     │
│                                              │
│  ✓ Generate    ✕ Cancel                      │
└─────────────────────────────────────────────┘
```

- Single confirm button
- Shows key params extracted from conversation
- On confirm: document produced, downloaded
- No STDB state change

### Tier 2 — Status Transition (Guarded Confirm)

Used exclusively for Pipeline status changes. Enhanced card with identity badge:

```
┌─────────────────────────────────────────────┐
│ 🔄 Status Change Request                    │
│                                              │
│ Pipeline: EH-15-26 BAPCO UPSTREAM-FEED      │
│ Customer: BAPCO Refining                     │
│ Amount: 4,200 BHD                           │
│                                              │
│ Proposal ──→ Quotation Sent                  │
│                                              │
│ Signed by: Ramya (Sales)                     │
│ ──────────────────────────────────────────── │
│  ✓ Confirm Transition    ✕ Cancel            │
└─────────────────────────────────────────────┘
```

- Shows full pipeline context (name, customer, amount)
- Visual arrow showing old → new status
- Identity badge (who is making this change)
- Writes to ActivityLog with timestamp + identity
- Irreversible — this is a deliberate business decision, no undo window

### Component Design

**Tier 1** reuses the existing approval flow in `ChatMessage`. The `approval` field on `ChatMessage` (defined in `ai/types.ts`, lines 31-39) already supports `'Proposed' | 'Approved' | 'Executed' | 'Rejected' | 'Failed'` statuses. Document generation skills render as approval cards using this existing mechanism — no new component needed.

**Tier 2** extends `ChatMessage` with a new optional `transitionRequest` field:

```typescript
// In ai/types.ts, add to ChatMessage interface:
transitionRequest?: {
  pipelineId: string;
  pipelineName: string;      // e.g. "EH-15-26 BAPCO UPSTREAM-FEED"
  customerName: string;
  amountBhd: string;         // formatted amount
  oldStatus: string;
  newStatus: string;
  signedBy: string;          // e.g. "Ramya (Sales)"
  status: 'Proposed' | 'Approved' | 'Rejected';
};
```

The chat component (`ChatPage.svelte` or a new `TransitionCard.svelte` ~80 LOC) checks for `transitionRequest` on each message and renders the Tier 2 card when present. The identity badge reads `signedBy` from the current `Member` store (name + role).

### Why Two Tiers

Documents are repeatable — you can regenerate a PDF. Status transitions are business commitments — "Quotation Sent" means Ramya vouches that she sent it. Different weight, different ceremony.

## 5. Workflow Context Builder

### Integration with existing `ai/context.ts`

The existing `ai/context.ts` (548 LOC) already builds a comprehensive system prompt via `buildSystemPrompt()`, which reads all STDB stores and computes business state via `buildBusinessState()`. It already includes pipeline summaries (lines 449-453) and overdue customer data (lines 412-417).

**Approach**: Do NOT create a separate `workflowContext.ts` file. Instead, **extend `buildSystemPrompt()` in `ai/context.ts`** with enhanced pipeline context sections. This avoids duplication and keeps all prompt logic in one place.

### Changes to `ai/context.ts`

1. **Replace** the existing "PIPELINE & ORDERS" section with a richer version that includes last action, pending items, and follow-ups per pipeline
2. **Replace** the existing "TOP OVERDUE CUSTOMERS" section with a combined "TODAY'S FOLLOW-UPS" section covering both pipeline follow-ups and overdue payments
3. **Add** a "RECENT ACTIVITY" section (last 5 actions from ActivityLog)
4. **Update** the "DOCUMENT GENERATION PROTOCOL" section (lines 504-514) to list all 9 document types instead of the current 6

### Enhanced Context Output

The updated `buildSystemPrompt()` should produce these sections:

```
═══ YOUR PIPELINE CONTEXT ═══
Active Pipelines (3):
• EH-15-26 BAPCO UPSTREAM-FEED — Stage: Proposal, Amount: 4,200 BHD
  Last action: Costing completed (2 days ago)
  Pending: Techno-commercial offer not yet generated

• EH-31-26 YATEEM BTU — Stage: Negotiation, Amount: 12,500 BHD
  Last action: REV-1 offer sent (5 days ago), awaiting response

• EH-09-26 VEOLIA ENERGY — Stage: ClosedWon, Amount: 1,800 BHD
  Pending: Invoice not yet generated

═══ TODAY'S FOLLOW-UPS ═══
• BAPCO: Follow up on EH-15-26 (due today)
• ALBA: Payment chase — 45 days overdue, 890 BHD

═══ RECENT ACTIVITY ═══
• Yesterday: Generated quotation for EH-31-26 (REV-1)
• 2 days ago: Recorded payment from VEOLIA (500 BHD)
• 3 days ago: Created pipeline EH-15-26

═══ CAPABILITIES ═══
Documents: Quotation, Invoice, PO, DN, Statement, Chase, Email Draft, Cover Letter, Technical Submittal
Status: Any pipeline stage transition (requires your explicit confirmation)
```

The AI uses this naturally in conversation — no special parsing needed, it just KNOWS the business context. Context updates reactively from STDB subscriptions since `buildSystemPrompt()` is called fresh for each message.

## 6. Skills & Executor Updates

### New Skills (in `skills/registry.ts`)

All new skills include `parameters: SkillParameter[]` following the existing pattern (see `generate_quotation` at lines 261-287 of `registry.ts`).

```typescript
// New document skills
{ name: 'generate_email_draft',
  displayName: 'Draft Email',
  category: 'communication',
  approval: 'explicit',
  requiredRoles: ['Admin', 'Manager', 'Sales', 'Operations', 'Accountant'],
  parameters: [
    { name: 'partyId', type: 'string', required: true, description: 'Recipient party ID' },
    { name: 'pipelineId', type: 'string', required: false, description: 'Related pipeline (for offer emails)' },
    { name: 'variant', type: 'string', required: true, description: 'rfq_response | offer_submission | follow_up | revision_notice | po_acknowledgment' },
    { name: 'points', type: 'string', required: false, description: 'Specific points to mention' },
  ] }

{ name: 'generate_cover_letter',
  displayName: 'Offer Cover Letter',
  category: 'communication',  // Communication doc, accompanies the offer
  approval: 'explicit',
  requiredRoles: ['Admin', 'Manager', 'Sales'],
  parameters: [
    { name: 'partyId', type: 'string', required: true, description: 'Customer party ID' },
    { name: 'pipelineId', type: 'string', required: true, description: 'Pipeline/offer this covers' },
    { name: 'notes', type: 'string', required: false, description: 'Additional notes or delivery promises' },
  ] }

{ name: 'generate_technical_submittal',
  displayName: 'Technical Submittal',
  category: 'data',  // Generates from data (document index)
  approval: 'explicit',
  requiredRoles: ['Admin', 'Manager', 'Sales', 'Operations'],
  parameters: [
    { name: 'pipelineId', type: 'string', required: true, description: 'Pipeline/offer this indexes' },
    { name: 'documents', type: 'string', required: true, description: 'JSON array of {name, type, pages}' },
  ] }

// Status transition skill — uses existing SkillCategory 'data' (writes to STDB)
{ name: 'update_pipeline_status',
  displayName: 'Update Pipeline Status',
  category: 'data',  // Writes to STDB, uses existing SkillCategory union
  approval: 'explicit',  // Renders as Tier 2 card (see Section 4)
  requiredRoles: ['Admin', 'Manager', 'Sales', 'Operations', 'Accountant'],
  parameters: [
    { name: 'pipelineId', type: 'string', required: true, description: 'Pipeline to update' },
    { name: 'newStatus', type: 'string', required: true, description: 'Target status (e.g. QuotationSent, ClosedWon)' },
    { name: 'notes', type: 'string', required: false, description: 'Optional notes for the transition' },
  ] }
```

**Note**: `update_pipeline_status` uses `category: 'data'` because the existing `SkillCategory` type only allows `'data' | 'file' | 'intelligence' | 'communication'`. The Tier 2 confirmation card is triggered by skill name check in the executor, not by category.

### Executor Refactor

Split `executor.ts` (1,233 LOC) into two focused files:

- **`documentExecutor.ts`** — All 9 document generation handlers (existing 6 + new 3). The existing `executeSkill()` entry point (lines 1125-1232) stays in `executor.ts` as a thin router that imports handlers from `documentExecutor.ts` and `statusExecutor.ts`.
- **`statusExecutor.ts`** (~200 LOC) — Status transition handler with Tier 2 confirmation logic, ActivityLog writing, and identity signing.

### Status Transition Reducer Sequence (`statusExecutor.ts`)

When a Tier 2 confirmation is approved, the executor calls STDB reducers in this order:

```typescript
async function handleStatusTransition(params, member): Promise<SkillResult> {
  // 1. Call advancePipeline reducer (updates Pipeline.status field)
  await conn.reducers.advancePipeline({
    pipelineId: params.pipelineId,
    newStatus: params.newStatus,
  });

  // 2. Call log_activity reducer (creates ActivityLog entry)
  await conn.reducers.logActivity({
    entityType: 'pipeline',
    entityId: params.pipelineId,
    action: 'status_change',
    detail: `${oldStatus} → ${params.newStatus}`,
    performedBy: member.name,  // identity from current session
  });

  // 3. Return success with summary
  return { success: true, message: `Pipeline updated: ${oldStatus} → ${params.newStatus}` };
}
```

**Error handling**: If `advancePipeline` succeeds but `logActivity` fails, the status change still stands (it's the primary action). The missing log entry is reported to the user as a warning, and can be manually added. This matches STDB's reducer-level atomicity — each reducer call is independent.

### Corrective Workflow for Accidental Transitions

Status transitions are irreversible in the normal flow (no undo window). If an accidental transition occurs, an Admin can use the same `update_pipeline_status` skill to set the status back. This is a deliberate corrective action, not an "undo" — it creates its own ActivityLog entry showing the correction.

## 7. File Changes Summary

### New Files (~710 LOC)

| File | LOC | Purpose |
|------|-----|---------|
| `documents/emailDraftGenerator.ts` | ~200 | Email draft generation (5 variants) |
| `documents/coverLetterGenerator.ts` | ~250 | Formal cover letter PDF |
| `documents/technicalSubmittalGenerator.ts` | ~180 | Tech docs index PDF |
| `components/TransitionCard.svelte` | ~80 | Tier 2 status transition confirmation card |

### Modified Files

| File | Change |
|------|--------|
| `documents/registry.ts` | Add 3 new document templates with context models |
| `skills/registry.ts` | Add 4 new skills with full `parameters` arrays |
| `skills/executor.ts` | Split into `documentExecutor.ts` + `statusExecutor.ts`, keep thin router |
| `ai/context.ts` | Enhance pipeline context sections, update doc list from 6→9, add recent activity |
| `ai/types.ts` | Add `transitionRequest` field to `ChatMessage` interface |
| `ChatPage.svelte` | Render `TransitionCard` when `transitionRequest` is present |

### No Changes Needed

| File | Why |
|------|-----|
| `module/src/index.ts` | Pipeline reducers already support status updates |
| `documents/letterhead.ts` | Shared letterhead, already works |
| `lib/format.ts` | BHD formatting, already works |
| `ai/client.ts` | No changes — `buildSystemPrompt()` is already called from here |
| Existing 6 generators | Untouched, they work as-is |

## 8. Conversation Continuity & AI Memory

### The Chaos Monkey Problem

Real users are chaotic. Ramya might:
- Start discussing BAPCO pricing, get interrupted by a phone call, close the browser
- Come back 2 hours later and say "where were we with BAPCO?"
- Switch mid-conversation from BAPCO to YATEEM and back
- Want the AI to remember that "BAPCO always negotiates 3% down" across ALL future sessions

The system must handle all of this gracefully. Conversations are not neat linear flows — they're interrupted, interleaved, and resumed.

### Inspiration: AMCE (Ananta Memory Compression Engine)

The full AMCE vision (see `asymmetrica-runtime/ananta_memory_compression_work.md`) describes quaternion-algebraic state distillation for persistent AI memory — encoding conversation structure into compact, losslessly reconstructible quaternion states. For V5, we implement the **practical subset** of AMCE principles:

- **Conversation persistence** (AMCE's Tier 2 Sparse Index → STDB `ChatMessage` table)
- **AI observations** (AMCE's Semantic Extraction → STDB `AiMemory` table)
- **State hydration** (AMCE's Reconstructor → reload context on session resume)

The full quaternion compression pipeline is a future upgrade path via the Asymmetrica Runtime.

### 8A. Schema Additions (STDB)

Two new tables in `module/src/index.ts`:

#### `ChatMessage` Table

Persists all conversation messages in STDB so they survive browser refreshes and session changes.

```typescript
@table({ name: 'chat_message', public: true })
class ChatMessage {
  @primaryKey id: u64 = 0n;
  memberId: Identity;           // who sent this message
  role: string;                 // 'user' | 'assistant' | 'system'
  content: string;              // message text
  skillRequest?: string;        // JSON of extracted skill (if any)
  approvalStatus?: string;      // 'Proposed' | 'Approved' | 'Rejected' | 'Executed'
  transitionRequest?: string;   // JSON of status transition (if any)
  pipelineContext?: string;     // which pipeline(s) were being discussed (JSON array of IDs)
  createdAt: Timestamp;
}
```

**Key design decisions**:
- `pipelineContext` tracks which pipelines were active in each message, enabling "where were we?" reconstruction
- Messages are never deleted (audit trail), but UI can paginate
- `skillRequest` and `transitionRequest` stored as JSON strings for flexibility

#### `AiMemory` Table

Persistent AI observations about users, parties, and business patterns — the things that make the AI feel like a real colleague who REMEMBERS.

```typescript
@table({ name: 'ai_memory', public: true })
class AiMemory {
  @primaryKey id: u64 = 0n;
  category: string;             // 'user_preference' | 'party_pattern' | 'business_insight' | 'workflow_note'
  subject: string;              // what/who this is about (e.g. "BAPCO", "Ramya", "pricing_strategy")
  content: string;              // the observation in natural language
  confidence: u32;              // 0-100, how confident the AI is
  source: string;               // 'ai_observed' | 'user_told' | 'data_derived'
  createdBy: Identity;          // which user's session created this
  createdAt: Timestamp;
  lastRelevantAt: Timestamp;    // updated when this memory is used in a response
  expiresAt?: Timestamp;        // optional TTL for time-bound observations
}
```

**Memory categories**:

| Category | Example | Lifetime |
|----------|---------|----------|
| `user_preference` | "Ramya prefers PDF over DOCX for final offers" | Long-lived |
| `party_pattern` | "BAPCO always negotiates 3% down on first offer" | Long-lived |
| `business_insight` | "Water treatment sector margins average 25%" | Long-lived |
| `workflow_note` | "EH-15-26: Ramya was discussing 22% margin for BAPCO" | Medium-lived, per-pipeline |

**How the AI creates memories**: The AI can propose a `remember` action (similar to Rythu Mitra's pattern):
```json
{"skill": "remember", "params": {"category": "party_pattern", "subject": "BAPCO", "content": "Always negotiates 3% down on first offer"}}
```
This goes through Tier 1 confirmation — Ramya sees what the AI wants to remember and can approve/reject/edit.

### 8B. Conversation Continuity Flow

#### On Session Start (user opens chat):

1. Load last 20 `ChatMessage` records from STDB for this member
2. Load all `AiMemory` records (injected into system prompt)
3. Reconstruct conversation context — the AI sees the recent history and can continue naturally

#### During Conversation:

1. Every user message and AI response is written to `ChatMessage` via reducer
2. `pipelineContext` is set based on which pipelines the AI mentions/discusses
3. AI can propose `remember` actions for significant observations
4. When user switches topics mid-conversation, the AI naturally follows (conversation history provides continuity)

#### On Session Resume (user returns after break):

1. User says "where were we?" or just starts chatting
2. System prompt includes last 20 messages + all AI memories
3. AI reconstructs context: "Last time we were working on EH-15-26 for BAPCO — you'd finalized 22% margin and I generated the offer. You mentioned you still needed to send it. Did you get that done?"

#### Cross-User Shared Knowledge:

When Ramya creates a memory about BAPCO, it's visible to other team members (shared `AiMemory` table). When Abhie discusses BAPCO later, the AI knows "BAPCO always negotiates 3% down" because Ramya's observation is in the shared memory pool. This is AMCE Section 9.5 (Collaborative Memory Spaces) in practice.

### 8C. New Skills for Memory

```typescript
{ name: 'remember',
  displayName: 'Remember This',
  category: 'data',
  approval: 'explicit',  // user confirms what AI wants to remember
  requiredRoles: ['Admin', 'Manager', 'Sales', 'Operations', 'Accountant'],
  parameters: [
    { name: 'category', type: 'string', required: true, description: 'user_preference | party_pattern | business_insight | workflow_note' },
    { name: 'subject', type: 'string', required: true, description: 'What/who this is about' },
    { name: 'content', type: 'string', required: true, description: 'The observation to remember' },
  ] }

{ name: 'forget',
  displayName: 'Forget This',
  category: 'data',
  approval: 'explicit',
  requiredRoles: ['Admin', 'Manager'],  // Only managers can delete memories
  parameters: [
    { name: 'memoryId', type: 'string', required: true, description: 'ID of the memory to remove' },
  ] }
```

### 8D. Updated File Changes

Additional new files for memory/continuity:

| File | LOC | Purpose |
|------|-----|---------|
| Reducers in `module/src/index.ts` | ~120 | `ChatMessage` + `AiMemory` tables, `saveChatMessage`, `saveAiMemory`, `deleteAiMemory` reducers |
| `lib/chatPersistence.ts` | ~100 | Client-side helpers: save messages to STDB, load history on session start |

Additional modified files:

| File | Change |
|------|--------|
| `module/src/index.ts` | Add `ChatMessage` and `AiMemory` tables + 3 reducers |
| `ai/context.ts` | Inject AI memories into system prompt ("Things I remember...") |
| `skills/registry.ts` | Add `remember` and `forget` skills |
| `skills/executor.ts` (or `statusExecutor.ts`) | Add `handleRemember` and `handleForget` handlers |

## 9. Example User Journey: Ramya's Morning

```
08:30 — Ramya logs in, opens Chat hub

RAMYA: "Good morning! What's on my plate today?"

AI: "Morning Ramya! You have 3 active items:
     1. BAPCO EH-15-26 — costing is done, ready to generate the offer
     2. YATEEM EH-31-26 — sent REV-1 five days ago, follow-up due today
     3. VEOLIA EH-09-26 — closed won, invoice pending

     Also, ALBA has a payment 45 days overdue (890 BHD). Want to start anywhere?"

RAMYA: "Let's do BAPCO first. What margin are we at?"

AI: "EH-15-26 has 3 Cerabar PMP71 transmitters at 420 BHD each from E+H.
     Your costing shows 22% margin at 540 BHD each, total 1,620 BHD + VAT.
     Last time BAPCO got 18% on a similar order. Want to adjust?"

RAMYA: "No, 22% is fine for this project size. Generate the offer."

AI: [Tier 1 ConfirmCard: Generate Quotation — BAPCO, 3 items, 1,620 BHD + VAT]

RAMYA: ✓ Confirm → PDF downloads

RAMYA: "Now draft the submission email"

AI: [Tier 1 ConfirmCard: Draft Email — Offer Submission for EH-15-26]

RAMYA: ✓ Confirm → Email text appears in chat, she copies to Outlook

RAMYA: "Also generate the cover letter"

AI: [Tier 1 ConfirmCard: Generate Cover Letter — EH-15-26 BAPCO]

RAMYA: ✓ Confirm → Cover letter PDF downloads

--- Ramya sends email with attachments from Outlook ---

RAMYA: "Done, I've sent the quotation to BAPCO"

AI: [Tier 2 ConfirmCard:
     Pipeline: EH-15-26 BAPCO UPSTREAM-FEED
     Amount: 1,620 BHD
     Proposal ──→ Quotation Sent
     Signed by: Ramya (Sales)]

RAMYA: ✓ Confirm Transition → STDB updated, ActivityLog entry created

AI: "Marked as sent! I've set a 7-day follow-up for March 26th.
     Want to move on to the YATEEM follow-up?"

--- Total time: ~8 minutes (vs 4-5 hours manually) ---
```

### Chaos Monkey Scenario: Interrupted Flow

```
10:15 — Ramya is working on YATEEM follow-up, phone rings, she closes the browser

14:00 — Ramya comes back, opens chat

RAMYA: "Hey, where were we?"

AI: "Welcome back Ramya! Earlier today you:
     ✓ Generated and sent the BAPCO EH-15-26 quotation (marked as sent)
     ... Were about to draft a follow-up email for YATEEM EH-31-26

     I also remember that BAPCO always negotiates 3% down on first offers
     (from your note last month). Want to continue with YATEEM?"

--- AI reconstructed context from ChatMessage history + AiMemory ---
```

### Cross-User Knowledge Sharing

```
Next day — Abhie logs in

ABHIE: "I need to prepare a quote for BAPCO, new project"

AI: "BAPCO is a Grade A customer. A few things I know about them:
     - They typically negotiate 3% down on first offers (from Ramya's experience)
     - Last order was EH-15-26, 3x Cerabar PMP71 at 22% margin
     - Payment terms: Net 45 days

     Want to start building the costing for this new project?"

--- AI pulled shared AiMemory entries about BAPCO ---
```

## 10. Success Criteria

- All 9 document types generate correctly with PH Trading letterhead and formatting
- Two-tier confirmation works: documents are Tier 1, status transitions are Tier 2
- AI system prompt includes live pipeline context from STDB
- Status transitions write to ActivityLog with employee identity
- Email drafts are copy-pasteable (not PDF)
- Cover letters match PH Trading's formal letter style
- Technical submittals produce clean index tables
- No document generation triggers any status change automatically
- No status change happens without explicit Tier 2 confirmation
- Chat messages persist in STDB and reload on session resume
- AI memories persist across sessions and are shared across team members
- User can approve/reject/edit what the AI wants to remember
- Interrupted workflows can be resumed naturally ("where were we?")
- Cross-user knowledge sharing works (Ramya's observations help Abhie)
