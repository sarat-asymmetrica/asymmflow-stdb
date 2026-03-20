# Conversation-First Document Flows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable PH Trading employees to generate documents and transition pipeline status through natural AI conversation, with persistent chat history and shared AI memory across sessions.

**Architecture:** Extend existing V5 skill/executor/document pipeline with 3 new document generators (email draft, cover letter, technical submittal), a two-tier confirmation system (Tier 1 for docs, Tier 2 for status transitions with identity signing), conversation persistence via STDB `ChatMessage` table, and shared AI memory via STDB `AiMemory` table. All changes follow existing patterns — no new architectural paradigms.

**Tech Stack:** SpacetimeDB (TypeScript module), Svelte 5, pdfMake, AIMLAPI (Grok/Claude), existing PH Trading letterhead assets.

**Spec:** `docs/superpowers/specs/2026-03-19-conversation-first-document-flows-design.md`

---

## File Map

### New Files

| File | LOC | Responsibility |
|------|-----|----------------|
| `client/src/lib/documents/emailDraftGenerator.ts` | ~200 | Generate 5 email variants (RFQ response, offer submission, follow-up, revision notice, PO ack) |
| `client/src/lib/documents/coverLetterGenerator.ts` | ~250 | Generate formal cover letter PDF with PH letterhead |
| `client/src/lib/documents/technicalSubmittalGenerator.ts` | ~180 | Generate tech docs index PDF |
| `client/src/lib/skills/documentExecutor.ts` | ~700 | All 9 document generation handlers (extracted from executor.ts + 3 new) |
| `client/src/lib/skills/statusExecutor.ts` | ~200 | Status transition handler + remember/forget handlers |
| `client/src/lib/chatPersistence.ts` | ~100 | Save/load chat messages to/from STDB |
| `client/src/lib/components/TransitionCard.svelte` | ~80 | Tier 2 status transition confirmation card |
| `module/src/memory_logic.ts` | ~120 | ChatMessage + AiMemory table logic, reducers |

### Modified Files

| File | Change |
|------|--------|
| `module/src/index.ts` | Add `ChatMessage` + `AiMemory` tables, 5 new reducers |
| `client/src/lib/skills/registry.ts` | Add 6 new skills (3 doc + status + remember + forget) |
| `client/src/lib/skills/executor.ts` | Slim to thin router importing documentExecutor + statusExecutor |
| `client/src/lib/ai/context.ts` | Enhanced pipeline context, AI memories in prompt, 9 doc types |
| `client/src/lib/ai/types.ts` | Add `transitionRequest` field to ChatMessage interface |
| `client/src/lib/documents/registry.ts` | Add 3 new document templates |

---

## Task 1: STDB Schema — ChatMessage & AiMemory Tables

**Files:**
- Create: `module/src/memory_logic.ts`
- Modify: `module/src/index.ts`
- Test: `module/src/memory.test.ts`

This task adds two new STDB tables and their reducers. `ChatMessage` persists all conversation messages so users can resume interrupted flows. `AiMemory` stores AI observations shared across the team.

- [ ] **Step 1: Write failing test for ChatMessage reducer**

Create `module/src/memory.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('ChatMessage', () => {
  it('should save a chat message with required fields', () => {
    const msg = {
      role: 'user',
      content: 'What margin did we give BAPCO?',
      pipelineContext: '[]',
    };
    expect(msg.role).toBe('user');
    expect(msg.content).toContain('BAPCO');
  });

  it('should save assistant message with skill request', () => {
    const msg = {
      role: 'assistant',
      content: 'I can generate that quotation.',
      skillRequest: JSON.stringify({ skill: 'generate_quotation', params: { partyId: '7' } }),
      pipelineContext: JSON.stringify([15]),
    };
    const parsed = JSON.parse(msg.skillRequest!);
    expect(parsed.skill).toBe('generate_quotation');
  });
});

describe('AiMemory', () => {
  it('should create a party pattern memory', () => {
    const mem = {
      category: 'party_pattern',
      subject: 'BAPCO',
      content: 'Always negotiates 3% down on first offer',
      confidence: 85,
      source: 'ai_observed',
    };
    expect(mem.category).toBe('party_pattern');
    expect(mem.confidence).toBe(85);
  });

  it('should validate memory categories', () => {
    const validCategories = ['user_preference', 'party_pattern', 'business_insight', 'workflow_note'];
    expect(validCategories).toContain('party_pattern');
    expect(validCategories).toContain('workflow_note');
  });
});
```

- [ ] **Step 2: Run test to verify it passes (pure logic test)**

Run: `cd "C:/Projects/asymm-kit-factory/experiments/003-asymmflow-reimagined/module" && npx vitest run src/memory.test.ts`
Expected: PASS (these are unit tests for data shapes)

- [ ] **Step 3: Add ChatMessage and AiMemory tables to STDB schema**

In `module/src/index.ts`, add these row definitions alongside existing ones (after `aiActionRow`):

```typescript
const chatMessageRow = {
  id: t.u64().primaryKey().autoInc(),
  memberId: t.identity(),
  role: t.string(),        // 'user' | 'assistant' | 'system'
  content: t.string(),
  skillRequest: t.string().optional(),       // JSON of extracted skill (if any)
  approvalStatus: t.string().optional(),     // 'Proposed' | 'Approved' | etc.
  transitionRequest: t.string().optional(),  // JSON of status transition (if any)
  pipelineContext: t.string().optional(),    // JSON array of pipeline IDs
  createdAt: t.timestamp(),                  // matches existing pattern (use ctx.timestamp)
};

const aiMemoryRow = {
  id: t.u64().primaryKey().autoInc(),
  category: t.string(),    // 'user_preference' | 'party_pattern' | 'business_insight' | 'workflow_note'
  subject: t.string(),
  content: t.string(),
  confidence: t.u32(),     // 0-100
  source: t.string(),      // 'ai_observed' | 'user_told' | 'data_derived'
  createdBy: t.identity(),
  createdAt: t.timestamp(),          // matches existing pattern
  lastRelevantAt: t.timestamp(),     // updated when memory is used
  expiresAt: t.timestamp().optional(),  // null = no expiry
};
```

**Note:** Uses `t.timestamp()` and `t.string().optional()` to match existing codebase patterns (see `offerSentAt`, `nextFollowUp` in pipelineRow). Never use `.default()` — it's not supported in this SDK version.

Add to the schema object:

```typescript
const spacetimedb = schema({
  // ... existing tables ...
  chat_message: chatMessageRow,
  ai_memory: aiMemoryRow,
});
```

- [ ] **Step 4: Add reducers for ChatMessage and AiMemory**

Create `module/src/memory_logic.ts`:

**Note:** This follows the same pattern as `auth_logic.ts` — export pure implementation functions that receive helper functions as parameters. The `requireMember` and `requireRole` helpers are defined in `index.ts` (not exported), so they are passed in from the reducer wrappers.

```typescript
// Save a chat message (called after every user/assistant turn)
export function saveChatMessageImpl(
  ctx: any,
  args: { role: string; content: string; skillRequest: string;
          approvalStatus: string; transitionRequest: string; pipelineContext: string },
  requireMember: (ctx: any) => any
) {
  requireMember(ctx); // verify caller is a registered member
  ctx.db.chat_message.insert({
    id: 0n,
    memberId: ctx.sender,
    role: args.role,
    content: args.content,
    skillRequest: args.skillRequest || undefined,
    approvalStatus: args.approvalStatus || undefined,
    transitionRequest: args.transitionRequest || undefined,
    pipelineContext: args.pipelineContext || undefined,
    createdAt: ctx.timestamp,  // use ctx.timestamp (STDB Timestamp), NOT Date.now()
  });
}

// Save an AI memory observation
export function saveAiMemoryImpl(
  ctx: any,
  args: { category: string; subject: string; content: string;
          confidence: number; source: string },
  requireMember: (ctx: any) => any
) {
  requireMember(ctx);
  const validCategories = ['user_preference', 'party_pattern', 'business_insight', 'workflow_note'];
  if (!validCategories.includes(args.category)) {
    throw new Error(`Invalid memory category: ${args.category}`);
  }
  ctx.db.ai_memory.insert({
    id: 0n,
    category: args.category,
    subject: args.subject,
    content: args.content,
    confidence: args.confidence,
    source: args.source,
    createdBy: ctx.sender,
    createdAt: ctx.timestamp,
    lastRelevantAt: ctx.timestamp,
    expiresAt: undefined,  // null = no expiry (optional field)
  });
}

// Delete an AI memory
export function deleteAiMemoryImpl(
  ctx: any,
  args: { memoryId: bigint },
  requireMember: (ctx: any) => any,
  requireRole: (member: any, ...roles: string[]) => void
) {
  const member = requireMember(ctx);
  requireRole(member, 'Admin', 'Manager');
  const mem = ctx.db.ai_memory.id.find(args.memoryId);
  if (!mem) throw new Error(`Memory ${args.memoryId} not found`);
  ctx.db.ai_memory.id.delete(args.memoryId);
}
```

Add reducer exports in `module/src/index.ts`:

```typescript
export const save_chat_message = spacetimedb.reducer(
  { name: 'save_chat_message' },
  { role: t.string(), content: t.string(), skillRequest: t.string(),
    approvalStatus: t.string(), transitionRequest: t.string(), pipelineContext: t.string() },
  (ctx, args) => saveChatMessageImpl(ctx, args, requireMember)
);

export const save_ai_memory = spacetimedb.reducer(
  { name: 'save_ai_memory' },
  { category: t.string(), subject: t.string(), content: t.string(),
    confidence: t.u32(), source: t.string() },
  (ctx, args) => saveAiMemoryImpl(ctx, args, requireMember)
);

export const delete_ai_memory = spacetimedb.reducer(
  { name: 'delete_ai_memory' },
  { memoryId: t.u64() },
  (ctx, args) => deleteAiMemoryImpl(ctx, args, requireMember, requireRole)
);
```

- [ ] **Step 5: Build and verify STDB module compiles**

Run: `cd "C:/Projects/asymm-kit-factory/experiments/003-asymmflow-reimagined/module" && npx spacetime build`
Expected: Build succeeds with no errors

- [ ] **Step 6: Run all module tests**

Run: `cd "C:/Projects/asymm-kit-factory/experiments/003-asymmflow-reimagined/module" && pnpm test`
Expected: All existing tests + new memory tests pass

- [ ] **Step 7: Commit**

```bash
git add module/src/index.ts module/src/memory_logic.ts module/src/memory.test.ts
git commit -m "feat(stdb): add ChatMessage and AiMemory tables with reducers"
```

---

## Task 2: Chat Persistence Layer (Client)

**Files:**
- Create: `client/src/lib/chatPersistence.ts`
- Modify: `client/src/lib/ai/types.ts`

This task creates the client-side helpers that save every message to STDB and reload conversation history on session start.

- [ ] **Step 1: Add `transitionRequest` field to ChatMessage in types.ts**

In `client/src/lib/ai/types.ts`, add to the `ChatMessage` interface (after `skillResult` field):

```typescript
  transitionRequest?: {
    pipelineId: string;
    pipelineName: string;
    customerName: string;
    amountBhd: string;
    oldStatus: string;
    newStatus: string;
    signedBy: string;
    status: 'Proposed' | 'Approved' | 'Rejected';
  };
```

- [ ] **Step 2: Create chatPersistence.ts**

Create `client/src/lib/chatPersistence.ts`:

```typescript
import type { ChatMessage } from './ai/types';

/**
 * Save a chat message to STDB for cross-session persistence.
 * Called after every user message and assistant response.
 */
export async function persistMessage(
  conn: any,
  msg: ChatMessage
): Promise<void> {
  try {
    await conn.reducers.save_chat_message({
      role: msg.role,
      content: msg.content,
      skillRequest: msg.approval ? JSON.stringify({
        skillName: msg.approval.skillName,
        plan: msg.approval.plan,
        status: msg.approval.status,
      }) : '',
      approvalStatus: msg.approval?.status || '',
      transitionRequest: msg.transitionRequest
        ? JSON.stringify(msg.transitionRequest)
        : '',
      pipelineContext: '[]', // populated by caller if known
    });
  } catch (e) {
    console.warn('[chatPersistence] Failed to save message:', e);
    // Non-blocking: chat continues even if persistence fails
  }
}

/**
 * Load recent chat messages from STDB on session start.
 * Returns last `limit` messages for the current member, sorted by createdAt.
 */
export function loadRecentMessages(
  chatMessages: any[], // STDB chat_message rows from subscription
  currentIdentity: any,
  limit: number = 20
): ChatMessage[] {
  const myMessages = chatMessages
    .filter((m: any) => String(m.memberId) === String(currentIdentity))
    .sort((a: any, b: any) => Number(a.createdAt) - Number(b.createdAt))
    .slice(-limit);

  return myMessages.map((m: any) => ({
    id: `stdb-${m.id}`,
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
    timestamp: Number(m.createdAt),
    approval: m.skillRequest ? (() => {
      try {
        const parsed = JSON.parse(m.skillRequest);
        return parsed.skillName ? parsed : undefined;
      } catch { return undefined; }
    })() : undefined,
    transitionRequest: m.transitionRequest ? (() => {
      try { return JSON.parse(m.transitionRequest); }
      catch { return undefined; }
    })() : undefined,
  }));
}
```

- [ ] **Step 3: Verify client builds**

Run: `cd "C:/Projects/asymm-kit-factory/experiments/003-asymmflow-reimagined/client" && npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/chatPersistence.ts client/src/lib/ai/types.ts
git commit -m "feat(client): add chat persistence layer and transitionRequest type"
```

---

## Task 3: Enhanced AI Context (context.ts)

**Files:**
- Modify: `client/src/lib/ai/context.ts`

This task enhances the AI system prompt with richer pipeline context, AI memories, and the updated document list (6 → 9 types).

- [ ] **Step 1: Add AI memory injection to buildSystemPrompt**

In `client/src/lib/ai/context.ts`, add a new import and helper function. Add near the top of the file:

```typescript
// Import the ai_memory store (will be available from STDB subscription)
// Usage: const memories = get(aiMemories); // from db.ts stores
```

Add a `formatRelativeTime` helper (this function does NOT exist in `format.ts`, so define it locally):

```typescript
/** Format a STDB timestamp as relative time (e.g. "2 days ago", "just now"). */
function formatRelativeTime(timestamp: any): string {
  const ms = typeof timestamp === 'bigint'
    ? Number(timestamp / 1000n)  // microseconds to ms
    : Number(timestamp?.microsSinceUnixEpoch ? timestamp.microsSinceUnixEpoch / 1000n : 0);
  const diffMs = Date.now() - ms;
  const days = Math.floor(diffMs / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}
```

Then add a new function after `buildBusinessState()`:

```typescript
/**
 * Build AI memory context section for the system prompt.
 * Injects persistent AI observations about users, parties, and patterns.
 */
export function buildMemoryContext(memories: any[]): string {
  if (!memories || memories.length === 0) return '';

  const grouped: Record<string, any[]> = {};
  for (const mem of memories) {
    const cat = mem.category || 'general';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(mem);
  }

  let section = '\n\n=== THINGS I REMEMBER (shared team knowledge) ===\n';

  if (grouped['party_pattern']?.length) {
    section += '\nCustomer/Supplier Patterns:\n';
    for (const m of grouped['party_pattern']) {
      section += `- ${m.subject}: ${m.content}\n`;
    }
  }
  if (grouped['user_preference']?.length) {
    section += '\nUser Preferences:\n';
    for (const m of grouped['user_preference']) {
      section += `- ${m.subject}: ${m.content}\n`;
    }
  }
  if (grouped['business_insight']?.length) {
    section += '\nBusiness Insights:\n';
    for (const m of grouped['business_insight']) {
      section += `- ${m.content}\n`;
    }
  }
  if (grouped['workflow_note']?.length) {
    section += '\nActive Workflow Notes:\n';
    for (const m of grouped['workflow_note']) {
      section += `- ${m.subject}: ${m.content}\n`;
    }
  }

  return section;
}
```

- [ ] **Step 2: Update document list in buildSystemPrompt**

Find the document generation protocol section in `buildSystemPrompt()` (around lines 504-514) and update it to list all 9 document types:

Replace the existing 6-item list with:

```typescript
// Document Generation Protocol section
`
=== DOCUMENT GENERATION ===
You can generate these documents when the user explicitly asks:
1. Tax Invoice — skill: create_invoice (requires partyId, subtotalFils, reference)
2. Quotation / Techno-Commercial Offer — skill: generate_quotation (requires partyId, items)
3. Statement of Account — skill: generate_statement (requires partyId)
4. Payment Chase — skill: chase_payment (requires partyId, channel)
5. Purchase Order — skill: generate_purchase_order (requires partyId, items)
6. Delivery Note — skill: generate_delivery_note (requires partyId, orderReference)
7. Email Draft — skill: generate_email_draft (requires partyId, variant: rfq_response|offer_submission|follow_up|revision_notice|po_acknowledgment)
8. Offer Cover Letter — skill: generate_cover_letter (requires partyId, pipelineId)
9. Technical Submittal — skill: generate_technical_submittal (requires pipelineId, documents JSON array)

Status Transitions:
- skill: update_pipeline_status (requires pipelineId, newStatus) — this shows a Tier 2 confirmation card with identity signing

Memory:
- skill: remember (requires category, subject, content) — save an observation for future reference
- skill: forget (requires memoryId) — remove a saved observation (Admin/Manager only)
`
```

- [ ] **Step 3: Add enhanced pipeline context to buildSystemPrompt**

In the pipeline section of `buildSystemPrompt()`, enhance the existing pipeline summary. Find where pipelines are listed and replace with a richer format:

```typescript
// Enhanced pipeline context
const pipelineSummary = pipelines
  .filter(p => p.status !== 'Terminal' && p.status !== 'Cancelled')
  .slice(0, 10)
  .map(p => {
    const party = parties.find(pt => pt.id === p.partyId);
    const partyName = party?.name || 'Unknown';
    const amountBhd = formatBHD(p.totalFils || 0n);
    // Find last activity for this pipeline
    const lastActivity = activities
      .filter(a => a.entityType === 'pipeline' && String(a.entityId) === String(p.id))
      .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))[0];
    const lastActionStr = lastActivity
      ? `Last: ${lastActivity.action} (${formatRelativeTime(lastActivity.createdAt)})`
      : 'No recent activity';
    return `- ${p.name || `Pipeline #${p.id}`} | ${partyName} | ${p.status} | ${amountBhd} BHD | ${lastActionStr}`;
  })
  .join('\n');
```

- [ ] **Step 4: Inject memory context into the final prompt**

At the end of `buildSystemPrompt()`, before the return statement, append the memory context. The caller will need to pass memories:

Update the function signature to accept an optional memories parameter:

```typescript
export function buildSystemPrompt(
  user: Member,
  state: BusinessState,
  memories?: any[]
): string {
  // ... existing prompt building ...

  // Before final return, append memory context
  const memorySection = memories ? buildMemoryContext(memories) : '';

  return basePrompt + memorySection;
}
```

- [ ] **Step 5: Verify client builds**

Run: `cd "C:/Projects/asymm-kit-factory/experiments/003-asymmflow-reimagined/client" && npm run build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/ai/context.ts
git commit -m "feat(ai): enhance system prompt with 9 doc types, pipeline context, AI memories"
```

---

## Task 4: Email Draft Generator

**Files:**
- Create: `client/src/lib/documents/emailDraftGenerator.ts`
- Modify: `client/src/lib/documents/registry.ts`

- [ ] **Step 1: Create emailDraftGenerator.ts**

Create `client/src/lib/documents/emailDraftGenerator.ts`:

```typescript
import { formatBHD } from '../format';

export type EmailVariant =
  | 'rfq_response'
  | 'offer_submission'
  | 'follow_up'
  | 'revision_notice'
  | 'po_acknowledgment';

export interface EmailDraftData {
  party: { name: string; grade?: string };
  contact?: { name: string; email?: string };
  pipeline?: {
    name: string;
    status: string;
    totalFils: bigint;
    validityDays?: number;
    reference?: string;
  };
  variant: EmailVariant;
  senderName: string;
  points?: string;          // specific points to mention
  overdueDays?: number;      // for follow-up variant
  revisionNotes?: string;    // for revision_notice variant
}

export interface EmailDraftResult {
  subject: string;
  body: string;
  variant: EmailVariant;
}

const SIGNATURE = `
Best regards,

PH TRADING W.L.L.
P.O. Box 815, Manama, Kingdom of Bahrain
Tel: +973 17 456789
www.phtrading.bh`;

export function generateEmailDraft(data: EmailDraftData): EmailDraftResult {
  const contactName = data.contact?.name || 'Sir/Madam';
  const companyName = data.party.name;

  switch (data.variant) {
    case 'rfq_response':
      return buildRfqResponse(data, contactName, companyName);
    case 'offer_submission':
      return buildOfferSubmission(data, contactName, companyName);
    case 'follow_up':
      return buildFollowUp(data, contactName, companyName);
    case 'revision_notice':
      return buildRevisionNotice(data, contactName, companyName);
    case 'po_acknowledgment':
      return buildPoAcknowledgment(data, contactName, companyName);
    default:
      throw new Error(`Unknown email variant: ${data.variant}`);
  }
}

function buildRfqResponse(
  data: EmailDraftData, contact: string, company: string
): EmailDraftResult {
  const ref = data.pipeline?.reference || data.pipeline?.name || '';
  return {
    subject: `Re: Request for Quotation${ref ? ` — ${ref}` : ''}`,
    body: `Dear ${contact},

Thank you for your enquiry${ref ? ` regarding ${ref}` : ''}. We acknowledge receipt and confirm that we are currently preparing our techno-commercial offer for your review.

${data.points ? `${data.points}\n\n` : ''}We will revert with our detailed proposal at the earliest.

${SIGNATURE}`,
    variant: 'rfq_response',
  };
}

function buildOfferSubmission(
  data: EmailDraftData, contact: string, company: string
): EmailDraftResult {
  const ref = data.pipeline?.reference || data.pipeline?.name || '';
  const amount = data.pipeline?.totalFils
    ? formatBHD(data.pipeline.totalFils)
    : '';
  const validity = data.pipeline?.validityDays || 30;

  return {
    subject: `Techno-Commercial Offer${ref ? ` — ${ref}` : ''} | PH Trading`,
    body: `Dear ${contact},

With reference to your enquiry, please find attached our techno-commercial offer${ref ? ` for ${ref}` : ''}.

${amount ? `Offer Value: ${amount} BHD (exclusive of VAT)\n` : ''}Validity: ${validity} days from the date of this email.

${data.points ? `${data.points}\n\n` : ''}Please do not hesitate to contact us should you require any clarification or further information. We look forward to your favorable response.

${SIGNATURE}`,
    variant: 'offer_submission',
  };
}

function buildFollowUp(
  data: EmailDraftData, contact: string, company: string
): EmailDraftResult {
  const ref = data.pipeline?.reference || data.pipeline?.name || '';
  const days = data.overdueDays || 0;
  const grade = data.party.grade || 'A';

  // Tone escalation based on grade + days (mirrors chaseGenerator pattern)
  let tone: 'friendly' | 'firm' = 'friendly';
  if (grade === 'A' && days > 14) tone = 'firm';
  if (grade === 'B' && days > 7) tone = 'firm';
  if (grade === 'C' || grade === 'D') tone = 'firm';

  const greeting = tone === 'friendly'
    ? `I hope this email finds you well. I am writing to follow up on our offer${ref ? ` ${ref}` : ''} submitted recently.`
    : `We are writing to follow up on our techno-commercial offer${ref ? ` ${ref}` : ''}, which is awaiting your response.`;

  return {
    subject: `Follow Up: Offer${ref ? ` ${ref}` : ''} | PH Trading`,
    body: `Dear ${contact},

${greeting}

${data.points ? `${data.points}\n\n` : ''}We would appreciate the opportunity to discuss this further and address any queries you may have. Please let us know a convenient time for a call or meeting.

${SIGNATURE}`,
    variant: 'follow_up',
  };
}

function buildRevisionNotice(
  data: EmailDraftData, contact: string, company: string
): EmailDraftResult {
  const ref = data.pipeline?.reference || data.pipeline?.name || '';

  return {
    subject: `Revised Offer${ref ? ` — ${ref}` : ''} | PH Trading`,
    body: `Dear ${contact},

Please find attached our revised techno-commercial offer${ref ? ` for ${ref}` : ''}.

${data.revisionNotes ? `Key changes in this revision:\n${data.revisionNotes}\n\n` : ''}All other terms and conditions remain unchanged unless specifically noted.

We look forward to your favorable response.

${SIGNATURE}`,
    variant: 'revision_notice',
  };
}

function buildPoAcknowledgment(
  data: EmailDraftData, contact: string, company: string
): EmailDraftResult {
  const ref = data.pipeline?.reference || data.pipeline?.name || '';

  return {
    subject: `PO Acknowledgment${ref ? ` — ${ref}` : ''} | PH Trading`,
    body: `Dear ${contact},

Thank you for your purchase order${ref ? ` for ${ref}` : ''}. We hereby acknowledge receipt and confirm that we are proceeding with order execution.

${data.points ? `${data.points}\n\n` : ''}We will keep you informed of the delivery timeline and any updates. Should you require any further information, please do not hesitate to contact us.

${SIGNATURE}`,
    variant: 'po_acknowledgment',
  };
}
```

- [ ] **Step 2: Add email_draft template to registry.ts**

In `client/src/lib/documents/registry.ts`, add the template definition before the REGISTRY map (around line 665):

```typescript
const EMAIL_DRAFT: DocumentTemplate = {
  id: 'email_draft',
  name: 'Email Draft',
  description: 'Generate professional email drafts for customer communication',
  category: 'communication',
  outputFormat: 'text',
  fields: [
    { name: 'partyId', label: 'Recipient', layer: 'hard', type: 'party',
      description: 'Customer or supplier to email' },
    { name: 'variant', label: 'Email Type', layer: 'hard', type: 'enum',
      description: 'rfq_response | offer_submission | follow_up | revision_notice | po_acknowledgment' },
    { name: 'pipelineId', label: 'Related Pipeline', layer: 'soft', type: 'string',
      description: 'Pipeline this email relates to' },
    { name: 'points', label: 'Points to Mention', layer: 'soft', type: 'string',
      description: 'Specific points the user wants included' },
    { name: 'contactName', label: 'Contact Name', layer: 'auto', type: 'string',
      description: 'Auto-filled from Contact table', source: 'contact.name' },
    { name: 'senderName', label: 'Sender', layer: 'auto', type: 'string',
      description: 'Auto-filled from current member', source: 'member.nickname' },
  ],
};
```

Add to the REGISTRY map:

```typescript
REGISTRY.set('email_draft', EMAIL_DRAFT);
```

- [ ] **Step 3: Verify client builds**

Run: `cd "C:/Projects/asymm-kit-factory/experiments/003-asymmflow-reimagined/client" && npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/documents/emailDraftGenerator.ts client/src/lib/documents/registry.ts
git commit -m "feat(docs): add email draft generator with 5 variants"
```

---

## Task 5: Cover Letter Generator

**Files:**
- Create: `client/src/lib/documents/coverLetterGenerator.ts`
- Modify: `client/src/lib/documents/registry.ts`

- [ ] **Step 1: Create coverLetterGenerator.ts**

Create `client/src/lib/documents/coverLetterGenerator.ts`:

```typescript
import { PH_LETTERHEAD_BASE64 } from './letterhead';
import { formatBHD } from '../format';

/** Format a JS Date as dd-MMM-yyyy (e.g. "19-Mar-2026"). NOT the same as format.ts formatDate which takes StdbTimestamp. */
function formatLetterDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export interface CoverLetterItem {
  description: string;
  quantity: number;
  unit: string;
}

export interface CoverLetterData {
  party: { name: string; grade?: string };
  contact?: { name: string };
  pipeline: {
    name: string;
    reference?: string;
    totalFils: bigint;
    validityDays?: number;
  };
  items: CoverLetterItem[];
  deliveryTerms?: string;
  notes?: string;
  senderName: string;
}

/**
 * Payment terms derived from customer grade (same logic as quotationGenerator)
 */
function getPaymentTerms(grade?: string): string {
  switch (grade) {
    case 'A': return 'Net 45 days from invoice date';
    case 'B': return 'Net 90 days from invoice date';
    case 'C': return '50% advance, balance on delivery';
    case 'D': return '100% advance before dispatch';
    default: return 'As per agreement';
  }
}

export function buildCoverLetterDocDefinition(data: CoverLetterData): object {
  const today = formatLetterDate(new Date());
  const contactName = data.contact?.name || 'Sir/Madam';
  const ref = data.pipeline.reference || data.pipeline.name;
  const amount = formatBHD(data.pipeline.totalFils);
  const validity = data.pipeline.validityDays || 30;
  const paymentTerms = getPaymentTerms(data.party.grade);

  const itemsTable = {
    table: {
      headerRows: 1,
      widths: [30, '*', 50, 40],
      body: [
        [
          { text: '#', style: 'tableHeader' },
          { text: 'Description', style: 'tableHeader' },
          { text: 'Qty', style: 'tableHeader', alignment: 'center' },
          { text: 'Unit', style: 'tableHeader', alignment: 'center' },
        ],
        ...data.items.map((item, i) => [
          { text: String(i + 1), alignment: 'center' },
          { text: item.description },
          { text: String(item.quantity), alignment: 'center' },
          { text: item.unit, alignment: 'center' },
        ]),
      ],
    },
    layout: 'lightHorizontalLines',
    margin: [0, 10, 0, 10],
  };

  return {
    pageSize: 'A4',
    pageMargins: [40, 90, 40, 80],
    background: [{
      image: PH_LETTERHEAD_BASE64,
      width: 595,
      absolutePosition: { x: 0, y: 0 },
    }],
    content: [
      { text: today, alignment: 'right', margin: [0, 0, 0, 5] },
      { text: `Ref: ${ref}`, alignment: 'right', margin: [0, 0, 0, 15] },
      { text: `To: ${data.party.name}`, style: 'buyerName' },
      { text: `Attn: ${contactName}`, margin: [0, 0, 0, 15] },
      {
        text: `Subject: Techno-Commercial Offer for ${ref}`,
        style: 'sectionLabel',
        margin: [0, 0, 0, 15],
      },
      { text: `Dear ${contactName},`, margin: [0, 0, 0, 10] },
      {
        text: 'With reference to your enquiry, we are pleased to submit our techno-commercial offer for the following:',
        margin: [0, 0, 0, 10],
      },
      itemsTable,
      {
        columns: [
          { text: 'Total:', style: 'sectionLabel', width: 80 },
          { text: `${amount} BHD (exclusive of VAT)` },
        ],
        margin: [0, 5, 0, 5],
      },
      {
        columns: [
          { text: 'Validity:', style: 'sectionLabel', width: 80 },
          { text: `${validity} days from the date hereof` },
        ],
        margin: [0, 5, 0, 5],
      },
      {
        columns: [
          { text: 'Delivery:', style: 'sectionLabel', width: 80 },
          { text: data.deliveryTerms || 'As per agreement' },
        ],
        margin: [0, 5, 0, 5],
      },
      {
        columns: [
          { text: 'Payment:', style: 'sectionLabel', width: 80 },
          { text: paymentTerms },
        ],
        margin: [0, 5, 0, 15],
      },
      ...(data.notes ? [{ text: data.notes, margin: [0, 0, 0, 15] }] : []),
      {
        text: 'We look forward to your favorable response and assure you of our best services at all times.',
        margin: [0, 0, 0, 30],
      },
      { text: 'Yours faithfully,', margin: [0, 0, 0, 5] },
      { text: 'PH TRADING W.L.L.', style: 'sectionLabel' },
      { text: data.senderName, margin: [0, 5, 0, 0] },
    ],
    styles: {
      buyerName: { bold: true, fontSize: 11 },
      sectionLabel: { bold: true, fontSize: 10 },
      tableHeader: { bold: true, fontSize: 9, fillColor: '#f5f5f0' },
    },
    defaultStyle: { fontSize: 10, font: 'Helvetica' },
  };
}

export async function generateCoverLetterPdf(data: CoverLetterData): Promise<void> {
  const pdfMake = (await import('pdfmake/build/pdfmake')).default;
  const pdfFonts = (await import('pdfmake/build/vfs_fonts')).default;
  pdfMake.vfs = pdfFonts.pdfMake?.vfs || pdfFonts.vfs;

  const docDef = buildCoverLetterDocDefinition(data);
  const ref = data.pipeline.reference || data.pipeline.name || 'cover-letter';
  pdfMake.createPdf(docDef as any).download(`${ref}-Cover-Letter.pdf`);
}
```

- [ ] **Step 2: Add cover_letter template to registry.ts**

In `client/src/lib/documents/registry.ts`, add:

```typescript
const COVER_LETTER: DocumentTemplate = {
  id: 'cover_letter',
  name: 'Offer Cover Letter',
  description: 'Formal letter accompanying a techno-commercial offer',
  category: 'communication',
  outputFormat: 'pdf',
  fields: [
    { name: 'partyId', label: 'Customer', layer: 'hard', type: 'party',
      description: 'Customer receiving the offer' },
    { name: 'pipelineId', label: 'Pipeline/Offer', layer: 'hard', type: 'string',
      description: 'Pipeline this cover letter accompanies' },
    { name: 'notes', label: 'Additional Notes', layer: 'soft', type: 'string',
      description: 'Special delivery promises or notes' },
    { name: 'contactName', label: 'Contact', layer: 'auto', type: 'string',
      description: 'Auto-filled from Contact table', source: 'contact.name' },
    { name: 'totalFils', label: 'Amount', layer: 'auto', type: 'bigint',
      description: 'Auto-filled from Pipeline costing', source: 'pipeline.totalFils' },
    { name: 'validityDays', label: 'Validity', layer: 'auto', type: 'number',
      description: 'Offer validity period', defaultValue: 30 },
    { name: 'paymentTerms', label: 'Payment Terms', layer: 'auto', type: 'string',
      description: 'Auto-derived from Party grade', source: 'party.grade' },
  ],
};
```

Add to REGISTRY: `REGISTRY.set('cover_letter', COVER_LETTER);`

- [ ] **Step 3: Verify client builds**

Run: `cd "C:/Projects/asymm-kit-factory/experiments/003-asymmflow-reimagined/client" && npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/documents/coverLetterGenerator.ts client/src/lib/documents/registry.ts
git commit -m "feat(docs): add cover letter PDF generator with PH letterhead"
```

---

## Task 6: Technical Submittal Generator

**Files:**
- Create: `client/src/lib/documents/technicalSubmittalGenerator.ts`
- Modify: `client/src/lib/documents/registry.ts`

- [ ] **Step 1: Create technicalSubmittalGenerator.ts**

Create `client/src/lib/documents/technicalSubmittalGenerator.ts`:

```typescript
import { PH_LETTERHEAD_BASE64 } from './letterhead';

/** Format a JS Date as dd-MMM-yyyy. */
function formatLetterDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export interface SubmittalDocument {
  name: string;
  type: string;  // 'TI' | 'DWG' | 'Sizing' | 'Spec' | 'Catalog' | 'Other'
  pages: number;
}

export interface TechnicalSubmittalData {
  party: { name: string };
  pipeline: {
    name: string;
    reference?: string;
  };
  documents: SubmittalDocument[];
  preparedBy: string;
}

export function buildTechnicalSubmittalDocDefinition(data: TechnicalSubmittalData): object {
  const today = formatLetterDate(new Date());
  const ref = data.pipeline.reference || data.pipeline.name;
  const totalPages = data.documents.reduce((sum, d) => sum + d.pages, 0);

  const docTable = {
    table: {
      headerRows: 1,
      widths: [30, '*', 60, 50],
      body: [
        [
          { text: '#', style: 'tableHeader', alignment: 'center' },
          { text: 'Document', style: 'tableHeader' },
          { text: 'Type', style: 'tableHeader', alignment: 'center' },
          { text: 'Pages', style: 'tableHeader', alignment: 'center' },
        ],
        ...data.documents.map((doc, i) => [
          { text: String(i + 1), alignment: 'center' },
          { text: doc.name },
          { text: doc.type, alignment: 'center' },
          { text: String(doc.pages), alignment: 'center' },
        ]),
      ],
    },
    layout: {
      hLineWidth: (i: number, node: any) =>
        i === 0 || i === 1 || i === node.table.body.length ? 1 : 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => '#cccccc',
      vLineColor: () => '#cccccc',
      paddingTop: () => 4,
      paddingBottom: () => 4,
    },
    margin: [0, 10, 0, 15] as [number, number, number, number],
  };

  return {
    pageSize: 'A4',
    pageMargins: [40, 90, 40, 80],
    background: [{
      image: PH_LETTERHEAD_BASE64,
      width: 595,
      absolutePosition: { x: 0, y: 0 },
    }],
    content: [
      {
        text: 'TECHNICAL SUBMITTAL',
        style: 'title',
        alignment: 'center',
        margin: [0, 0, 0, 5],
      },
      {
        columns: [
          { text: `Ref: ${ref}`, style: 'sectionLabel' },
          { text: `Customer: ${data.party.name}`, style: 'sectionLabel', alignment: 'right' },
        ],
        margin: [0, 0, 0, 15],
      },
      { text: 'Document List:', style: 'sectionLabel', margin: [0, 0, 0, 5] },
      docTable,
      {
        columns: [
          { text: `Total documents: ${data.documents.length}`, width: 'auto' },
          { text: `Total pages: ${totalPages}`, width: 'auto', margin: [20, 0, 0, 0] },
        ],
        margin: [0, 0, 0, 20],
      },
      {
        columns: [
          {
            text: [
              { text: 'Prepared by: ', style: 'sectionLabel' },
              { text: data.preparedBy },
            ],
          },
          {
            text: [
              { text: 'Date: ', style: 'sectionLabel' },
              { text: today },
            ],
            alignment: 'right',
          },
        ],
      },
    ],
    styles: {
      title: { bold: true, fontSize: 14 },
      sectionLabel: { bold: true, fontSize: 10 },
      tableHeader: { bold: true, fontSize: 9, fillColor: '#f5f5f0' },
    },
    defaultStyle: { fontSize: 10, font: 'Helvetica' },
  };
}

export async function generateTechnicalSubmittalPdf(
  data: TechnicalSubmittalData
): Promise<void> {
  const pdfMake = (await import('pdfmake/build/pdfmake')).default;
  const pdfFonts = (await import('pdfmake/build/vfs_fonts')).default;
  pdfMake.vfs = pdfFonts.pdfMake?.vfs || pdfFonts.vfs;

  const docDef = buildTechnicalSubmittalDocDefinition(data);
  const ref = data.pipeline.reference || data.pipeline.name || 'tech-submittal';
  pdfMake.createPdf(docDef as any).download(`${ref}-Technical-Submittal.pdf`);
}
```

- [ ] **Step 2: Add technical_submittal template to registry.ts**

In `client/src/lib/documents/registry.ts`, add:

```typescript
const TECHNICAL_SUBMITTAL: DocumentTemplate = {
  id: 'technical_submittal',
  name: 'Technical Submittal',
  description: 'Index of technical documents accompanying an offer',
  category: 'operations',
  outputFormat: 'pdf',
  fields: [
    { name: 'pipelineId', label: 'Pipeline/Offer', layer: 'hard', type: 'string',
      description: 'Pipeline this submittal indexes' },
    { name: 'documents', label: 'Document List', layer: 'hard', type: 'string',
      description: 'JSON array of {name, type, pages}' },
    { name: 'partyName', label: 'Customer', layer: 'auto', type: 'string',
      description: 'Auto-filled from Pipeline party', source: 'pipeline.party.name' },
    { name: 'preparedBy', label: 'Prepared By', layer: 'auto', type: 'string',
      description: 'Auto-filled from current member', source: 'member.nickname' },
  ],
};
```

Add to REGISTRY: `REGISTRY.set('technical_submittal', TECHNICAL_SUBMITTAL);`

- [ ] **Step 3: Verify client builds**

Run: `cd "C:/Projects/asymm-kit-factory/experiments/003-asymmflow-reimagined/client" && npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/documents/technicalSubmittalGenerator.ts client/src/lib/documents/registry.ts
git commit -m "feat(docs): add technical submittal PDF generator"
```

---

## Task 7: Skills Registry — Add 6 New Skills

**Files:**
- Modify: `client/src/lib/skills/registry.ts`

- [ ] **Step 1: Add 6 new skill definitions to SKILLS array**

In `client/src/lib/skills/registry.ts`, add to the `SKILLS` array (before the closing bracket, around line 525):

```typescript
  // === NEW: Document generation skills ===
  {
    name: 'generate_email_draft',
    displayName: 'Draft Email',
    description: 'Generate a professional email draft for customer communication. Supports RFQ response, offer submission, follow-up, revision notice, and PO acknowledgment variants.',
    category: 'communication',
    approval: 'explicit',
    requiredRoles: ['Admin', 'Manager', 'Sales', 'Operations', 'Accountant'],
    parameters: [
      { name: 'partyId', type: 'string', required: true, description: 'Recipient party ID' },
      { name: 'pipelineId', type: 'string', required: false, description: 'Related pipeline (for offer emails)' },
      { name: 'variant', type: 'string', required: true, description: 'Email type: rfq_response | offer_submission | follow_up | revision_notice | po_acknowledgment' },
      { name: 'points', type: 'string', required: false, description: 'Specific points to mention in the email' },
    ],
  },
  {
    name: 'generate_cover_letter',
    displayName: 'Offer Cover Letter',
    description: 'Generate a formal cover letter PDF with PH Trading letterhead to accompany a techno-commercial offer.',
    category: 'communication',
    approval: 'explicit',
    requiredRoles: ['Admin', 'Manager', 'Sales'],
    parameters: [
      { name: 'partyId', type: 'string', required: true, description: 'Customer party ID' },
      { name: 'pipelineId', type: 'string', required: true, description: 'Pipeline/offer this covers' },
      { name: 'notes', type: 'string', required: false, description: 'Additional notes or delivery promises' },
    ],
  },
  {
    name: 'generate_technical_submittal',
    displayName: 'Technical Submittal',
    description: 'Generate a PDF index of technical documents (specs, drawings, TI sheets) included with an offer.',
    category: 'data',
    approval: 'explicit',
    requiredRoles: ['Admin', 'Manager', 'Sales', 'Operations'],
    parameters: [
      { name: 'pipelineId', type: 'string', required: true, description: 'Pipeline/offer this indexes' },
      { name: 'documents', type: 'string', required: true, description: 'JSON array of {name, type, pages}' },
    ],
  },

  // === NEW: Status transition skill ===
  {
    name: 'update_pipeline_status',
    displayName: 'Update Pipeline Status',
    description: 'Transition a pipeline to a new status. Shows a Tier 2 confirmation card with identity signing. Used when the user confirms they have completed a real-world action (sent quotation, received PO, etc.).',
    category: 'data',
    approval: 'explicit',
    requiredRoles: ['Admin', 'Manager', 'Sales', 'Operations', 'Accountant'],
    parameters: [
      { name: 'pipelineId', type: 'string', required: true, description: 'Pipeline to update' },
      { name: 'newStatus', type: 'string', required: true, description: 'Target status (e.g. QuotationSent, Negotiation, ClosedWon)' },
      { name: 'notes', type: 'string', required: false, description: 'Optional notes for the transition' },
    ],
  },

  // === NEW: Memory skills ===
  {
    name: 'remember',
    displayName: 'Remember This',
    description: 'Save an observation about a customer, user preference, or business pattern for future reference. Shared across the team.',
    category: 'data',
    approval: 'explicit',
    requiredRoles: ['Admin', 'Manager', 'Sales', 'Operations', 'Accountant'],
    parameters: [
      { name: 'category', type: 'string', required: true, description: 'user_preference | party_pattern | business_insight | workflow_note' },
      { name: 'subject', type: 'string', required: true, description: 'What/who this is about (e.g. BAPCO, Ramya, pricing)' },
      { name: 'content', type: 'string', required: true, description: 'The observation to remember' },
    ],
  },
  {
    name: 'forget',
    displayName: 'Forget This',
    description: 'Remove a saved AI observation. Only Admin and Manager roles can delete memories.',
    category: 'data',
    approval: 'explicit',
    requiredRoles: ['Admin', 'Manager'],
    parameters: [
      { name: 'memoryId', type: 'string', required: true, description: 'ID of the memory to remove' },
    ],
  },
```

- [ ] **Step 2: Verify client builds**

Run: `cd "C:/Projects/asymm-kit-factory/experiments/003-asymmflow-reimagined/client" && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add client/src/lib/skills/registry.ts
git commit -m "feat(skills): add 6 new skills — email draft, cover letter, tech submittal, status transition, remember, forget"
```

---

## Task 8: Executor Split — documentExecutor + statusExecutor

**Files:**
- Create: `client/src/lib/skills/documentExecutor.ts`
- Create: `client/src/lib/skills/statusExecutor.ts`
- Modify: `client/src/lib/skills/executor.ts`

This is the largest task. We extract all document handlers into `documentExecutor.ts`, create `statusExecutor.ts` for transitions and memory, and slim `executor.ts` to a thin router.

- [ ] **Step 1: Create documentExecutor.ts**

Create `client/src/lib/skills/documentExecutor.ts`. Move all existing `handle*` functions that generate documents from `executor.ts` into this file, plus add the 3 new handlers:

```typescript
import type { SkillResult } from './types';
import { get } from 'svelte/store';
// Import all stores from db.ts
// Import all generators

/**
 * Route a document generation skill to its handler.
 * Returns null if the skill name is not a document skill.
 */
export async function executeDocumentSkill(
  skillName: string,
  params: Record<string, unknown>
): Promise<SkillResult | null> {
  switch (skillName) {
    // Existing document skills (move PDF/text generator handlers here from executor.ts)
    // NOTE: record_payment and create_invoice are STDB mutations, NOT document generators.
    // They stay in the main executor.ts with the query handlers.
    case 'generate_purchase_order':
      return await handleGeneratePurchaseOrder(params);
    case 'generate_delivery_note':
      return await handleGenerateDeliveryNote(params);
    case 'chase_payment':
      return await handleChasePayment(params);
    case 'generate_statement':
      return await handleGenerateStatement(params);
    case 'generate_quotation':
      return await handleGenerateQuotation(params);

    // New document skills
    case 'generate_email_draft':
      return await handleGenerateEmailDraft(params);
    case 'generate_cover_letter':
      return await handleGenerateCoverLetter(params);
    case 'generate_technical_submittal':
      return await handleGenerateTechnicalSubmittal(params);

    default:
      return null; // Not a document skill
  }
}

// === NEW HANDLERS ===

async function handleGenerateEmailDraft(
  params: Record<string, unknown>
): Promise<SkillResult> {
  const { generateEmailDraft } = await import('../documents/emailDraftGenerator');
  const partyId = params.partyId as string;
  const variant = params.variant as string;

  // Look up party and pipeline from stores
  const allParties = get((await import('../db')).parties);
  const party = allParties.find(p => String(p.id) === partyId);
  if (!party) return { success: false, summary: `Party ${partyId} not found`, error: 'not_found' };

  let pipeline: any = undefined;
  if (params.pipelineId) {
    const allPipelines = get((await import('../db')).pipelines);
    pipeline = allPipelines.find(p => String(p.id) === String(params.pipelineId));
  }

  const result = generateEmailDraft({
    party: { name: party.name, grade: party.grade },
    pipeline: pipeline ? {
      name: pipeline.name || `Pipeline #${pipeline.id}`,
      status: pipeline.status,
      totalFils: pipeline.totalFils || 0n,
      reference: pipeline.name,
    } : undefined,
    variant: variant as any,
    senderName: 'PH Trading Team',
    points: params.points as string | undefined,
  });

  return {
    success: true,
    summary: `Email draft generated (${result.variant}):\n\n**Subject:** ${result.subject}\n\n${result.body}`,
    data: { subject: result.subject, body: result.body, variant: result.variant },
  };
}

async function handleGenerateCoverLetter(
  params: Record<string, unknown>
): Promise<SkillResult> {
  const { generateCoverLetterPdf } = await import('../documents/coverLetterGenerator');
  const partyId = params.partyId as string;
  const pipelineId = params.pipelineId as string;

  const allParties = get((await import('../db')).parties);
  const party = allParties.find(p => String(p.id) === partyId);
  if (!party) return { success: false, summary: `Party ${partyId} not found`, error: 'not_found' };

  const allPipelines = get((await import('../db')).pipelines);
  const pipeline = allPipelines.find(p => String(p.id) === pipelineId);
  if (!pipeline) return { success: false, summary: `Pipeline ${pipelineId} not found`, error: 'not_found' };

  // Build items from line items if available
  const allLineItems = get((await import('../db')).lineItems);
  const pipelineItems = allLineItems
    .filter(li => li.parentType === 'pipeline' && String(li.parentId) === pipelineId)
    .map(li => ({
      description: li.description || 'Item',
      quantity: Number(li.quantity || 1),
      unit: li.unit || 'EA',
    }));

  await generateCoverLetterPdf({
    party: { name: party.name, grade: party.grade },
    pipeline: {
      name: pipeline.name || `Pipeline #${pipeline.id}`,
      reference: pipeline.name,
      totalFils: pipeline.totalFils || 0n,
      validityDays: 30,
    },
    items: pipelineItems.length > 0 ? pipelineItems : [{ description: 'As per attached offer', quantity: 1, unit: 'LOT' }],
    notes: params.notes as string | undefined,
    senderName: 'PH Trading Team',
  });

  return {
    success: true,
    summary: `Cover letter PDF generated for ${party.name} — ${pipeline.name}. Downloading...`,
  };
}

async function handleGenerateTechnicalSubmittal(
  params: Record<string, unknown>
): Promise<SkillResult> {
  const { generateTechnicalSubmittalPdf } = await import('../documents/technicalSubmittalGenerator');
  const pipelineId = params.pipelineId as string;

  const allPipelines = get((await import('../db')).pipelines);
  const pipeline = allPipelines.find(p => String(p.id) === pipelineId);
  if (!pipeline) return { success: false, summary: `Pipeline ${pipelineId} not found`, error: 'not_found' };

  const allParties = get((await import('../db')).parties);
  const party = allParties.find(p => p.id === pipeline.partyId);

  let documents: any[] = [];
  try {
    documents = JSON.parse(params.documents as string);
  } catch {
    return { success: false, summary: 'Invalid documents JSON', error: 'invalid_params' };
  }

  await generateTechnicalSubmittalPdf({
    party: { name: party?.name || 'Customer' },
    pipeline: {
      name: pipeline.name || `Pipeline #${pipeline.id}`,
      reference: pipeline.name,
    },
    documents,
    preparedBy: 'PH Trading Team',
  });

  return {
    success: true,
    summary: `Technical submittal PDF generated for ${pipeline.name} with ${documents.length} documents. Downloading...`,
  };
}

// === EXISTING HANDLERS (moved from executor.ts) ===
// Move handleGeneratePurchaseOrder, handleGenerateDeliveryNote,
// handleCreateInvoice, handleRecordPayment, handleChasePayment,
// handleGenerateStatement, handleGenerateQuotation here.
// Keep exact same implementation, just change file location.
```

**Note to implementer:** The existing handler functions (lines ~200-1120 of executor.ts) should be moved wholesale into this file. The imports they use (stores, generators, format utils) stay the same. This step is a mechanical move, not a rewrite.

- [ ] **Step 2: Create statusExecutor.ts**

Create `client/src/lib/skills/statusExecutor.ts`:

```typescript
import type { SkillResult } from './types';
import { get } from 'svelte/store';

/**
 * Route a status/memory skill to its handler.
 * Returns null if the skill name is not handled here.
 */
export async function executeStatusSkill(
  skillName: string,
  params: Record<string, unknown>
): Promise<SkillResult | null> {
  switch (skillName) {
    case 'update_pipeline_status':
      return await handleUpdatePipelineStatus(params);
    case 'remember':
      return await handleRemember(params);
    case 'forget':
      return await handleForget(params);
    default:
      return null;
  }
}

async function handleUpdatePipelineStatus(
  params: Record<string, unknown>
): Promise<SkillResult> {
  const pipelineId = params.pipelineId as string;
  const newStatus = params.newStatus as string;

  const db = await import('../db');
  const conn = db.getConnection();
  if (!conn) return { success: false, summary: 'Not connected to STDB', error: 'no_connection' };

  const allPipelines = get(db.pipelines);
  const pipeline = allPipelines.find(p => String(p.id) === pipelineId);
  if (!pipeline) return { success: false, summary: `Pipeline ${pipelineId} not found`, error: 'not_found' };

  const oldStatus = pipeline.status || 'Unknown';

  // 1. Advance pipeline status
  // IMPORTANT: advance_pipeline reducer requires ALL pipeline fields.
  // Spread the current pipeline and only override the status field.
  // (See existing handleGenerateQuotation in executor.ts lines 1042-1057 for pattern)
  try {
    await conn.reducers.advance_pipeline({
      id: pipeline.id,
      partyId: pipeline.partyId,
      title: pipeline.title || pipeline.name || '',
      newStatus,
      estimatedValueFils: pipeline.estimatedValueFils || pipeline.totalFils || 0n,
      winProbabilityBps: pipeline.winProbabilityBps || 0,
      competitorPresent: pipeline.competitorPresent || false,
      oemPriceFils: pipeline.oemPriceFils || 0n,
      markupBps: pipeline.markupBps || 0,
      additionalCostsFils: pipeline.additionalCostsFils || 0n,
      costingApproved: pipeline.costingApproved || false,
      offerSentAt: pipeline.offerSentAt,
      lossReason: pipeline.lossReason || '',
      nextFollowUp: pipeline.nextFollowUp,
    });
  } catch (e: any) {
    return { success: false, summary: `Failed to update pipeline: ${e.message}`, error: 'reducer_failed' };
  }

  // 2. Log activity (best-effort)
  // log_activity requires followUpDue (optional) — pass undefined explicitly
  try {
    await conn.reducers.log_activity({
      entityType: 'pipeline',
      entityId: BigInt(pipelineId),
      action: 'status_change',
      detail: `${oldStatus} → ${newStatus}${params.notes ? ` (${params.notes})` : ''}`,
      followUpDue: undefined,
    });
  } catch (e: any) {
    console.warn('[statusExecutor] Failed to log activity:', e);
    // Non-blocking: status change already succeeded
  }

  return {
    success: true,
    summary: `Pipeline updated: ${oldStatus} → ${newStatus}`,
    data: { pipelineId, oldStatus, newStatus },
  };
}

async function handleRemember(
  params: Record<string, unknown>
): Promise<SkillResult> {
  const db = await import('../db');
  const conn = db.getConnection();
  if (!conn) return { success: false, summary: 'Not connected to STDB', error: 'no_connection' };

  const category = params.category as string;
  const subject = params.subject as string;
  const content = params.content as string;

  try {
    await conn.reducers.save_ai_memory({
      category,
      subject,
      content,
      confidence: 80,
      source: 'ai_observed',
    });
  } catch (e: any) {
    return { success: false, summary: `Failed to save memory: ${e.message}`, error: 'reducer_failed' };
  }

  return {
    success: true,
    summary: `Remembered: "${content}" (about ${subject})`,
    data: { category, subject, content },
  };
}

async function handleForget(
  params: Record<string, unknown>
): Promise<SkillResult> {
  const db = await import('../db');
  const conn = db.getConnection();
  if (!conn) return { success: false, summary: 'Not connected to STDB', error: 'no_connection' };

  try {
    await conn.reducers.delete_ai_memory({
      memoryId: BigInt(params.memoryId as string),
    });
  } catch (e: any) {
    return { success: false, summary: `Failed to delete memory: ${e.message}`, error: 'reducer_failed' };
  }

  return {
    success: true,
    summary: `Memory removed.`,
  };
}
```

- [ ] **Step 3: Slim executor.ts to thin router**

Replace the `executeSkill` function body in `client/src/lib/skills/executor.ts` (around lines 1125-1232) with:

```typescript
import { executeDocumentSkill } from './documentExecutor';
import { executeStatusSkill } from './statusExecutor';

export async function executeSkill(
  skillName: string,
  params: Record<string, unknown>,
  options?: ExecuteSkillOptions
): Promise<SkillResult> {
  // RC-15 defense-in-depth guard (keep existing validation)
  const skill = getSkillByName(skillName);
  if (!skill) {
    return { success: false, summary: `Unknown skill: ${skillName}`, error: 'unknown_skill' };
  }
  if (options?.userRole && !canExecuteSkill(skill, options.userRole as any)) {
    return { success: false, summary: `Role '${options.userRole}' cannot execute '${skillName}'`, error: 'unauthorized' };
  }
  if (skill.approval !== 'auto' && !options?.approved) {
    return { success: false, summary: `Skill '${skillName}' requires approval`, error: 'approval_required' };
  }

  // Wrap all routing in try/catch (matches existing pattern in executor.ts)
  try {
    // Route to document executor (PDF/text generators only)
    const docResult = await executeDocumentSkill(skillName, params);
    if (docResult) return docResult;

    // Route to status/memory executor
    const statusResult = await executeStatusSkill(skillName, params);
    if (statusResult) return statusResult;

    // Route to existing query + mutation handlers (keep inline for now)
    // Note: record_payment and create_invoice stay here — they're STDB mutations, not document generators
    switch (skillName) {
      case 'query_dashboard':
        return await handleQueryDashboard();
      case 'query_customer_360':
        return await handleQueryCustomer360(params);
      case 'query_ar_aging':
        return await handleQueryARAging();
      case 'query_order_status':
        return await handleQueryOrderStatus(params);
      case 'predict_payment_date':
        return await handlePredictPaymentDate(params);
      case 'query_top_debtors':
        return await handleQueryTopDebtors(params);
      case 'record_payment':
        return await handleRecordPayment(params);
      case 'create_invoice':
        return await handleCreateInvoice(params);
      default:
        return { success: false, summary: `Skill '${skillName}' is not yet implemented`, error: 'not_implemented' };
    }
  } catch (e: any) {
    return { success: false, summary: `Skill execution failed: ${e.message}`, error: 'execution_error' };
  }
}
```

**Note to implementer:** Keep the query handler functions (`handleQueryDashboard`, etc.) in `executor.ts` for now — they're lightweight and don't need extraction yet. Move ONLY the document generation handlers (PO, DN, invoice, payment, chase, statement, quotation) to `documentExecutor.ts`.

- [ ] **Step 4: Verify client builds**

Run: `cd "C:/Projects/asymm-kit-factory/experiments/003-asymmflow-reimagined/client" && npm run build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/skills/documentExecutor.ts client/src/lib/skills/statusExecutor.ts client/src/lib/skills/executor.ts
git commit -m "refactor(skills): split executor into documentExecutor + statusExecutor + thin router"
```

---

## Task 9: TransitionCard Component

**Files:**
- Create: `client/src/lib/components/TransitionCard.svelte`

- [ ] **Step 1: Create TransitionCard.svelte**

Create `client/src/lib/components/TransitionCard.svelte`:

**Note:** Uses Svelte 5 runes syntax (`$props()`, `$derived`, lowercase `onclick`).

```svelte
<script lang="ts">
  interface TransitionRequest {
    pipelineId: string;
    pipelineName: string;
    customerName: string;
    amountBhd: string;
    oldStatus: string;
    newStatus: string;
    signedBy: string;
    status: 'Proposed' | 'Approved' | 'Rejected';
  }

  interface Props {
    request: TransitionRequest;
    onconfirm: () => void;
    onreject: () => void;
  }

  let { request, onconfirm, onreject }: Props = $props();

  let isPending = $derived(request.status === 'Proposed');
</script>

<div class="transition-card" class:approved={request.status === 'Approved'} class:rejected={request.status === 'Rejected'}>
  <div class="header">
    <span class="icon">&#x1f504;</span>
    <span class="title">Status Change Request</span>
  </div>

  <div class="details">
    <div class="row">
      <span class="label">Pipeline:</span>
      <span class="value">{request.pipelineName}</span>
    </div>
    <div class="row">
      <span class="label">Customer:</span>
      <span class="value">{request.customerName}</span>
    </div>
    <div class="row">
      <span class="label">Amount:</span>
      <span class="value">{request.amountBhd} BHD</span>
    </div>
  </div>

  <div class="transition-arrow">
    <span class="old-status">{request.oldStatus}</span>
    <span class="arrow">&#x2192;</span>
    <span class="new-status">{request.newStatus}</span>
  </div>

  <div class="signed-by">
    Signed by: {request.signedBy}
  </div>

  {#if isPending}
    <div class="actions">
      <button class="btn-confirm" onclick={onconfirm}>
        Confirm Transition
      </button>
      <button class="btn-cancel" onclick={onreject}>
        Cancel
      </button>
    </div>
  {:else if request.status === 'Approved'}
    <div class="status-badge approved-badge">Confirmed</div>
  {:else}
    <div class="status-badge rejected-badge">Cancelled</div>
  {/if}
</div>

<style>
  .transition-card {
    border: 2px solid var(--gold, #c5a059);
    border-radius: 8px;
    padding: 16px;
    margin: 8px 0;
    background: var(--surface, #fdfbf7);
  }
  .transition-card.approved { border-color: #4a9; opacity: 0.8; }
  .transition-card.rejected { border-color: #c4796b; opacity: 0.6; }
  .header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
  .icon { font-size: 18px; }
  .title { font-weight: 600; font-size: 14px; }
  .details { margin-bottom: 12px; }
  .row { display: flex; gap: 8px; margin-bottom: 4px; font-size: 13px; }
  .label { color: #888; min-width: 80px; }
  .value { font-weight: 500; }
  .transition-arrow {
    display: flex; align-items: center; gap: 12px;
    padding: 8px 12px; background: #f5f5f0; border-radius: 6px;
    margin-bottom: 12px; font-size: 14px; font-weight: 600;
  }
  .old-status { color: #888; }
  .arrow { color: var(--gold, #c5a059); font-size: 18px; }
  .new-status { color: #333; }
  .signed-by {
    font-size: 12px; color: #888; border-top: 1px solid #eee;
    padding-top: 8px; margin-bottom: 12px;
  }
  .actions { display: flex; gap: 8px; }
  .btn-confirm {
    flex: 1; padding: 8px 16px; background: var(--gold, #c5a059);
    color: white; border: none; border-radius: 6px; cursor: pointer;
    font-weight: 600; font-size: 13px;
  }
  .btn-confirm:hover { opacity: 0.9; }
  .btn-cancel {
    padding: 8px 16px; background: transparent;
    border: 1px solid #ccc; border-radius: 6px; cursor: pointer;
    font-size: 13px;
  }
  .status-badge { text-align: center; padding: 6px; border-radius: 4px; font-size: 12px; font-weight: 600; }
  .approved-badge { background: #e8f5e9; color: #2e7d32; }
  .rejected-badge { background: #fbe9e7; color: #c62828; }
</style>
```

- [ ] **Step 2: Verify client builds**

Run: `cd "C:/Projects/asymm-kit-factory/experiments/003-asymmflow-reimagined/client" && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add client/src/lib/components/TransitionCard.svelte
git commit -m "feat(ui): add TransitionCard component for Tier 2 status confirmations"
```

---

## Task 10: Integration — Wire Everything Together

**Files:**
- Modify: `client/src/App.svelte` (or ChatPage — wherever chat messages are rendered)
- Modify: `client/src/lib/db.ts` (add stores for new tables)

This task wires the new STDB subscriptions, injects memories into the system prompt, and integrates chat persistence + TransitionCard rendering.

- [ ] **Step 1: Add STDB stores for ChatMessage and AiMemory in db.ts**

In `client/src/lib/db.ts`, add stores for the two new tables. Follow the existing pattern for other table stores:

```typescript
// After existing store definitions, add:
export const chatMessages = writable<any[]>([]);
export const aiMemories = writable<any[]>([]);

// In the subscription setup (where other tables are subscribed), add:
// conn.db.chat_message.onInsert((msg) => { chatMessages.update(ms => [...ms, msg]); });
// conn.db.ai_memory.onInsert((mem) => { aiMemories.update(ms => [...ms, mem]); });
// conn.db.ai_memory.onDelete((mem) => { aiMemories.update(ms => ms.filter(m => m.id !== mem.id)); });
```

- [ ] **Step 2: Wire memories into system prompt**

In the chat component (where `buildSystemPrompt` is called), pass AI memories:

```typescript
// Where system prompt is built:
import { aiMemories } from '../db';
import { get } from 'svelte/store';

const memories = get(aiMemories);
const systemPrompt = buildSystemPrompt(currentUser, businessState, memories);
```

- [ ] **Step 3: Wire chat persistence**

In the chat component, after each message is sent/received:

```typescript
import { persistMessage } from '../chatPersistence';

// After user sends message:
await persistMessage(conn, userMessage);

// After AI responds:
await persistMessage(conn, assistantMessage);
```

- [ ] **Step 4: Wire TransitionCard rendering**

In the chat message rendering component, check for `transitionRequest`:

```svelte
{#if message.transitionRequest}
  <TransitionCard
    request={message.transitionRequest}
    onconfirm={() => handleTransitionConfirm(message)}
    onreject={() => handleTransitionReject(message)}
  />
{/if}
```

- [ ] **Step 5: Load conversation history on session start**

In the chat component's init/mount:

```typescript
import { loadRecentMessages } from '../chatPersistence';
import { chatMessages } from '../db';
import { get } from 'svelte/store';

onMount(() => {
  const stdbMessages = get(chatMessages);
  if (stdbMessages.length > 0) {
    const restored = loadRecentMessages(stdbMessages, currentIdentity, 20);
    messages = [...restored]; // Populate chat UI with history
  }
});
```

- [ ] **Step 6: Verify full build**

Run: `cd "C:/Projects/asymm-kit-factory/experiments/003-asymmflow-reimagined/client" && npm run build`
Expected: Build succeeds with 0 errors

- [ ] **Step 7: Commit**

```bash
git add client/src/lib/db.ts client/src/App.svelte
git commit -m "feat: wire STDB stores, chat persistence, memories, and TransitionCard"
```

---

## Task 11: Publish STDB Module & End-to-End Verification

- [ ] **Step 1: Build STDB module**

Run: `cd "C:/Projects/asymm-kit-factory/experiments/003-asymmflow-reimagined/module" && npx spacetime build`
Expected: Build succeeds

- [ ] **Step 2: Generate client bindings**

Run: `cd "C:/Projects/asymm-kit-factory/experiments/003-asymmflow-reimagined/module" && npx spacetime generate --lang typescript --out-dir ../client/src/lib/stdb`
Expected: TypeScript bindings generated for all tables including `chat_message` and `ai_memory`

- [ ] **Step 3: Publish to maincloud**

Run: `npx spacetime publish asymm-flow`
Expected: Module published successfully

- [ ] **Step 4: Start client dev server and test**

Run: `cd "C:/Projects/asymm-kit-factory/experiments/003-asymmflow-reimagined/client" && npm run dev`

Manual verification checklist:
1. Open chat, send a message — verify it persists in STDB (`chat_message` table)
2. Close browser, reopen — verify conversation history loads
3. Ask AI to generate an email draft — verify Tier 1 confirm card appears
4. Approve email draft — verify text appears in chat (copy-pasteable)
5. Ask AI to generate a cover letter — verify PDF downloads
6. Ask AI to update pipeline status — verify Tier 2 TransitionCard appears
7. Confirm transition — verify STDB pipeline status updates + ActivityLog entry
8. Ask AI to remember something — verify AiMemory entry created
9. Log out, log in as different user — verify shared memories appear in AI context

- [ ] **Step 5: Commit final integration**

```bash
git add -A
git commit -m "feat: conversation-first document flows — complete implementation"
```

---

## Summary

| Task | Files | New LOC | Description |
|------|-------|---------|-------------|
| 1 | module/ | ~120 | ChatMessage + AiMemory STDB tables |
| 2 | client/lib/ | ~100 | Chat persistence layer |
| 3 | client/lib/ai/ | ~80 | Enhanced AI context with memories |
| 4 | client/lib/documents/ | ~200 | Email draft generator (5 variants) |
| 5 | client/lib/documents/ | ~250 | Cover letter PDF generator |
| 6 | client/lib/documents/ | ~180 | Technical submittal PDF generator |
| 7 | client/lib/skills/ | ~80 | 6 new skill definitions |
| 8 | client/lib/skills/ | ~300 | Executor split + new handlers |
| 9 | client/lib/components/ | ~80 | TransitionCard Svelte component |
| 10 | client/ | ~50 | Integration wiring |
| 11 | — | — | Build, publish, verify |
| **Total** | | **~1,440** | |
