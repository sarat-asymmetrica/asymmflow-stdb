# ADR010 — Chat-First UI (Hub Pages are Views, Chat is Interaction)

**Status:** Decided
**Date:** 2026-03-08
**Deciders:** Commander (Sarat) + Claude

---

## Context

The legacy AsymmFlow has 43 screens and 177 Svelte components. Abhie navigates between screens to accomplish tasks: Customer screen → find party → Invoices tab → Create Invoice modal → fill 12 fields → save. Every workflow requires knowing which screen to go to.

The intelligence audit found that Butler AI (the existing chat) is "reactive only" — it answers questions but cannot initiate, execute, or compose workflows. The entire value of the reimagined system is in flipping this: the AI should be able to initiate and execute, with human approval.

The question: what's the right UI paradigm for an AI-first ERP?

---

## Decision

**Chat is the primary interaction surface. Hub pages (Dashboard, Sales, Finance, Operations, Contacts) are views into STDB data — display surfaces, not workflow surfaces. New workflows are initiated via chat, not navigation.**

---

## Rationale

### The Paradigm

```
LEGACY: User navigates to the right screen → fills forms → saves → data changes
REIMAGINED: User describes what they want in chat → AI proposes action → user approves → done
```

Abhie's actual interaction:
```
Legacy:   Menu → Customers → Search "EWA" → Open → Invoices tab →
          Filter overdue → Note down amounts → Close → Contacts tab →
          Find Abu Hassan → WhatsApp icon → open phone → compose message
          [~15 taps, ~5 minutes]

Reimagined: Chat: "Chase EWA for overdue payments"
            AI: "EWA has 3 overdue invoices totaling 7,300 BHD.
                 I'll draft WhatsApp messages for each (Grade B tone).
                 [Approve] [Edit] [Cancel]"
            Abhie: [Approve]
            AI: "Done. 3 drafts ready. Review and send from your phone."
            [~3 taps, ~30 seconds]
```

### Why hub pages stay (as views)

1. **Some information is best browsed, not described.**
   The Sales pipeline visual (kanban-style status view of all opportunities) is
   better as a visual table than as a chat response. "Show me the pipeline" in chat
   returns a text summary; the Pipeline hub shows the full sortable, filterable view.

2. **Data entry still benefits from structured forms.**
   Creating a party with 15 fields is better in a form than in chat (for now).
   Chat can initiate ("create a new customer") and navigate to the form, but the
   form itself has validation, dropdowns, and structured input that chat doesn't
   replicate well yet.

3. **Progressive disclosure for new users.**
   A new team member (Rahul joins PH Trading) can navigate the hub pages to understand
   what data exists. Chat assumes you know what to ask. Hub pages reveal the data model.

### Why chat is primary

1. **Compositional workflows.**
   "Take the Q1 invoices folder, pull the Excel files, and generate a PowerPoint showing
   revenue by customer grade" — this is 4 skills composed. There's no screen for this.
   It can only be expressed in natural language and executed via the skills layer.

2. **Proactive intelligence.**
   The AI can initiate: "EWA hasn't paid in 90 days. Want me to draft a chase letter?"
   This requires the AI to push information, not wait for navigation. Only chat can do this.

3. **The right interface for the actual work.**
   Abhie spends his day: managing relationships, chasing payments, generating quotations,
   monitoring cashflow. None of these are "click this menu" tasks — they're conversational,
   contextual, and often composing multiple data points. Chat matches the actual work.

### The dual-mode layout

```
+-----------------------------------------------------------+
|  Header: Logo + Abhie (Admin) + Connection Status         |
+--------+--------------------------------------------------+
|        |                                                   |
| Side   |  MAIN AREA                                        |
| Nav    |                                                   |
| [Chat] |  Tab 1: Chat Interface (DEFAULT)                  |
| [Dash] |  ┌──────────────────────────────────────────┐    |
| [Sales]|  │ Conversation history                      │    |
| [Ops]  |  │ Approval cards (AiAction proposals)       │    |
| [$$]   |  │ AI responses with rich formatting         │    |
| [Contacts]│ ConfirmCard for explicit skill approvals  │    |
|        |  │ Input: text + attach file                 │    |
|        |  └──────────────────────────────────────────┘    |
|        |                                                   |
|        |  Tab 2-6: Hub pages (views into STDB data)        |
+--------+--------------------------------------------------+
```

Chat is the first tab, always visible. Hub pages are one tap away, but they're
reference views — you go there to see, you go to chat to do.

---

## Consequences

- **F012 (Chat Interface):** Chat is a top-level tab, not a floating overlay.
  Conversation history persists in STDB. Multiple conversations possible.
- **F013 (AI Context Builder):** System prompt includes current hub page context
  (if Abhie is on Sales hub, AI knows he's thinking about pipeline).
- **F014 (AiAction Approval):** Approval cards render as message bubbles in chat.
  The approval UX is part of the conversation, not a separate modal.
- **F005-F011 (Hub Pages):** Hub pages are display surfaces. They have search and
  filter but no "create" flows — create always goes through chat or the modal invoked by chat.
- **F016 (Intent Routing):** Intent router must distinguish: "show me overdue invoices"
  (navigate to Finance hub with filter) vs "chase overdue invoices" (execute skill).
- **Navigation:** Side nav icons navigate to hub pages. Chat icon always returns to chat.

---

## References

- `ARCHITECTURE.md` §6 — UI Architecture (Chat-First + Hub Pages layout)
- `ARCHITECTURE.md` §1 — Paradigm shift table (43 screens → 7 hub pages + chat)
- `audit_intelligence.md` §1.1 — Butler AI audit (reactive only, no agency)
- `VISION_ROADMAP.md` §1.3 — AiAction Approval Pipeline superpower
- `PERSONA_STORM_VERDICT.md` — Persona testing that validated chat-first for Abhie's workflow
