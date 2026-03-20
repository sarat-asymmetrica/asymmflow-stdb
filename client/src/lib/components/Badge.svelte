<script lang="ts">
  let {
    variant = 'neutral' as 'success' | 'warning' | 'danger' | 'neutral' | 'info' | 'gold',
    size = 'md' as 'sm' | 'md',
    children,
  } = $props();

  const variantMap = {
    success: 'badge-success',
    warning: 'badge-warning',
    danger: 'badge-danger',
    neutral: 'badge-neutral',
    info: 'badge-info',
    gold: 'badge-gold',
  };

  const sizeMap = {
    sm: 'badge-sm',
    md: 'badge-md',
  };
</script>

<span
  class="badge {variantMap[variant] ?? 'badge-neutral'} {sizeMap[size] ?? 'badge-md'}"
  aria-label="{variant} status"
>
  {@render children?.()}
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-ui);
    font-weight: 500;
    letter-spacing: 0.04em;
    border-radius: var(--radius-pill);
    white-space: nowrap;
    line-height: 1;
  }

  /* Sizes */
  .badge-sm {
    font-size: 0.65rem;
    padding: 2px var(--sp-3);
    min-height: 16px;
  }

  .badge-md {
    font-size: var(--text-xs);
    padding: var(--sp-1) var(--sp-5);
    min-height: 20px;
  }

  /* Variants — semantic soft backgrounds */
  .badge-success {
    background: var(--sage-soft);
    color: var(--sage);
  }

  .badge-warning {
    background: var(--amber-soft);
    color: var(--amber);
  }

  .badge-danger {
    background: var(--coral-soft);
    color: var(--coral);
  }

  .badge-info {
    background: var(--blue-soft);
    color: var(--blue);
  }

  .badge-gold {
    background: var(--gold-soft);
    color: var(--gold);
  }

  .badge-neutral {
    background: var(--ink-12);
    color: var(--ink-60);
  }
</style>
