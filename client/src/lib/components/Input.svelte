<script>
  let {
    type = 'text',
    placeholder = '',
    value = $bindable(''),
    required = false,
    error = '',
    disabled = false,
    label = '',
    id = '',
    oninput = undefined,
    onblur = undefined,
  } = $props();

  let inputId = $derived(id || `input-${label.toLowerCase().replace(/\s+/g, '-')}-${Math.random().toString(36).slice(2, 7)}`);
  let focused = $state(false);
</script>

<div class="input-wrap" class:has-error={!!error} class:is-disabled={disabled} class:is-focused={focused}>
  {#if label}
    <label for={inputId} class="input-label">
      {label}
      {#if required}
        <span class="required-dot" aria-hidden="true">●</span>
        <span class="sr-only"> (required)</span>
      {/if}
    </label>
  {/if}

  <div class="input-field-wrap">
    <input
      {type}
      id={inputId}
      {placeholder}
      {disabled}
      {required}
      bind:value
      aria-invalid={!!error}
      aria-describedby={error ? `${inputId}-error` : undefined}
      onfocus={() => (focused = true)}
      onblur={(e) => {
        focused = false;
        onblur?.(e);
      }}
      oninput={oninput}
      class="input-field"
    />
    <span class="input-underline" aria-hidden="true"></span>
  </div>

  {#if error}
    <span id="{inputId}-error" class="input-error" role="alert">{error}</span>
  {/if}
</div>

<style>
  .input-wrap {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    width: 100%;
  }

  .input-label {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--ink-60);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    transition: color var(--dur-fast) var(--ease-out);
  }

  .input-wrap.is-focused .input-label {
    color: var(--gold);
  }

  .input-wrap.has-error .input-label {
    color: var(--coral);
  }

  .required-dot {
    color: var(--gold);
    font-size: 0.5em;
    vertical-align: middle;
  }

  .input-field-wrap {
    position: relative;
    display: flex;
    flex-direction: column;
  }

  .input-field {
    font-family: var(--font-body);
    font-size: var(--text-md);
    color: var(--ink);
    background: transparent;
    border: none;
    border-bottom: 1.5px solid var(--ink-12);
    padding: var(--sp-3) 0;
    width: 100%;
    outline: none;
    transition: border-color var(--dur-fast) var(--ease-out);
  }

  .input-field::placeholder {
    color: var(--ink-30);
    font-style: italic;
  }

  .input-field:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  /* Gold underline on focus */
  .input-underline {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 0;
    height: 2px;
    background: var(--gold);
    transition: width var(--dur-normal) var(--ease-smooth);
  }

  .input-wrap.is-focused .input-underline {
    width: 100%;
  }

  /* Coral underline on error */
  .input-wrap.has-error .input-underline {
    width: 100%;
    background: var(--coral);
  }

  .input-wrap.has-error .input-field {
    border-bottom-color: var(--coral-soft);
  }

  .input-error {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--coral);
    margin-top: var(--sp-1);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }
</style>
