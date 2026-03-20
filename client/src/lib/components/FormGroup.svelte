<script>
  let {
    label = '',
    required = false,
    error = '',
    hint = '',
    children,
  } = $props();
</script>

<div class="form-group" class:has-error={!!error}>
  {#if label}
    <div class="form-label-row">
      <span class="form-label">{label}</span>
      {#if required}
        <span class="required-dot" aria-hidden="true" title="Required">●</span>
      {/if}
    </div>
  {/if}

  <div class="form-control">
    {@render children?.()}
  </div>

  {#if error}
    <span class="form-error" role="alert">{error}</span>
  {:else if hint}
    <span class="form-hint">{hint}</span>
  {/if}
</div>

<style>
  .form-group {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    width: 100%;
  }

  .form-label-row {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }

  .form-label {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--ink-60);
    line-height: 1;
  }

  .form-group.has-error .form-label {
    color: var(--coral);
  }

  .required-dot {
    color: var(--gold);
    font-size: 0.45em;
    vertical-align: middle;
    cursor: help;
    flex-shrink: 0;
  }

  .form-control {
    width: 100%;
  }

  .form-error {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--coral);
    line-height: 1.4;
  }

  .form-hint {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--ink-30);
    line-height: 1.4;
  }
</style>
