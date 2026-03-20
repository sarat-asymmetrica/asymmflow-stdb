# AsymmFlow Intelligence Layer — Full Audit & Reimagined Architecture
## Euler + Alan Kay Perspective on AI Agency for PH Trading WLL

**Date**: 2026-03-08
**Author**: Euler (mathematics) + Alan Kay (messaging/objects) perspective
**Status**: Full Design — Ready to Build Sprint 4

---

## EULER'S OPENING STATEMENT

Leonhard Euler proved that a walk across all seven bridges of Königsberg was impossible — not
by trying every route, but by reducing the problem to a graph invariant. The insight: you don't
need to simulate the whole system. You need the right abstraction.

PH Trading's intelligence problem is the same. You don't need a chatbot. You need INVARIANTS
about cashflow, customer behavior, and pricing — expressed as mathematical functions — that an
agent can read, compute, and act on.

## ALAN KAY'S OPENING STATEMENT

The big idea is "messaging." The key in making great and growable systems is much more to design
how its modules communicate rather than what their internal properties and behaviors should be.

SpacetimeDB tables ARE the message bus. Agents don't call functions — they read rows and write
rows. Other agents or humans subscribe to those rows. This is Smalltalk done right, at the
database level. The database IS the object system.

---

## PART 1: CURRENT AI AUDIT — WHAT EXISTS, WHAT'S BROKEN, WHAT'S MISSING

### 1.1 Butler AI (Current Mistral Integration)

**What it handles:**
- Natural language queries against the SQLite database
- "Show me overdue invoices" → SQL generation → result display
- Basic reporting questions ("what's our revenue this month?")

**How context is built (inferred from codebase structure):**
- Static system prompt with schema description
- User query appended
- Mistral generates SQL or narrative
- Results piped back to UI

**Critical limitations:**

1. **REACTIVE ONLY** — Butler answers questions. It never initiates. It never says
   "Customer Al-Rashid hasn't paid in 90 days, here's what I recommend." It waits.
   A business bleeding 10K BHD/month cannot afford a reactive AI.

2. **CONTEXT IS STALE** — The system prompt describes the schema, not the live state.
   Butler doesn't know that today is December (add 45 days to payment prediction).
   It doesn't know ABB is competing on the current tender. It describes structure,
   not the alive, breathing business.

3. **NO ARABIC CAPABILITY** — Arabic supplier invoices (the primary document format
   in the GCC supply chain) are not processed. Ramya manually translates. This is
   the highest-cost human bottleneck in the process.

4. **NO ACTION CAPABILITY** — Butler can recommend "send a reminder to Al-Rashid"
   but cannot actually send it. There's no path from insight to action within the
   system. Every recommendation requires a human relay.

5. **NO DOMAIN GROUNDING** — Mistral doesn't know:
   - ABB's pricing strategy (undercut by 15-20% on standard flow meters)
   - That emergency delivery wins regardless of price (ABB takes 8 weeks)
   - That personal visits convert 60% of stuck payments
   - That December is the worst month for collections
   These aren't in any prompt. They exist only in Abhie's head.

**Grade: D+** — Answers questions, misses the entire point.

---

### 1.2 Payment Predictor (Pseudo-code from Business Reality Doc)

```python
def predict_payment_days(customer, order_value, history):
    base_days = history.average_payment_days

    if order_value > customer.typical_order * 2:
        base_days += 30

    if current_month == 'December':
        base_days += 45

    if customer.has_new_management:
        base_days += 60

    return base_days
```

**Euler's Analysis:**

This is linear additive adjustment — a first-order Taylor expansion around the mean. It works
when adjustments are independent. They are not. Consider:

- A D-grade customer (base: 180 days)
- With a 2x order (+ 30 days)
- In December (+ 45 days)

The naive model says: 255 days. But in reality, a D-grade customer in December with an unusually
large order is a near-certain 6+ month delay — the factors MULTIPLY, not add.

**What's missing mathematically:**
- No survival analysis (what's the probability of payment by day N?)
- No grade-conditional distribution (A-grade variance is low, D-grade variance is enormous)
- No interaction terms between predictors
- No confidence interval (is "120 days" ± 10 or ± 90?)
- No update mechanism (predictions don't improve from new payment data)

**Grade: C** — Directionally correct, mathematically naive.

---

### 1.3 Win Probability Calculator

```python
def calculate_win_probability(opportunity):
    probability = 0.5

    if opportunity.competitor == 'ABB':
        probability *= 0.3

    if opportunity.is_emergency:
        probability *= 1.8

    if opportunity.customer_grade == 'A':
        probability *= 1.5

    if opportunity.product in ['Servomex', 'GIC']:
        probability *= 1.3

    return min(probability, 0.95)
```

**Euler's Analysis:**

This is a multiplicative model — good intuition, but naively applied. The problem: multiplying
probabilities that aren't independent produces nonsense. If ABB is present AND it's an emergency
AND it's Servomex, we get:

0.5 × 0.3 × 1.8 × 1.3 = 0.351 → 35.1%

But reality: Servomex is a specialty where ABB is weak. The emergency factor nearly guarantees
the win regardless of ABB. The true probability is probably 75%+. The model underfits by 2x.

A logistic regression captures this correctly:

```
P(win) = σ(β₀ + β₁·ABB + β₂·emergency + β₃·grade + β₄·product + β₅·ABB×emergency)
```

The interaction term β₅·ABB×emergency captures that emergency kills ABB's advantage. This
is the difference between a model and an approximation.

**Grade: C+** — Directionally correct, misses feature interactions.

---

### 1.4 Discount Optimizer

```python
def calculate_optimal_discount(customer, product, competition):
    max_discount = 0

    if customer.payment_grade == 'A':
        max_discount = 0.07
    elif customer.payment_grade == 'B':
        max_discount = 0.03
    else:
        return 0

    if competition == 'ABB':
        if product.margin < 0.15:
            return -1  # Signal to not compete

    if customer.years_with_us > 5:
        max_discount += 0.02

    return max_discount
```

**Euler's Analysis:**

The maximum discount is correct as a business rule. But this is not optimization — it's a
ceiling function. True optimization asks: what is the OPTIMAL discount, not the maximum?

The insight the model misses: offering a discount to an A-grade customer who would have
paid anyway is pure margin destruction. The optimal discount is the minimum necessary to
win the deal. If ABB isn't competing, optimal discount = 0, not 7%.

This needs information theory: the value of the discount equals the probability it changes
the outcome, weighted by the deal size.

```
Expected_Value(discount d) = P(win | d) × margin(d) × deal_size
Optimal_d = argmax Expected_Value(d)
```

**Grade: B-** — Correct ceiling, missing optimization logic.

---

### 1.5 What's MISSING (The Critical Gaps)

| Missing Capability | Business Impact | Effort |
|---|---|---|
| Proactive payment chasing | 50K BHD in receivables sitting uncollected | Medium |
| Arabic document processing | Every Arabic invoice = manual Ramya time | Low (Sarvam exists!) |
| Cashflow 90-day forecast | Abhie can't see the cliff before he falls off | Medium |
| ABB detection in pipeline | No systematic "should we compete?" gate | Low |
| Customer grade auto-update | Grades are manually assigned, go stale | Medium |
| Tender document analysis | Arabic + English tenders = manual reading | Medium |
| WhatsApp message drafting | Every follow-up = human writing time | Low |
| Pricing recommendation at quote time | Price is set by gut, not by model | Medium |

---

## PART 2: REIMAGINED AI AGENT ARCHITECTURE

### 2.1 Alan Kay's Core Insight Applied

In Smalltalk, objects communicate by sending messages. No shared state, no direct calls —
only message passing. The receiver decides what to do with the message.

In AsymmFlow STDB, the equivalent is:

```
TABLES = objects (they hold state)
REDUCERS = message handlers (they decide what to do)
AGENT READS = subscriptions (continuous message receipt)
AGENT WRITES = reducer calls (sending messages that change state)
```

The architecture is NOT "AI calls database." It is:

```
Database changes → Agent reads new state → Agent decides → Agent writes recommendation →
Human reads recommendation → Human approves → Reducer enforces the action
```

The AI is a participant in a message-passing system, not a controller of it.

### 2.2 The Five Agents

```
+-------------------------------------------------------------------+
|  AGENT 1: BUTLER                                                  |
|  Role: Conversational interface to live business state            |
|  Trigger: Human question                                          |
|  Model: Grok (AIMLAPI) — fast, streaming, reasoning              |
|  Action: Answers questions, drafts messages, explains state       |
|  STDB: READ only. Writes nothing. Pure Q&A.                      |
+-------------------------------------------------------------------+
|  AGENT 2: PAYMENT CHASER                                          |
|  Role: Monitor overdue invoices, recommend escalation             |
|  Trigger: Scheduled (daily) OR invoice status change             |
|  Model: Grok (AIMLAPI) — for message drafting                    |
|  Action: Writes FollowUp rows + drafts WhatsApp text             |
|  STDB: READS Invoice, Customer, Payment. WRITES FollowUp.        |
+-------------------------------------------------------------------+
|  AGENT 3: DOCUMENT PROCESSOR                                      |
|  Role: OCR + translate Arabic supplier invoices/tenders           |
|  Trigger: New document uploaded (procedure call)                  |
|  Model: Sarvam Mayura — Arabic to English translation            |
|  Action: Writes structured data extracted from document           |
|  STDB: PROCEDURE (has HTTP). WRITES SupplierInvoice + fields.    |
+-------------------------------------------------------------------+
|  AGENT 4: PRICING ADVISOR                                         |
|  Role: Win probability + optimal discount + ABB warning           |
|  Trigger: CostingSheet created or updated                         |
|  Model: Client-side computation + Grok for narrative              |
|  Action: Writes PricingRecommendation row                         |
|  STDB: READS Opportunity, Customer, Product. WRITES Recommend.   |
+-------------------------------------------------------------------+
|  AGENT 5: CASHFLOW FORECASTER                                     |
|  Role: 90-day cash position projection                            |
|  Trigger: Daily scheduled OR on payment/invoice event            |
|  Model: Euler's ODE (client-side). Grok for narrative.           |
|  Action: Writes CashflowForecast rows                             |
|  STDB: READS all finance tables. WRITES CashflowForecast.        |
+-------------------------------------------------------------------+
```

### 2.3 How Agents Interact with STDB

**CRITICAL STDB CONSTRAINT (from CLAUDE.md rules):**
Reducers are deterministic — no network, no HTTP. Only Procedures can do HTTP.

This determines the architecture split:

```
CLIENT-SIDE (Svelte browser):
  - Butler chat (streaming SSE to Grok)
  - Win probability calculation (pure math)
  - Pricing advisor narrative (call Grok with computed numbers)
  - Cashflow ODE integration (pure math)

SERVER-SIDE PROCEDURE (STDB):
  - Arabic document OCR (HTTP to Sarvam)
  - WhatsApp message sending (HTTP to WhatsApp Business API)
  - PDF generation (HTTP to PDF service)

SERVER-SIDE REDUCER (STDB):
  - Record AI recommendation (ctx.db.recommendation.insert)
  - Create follow-up from agent (ctx.db.followUp.insert)
  - Update opportunity win probability (ctx.db.opportunity.id.update)
```

**The flow for document processing:**

```
User uploads Arabic PDF
    |
    v
STDB Procedure: process_arabic_document
    |
    +-> ctx.http.fetch(Sarvam OCR endpoint)
    |       Returns: extracted text (Arabic)
    |
    +-> ctx.http.fetch(Sarvam translate endpoint)
    |       Returns: English text
    |
    +-> ctx.withTx(tx => {
            tx.db.supplierInvoice.insert({ ... extracted fields ... })
            tx.db.activityEvent.insert({ kind: 'DocumentProcessed', ... })
        })
```

**The flow for payment chasing:**

```
Client-side agent loop (setInterval or STDB subscription trigger):
    |
    [1] Read Invoice table: filter outstandingBhd > 0, dueDate < now
    [2] Read Customer table: join on customerId
    [3] Compute days_overdue, grade, escalation_level
    [4] Call Grok with context → draft WhatsApp message
    [5] conn.reducers.create_follow_up({
            entityType: 'invoice',
            entityId: invoice.id,
            note: draftedMessage,
            dueAt: tomorrow,
        })
```

---

### 2.4 STDB Tables for Intelligence Layer

Three new tables added to the schema:

```typescript
// AI recommendation — agent writes, human reads and approves
const AiRecommendation = table({
  public: true,
  indexes: [
    { name: 'ai_rec_entity', algorithm: 'btree', columns: ['entityType', 'entityId'] },
    { name: 'ai_rec_pending', algorithm: 'btree', columns: ['isPending'] },
  ],
}, {
  id: t.u64().primaryKey().autoInc(),
  agentName: t.string(),        // 'payment_chaser', 'pricing_advisor', etc.
  entityType: t.string(),       // 'invoice', 'opportunity', 'customer'
  entityId: t.u64(),
  recommendation: t.string(),   // Human-readable action recommendation
  draftMessage: t.string(),     // Draft WhatsApp/email text
  confidence: t.u64(),          // basis points (8500 = 85% confident)
  isPending: t.bool(),          // true = awaiting human review
  approvedBy: t.identity().optional(),
  approvedAt: t.timestamp().optional(),
  createdAt: t.timestamp(),
});

// Cashflow forecast — agent writes daily
const CashflowForecast = table({
  public: true,
  indexes: [
    { name: 'cashflow_date', algorithm: 'btree', columns: ['forecastDate'] },
  ],
}, {
  id: t.u64().primaryKey().autoInc(),
  forecastDate: t.timestamp(),  // Which day this forecast covers
  expectedCashBhd: t.u64(),     // Projected cash position in fils
  confidenceLowBhd: t.u64(),    // Lower bound (10th percentile)
  confidenceHighBhd: t.u64(),   // Upper bound (90th percentile)
  assumptions: t.string(),      // JSON: what receivables were assumed
  generatedAt: t.timestamp(),
});

// Pricing recommendation — agent writes per costing sheet
const PricingRecommendation = table({
  public: true,
  indexes: [
    { name: 'pricing_costing', algorithm: 'btree', columns: ['costingSheetId'] },
  ],
}, {
  id: t.u64().primaryKey().autoInc(),
  costingSheetId: t.u64(),
  opportunityId: t.u64(),
  winProbabilityBps: t.u64(),     // Logistic regression output
  recommendedDiscountBps: t.u64(), // Optimal (not max) discount
  abbWarning: t.bool(),           // ABB detected → should we compete?
  marginAfterDiscountBps: t.u64(),
  narrative: t.string(),          // Grok-generated explanation
  createdAt: t.timestamp(),
});
```

---

### 2.5 Agent Flow Diagrams (Text)

**AGENT 1: BUTLER — Conversational**

```
Human types: "Which customers are most at risk of not paying this month?"
    |
    v
Client reads STDB tables:
    - Invoice: filter dueDate < (now + 30 days), outstandingBhd > 0
    - Customer: join, get grade
    - Payment: join, get average payment delay per customer
    |
    v
Build system prompt:
    "You are the AsymmFlow business advisor for PH Trading Bahrain...
     [live state injected — see Section 3.1 below]"
    |
    v
Call Grok streaming SSE:
    model: 'x-ai/grok-4-fast-non-reasoning'
    temperature: 0.3 (factual mode)
    |
    v
Stream response to UI
    "Three invoices are highest risk this month:
     1. Al-Rashid (D-grade): 45 days overdue, 85K BHD outstanding..."
```

**AGENT 2: PAYMENT CHASER — Proactive**

```
Daily trigger OR invoice.status changes to 'Overdue'
    |
    v
Read all overdue invoices (outstandingBhd > 0, dueDate < now)
    |
    v
For each invoice:
    daysOverdue = (now - dueDate) / 86400000
    grade = customer.grade
    escalationLevel = computeEscalation(daysOverdue, grade)
    |
    v
Escalation ladder:
    A-grade:  15d → gentle reminder, 45d → personal call, 90d → management
    B-grade:  7d → reminder, 30d → personal call, 60d → stop service warning
    C-grade:  0d → follow-up at invoice, 15d → advance required next time
    D-grade:  0d → immediate follow-up, 30d → stop service, 45d → legal
    |
    v
For each invoice needing action:
    Call Grok with invoice + customer context
    → Generate WhatsApp message draft in appropriate tone
    |
    v
conn.reducers.create_follow_up({
    entityType: 'invoice',
    entityId: invoice.id,
    note: grokDraftMessage,
    dueAt: tomorrow,
})

conn.reducers.create_ai_recommendation({
    agentName: 'payment_chaser',
    entityType: 'invoice',
    entityId: invoice.id,
    recommendation: 'Send WhatsApp reminder (draft attached)',
    draftMessage: grokDraftMessage,
    confidence: 9000,  // 90% — grade-based escalation is reliable
    isPending: true,
})
```

**AGENT 3: DOCUMENT PROCESSOR — Reactive**

```
User uploads Arabic supplier invoice (PDF/image)
    |
    v
STDB Procedure: process_arabic_document({ fileUrl, supplierId, purchaseOrderId })
    |
    +-> Step 1: Fetch PDF from URL
    |   ctx.http.fetch(fileUrl) → binary data
    |
    +-> Step 2: Sarvam OCR (if image/scanned PDF)
    |   POST https://api.sarvam.ai/speech-to-text  [image endpoint]
    |   Or: pass through Sarvam's document API
    |
    +-> Step 3: Extract text
    |   Sarvam returns Arabic text
    |
    +-> Step 4: Translate to English
    |   POST https://api.sarvam.ai/translate
    |   { input: arabicText, source: 'ar-SA', target: 'en-IN', model: 'mayura:v1' }
    |
    +-> Step 5: Parse structured fields via Grok
    |   "Extract invoice number, date, line items, total from this text: ..."
    |   Returns JSON: { invoiceNumber, date, total, lineItems: [...] }
    |
    +-> Step 6: Write to STDB (withTx)
    |   tx.db.supplierInvoice.insert({
    |       supplierId, purchaseOrderId,
    |       status: { tag: 'Draft' },
    |       totalBhd: parsedTotal,
    |       ...
    |   })
    |
    +-> Return: { success: true, supplierInvoiceId, extractedText }
```

**AGENT 4: PRICING ADVISOR — Triggered on Costing Sheet**

```
User creates or updates a CostingSheet
    |
    v
Client-side advisor fires (subscription trigger on costingSheet table):
    |
    +-> Read Opportunity linked to this costing sheet
    +-> Read Customer grade, payment history
    +-> Read Product type, typical margin
    +-> Detect ABB competition (opportunity.competitorPresent)
    |
    v
Logistic regression (pure math, no AI needed):
    winProb = logistic(computeWinScore(opportunity, customer, product))
    |
    v
Optimal discount search (maximizes expected margin):
    bestDiscount = 0
    bestEV = -Infinity
    for d in [0, 0.01, 0.02, ..., maxDiscount(grade)]:
        ev = P(win at price-d) × margin(d) × dealSize
        if ev > bestEV: bestEV = ev, bestDiscount = d
    |
    v
ABB warning logic:
    if competitor == 'ABB' && product.margin < 0.15:
        abbWarning = true
        recommendation = "DO NOT COMPETE — margin below threshold with ABB present"
    |
    v
Call Grok for narrative (temperature: 0.2):
    "Given these numbers, write a 3-sentence pricing recommendation
     for the sales team. Be direct and specific."
    |
    v
conn.reducers.create_pricing_recommendation({
    costingSheetId, opportunityId,
    winProbabilityBps: Math.round(winProb * 10000),
    recommendedDiscountBps: Math.round(bestDiscount * 10000),
    abbWarning,
    marginAfterDiscountBps: ...,
    narrative: grokNarrative,
})
```

**AGENT 5: CASHFLOW FORECASTER — Daily**

```
Daily scheduled trigger (STDB ScheduleAt) OR manual run
    |
    v
Read all live financial state:
    - Cash on hand (bank balance — manual input field)
    - Outstanding invoices: for each, estimated payment date
    - Upcoming supplier payments: due dates from SupplierInvoice
    - Fixed monthly costs: 15,000 BHD burn (config)
    |
    v
Euler's method for ODE integration (90 days, daily steps):

    dCash/dt = Revenue(t) - Costs(t) - Payments(t)

    Revenue(t):
        For each invoice with estimated pay date in [t, t+1]:
            P(pays on this day) = survival_probability(customer.grade, daysFromDue)
            Expected_payment += outstanding × P

    Costs(t):
        Fixed: 15000 / 30 BHD/day
        Variable: supplier payments due

    // Euler step:
    cash[t+1] = cash[t] + (Revenue(t) - Costs(t))
    |
    v
Monte Carlo for confidence bands (1000 simulations):
    Vary payment timing by grade:
        A-grade: normally distributed ±7 days from predicted
        B-grade: normally distributed ±15 days
        C-grade: uniformly distributed 0 to 120 days
        D-grade: heavy-tailed — 50% chance of 180+ days
    |
    v
For each day, compute P10 and P90 across simulations
    |
    v
Write forecast rows to STDB:
    for day in range(90):
        conn.reducers.upsert_cashflow_forecast({
            forecastDate: today + day,
            expectedCashBhd: medianForecast[day],
            confidenceLowBhd: p10[day],
            confidenceHighBhd: p90[day],
            assumptions: JSON.stringify({ invoicesIncluded, ... })
        })
    |
    v
Alert if P10 < 0 within 60 days:
    conn.reducers.create_ai_recommendation({
        agentName: 'cashflow_forecaster',
        recommendation: 'CRITICAL: P10 scenario shows negative cash in 47 days',
        confidence: 9000,
        ...
    })
```

---

## PART 3: MULTI-MODEL ROUTING TABLE

| Task | Model | Why | Mode |
|---|---|---|---|
| Butler chat — general Q&A | Grok (AIMLAPI) | Fast, streaming, BHD context | Client-side SSE |
| Butler chat — complex reasoning | Grok 4 (AIMLAPI) | When user asks "why" or "what should I do" | Client-side |
| Payment chaser WhatsApp drafts | Grok (AIMLAPI) | Informal tone, cultural context, fast | Client-side |
| Arabic document translation | Sarvam Mayura v1 | Best-in-class Arabic→English for GCC | Procedure HTTP |
| Supplier invoice parsing | Grok (AIMLAPI) | JSON extraction from translated text | Client-side |
| Tender document summarization | Claude (Anthropic) | Long context, complex Arabic documents | Client-side |
| Win probability (computation) | Pure math (logistic) | Deterministic, no LLM needed | Client-side |
| Pricing narrative | Grok (AIMLAPI) | 2-3 sentence business recommendation | Client-side |
| Cashflow ODE (computation) | Pure math (Euler's) | Deterministic, Monte Carlo | Client-side |
| Cashflow narrative | Grok (AIMLAPI) | Plain English explanation of numbers | Client-side |
| Audit/validation | Claude (Anthropic) | When AI output needs cross-checking | Client-side |
| TTS for field staff | Sarvam TTS | Hindi/Arabic voice for mobile users | Client-side |

**Note on model costs:**
- Grok via AIMLAPI: cheap, fast, good enough for 80% of tasks
- Sarvam: free tier exists, pay-per-use for translation/TTS
- Claude: use sparingly — for tender complexity or validation only
- Pure math: always prefer when possible — zero cost, deterministic

---

## PART 4: SYSTEM PROMPT ARCHITECTURE

### 4.1 The PH Trading Base Context Block

This is injected into EVERY AI call as the system prompt foundation.
Built from live STDB table reads. Computed fresh on every agent invocation.

```typescript
function buildPHContext(stdb: STDBState): string {
  const today = new Date();
  const month = today.toLocaleString('default', { month: 'long' });
  const isDecember = today.getMonth() === 11;

  // Count by customer grade
  const gradeCount = { A: 0, B: 0, C: 0, D: 0 };
  for (const c of stdb.customers) gradeCount[c.grade.tag]++;

  // Overdue invoice total
  const overdueTotal = stdb.invoices
    .filter(inv => inv.status.tag === 'Overdue' || inv.outstandingBhd > 0n)
    .reduce((sum, inv) => sum + inv.outstandingBhd, 0n);

  // Active pipeline
  const pipelineCount = stdb.opportunities
    .filter(o => o.stage.tag !== 'ClosedWon' && o.stage.tag !== 'ClosedLost').length;

  return `You are the intelligence layer of AsymmFlow — an ERP for PH Trading WLL, Bahrain.

## COMPANY FACTS (non-negotiable truths)
- Business: Process instrumentation distributor (Endress+Hauser, Servomex, Landis+Gyr, GIC)
- Monthly burn: 15,000 BHD. Current revenue: 4,000-5,000 BHD. Cash position: CRITICAL.
- Currency: BHD (Bahraini Dinar). All amounts in this system are fils (1 BHD = 1000 fils).
- Team: 8 people. Owner: Abhie.

## CURRENT BUSINESS STATE
- Month: ${month}${isDecember ? ' ⚠ DECEMBER — collections are 45 days slower than normal' : ''}
- Customer mix: ${gradeCount.A} A-grade, ${gradeCount.B} B-grade, ${gradeCount.C} C-grade, ${gradeCount.D} D-grade
- Total overdue receivables: ${(Number(overdueTotal) / 1000).toFixed(3)} BHD
- Active pipeline opportunities: ${pipelineCount}

## COMPETITIVE INTELLIGENCE
- ABB: Strongest competitor. Undercuts by 15-20% on standard flow meters.
  ABB's weaknesses: won't touch orders <10 units, takes 8+ weeks for delivery.
  If ABB is in a tender for standard flow meters: recommend strategic withdrawal unless margin >15%.
- Servomex gas analyzers: PH Trading wins here — ABB is weak.
- Emergency delivery: always win (ABB takes 8 weeks; PH Trading = same day/week).

## PAYMENT REALITY
- A-grade customers: pay within 45 days. Offer max 7% discount.
- B-grade: pay within 90 days. Max 3% discount.
- C-grade: pay when they feel like it. 0% discount. Require 50% advance on new orders.
- D-grade: 6+ month chase. Require 100% advance or decline to quote.
- Tactics that work: 3% discount = 40% take payment immediately.
  Personal visit from Abhie = 60% pay something. Stopping service = 90% pay within 48 hours.

## YOUR ROLE
You act. You don't just advise. When you recommend a WhatsApp message, write the full
draft. When you flag a risk, quantify it in BHD. When you compute a probability, show
the key factors. Be direct. PH Trading does not have time for vague recommendations.`;
}
```

### 4.2 Agent-Specific System Prompts

**Butler Agent:**
```
${phBaseContext}

## YOUR TASK TODAY
Answer the user's question using the live business data above.
- Use actual numbers from the data (never make up figures)
- Recommend specific actions when the question implies one
- Format amounts as BHD (convert from fils: divide by 1000)
- Be concise. Abhie is busy.
```

**Payment Chaser Agent:**
```
${phBaseContext}

## CURRENT OVERDUE INVOICES (for payment chasing)
${overdueInvoiceTable}

## YOUR TASK
Write a WhatsApp message to ${customerContact.name} at ${customer.name}.
The invoice #${invoice.id} for ${invoiceAmountBHD} BHD is ${daysOverdue} days overdue.
Customer grade: ${grade}. Escalation level: ${escalationLevel}.

Tone guidelines:
- Level 1 (gentle): Warm, assume it's an oversight. "Just checking in..."
- Level 2 (firm): Professional, reference the specific amount and days.
- Level 3 (serious): Reference consequences. "We may need to put future orders on hold..."
- Level 4 (final): State the consequence clearly. Don't threaten, state facts.

Write ONLY the WhatsApp message. No preamble. Maximum 150 words.
Use the WhatsApp style: short sentences, occasional line break.
```

**Pricing Advisor Agent:**
```
${phBaseContext}

## OPPORTUNITY DETAILS
Customer: ${customer.name} (Grade: ${grade}, ${yearsRelationship} years)
Product: ${product.name} (typical margin: ${product.typicalMarginBps / 100}%)
OEM cost: ${oemCostBHD} BHD
Proposed markup: ${markupBps / 100}%
Competitor: ${competitorPresent}

## COMPUTED ANALYSIS
Win probability: ${(winProbBps / 100).toFixed(1)}%
Recommended discount: ${(recommendedDiscountBps / 100).toFixed(1)}%
Margin after discount: ${(marginAfterDiscountBps / 100).toFixed(1)}%
ABB warning: ${abbWarning ? 'YES — consider not competing' : 'No'}

## YOUR TASK
Write a 3-sentence pricing recommendation for the sales team.
Sentence 1: The recommended action (compete/don't compete, what price).
Sentence 2: The key reason (the dominant factor in the win probability).
Sentence 3: The risk or opportunity to watch.
Be specific with numbers.
```

**Cashflow Forecaster Agent:**
```
${phBaseContext}

## 90-DAY CASHFLOW PROJECTION
Current cash: ${currentCashBHD} BHD
Monthly fixed costs: 15,000 BHD

30-day projection: ${p50_30d} BHD (range: ${p10_30d} to ${p90_30d} BHD)
60-day projection: ${p50_60d} BHD (range: ${p10_60d} to ${p90_60d} BHD)
90-day projection: ${p50_90d} BHD (range: ${p10_90d} to ${p90_90d} BHD)

Key receivables included:
${topReceivables}

## YOUR TASK
Write a 4-sentence cashflow narrative for Abhie.
Sentence 1: The headline (how many months of runway at P50 scenario?).
Sentence 2: The biggest risk in the P10 scenario.
Sentence 3: The most impactful action Abhie can take in the next 7 days.
Sentence 4: What to watch — the leading indicator that the forecast is going wrong.
```

---

## PART 5: MATHEMATICAL MODELS

### 5.1 Cashflow as Euler's Method for ODEs

**The Differential Equation:**

```
dCash/dt = Revenue(t) - OpCosts(t) - SupplierPayments(t)

WHERE:
  Revenue(t) = Σ_i [ outstanding_i × P(payment on day t | customer_i, overdue_i) ]
  OpCosts(t) = 15000 / 30  (BHD/day, fixed)
  SupplierPayments(t) = Σ_j [ supplier_invoice_j × 𝟙[due_date_j = t] ]
```

**Euler's Method (the simplest correct ODE solver):**

```
Cash[0] = current_bank_balance
For t = 1 to 90:
    Cash[t] = Cash[t-1] + Revenue(t-1) - OpCosts(t-1) - SupplierPayments(t-1)
```

**Payment probability model P(payment on day t):**

```
For customer grade G, let λ_G be the average payment rate:
    λ_A = 1/45  (average 45 days → exponential rate)
    λ_B = 1/90
    λ_C = 1/135  (90-180 days, use median)
    λ_D = 1/180

P(payment on day t) = λ_G × exp(-λ_G × daysOverdue)

This is the exponential survival model — standard in collections analysis.
The probability of payment on any given day decreases exponentially with overdue time.
```

**Confidence bands via Monte Carlo:**

```
For each simulation s = 1 to 1000:
    For each invoice i:
        payment_day_i[s] ~ exponential(rate=λ_{grade_i}) + dueDate_i
    Run Euler method with this payment schedule
    Record Cash[t][s] for each day t

P10[t] = percentile(Cash[t][1..1000], 10)
P50[t] = percentile(Cash[t][1..1000], 50)
P90[t] = percentile(Cash[t][1..1000], 90)
```

**Why Euler and not Runge-Kutta?**

The revenue function is piecewise (payments happen on discrete days, not continuously).
Euler's method with daily steps is exact for piecewise-constant forcing functions.
Higher-order methods would give false precision on a discrete system.

---

### 5.2 Customer Scoring as a Spectral Problem

**The Insight (Euler would love this):**

Build an adjacency matrix M where M[i][j] = payment_correlation(customer_i, customer_j).
Customers who behave similarly (both pay early, or both delay) have high correlation.
The eigenvalues of M reveal clusters of customers — not by sector or size, but by behavior.

```
M ∈ ℝ^{n×n}, M[i][j] = pearson_correlation(payment_delay_series_i, payment_delay_series_j)

Eigendecomposition: M = V Λ V^T

Principal eigenvectors reveal:
    v₁: The "reliable vs unreliable" axis
    v₂: The "seasonal vs consistent" axis
    v₃: The "responsive to discounts vs not" axis
```

**Practical implementation for PH Trading (12-month horizon):**

```typescript
function computeCustomerClusters(payments: Payment[], invoices: Invoice[]): CustomerCluster[] {
  // Build monthly payment delay matrix (customers × months)
  const delayMatrix = buildDelayMatrix(payments, invoices, 12);

  // Correlation matrix
  const corrMatrix = pearsonCorrelation(delayMatrix);

  // Power iteration for top 3 eigenvectors (no numpy needed in browser)
  const [v1, v2, v3] = powerIteration(corrMatrix, 3, 100);

  // Project each customer onto the eigenvectors
  const scores = customers.map(c => ({
    id: c.id,
    reliability: dotProduct(delayMatrix[c.id], v1),
    seasonality: dotProduct(delayMatrix[c.id], v2),
    discountSensitivity: dotProduct(delayMatrix[c.id], v3),
  }));

  return kMeans(scores, 4);  // 4 clusters → maps naturally to A/B/C/D
}
```

**Why this matters:** The current A/B/C/D grading is manual and goes stale.
The spectral method auto-grades customers from their actual payment behavior.
Run monthly. Flag when a customer's cluster assignment changes — that's an early warning.

---

### 5.3 Payment Prediction as Survival Analysis

**Kaplan-Meier for "time to payment" by grade:**

```
The survival function S(t) = P(payment has NOT occurred by day t)

For each customer grade:
    S_A(t): Most payments happen by day 30, sharp drop, long tail to day 60
    S_B(t): Payments spread 30-90 days, moderate tail
    S_C(t): Flat — payments arrive uniformly through 180 days
    S_D(t): Heavy right tail — many never pay without intervention

Estimator (Kaplan-Meier, non-parametric):
    S(t) = Π_{t_i ≤ t} [ (n_i - d_i) / n_i ]
    n_i = customers at risk at time t_i
    d_i = customers who paid at exactly t_i
```

**What this gives us the current model lacks:**

1. A confidence interval on any prediction ("90% of A-grade customers pay by day 60")
2. Automatic detection of payment behavior changes (grade-drift)
3. Expected payment day = ∫ S(t) dt (proper expected value, not mean)
4. Survival curves conditioned on current overdue days (updated daily)

**Implementation:** Standard survival analysis. Can be done in browser with
a single page of TypeScript. No ML library needed. Just sort payment events
and compute the product estimator.

---

### 5.4 Win Probability as Logistic Regression

**Replace the multiplicative heuristic with a proper statistical model.**

```
Features:
    x₁ = I(competitor == 'ABB')          [-1 if ABB, 0 otherwise]
    x₂ = I(is_emergency)                  [+1 if emergency, 0 otherwise]
    x₃ = customerGradeScore(grade)        [A=1.0, B=0.5, C=0, D=-0.5]
    x₄ = productAdvantageScore(product)   [Servomex=0.8, GIC=0.5, E+H=0.3, L+G=0]
    x₅ = x₁ × x₂                         [INTERACTION: ABB × emergency]

Linear predictor:
    z = β₀ + β₁x₁ + β₂x₂ + β₃x₃ + β₄x₄ + β₅x₅

Win probability:
    P(win) = σ(z) = 1 / (1 + exp(-z))
```

**Coefficients (initial calibration from business reality doc):**

```
β₀ = 0.0     (base: 50% when no information)
β₁ = -1.85   (ABB present: 50% → ~14%, matches the 0.3× factor)
β₂ = +1.25   (emergency: 50% → ~78%, matches 1.8× factor)
β₃ = +0.9    (A-grade: 50% → ~71%, matches 1.5× factor)
β₄ = +0.6    (Servomex: 50% → ~65%, matches 1.3× factor)
β₅ = +2.1    (ABB × emergency: neutralizes ABB disadvantage — the key interaction!)

VALIDATION: ABB + emergency + Servomex:
    z = -1.85 + 1.25 + 0.6 + (−1.85)(1.25) = 0.0 + 2.1 interaction = ~+2.1
    P(win) = σ(2.1) = 89%  ← correct! (Emergency kills ABB's advantage)

Old multiplicative model: 0.5 × 0.3 × 1.8 × 1.3 = 35%  ← WRONG
```

**Improvement over time:** As won/lost offers accumulate in STDB, retrain the logistic
regression monthly using maximum likelihood. The model gets better automatically.

---

### 5.5 Information Gain for Pricing

**Which feature matters most when setting price?**

Entropy-based feature importance (the same math behind decision trees, but applied
to understand the pricing problem):

```
H(win) = entropy of the win/lose variable
    = -P(win)log₂P(win) - P(lose)log₂P(lose)

For each feature F:
    H(win | F=f) = conditional entropy given we know F
    IG(F) = H(win) - E[H(win | F)]

Features ranked by information gain:
    1. ABB presence (highest IG — binary, highly predictive)
    2. Customer grade (second — A vs D changes everything)
    3. Is emergency (third — high value when true)
    4. Product type (moderate — matters for specialty products)
    5. Relationship years (lowest — useful but not decisive)
```

**Practical implication:** When building the pricing recommendation UI, show features
in order of information gain. If ABB is present, that's the first question to answer.
Don't bury it after product type.

---

### 5.6 Optimal Discount via Expected Value Maximization

**Correct formulation (replacing the ceiling-function approach):**

```
Let:
    d = discount rate (continuous variable 0 to max_grade_discount)
    margin(d) = base_margin - d
    P(win | d) ≈ P(win | d=0) + d × (∂P/∂d)
        (discount changes win probability — slope estimated from historical data)
    deal_size = fixed

Expected_Value(d) = P(win | d) × margin(d) × deal_size

dEV/dd = 0:
    [P'(d)] × margin(d) + P(d) × [-1] = 0
    P'(d) = P(d) / margin(d)

This is the optimal discount condition: the marginal gain in win probability
equals the ratio of current win probability to current margin.
```

**Interpretation:** You should ONLY give a discount when the probability that the
discount changes the outcome (P'(d)) is large enough to justify the margin loss.
For A-grade customers in non-competitive tenders, P'(d) ≈ 0 → optimal discount = 0.
For borderline deals with ABB present, P'(d) is high → discount makes sense.

---

## PART 6: WRIGHT BROTHERS EMPIRICISM

### 6.1 Is the Agent Architecture Isomorphic to Microservices?

Yes, with one crucial difference.

In a microservices architecture:
- Services communicate via HTTP or message queues
- Each service has its own database
- Coordination requires a separate event bus

In AsymmFlow STDB architecture:
- Agents communicate via STDB tables (the tables ARE the message bus)
- All agents share the same database (no data duplication)
- Subscriptions ARE the event bus (no additional infrastructure)

This is Alan Kay's vision: **the database is the object system, and subscriptions are
method calls that never return.** STDB collapses microservices + message bus + database
into a single primitive. The agents are genuinely simpler because they don't need to
manage their own state — STDB is the shared memory.

### 6.2 Can We Apply Reinforcement Learning to Pricing?

The framing:
- State: customer grade, ABB present, product type, urgency, current market
- Action: set markup percentage (discrete: 10%, 12%, 15%, 18%, 20%, 25%)
- Reward: +margin if win, 0 if lose

**Honest assessment:** Not yet. We have insufficient data. PH Trading wins/loses maybe
50-100 deals per year. RL needs thousands of (state, action, reward) tuples to converge.

**What we can do now (Wright Brothers empiricism — fly what we have):**
1. Log every quote with all features and the outcome (win/lose) into STDB
2. In 6 months: fit a logistic regression on this data (achievable at 100 deals)
3. In 2 years: enough data to try RL if desired

The logistic regression from Section 5.4 gives ~85% of the value with 1% of the
complexity. Build that first. The data it generates is what trains the next model.

### 6.3 What AlphaGo Teaches Us About PH Trading Strategy

AlphaGo's key insight: the value function (how good is this position?) is more
important than the policy (what move to make?). Once you have a good value function,
the best move is the one that maximizes the next state's value.

Applied to PH Trading:

The **position value** is: `(MRR + receivables × collectability) / monthly_burn`
- High position value: lots of recurring revenue, high-grade customers, low burn
- Low position value: project-dependent revenue, D-grade customers, high burn

The **move value** is how much each action improves the position:
- Signing a maintenance contract: +MRR/burn ratio → high value
- Chasing a D-grade payment: +receivables × low collectability → moderate value
- Competing with ABB on standard flow meters: -margin with low win probability → negative value

**The AlphaGo lesson for Abhie:** The right strategy is NOT "close every deal." It is
"improve your position." Passing on bad deals (D-grade customers, ABB flow meters)
improves position. Signing one maintenance contract is worth more than three one-time
project wins. The AI should express recommendations as position improvements, not just
deal wins.

### 6.4 On the Geometric Pipeline Vision (Navier-Stokes etc.)

**Honest assessment from Euler:**

The Navier-Stokes equations for cashflow forecasting are mathematically beautiful but
practically wrong for PH Trading's scale.

NS equations model continuous fluids with millions of particles. PH Trading has 50-100
invoices. At this scale, the individual transactions are the dominant effect — not the
continuous flow dynamics. Using NS here is like using quantum mechanics to model a
baseball game.

**What to use instead (and why it's better):**
- Euler's ODE method (Section 5.1): correct level of abstraction, handles discrete events
- Survival analysis (Section 5.3): correct model for payment timing
- Logistic regression (Section 5.4): correct model for win probability

The geometric pipeline vision may be appropriate at larger scale (thousands of invoices,
continuous billing relationships). At PH Trading's current scale, it would add complexity
without accuracy improvement.

**Build the simple correct models first.** When they're limited by their assumptions,
that's when you know the right time to reach for more complex mathematics.

---

## PART 7: THE WRIGHT BROTHERS MOMENT

On December 17, 1903, Orville Wright flew 120 feet in 12 seconds. Not a simulation.
Not a prototype. An actual aircraft that actually flew.

The Wright Brothers moment for AsymmFlow Intelligence is not when we deploy a chatbot.
It is when the PAYMENT CHASER AGENT sends its first WhatsApp draft that Abhie reads,
clicks "send," and a customer calls back within 24 hours to arrange payment.

That is the moment the system crosses from software to business partner.

**The sequence to that moment:**

```
WEEK 1:
    Build the Butler agent (client-side, easiest)
    Connect to live STDB with real PH Trading data
    Abhie asks "which invoices are overdue?" → gets accurate answer in 3 seconds
    The moment: Abhie trusts the number without opening Excel to verify

WEEK 2:
    Build the Payment Chaser agent
    It reads overdue invoices, generates WhatsApp drafts
    AiRecommendation table shows 5 drafts waiting for approval
    Abhie reviews, edits one word, sends
    The moment: Customer pays 3 days later

WEEK 3:
    Build the Pricing Advisor
    When Abhie creates a costing sheet, PricingRecommendation appears automatically
    "Win probability: 67%. ABB is weak here. Offer at 15% markup."
    The moment: Abhie wins a deal he would have priced himself out of

WEEK 4:
    Build the Cashflow Forecaster
    The 90-day chart shows cash going negative in 52 days under P10 scenario
    Abhie initiates a collection blitz that week
    The moment: The cliff was avoided because the system saw it coming
```

**The 120 feet.** Not 10,000 feet. Just far enough to prove the physics works.
Then iterate.

---

## PART 8: THE KEY ARCHITECTURAL DECISIONS (Summary)

### Decision 1: STDB is the message bus
Agents don't call each other. They write to STDB tables. Other agents and humans
subscribe to those tables. Alan Kay's messaging, implemented at the database level.

### Decision 2: Computation is client-side, side effects are procedures
Win probability, cashflow ODE, optimal discount: pure math in the browser, zero cost.
Arabic OCR, WhatsApp sending, PDF generation: STDB procedures with HTTP access.
Chat/narrative: client-side streaming SSE to AI APIs.

### Decision 3: Humans approve, agents draft
Agents NEVER act unilaterally. They write AiRecommendation rows with isPending=true.
Humans see the recommendation, can edit it, approve it with a single click.
The reducer then executes the action. The AI is a junior staff member who needs sign-off.
(Exception: cashflow forecast and pricing recommendation are purely advisory — they don't
trigger actions, they inform decisions.)

### Decision 4: Simple math first
Logistic regression > multiplicative heuristic.
Euler's ODE > Navier-Stokes.
Survival curves > average payment days.
These are correct, not just simpler. When the correct simple model fails, that's
when you know the right time to add complexity.

### Decision 5: Ground every AI call in live data
No AI call goes out without injecting the current business state (overdues, grade mix,
cash position, competitive context). A system prompt without live data is a chatbot.
A system prompt WITH live data is an advisor.

---

## APPENDIX: QUICK REFERENCE

### New STDB Tables Needed (Sprint 4)
1. `AiRecommendation` — agent writes, human approves
2. `CashflowForecast` — 90-day projection rows (daily)
3. `PricingRecommendation` — per costing sheet

### New STDB Procedures Needed
1. `process_arabic_document` — OCR + translate + parse + insert
2. (optional) `send_whatsapp_message` — HTTP to WhatsApp Business API after approval

### New Reducers Needed
1. `create_ai_recommendation` — insert AiRecommendation row
2. `approve_ai_recommendation` — set isPending=false, approvedBy, approvedAt
3. `upsert_cashflow_forecast` — insert or update daily forecast row
4. `create_pricing_recommendation` — insert PricingRecommendation

### API Endpoints Used
- Grok: `https://api.aimlapi.com/v1/chat/completions` (streaming SSE, Bearer token)
- Sarvam translate: `https://api.sarvam.ai/translate` (api-subscription-key header)
- Sarvam chat: `https://api.sarvam.ai/v1/chat/completions` (for audit/entity extraction)
- Claude: `https://api.anthropic.com/v1/messages` (for long-context tender analysis)

### Files to Create (Sprint 4)
```
003-asymmflow-reimagined/
├── module/src/ai_tables.ts          # AiRecommendation, CashflowForecast, PricingRecommendation
├── module/src/ai_reducers.ts        # create_ai_recommendation, approve, upsert_forecast
├── module/src/ai_procedures.ts      # process_arabic_document
├── client/src/lib/agents/
│   ├── butler.ts                    # Conversational agent
│   ├── payment_chaser.ts            # Proactive overdue monitor
│   ├── document_processor.ts        # Arabic document client
│   ├── pricing_advisor.ts           # Win prob + discount optimizer
│   └── cashflow_forecaster.ts       # ODE + Monte Carlo
├── client/src/lib/math/
│   ├── logistic_regression.ts       # Win probability
│   ├── euler_ode.ts                 # Cashflow ODE solver
│   ├── survival_analysis.ts         # Kaplan-Meier payment curves
│   └── optimal_discount.ts          # Expected value maximization
└── client/src/lib/ph_context.ts     # buildPHContext() — live STDB → system prompt
```

---

*"The purpose of computing is insight, not numbers."*
*— Richard Hamming*

*The purpose of AsymmFlow's AI layer is not to answer questions.*
*It is to prevent the company from bleeding to death.*

*Build accordingly.*

**Om Lokah Samastah Sukhino Bhavantu**
*May PH Trading survive, thrive, and serve Bahrain well.*
