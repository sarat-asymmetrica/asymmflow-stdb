# F014 — AiAction Approval Flow (Proposed → Approved → Executed)

**Status:** 📋 Specced
**Wave:** 2 (AI Chat Core)
**Owner:** Commander + Claude
**Created:** 2026-03-20

---

## 0. Philosophy

> This is the moment where AI becomes leverage rather than chatbot. The approval card is where Abhie reviews a plan, contributes his tacit knowledge ("not EWA this month, they just paid"), and decides to act. The AI did the research; Abhie makes the decision.

---

## 1. User Story

As **Abhie (Admin)**,
I want to **review AI-proposed actions as structured cards in the chat interface before they execute**,
so that **I maintain control over business-critical operations (invoices, payments, communications) while delegating the cognitive work to the AI**.

---

## 2. Acceptance Criteria

### Proposal Phase
- [ ] AC1: When AI identifies an `explicit` or `admin_only` skill is needed, it calls `propose_ai_action` reducer — no execution happens yet
- [ ] AC2: The AiAction row appears in STDB with status `Proposed` and a JSON `plan` field describing exactly what will happen
- [ ] AC3: The chat UI renders Proposed AiAction rows as styled approval cards — distinct from regular message bubbles

### Approval Card UI
- [ ] AC4: Approval card shows: skill name, human-readable plan summary, affected entities (party names, amounts, counts), timestamp
- [ ] AC5: Approval card has three buttons: [Approve] (green) | [Edit Plan] (neutral) | [Cancel] (red)
- [ ] AC6: [Edit Plan] opens the plan JSON in an editable text area — Abhie can change args before approving
- [ ] AC7: [Cancel] sets AiAction status to `Rejected` and shows "Cancelled" state in the card
- [ ] AC8: Cards for already-executed actions are read-only (show status + result, no buttons)

### Execution Phase
- [ ] AC9: [Approve] calls `resolve_ai_action(id, 'Approved')` reducer, setting status to `Approved`
- [ ] AC10: Skill execution triggers immediately after reducer confirms `Approved` (client-side, not server-side)
- [ ] AC11: During execution, card shows a loading state: "[SkillName] running..."
- [ ] AC12: On success, status → `Executed`. Card shows result summary (e.g., "3 WhatsApp drafts generated")
- [ ] AC13: On failure, status → `Failed`. Card shows error message. [Retry] button appears.

### Audit Trail
- [ ] AC14: Every AiAction (Proposed/Approved/Rejected/Executed/Failed) is queryable from STDB
- [ ] AC15: `approvedBy` field stores the approver's STDB identity (ctx.sender in resolve reducer)
- [ ] AC16: `result` field stores execution output as JSON (file paths, message drafts, record IDs)

### Auto-Approval Bypass
- [ ] AC17: Skills with `approval: 'auto'` call their execute function directly — no AiAction row created, no approval card shown
- [ ] AC18: Auto-executed skills still log to ActivityLog (not AiAction) for auditability

---

## 3. Full-Stack Contract

### 3a. STDB Layer

The `AiAction` table already exists in Wave 0 schema. Two reducers to implement:

```typescript
// Reducer 9: AI proposes an action
reducer propose_ai_action(
  skillName: string,
  plan: string,  // JSON string describing the plan
  // implicitly: requestorId = ctx.sender
): void {
  db.aiAction.insert({
    requestorId: ctx.sender,
    skillName,
    plan,
    status: AiActionStatus.Proposed,
    approvedBy: null,
    result: '',
    errorMessage: null,
    createdAt: ctx.timestamp,
    updatedAt: ctx.timestamp,
  });
}

// Reducer 10: Human approves or rejects
reducer resolve_ai_action(
  actionId: bigint,
  resolution: 'Approved' | 'Rejected',
): void {
  const action = db.aiAction.id.find(actionId);
  if (!action) throw new Error('AiAction not found');
  if (action.status !== AiActionStatus.Proposed) throw new Error('Can only resolve Proposed actions');

  db.aiAction.id.update(actionId, {
    status: resolution === 'Approved' ? AiActionStatus.Approved : AiActionStatus.Rejected,
    approvedBy: ctx.sender,
    updatedAt: ctx.timestamp,
  });
  // Note: Execution is triggered client-side after detecting status = Approved.
  // Server does NOT execute the skill — client does (because skills need Neutralino access).
}

// Update result after execution (called by client after skill completes)
reducer update_ai_action_result(
  actionId: bigint,
  status: 'Executed' | 'Failed',
  result: string,       // JSON success details
  errorMessage: string, // error description if Failed
): void {
  // Only the requestor or admin can update the result
  const action = db.aiAction.id.find(actionId);
  if (!action) throw new Error('AiAction not found');

  db.aiAction.id.update(actionId, {
    status: status === 'Executed' ? AiActionStatus.Executed : AiActionStatus.Failed,
    result,
    errorMessage: errorMessage || null,
    updatedAt: ctx.timestamp,
  });
}
```

### 3b. Client Layer

**New component: `ApprovalCard.svelte`**

Props:
```typescript
interface ApprovalCardProps {
  action: AiAction;          // live STDB row (subscribes for status updates)
  onApprove: () => void;
  onReject: () => void;
  onEdit: (newPlan: string) => void;
}
```

States the card renders:
- `Proposed`: Shows plan summary, [Approve] [Edit] [Cancel] buttons
- `Approved` (transitional): "Executing..." loading state
- `Executed`: Green check, result summary, read-only
- `Rejected`: Grey, "Cancelled", read-only
- `Failed`: Red, error message, [Retry] button

**Integration in `ChatPanel.svelte`**

Message rendering loop:
```typescript
// When rendering messages, check for linked AiAction rows:
for (const message of messages) {
  if (message.aiActionId) {
    // render ApprovalCard for the linked action
    const action = $aiActions.find(a => a.id === message.aiActionId);
    if (action) renderApprovalCard(action);
  } else {
    renderMessageBubble(message);
  }
}
```

**Intent routing update in `chat.ts`**

When LLM returns a response that triggers an explicit skill:
```typescript
async function handleSkillProposal(skillName: string, args: Record<string, unknown>) {
  // 1. Propose the action via reducer
  const plan = JSON.stringify({ skill: skillName, args, reasoning: lastAssistantMessage });
  await stdb.reducers.propose_ai_action(skillName, plan);

  // 2. Subscribe to the new AiAction row
  // 3. ApprovalCard renders automatically via STDB subscription
}

// When AiAction status changes to Approved:
stdb.on('aiAction', async (action) => {
  if (action.status === 'Approved') {
    await executeSkill(action);  // Actually run the skill
  }
});
```

### 3c. Neutralino Layer

Skills that need file system access (scan_folder, ocr_document, generate_pptx) run client-side after approval. They use Neutralino APIs in their `execute()` function. The approval gate (STDB reducer) doesn't need Neutralino — only skill execution does.

### 3d. AI Layer

The LLM must know when to propose vs auto-execute:
```
System prompt addition:
"When you identify an action that requires explicit approval (creating invoices,
recording payments, sending messages, file operations), respond with:
{
  'skill': 'skill_name',
  'args': { ... },
  'explanation': 'brief description of what this will do'
}

The system will show an approval card to the user. You do NOT execute the skill
yourself — you propose it. The user approves, then the system executes."
```

---

## 4. Dependencies

- **Requires:** F003 (STDB wiring), F012 (chat interface), F001 (AiAction table in schema)
- **Blocks:** F015 (intent routing), F017-F032 (all Skills)

---

## 5. Invariants This Feature Must Respect

- INV-12: Every AI action has a full audit trail in AiAction
- INV-13: Skills with approval='explicit' NEVER auto-execute
- INV-15: ctx.sender is the actor — approvedBy stores the actual approver identity
- INV-20: Reducer = transaction — if resolve_ai_action throws, no status change committed

---

## 6. Architecture Notes

### Why client-side execution (not server-side)

STDB Procedures can run HTTP requests server-side. However, skills that require Neutralino (file system, process spawning) MUST run client-side — the server process has no access to Abhie's file system.

The pattern: STDB reducer approves the action, client detects the approval via subscription, client executes the skill using its Neutralino + AI access, client calls `update_ai_action_result` reducer to record the outcome.

This means: approval is atomic (inside a reducer/transaction), execution is client-side. The audit trail is in STDB regardless of where execution happened.

### Plan JSON format

The `plan` field is a JSON string shown to Abhie in the approval card. It must be human-readable:
```json
{
  "skill": "chase_payment",
  "args": {
    "grade": "C",
    "daysOverdue": 30,
    "invoiceIds": [101, 103, 107]
  },
  "explanation": "3 overdue invoices from Grade C customers (23,000 BHD total). Will generate firm reminder WhatsApp drafts — one per customer."
}
```

The `explanation` field is what renders in the approval card summary. Args are shown in a collapsible "Details" section.

---

## 7. Test Plan

- [ ] Propose an action → AiAction row created with status=Proposed
- [ ] ApprovalCard renders in chat with correct plan summary
- [ ] [Approve] button → status transitions to Approved
- [ ] Skill execution triggers after Approved status detected
- [ ] Successful execution → status=Executed, result stored
- [ ] Failed execution → status=Failed, error stored, [Retry] button visible
- [ ] [Cancel] button → status=Rejected, card goes grey
- [ ] [Edit Plan] → editable JSON, modified plan saved on approve
- [ ] Auto-approval skill (query_dashboard) → no AiAction row created, no card shown
- [ ] admin_only skill attempted by non-Admin user → reducer rejects with role error
- [ ] Two concurrent approvals by different users → STDB handles atomically (first wins)

---

## 8. Session Log

| Date | Session | What Happened | Next Step |
|------|---------|---------------|-----------|
| 2026-03-20 | Spec | Created full contract — AiAction table was in Wave 0, now speccing the approval UI | Build ApprovalCard.svelte |
