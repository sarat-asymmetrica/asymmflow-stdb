<script lang="ts">
  /**
   * KPICard — V4 Rams x Neumorphic
   *
   * Props:
   *   label        — 10px uppercase label (e.g. "REVENUE MTD")
   *   number       — big display value (e.g. "12,450")
   *   unit         — small trailing unit (e.g. "BHD")
   *   subtitle     — secondary line below the number
   *   subtitleColor — 'sage' | 'coral' | 'gold' | 'muted' (default: 'muted')
   *   variant       — 'default' | 'danger' (danger adds coral top border)
   *   onclick       — optional click handler
   *   href          — optional; if set, renders as <a> instead of <div>
   */

  let {
    label = '',
    number = '',
    unit = '',
    subtitle = '',
    subtitleColor = 'muted' as 'sage' | 'coral' | 'gold' | 'muted',
    variant = 'default' as 'default' | 'danger',
    onclick = undefined as (() => void) | undefined,
  } = $props();

  let isInteractive = $derived(onclick !== undefined);
</script>

{#if isInteractive}
  <button
    class="kpi-card kpi-card--{variant}"
    type="button"
    {onclick}
  >
    <span class="kpi-label">{label}</span>
    <span class="kpi-number-row">
      <span class="kpi-number">{number}</span>
      {#if unit}
        <span class="kpi-unit">{unit}</span>
      {/if}
    </span>
    {#if subtitle}
      <span class="kpi-subtitle kpi-subtitle--{subtitleColor}">{subtitle}</span>
    {/if}
  </button>
{:else}
  <div class="kpi-card kpi-card--{variant}">
    <span class="kpi-label">{label}</span>
    <span class="kpi-number-row">
      <span class="kpi-number">{number}</span>
      {#if unit}
        <span class="kpi-unit">{unit}</span>
      {/if}
    </span>
    {#if subtitle}
      <span class="kpi-subtitle kpi-subtitle--{subtitleColor}">{subtitle}</span>
    {/if}
  </div>
{/if}

<style>
  .kpi-card {
    /* Neumorphic raised surface */
    background: var(--paper-card);
    border: none;
    border-radius: 14px;
    box-shadow:
      -6px -6px 14px rgba(253, 251, 247, 0.75),
       6px  6px 14px rgba(170, 160, 142, 0.3);

    padding: var(--sp-21) var(--sp-21);
    display: flex;
    flex-direction: column;
    gap: var(--sp-8);
    text-align: left;
    font-family: var(--font-ui);
    cursor: default;
    transition:
      box-shadow var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-out);
  }

  button.kpi-card {
    cursor: pointer;
  }

  button.kpi-card:hover {
    box-shadow:
      -8px -8px 18px rgba(253, 251, 247, 0.85),
       8px  8px 18px rgba(170, 160, 142, 0.35);
    transform: translateY(-1px);
  }

  button.kpi-card:active {
    box-shadow:
      inset -3px -3px 7px rgba(253, 251, 247, 0.5),
      inset  3px  3px 7px rgba(170, 160, 142, 0.2);
    transform: translateY(0);
  }

  button.kpi-card:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 3px;
  }

  /* Danger variant — coral top accent */
  .kpi-card--danger {
    border-top: 2px solid var(--coral);
  }

  .kpi-label {
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--ink-40);
    line-height: 1;
  }

  .kpi-number-row {
    display: flex;
    align-items: baseline;
    gap: var(--sp-5);
    line-height: 1;
  }

  .kpi-number {
    font-size: 44px;
    font-weight: 300;
    letter-spacing: -0.04em;
    color: var(--ink);
    line-height: 1;
  }

  .kpi-unit {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--ink-40);
    letter-spacing: 0.04em;
  }

  .kpi-subtitle {
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.08em;
    line-height: 1.3;
  }

  .kpi-subtitle--muted  { color: var(--ink-40); }
  .kpi-subtitle--sage   { color: var(--sage);   font-weight: 600; }
  .kpi-subtitle--coral  { color: var(--coral);  font-weight: 600; }
  .kpi-subtitle--gold   { color: var(--gold);   font-weight: 600; }
</style>
