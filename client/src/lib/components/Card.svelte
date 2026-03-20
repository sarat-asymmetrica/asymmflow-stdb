<script lang="ts">
  let {
    elevated = false,
    padding = 'md' as 'sm' | 'md' | 'lg',
    onclick = undefined,
    children,
  } = $props();

  let isClickable = $derived(typeof onclick === 'function');

  const paddingMap = {
    sm: 'pad-sm',
    md: 'pad-md',
    lg: 'pad-lg',
  };
</script>

<div
  class="card {paddingMap[padding] ?? 'pad-md'}"
  class:elevated
  class:clickable={isClickable}
  role={isClickable ? 'button' : undefined}
  tabindex={isClickable ? 0 : undefined}
  {onclick}
  onkeydown={isClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onclick(e); } } : undefined}
>
  {@render children?.()}
</div>

<style>
  .card {
    background: var(--paper-card);
    border-radius: var(--radius-md);
    border: 1px solid var(--ink-06);
    transition:
      box-shadow var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
    animation: asymm-enter var(--dur-slow) var(--ease-out) both;
  }

  .card.elevated {
    box-shadow: var(--shadow-md);
    border-color: transparent;
  }

  .card.clickable {
    cursor: pointer;
    outline: none;
  }

  .card.clickable:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
    border-color: var(--gold-soft);
  }

  .card.clickable:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }

  .card.clickable:active {
    transform: translateY(0);
    box-shadow: var(--shadow-sm);
  }

  /* Padding variants */
  .pad-sm {
    padding: var(--sp-8);
  }

  .pad-md {
    padding: var(--sp-13);
  }

  .pad-lg {
    padding: var(--sp-21);
  }
</style>
