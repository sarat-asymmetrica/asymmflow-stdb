# F021 — Skill: `chase_payment` (WhatsApp Drafts by Customer Grade)

**Status:** — (Not yet specced beyond this contract)
**Wave:** 3 (Skills Layer)
**Owner:** Commander + Claude
**Created:** 2026-03-20

---

## 0. Philosophy

> Abhie spends hours per week composing payment chase messages — different tone for each customer grade, referencing specific invoices, calculating exact outstanding amounts. This is exactly the kind of high-volume, context-requiring, judgment-needing work where AI + human review is the right architecture. AI does the drafting; Abhie does the deciding.

---

## 1. User Story

As **Abhie (Admin)** or **any Sales/Accountant role**,
I want to **ask the AI to generate payment chase messages for overdue customers, with the right tone for each customer grade**,
so that **I can review the drafts and send them from WhatsApp in minutes instead of hours**.

---

## 2. Acceptance Criteria

### Trigger and Detection
- [ ] AC1: Chat phrases like "chase overdue payments", "follow up with Grade C", "who owes us?", "send reminders" trigger the payment chase intent
- [ ] AC2: AI queries STDB for overdue MoneyEvents (`status = Active AND dueDate < now()`)
- [ ] AC3: Results are grouped by party, not by invoice — one draft per customer regardless of how many invoices they have

### Grade-Based Tone (PH Trading policy)
- [ ] AC4: Grade A customers: polite reminder, reference to relationship, soft nudge ("As a valued partner...")
- [ ] AC5: Grade B customers: firm reminder, specific amounts, payment terms reference
- [ ] AC6: Grade C customers: formal notice, all outstanding amounts listed, consequences mentioned
- [ ] AC7: Grade D customers: final notice, service suspension warning, director escalation

### Draft Content (each draft must include)
- [ ] AC8: Customer name and contact name (from Contact table)
- [ ] AC9: Invoice numbers and individual outstanding amounts in BHD (X.XXX format)
- [ ] AC10: Total outstanding amount
- [ ] AC11: Oldest invoice date (how long it's been outstanding)
- [ ] AC12: Relevant payment terms (from Party.paymentTermsDays)
- [ ] AC13: PH Trading contact details (Abhie's phone, company name)

### Approval Flow (via AiAction)
- [ ] AC14: Skill is `approval: 'explicit'` — always goes through AiAction approval gate (ADR005)
- [ ] AC15: Approval card shows: number of customers, total outstanding, grade distribution
- [ ] AC16: After approval, skill generates drafts and stores in AiAction.result as JSON array
- [ ] AC17: Chat shows each draft as a readable message card with a [Copy] button

### Filters (Abhie can refine)
- [ ] AC18: Optional filter: "Grade C only", "overdue by 60+ days", "EWA only", specific customer name
- [ ] AC19: Optional exclusion: "skip Al-Rashid" (Abhie knows something the AI doesn't)

---

## 3. Full-Stack Contract

### 3a. STDB Layer

No new schema. Uses existing:
- `MoneyEvent` — query overdue invoices (`kind = 'customer_invoice', status = Active, dueDate < now()`)
- `Party` — customer name, grade, payment terms
- `Contact` — contact name for addressing the message

STDB View (add if not exists):
```typescript
// overdue_invoices view (subscribable):
SELECT
  me.id as event_id,
  me.party_id,
  me.reference,
  me.total_fils,
  me.due_date,
  p.name as party_name,
  p.grade,
  p.payment_terms_days,
  DATEDIFF(NOW(), me.due_date) as days_overdue
FROM money_event me
JOIN party p ON me.party_id = p.id
WHERE me.kind = 'customer_invoice'
  AND me.status = 'Active'
  AND me.due_date < NOW()
ORDER BY p.grade ASC, days_overdue DESC
```

### 3b. Skill Layer

```typescript
interface ChasePaymentArgs {
  gradeFilter?: CustomerGrade[];      // null = all grades
  minDaysOverdue?: number;            // default 1 (any overdue)
  partyIds?: bigint[];               // null = all parties
  excludePartyIds?: bigint[];         // parties to skip
}

interface ChasePaymentResult {
  drafts: PaymentChaseDraft[];
  summary: {
    totalParties: number;
    totalAmountFils: bigint;
    gradeBreakdown: Record<CustomerGrade, number>;
  };
}

interface PaymentChaseDraft {
  partyId: bigint;
  partyName: string;
  contactName: string;
  grade: CustomerGrade;
  messageText: string;      // The WhatsApp draft (ready to copy-paste)
  invoiceCount: number;
  totalOutstandingFils: bigint;
  oldestInvoiceDays: number;
}

// Skill metadata
const chasePaymentSkill: Skill = {
  name: 'chase_payment',
  description: 'Generate WhatsApp payment chase drafts for overdue customers, tone-matched to customer grade',
  category: 'communication',
  approval: 'explicit',
  requiredRole: [UserRole.Admin, UserRole.Accountant, UserRole.Sales],
  execute: async (args: ChasePaymentArgs, ctx: SkillContext): Promise<ChasePaymentResult> => {
    // 1. Query overdue invoices from STDB
    const overdueInvoices = await queryOverdueInvoices(ctx.stdb, args);

    // 2. Group by party
    const partyGroups = groupBy(overdueInvoices, me => me.partyId);

    // 3. For each party, fetch party + contact, generate draft via Grok
    const drafts: PaymentChaseDraft[] = [];
    for (const [partyId, invoices] of partyGroups) {
      const party = await ctx.stdb.db.party.id.find(partyId);
      const contact = await getPreferredContact(ctx.stdb, partyId);

      const messageText = await generateChaseDraft(ctx.ai, {
        party, contact, invoices,
        template: GRADE_TEMPLATES[party.grade],
        todayDate: new Date().toISOString().split('T')[0],
      });

      drafts.push({
        partyId,
        partyName: party.name,
        contactName: contact?.name ?? 'Sir/Madam',
        grade: party.grade,
        messageText,
        invoiceCount: invoices.length,
        totalOutstandingFils: invoices.reduce((sum, inv) => sum + inv.totalFils, 0n),
        oldestInvoiceDays: Math.max(...invoices.map(inv => inv.daysOverdue)),
      });
    }

    return {
      drafts,
      summary: {
        totalParties: drafts.length,
        totalAmountFils: drafts.reduce((sum, d) => sum + d.totalOutstandingFils, 0n),
        gradeBreakdown: countByGrade(drafts),
      }
    };
  }
};
```

### 3c. Grade Template System

```typescript
const GRADE_TEMPLATES: Record<CustomerGrade, ChaseTemplate> = {
  A: {
    tone: 'polite',
    opening: 'Dear {contactName}, I hope this message finds you well.',
    subject: 'Friendly reminder — invoice(s) due',
    body: 'As one of our valued partners, we wanted to gently bring to your attention that the following invoice(s) are outstanding: {invoiceList}. Total: BHD {totalAmount}. We look forward to your continued partnership.',
    closing: 'Please let us know if you have any questions. Many thanks.',
  },
  B: {
    tone: 'firm',
    opening: 'Dear {contactName},',
    subject: 'Payment reminder — outstanding invoices',
    body: 'This is a reminder that the following invoice(s) are overdue per your agreed payment terms ({paymentTermsDays} days): {invoiceList}. Total outstanding: BHD {totalAmount}. Please arrange payment at your earliest convenience.',
    closing: 'Please contact us if you would like to discuss payment arrangements.',
  },
  C: {
    tone: 'formal_notice',
    opening: 'Dear {contactName},',
    subject: 'FORMAL NOTICE — Overdue payment required',
    body: 'Despite previous communications, the following invoices remain unpaid, now {oldestDays} days overdue: {invoiceList}. Total outstanding: BHD {totalAmount}. As per our credit terms, we require immediate payment. Further delay may result in suspension of services and/or referral to our collections process.',
    closing: 'Please remit payment within 7 days. Contact Abhie at [phone] for arrangements.',
  },
  D: {
    tone: 'final_notice',
    opening: 'Dear {contactName},',
    subject: 'FINAL NOTICE — Service suspension imminent',
    body: 'This is a FINAL NOTICE. Outstanding invoices totalling BHD {totalAmount} remain unpaid, with the oldest now {oldestDays} days overdue: {invoiceList}. Per our credit policy, all services to your account will be SUSPENDED within 48 hours. Payment in FULL is required to avoid suspension and potential legal proceedings.',
    closing: 'This matter has been escalated to management. Contact us IMMEDIATELY.',
  },
};
```

### 3d. AI Layer

The Grok call for personalization:
```
System: "You are PH Trading's payment collection assistant.
         Generate a WhatsApp message using the template and context provided.
         Keep it under 300 words. Use the customer's actual invoice references.
         Do not make up amounts — use only the exact figures provided."

User: "Template: {template.body}
       Customer: {party.name}, Grade {party.grade}
       Invoices: {invoiceList with amounts in BHD}
       Oldest: {oldestDays} days overdue
       Payment terms: {paymentTermsDays} days"
```

The template ensures the right tone. Grok personalizes and fills in the specifics.

---

## 4. Dependencies

- **Requires:** F014 (AiAction Approval Gate), F003 (STDB wiring), F012 (Chat interface)
- **Blocks:** F035 (Payment Chase Letter PDF — same logic, different output format)

---

## 5. Invariants This Feature Must Respect

- INV-01: Outstanding computed from MoneyEvent sum (not stored grade)
- INV-02: Display amounts in BHD X.XXX format (from fils), never raw fils in messages
- INV-12: Every execution logged in AiAction with full result
- INV-13: Explicit approval always required — this NEVER auto-runs
- INV-14: Vyapti principle — check defeating conditions before alerting (e.g., if a payment was just recorded, re-query before generating a chase for that party)

---

## 6. Architecture Notes

### Why Grok for drafts (not a fixed template)

Templates define tone and structure. Grok personalizes:
- "The invoice dated March 3 for the gas analyzers" is more human than "Invoice INV-2026-0034"
- Grok can reference the party's history: "as we discussed in our meeting last week" (if in context)
- Fixed templates produce robotic messages; Grok-with-template produces human messages

The template is the guardrail (ensures correct tone). Grok is the personalizer (fills in human warmth). Both are needed.

### The "just paid" race condition

A customer pays at 9am. At 9:15am, Abhie asks for chase drafts. Is that customer included?

Mitigation: The skill queries STDB at execution time (after approval), not at proposal time. Between "propose" and "approve", Abhie may also say "skip Al-Rashid, they just paid." The `excludePartyIds` arg handles this.

Residual risk: If payment is recorded AFTER the skill executes but BEFORE Abhie sends the draft, Abhie would be sending a chase to a customer who already paid. This is a human problem, not a system problem. Abhie reviews drafts before sending. The [Copy] button on each draft is intentional — it requires one deliberate action per customer.

---

## 7. Test Plan

- [ ] "Chase overdue payments" → correctly queries MoneyEvent for overdue invoices
- [ ] Grade A customer → polite tone generated
- [ ] Grade D customer → final notice tone generated
- [ ] Two invoices from same customer → grouped into one draft (not two)
- [ ] "Skip Al-Rashid" → Al-Rashid excluded from drafts
- [ ] "Grade C only" → other grades not included
- [ ] Outstanding amount in draft matches MoneyEvent sum (not stored value)
- [ ] Party with no contact → draft addresses "Sir/Madam"
- [ ] All outstanding amounts in BHD format (X.XXX), not fils
- [ ] AiAction approval card shows correct count and total before execution
- [ ] Executed AiAction stores all drafts in result JSON
- [ ] [Copy] button copies message text to clipboard via Neutralino

---

## 8. Session Log

| Date | Session | What Happened | Next Step |
|------|---------|---------------|-----------|
| 2026-03-20 | Spec | Created full contract including grade templates and Grok integration | Build after F014 is live |
