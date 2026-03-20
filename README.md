# AsymmFlow STDB

> Chat-first agentic ERP/CRM built on SpacetimeDB v2.0+

**AsymmFlow V5** — a radical reimagining of enterprise resource planning where AI has skills (file ops, OCR, document generation, payment chasing) with explicit human approval and full audit trails.

## Architecture

- **Frontend**: Svelte 5 + Living Geometry design system
- **Backend**: SpacetimeDB v2.0 (procedures, not separate server)
- **Desktop**: Neutralino (~2MB executable)
- **AI**: Chat-first interface with skill-based execution

## Key Concepts

- **Unified Schema**: Party (Customer+Supplier), Pipeline (Opp+Costing+Offer), MoneyEvent (Invoice+Payment)
- **Universal State Machine**: All state machines as partial monoid — one generic transition reducer
- **Key Invariant**: "outstanding" is NEVER stored — computed from sum of MoneyEvents
- **Skills Architecture**: 15 skills across data/file/intelligence/communication categories
- **AiAction Table**: proposed → approved → executed flow with full audit trail

## Stack

| Layer | Technology |
|-------|-----------|
| Shell | Neutralino v5 (~2MB) |
| State | SpacetimeDB v2.0 |
| UI | Svelte 5 + Living Geometry |
| AI | Sarvam/Grok via AIMLAPI |
| Design | V4 Warm Clay Neumorphism |

## Getting Started

```bash
# Client
cd client && npm install && npm run dev

# Module (SpacetimeDB)
cd module && npm install && npm run build
```

## License

Proprietary — Asymmetrica Research Labs
