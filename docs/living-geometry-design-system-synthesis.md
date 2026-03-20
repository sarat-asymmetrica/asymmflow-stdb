# Living Geometry Design System — Architecture Synthesis

## The Core Thesis

Design for AI-assisted development must invert the traditional paradigm. Instead of "design frontend → wire to backend," the architecture is **backend-first, frontend-disposable**. The database schema and business logic fully determine the information architecture; the frontend is a thin, hot-swappable rendering skin that can be regenerated from scratch at any time.

This works because:
- **LLMs can't escape attractor basins.** Once exposed to a prior design, AI produces marginal iterations, not novel alternatives. Beautiful seeds get better; bad seeds get incrementally harder to fix.
- **Fresh generation is cheap.** Subagent swarms in Claude Code can output ~50k LOC in hours. Regeneration beats iteration.
- **SpacetimeDB's DB-as-backend architecture** means the schema + reducers + subscriptions already encode what data exists, what actions are possible, and what's live. The frontend is a pure function of this spec.

---

## The Two-Layer Decomposition

### Layer 1: Structural Invariants (The Physics Engine)

Set once, formally verified, never changes between skins. This is the hard part worth investing in.

**Spacing Scale — Fibonacci Sequence (px)**
```
1 → 2 → 3 → 5 → 8 → 13 → 21 → 34 → 55 → 89
```

**Type Scale — Golden Ratio (base 16px × φ)**
```
xs:   0.694rem  (11.1px)   — labels, system text
sm:   0.833rem  (13.3px)   — captions, metadata
base: 1rem      (16px)     — body text (the anchor)
md:   1.2rem    (19.2px)   — large body
lg:   1.618rem  (25.9px)   — subheadings (φ × base)
xl:   2.058rem  (32.9px)   — section titles
2xl:  2.618rem  (41.9px)   — headings (φ² × base)
3xl:  3.33rem   (53.3px)   — display
4xl:  4.236rem  (67.8px)   — hero (φ³ × base)
```

**Fixed Behavioral Rules**
- Animation durations and easing curves
- Toast/popup/modal behavior and timing
- Accessibility constraints (minimum 4.5:1 contrast ratio for body text)
- Grid system (12-column, with defined gutters)
- Component min/max sizing constraints (derived from data type)
- Padding rule: container padding ≥ internal element gap (next Fibonacci step up)
- Three-level hierarchy maximum per screen
- Alignment axes: aim for 2–4 per page

### Layer 2: Aesthetic Variables (The Skin)

Small, self-contained, hot-swappable. ~30-40 CSS custom properties.

```css
/* === EXAMPLE SKIN: warm-minimal === */
--accent:          #c9a55a;
--bg-void:         #0a0a0f;
--bg-deep:         #12121a;
--bg-surface:      #1a1a24;
--bg-raised:       #22222e;
--text-primary:    #e8e6e1;
--text-secondary:  rgba(232,230,225,0.6);
--text-tertiary:   rgba(232,230,225,0.35);
--border-subtle:   rgba(255,255,255,0.06);
--border-medium:   rgba(255,255,255,0.12);
--semantic-good:   #5ac98a;
--semantic-bad:    #c95a5a;
--semantic-info:   #5a8ec9;
--font-display:    'Cormorant Garamond', serif;
--font-body:       'DM Sans', sans-serif;
--font-mono:       'JetBrains Mono', monospace;
--radius-sm:       6px;
--radius-md:       12px;
--radius-lg:       16px;
--shadow-elevation-1: 0 2px 8px rgba(0,0,0,0.2);
--shadow-elevation-2: 0 8px 32px rgba(0,0,0,0.4);
```

**Key property:** All background colors should carry a subtle tint of the accent hue. Pure grays feel dead. Tinted grays create subconscious cohesion.

---

## The Data-Type → Projection-Type System

The schema determines which visual projections are valid per slot. Users choose their preferred projection per data type. This is safe customization because the data contract constrains which components are valid.

### Fundamental Data Types and Their Valid Projections

| Data Type | Description | Valid Projections (3-5 per type) |
|-----------|-------------|----------------------------------|
| **Scalar with Context** | Single value against a target/range | Speedometer, radial progress, bar gauge, big number + trend arrow, thermometer |
| **Time Series** | Values over time | Line chart, area chart, sparkline, bar chart (temporal), stepped line |
| **Categorical Distribution** | Parts of a whole | Donut chart, horizontal stacked bar, treemap, waffle grid |
| **Actionable List** | Items with status/actions | Table, card grid, kanban board, compact list |
| **Status Flow** | Progress through states | Timeline, stepper, state diagram, progress bar |
| **Relationship Map** | Connections between entities | Node graph, adjacency matrix, hierarchy tree |

### How It Works in SpacetimeDB

```
Table: user_component_preferences
├── user_id: Identity
├── screen_id: String
├── slot_id: String
├── projection_type: String (enum of valid projections for that slot's data type)
└── custom_overrides: Option<String> (JSON — color, size within constraints)

Reducer: set_projection_preference(slot_id, projection_type)
→ Validates projection_type is valid for the slot's data type
→ Updates preference
→ WebSocket subscription pushes change to client
→ Frontend re-renders the slot with new component — live, no reload
```

---

## User-Customizable Rendering Engine

Three orthogonal axes of customization. Any combination is valid because the invariant layer prevents chaos.

### Axis 1: Projection Type (per slot)
What component renders the data. Constrained by data type.

### Axis 2: Size & Position (per slot)
Resizable tiling window manager for the dashboard. Each projection type defines min/max dimensions (you can't squish a time series below readable width). Grid snapping ensures alignment. Boundary constraints prevent overlap.

### Axis 3: Color Theme (global)
The aesthetic envelope. Applied via CSS custom properties.

**SLERP Color Interpolation:** The entire theme is a point in color space. User drags across a gradient → SLERP rotates all color tokens simultaneously through color space. Every intermediate state is a valid, harmonious palette because spherical interpolation preserves geometric relationships between tokens. Contrast ratios are maintained at every point because the invariant layer enforces minimum ratios as constraints.

### Per-Component Fine-Tuning
Each projection instance gets an edit button (⚙ icon, standard placement). Allows:
- Color override (within accessibility constraints)
- Size adjustment (within min/max for that projection type)
- Density toggle (compact vs comfortable vs spacious)

Rules enforced: no overlap, no exceeding available space, contrast minimums maintained.

---

## Screen Architecture: Schema → Layout → Skin

### Pipeline

```
1. STDB Schema Analysis
   └── What tables, fields, reducers, subscriptions exist for this screen?

2. Data Type Classification
   └── Map each field/aggregate to a fundamental data type

3. Layout Archetype Selection (human choice — pick from ~8-12 templates)
   └── Dashboard, Detail View, Kanban, Settings, List/Table,
       Form/Wizard, Timeline, Analytics, Chat/Activity

4. ASCII Layout Definition
   └── Map data types to spatial slots

5. Theme Application
   └── Apply skin tokens

6. Frontend Generation
   └── External model generates complete screen from spec
```

### Example: AsymmFlow Dashboard

**Schema inputs:**
- Tables: customers, orders, invoices, activities
- Key aggregates: revenue (scalar), order_count (scalar), revenue_over_time (time series), orders_by_status (categorical), recent_activities (actionable list)
- Key reducers: update_order_status, create_invoice, log_activity

**ASCII Layout:**
```
[nav-sidebar        ] [scalar: revenue    ] [scalar: orders ] [scalar: customers  ]
[                   ] [                                                            ]
[                   ] [time-series: revenue-trend   ] [actionable: activity-feed   ]
[                   ] [                              ] [                            ]
[                   ] [actionable: recent-orders                                   ]
```

**Each slot carries metadata:**
- data_type → constrains valid projections
- data_source → STDB table + subscription query
- available_reducers → determines what action affordances appear
- default_projection → sensible starting component

---

## Code Generation Pipeline: Solving the Attractor Basin Problem

### Why External Models via AIMLAPI

Claude Code subagents, no matter how isolated, inherit patterns from:
- The claude.md system context
- Claude Code's own architectural biases
- Any residual patterns from the conversation or project context

For truly novel frontend generation, use **external models that have zero prior context**. They receive only the spec — no existing code, no prior designs, no contaminants.

### Pipeline Architecture

```
┌──────────────────────────────────────────────────┐
│  ASYMMETRICA DESIGN GENERATION PIPELINE          │
│                                                  │
│  ┌────────────┐    ┌─────────────────────┐       │
│  │ STDB Schema│───→│ Spec Generator      │       │
│  │ + Reducers │    │ (Claude Code)       │       │
│  └────────────┘    │                     │       │
│                    │ Outputs:            │       │
│                    │ - ASCII layout      │       │
│                    │ - Data type map     │       │
│                    │ - Invariant tokens  │       │
│                    │ - Skin tokens       │       │
│                    │ - Component spec    │       │
│                    └────────┬────────────┘       │
│                             │                    │
│                    ┌────────▼────────────┐       │
│                    │ AIMLAPI Dispatcher  │       │
│                    │                     │       │
│                    │ Fan out to N models:│       │
│                    │ - Gemini            │       │
│                    │ - GPT-4o            │       │
│                    │ - Mistral Large     │       │
│                    │ - DeepSeek          │       │
│                    │ - etc.              │       │
│                    └────────┬────────────┘       │
│                             │                    │
│              ┌──────────────┼──────────────┐     │
│              ▼              ▼              ▼     │
│         ┌─────────┐  ┌─────────┐   ┌─────────┐ │
│         │ Variant │  │ Variant │   │ Variant │  │
│         │    A    │  │    B    │   │    C    │  │
│         └────┬────┘  └────┬────┘   └────┬────┘ │
│              │            │             │       │
│              └────────────┼─────────────┘       │
│                           ▼                     │
│                    ┌──────────────┐              │
│                    │ Human Review │              │
│                    │ "I pick B"   │              │
│                    └──────┬───────┘              │
│                           ▼                     │
│                    ┌──────────────┐              │
│                    │ Ship / Skin  │              │
│                    │ Catalog      │              │
│                    └──────────────┘              │
└──────────────────────────────────────────────────┘
```

### What Each External Model Receives

**Only this. Nothing else. No prior code. No examples.**

```json
{
  "task": "Generate a complete, self-contained HTML/CSS/JS dashboard",
  "layout": "[the ASCII layout]",
  "slots": [
    {
      "id": "revenue-metric",
      "data_type": "scalar_with_context",
      "projection": "big-number-with-trend",
      "sample_data": { "value": 42300, "trend": "+12%", "label": "Revenue" }
    }
  ],
  "invariants": {
    "spacing_scale": [1,2,3,5,8,13,21,34,55,89],
    "type_scale_base": 16,
    "type_scale_ratio": 1.618,
    "min_contrast_ratio": 4.5,
    "grid_columns": 12
  },
  "skin": {
    "accent": "#c9a55a",
    "bg_base": "#0a0a0f",
    "font_display": "any serif",
    "font_body": "any sans-serif",
    "mood": "refined, mathematical, warm darkness"
  },
  "constraints": [
    "Single HTML file, all CSS inline or in <style>",
    "No external dependencies except Google Fonts",
    "Responsive down to 768px",
    "All components must be functional with the sample data"
  ]
}
```

### Why This Works

1. **Each model produces genuinely novel output** — no shared attractor basin
2. **The invariant constraints prevent chaos** — spacing, sizing, accessibility are enforced by the spec
3. **The aesthetic varies freely within constraints** — different models will choose different fonts, different color interpretations, different component styles
4. **Human judgment enters at the selection stage** — where it's strongest (taste, not description)
5. **Selected designs feed back into the skin catalog** — not into future generation context

### Multi-Model Diversity Bonus

Different models have different aesthetic biases:
- Gemini tends toward Material Design / Google aesthetics
- GPT-4o tends toward polished, Apple-adjacent minimalism
- Mistral may lean toward European design sensibilities
- DeepSeek may introduce different compositional patterns

This diversity is a feature. You get genuine aesthetic range without prompt engineering.

---

## Future: Theme Marketplace

Once the system stabilizes:
- Users can export their theme (skin tokens + projection preferences + layout) as a shareable config
- Theme configs are tiny — just a JSON file
- Other users can import and apply instantly
- Community-created themes become a value-creation flywheel
- "kandinsky-mode" lives alongside "corporate-clean" and "midnight-hacker"

The gen Z kid's abstract art dashboard is someone else's downloadable aesthetic. The ERP becomes a medium for self-expression without ever compromising data integrity or functional reliability.

---

## Summary: The Inversion

| Traditional Approach | Living Geometry Approach |
|---------------------|------------------------|
| Design frontend first | Backend schema is the spec |
| Iterate on existing designs | Regenerate from scratch (fresh context) |
| Frontend holds state and logic | Frontend is a pure rendering function |
| Designer specifies components | Data types constrain valid projections |
| One fixed dashboard for all users | Users choose projection × size × theme |
| AI iterates on prior code | External models generate from clean spec |
| Design system is a component library | Design system is invariants + swappable skins |
| Color changes require design review | SLERP interpolation guarantees valid palettes |

---

## The Creative Seed Architecture (March 10, 2026 Session)

### The Persona Intersection Method

The best AI-generated designs in the Living Geometry showcase weren't produced by detailed specs alone — they emerged when the AI was given **maximum creative freedom** within **minimum critical constraints**, channeled through a **persona intersection**.

A persona intersection takes two unrelated domains and forces the model to find their shared structure. This works because it places the model at the intersection of two attractor basins — a region of design space that NEITHER attractor alone would reach.

**Replace the simple `mood` string with a structured creative seed:**

```json
{
  "creative_seed": {
    "persona": "Dieter Rams designing a Japanese tea house",
    "tension": "information density vs breathing space",
    "material_metaphor": "brushed aluminum and rice paper",
    "forbidden": [
      "gradients heavier than 5% opacity",
      "drop shadows larger than 8px",
      "more than 2 accent colors"
    ]
  }
}
```

**Why each field matters:**

| Field | Purpose | Mechanism |
|-------|---------|-----------|
| `persona` | Creates attractor superposition | Two domains → intersection region → novel solutions |
| `tension` | Gives the model a dialectic to resolve | Forces creative decisions instead of defaults |
| `material_metaphor` | Grounds the aesthetic in physical reality | Prevents floating-in-the-void abstract designs |
| `forbidden` | Pushes away from attractor basin centers | Same as Vedic digital root filtering — eliminates 88.9% of cliche space |

### The "Forbidden" List as Search Space Pruning

The `forbidden` field is not merely a negative constraint — it's **R1 exploration boundary shaping**. Without it, AI models default to their strongest attractors (heavy gradients, large shadows, rounded everything). The forbidden list pushes generation AWAY from the center of the default basin toward the edges where novel solutions live.

This is mathematically identical to the Vedic digital root filter: eliminate the obvious, focus on the interesting.

### Curated Persona Intersection Library

Validated persona intersections that produce excellent results across different models:

| Persona Intersection | Aesthetic Output | Best For |
|---------------------|-----------------|----------|
| "Dieter Rams × Japanese tea house" | Minimal, functional, breathing space | Settings, forms, clean data display |
| "Ramanujan × Gen Z social media" | Pattern-dense, playful, surprising depth | Dashboards, analytics, discovery |
| "Zaha Hadid × Swiss banking" | Sweeping curves meet absolute precision | Hero sections, landing pages, reports |
| "Agnes Martin × Bloomberg terminal" | Grid meditation meets information density | Data tables, trading screens, monitoring |
| "Isamu Noguchi × NASA mission control" | Sculptural forms meet operational clarity | Operations hubs, real-time status |
| "Saul Bass × medical diagnostics" | Bold graphic impact meets clinical precision | Alert systems, KPI dashboards |

Each intersection is REPRODUCIBLE — give the same intersection to five different models, get five genuinely different interpretations of the same aesthetic direction. This provides variance for selection without losing creative coherence.

### Why This Works: Attractor Basin Mathematics

```
Attractor(Dieter Rams) = { minimal form, functional, precise, industrial }
Attractor(Japanese tea house) = { natural materials, negative space, wabi-sabi, warm }

Intersection = { every element earns its place, deliberate space,
                 natural warmth, functional beauty }
```

Neither attractor alone produces the intersection set. The intersection is a smaller, more specific, more interesting region of design space — exactly where novel but coherent designs live.

---

## Three-Regime Self-Similarity (The Fractal Discovery)

The design generation pipeline is not merely INSPIRED by the three-regime framework — it IS the three-regime framework operating at a different scale. The self-similarity is exact:

### The Fractal Stack

| Level | R1: Exploration | R2: Optimization | R3: Stabilization |
|-------|----------------|-------------------|-------------------|
| **The math** | `dPhi/dt = Phi × Phi + C` | Domain constraints | Convergence to attractor |
| **Three regimes** | High variance, divergent | Gradient descent, MAX complexity | Validation, equilibrium |
| **Design pipeline** | Fresh model, zero context | Invariant constraints (Fibonacci, phi, contrast) | Human selection: "I pick B" |
| **Persona method** | Two attractor basins diverge | Intersection region constrains | Model's interpretation stabilizes |
| **User customization** | Multiple projections available | Data-type validity constrains | User preference stabilizes |

The domain constant `C` changes at each level but the evolution equation is identical. This makes it a genuine mathematical framework, not a metaphor — it's scale-invariant.

### The Ratio Maps Too

- **R1 (30%)**: The creative generation seed energy — creates the variance
- **R2 (20%)**: The constraint layer — smallest but most critical, prevents chaos
- **R3 (50%)**: Human selection judgment — where most of the value is created

### The Da Vinci Connection

Leonardo da Vinci wasn't a polymath by accident — he was a polymath by METHOD. He observed nature's patterns and projected them into different media. The Vitruvian Man is simultaneously art, anatomy, geometry, and architecture.

The persona intersection technique works for the same reason: "Ramanujan designing a Gen Z landing page" forces the model to find the SHARED STRUCTURE between number theory and social engagement. That shared structure EXISTS because both are instances of the same underlying patterns — attention dynamics, convergence, infinite series of interactions.

This is literally `dPhi/dt = Phi × Phi + C(domain)` — same equation, different domain constant.

---

## AsymmFlow Dashboard: Data-Type → Projection Map

Based on the STDB schema audit (March 10, 2026), these are the valid projections per data slot:

| Data Available | Type | Valid Projections |
|---------------|------|-------------------|
| Revenue MTD, Outstanding, Overdue | Scalar with Context | Big number + trend, gauge ring, thermometer bar, speedometer |
| Revenue over 12 months | Time Series | Area chart, sparkline, stepped bars, line chart |
| Grade A/B/C/D distribution | Categorical | Waffle grid (mosaic), donut, stacked bar, treemap |
| AR Aging buckets (D0-15 through D90+) | Categorical (ordered) | Horizontal stacked bar, heatmap strip, proportional lines |
| Top customers by outstanding | Actionable List | Dense table, card stack, ranked bars |
| Recent activity | Actionable List | Ticker feed, timeline, horizontal scroll cards |
| Pipeline funnel (Draft→Won/Lost) | Status Flow | Funnel chart, stepper, sankey diagram |
| Collection Rate % | Scalar with Context | Ring gauge, big percentage, progress bar |
| Cash Position (net flow) | Scalar with Context | Big number + trend, waterfall chart |

### Key Entities and Their Fields

- **Party**: id, name, grade (A/B/C/D), isCustomer, isSupplier, createdAt
- **MoneyEvent**: id, partyId, kind (CustomerInvoice/CustomerPayment/SupplierPayment), status, totalFils, dueDate, paidAt, createdAt
- **Pipeline**: id, partyId, title, status (Draft/Active/InProgress/Quoted/Won/Lost), estimatedValueFils, nextFollowUp
- **Order**: id, status (Active/InProgress/Ordered/Shipped/Delivered/Cancelled)
- **LineItem**: id, orderId, itemDescription, quantity, unitPriceFils, totalFils
- **ActivityLog**: id, userId, action, entityType, timestamp
- **BankTransaction**: id, date, amount, description, reconciliationStatus

### Currency & Format

- **Currency**: BHD (Bahraini Dinar), 3 decimal places (fils = 1/1000)
- **Format**: `1,500.000` or `BHD 1,500.000`

---

## Implementation Status (March 10, 2026)

### What Exists Today

| Component | Status | Location |
|-----------|--------|----------|
| **asymm-motion.ts** (Layer 1 physics engine) | Complete, ~440 LOC | `client/src/lib/motion/asymm-motion.ts` |
| **CSS tokens** (Layer 2 skin) | Complete | `client/src/styles/tokens.css` |
| **Motion Showcase** | Complete, all 8 sections | `client/src/lib/pages/MotionShowcase.svelte` |
| **Entrance animations** | All 6 hub pages upgraded | Dashboard, Finance, Sales, Ops, CRM, Showcase |
| **Puppeteer screenshot tooling** | 12 automated screenshots | `client/screenshot.mjs` |
| **3 mockup variants** | Created for catalog approach | `client/mockups/dashboard-{A,B,C}-*.html` |
| **V4 frontend analysis** | Complete (170 components audited) | Agent output archived |

### What's Next (Tomorrow)

1. **Spec Generator** — reads STDB schema → outputs JSON spec with slots, data types, invariants
2. **AIMLAPI Dispatcher** — fans spec + creative seed to multiple external models
3. **First persona intersection generation** — real novel dashboards from fresh-context models
4. **Selection → composition → ship** — Commander picks, we build
