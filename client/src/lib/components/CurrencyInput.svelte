<script lang="ts">
  /**
   * CurrencyInput — BHD currency input.
   * value is bound as BigInt in fils (1 BHD = 1000 fils).
   *
   * Example: 1500 fils = BHD 1.500
   */

  let {
    value = $bindable(0n),
    disabled = false,
    error = '',
    label = '',
    id = '',
    required = false,
  } = $props();

  let inputId = $derived(id || `currency-${Math.random().toString(36).slice(2, 7)}`);
  let focused = $state(false);

  // Display string from fils bigint
  let displayValue = $state('');

  // Initialize display from prop
  $effect(() => {
    if (!focused) {
      displayValue = filsToBHDString(value);
    }
  });

  function filsToBHDString(fils: bigint | null | undefined) {
    if (fils === null || fils === undefined) return '';
    const n = Number(fils);
    return (n / 1000).toFixed(3);
  }

  function parseBHDToFils(str: string) {
    // Remove any non-numeric except dot
    const cleaned = str.replace(/[^0-9.]/g, '');
    if (!cleaned || cleaned === '.') return 0n;
    const num = parseFloat(cleaned);
    if (isNaN(num)) return 0n;
    return BigInt(Math.round(num * 1000));
  }

  function handleInput(e: Event & { currentTarget: HTMLInputElement }) {
    const raw = e.currentTarget.value;
    // Allow only digits and a single decimal point
    const cleaned = raw.replace(/[^0-9.]/g, '');
    // Prevent multiple dots
    const parts = cleaned.split('.');
    const normalized = parts.length > 2
      ? parts[0] + '.' + parts.slice(1).join('')
      : cleaned;

    displayValue = normalized;
    value = parseBHDToFils(normalized);
  }

  function handleFocus() {
    focused = true;
    // Show raw editable value
    displayValue = filsToBHDString(value);
  }

  function handleBlur() {
    focused = false;
    // Format on blur
    displayValue = filsToBHDString(value);
  }
</script>

<div class="currency-wrap" class:has-error={!!error} class:is-disabled={disabled} class:is-focused={focused}>
  {#if label}
    <label for={inputId} class="currency-label">
      {label}
      {#if required}
        <span class="required-dot" aria-hidden="true">●</span>
      {/if}
    </label>
  {/if}

  <div class="currency-field-wrap">
    <span class="currency-prefix" aria-hidden="true">BHD</span>
    <input
      id={inputId}
      type="text"
      inputmode="decimal"
      autocomplete="off"
      {disabled}
      {required}
      value={displayValue}
      placeholder="0.000"
      aria-label="{label || 'Amount'} in BHD"
      aria-invalid={!!error}
      aria-describedby={error ? `${inputId}-error` : undefined}
      onfocus={handleFocus}
      onblur={handleBlur}
      oninput={handleInput}
      class="currency-input"
    />
    <span class="currency-underline" aria-hidden="true"></span>
  </div>

  {#if error}
    <span id="{inputId}-error" class="currency-error" role="alert">{error}</span>
  {/if}
</div>

<style>
  .currency-wrap {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    width: 100%;
  }

  .currency-label {
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

  .currency-wrap.is-focused .currency-label {
    color: var(--gold);
  }

  .currency-wrap.has-error .currency-label {
    color: var(--coral);
  }

  .required-dot {
    color: var(--gold);
    font-size: 0.5em;
    vertical-align: middle;
  }

  .currency-field-wrap {
    position: relative;
    display: flex;
    align-items: center;
    border-bottom: 1.5px solid var(--ink-12);
    transition: border-color var(--dur-fast) var(--ease-out);
  }

  .currency-wrap.has-error .currency-field-wrap {
    border-bottom-color: var(--coral-soft);
  }

  .currency-prefix {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--ink-60);
    letter-spacing: 0.05em;
    padding: var(--sp-3) var(--sp-3) var(--sp-3) 0;
    flex-shrink: 0;
    user-select: none;
  }

  .currency-wrap.is-focused .currency-prefix {
    color: var(--gold);
  }

  .currency-input {
    font-family: var(--font-data);
    font-size: var(--text-md);
    color: var(--ink);
    background: transparent;
    border: none;
    outline: none;
    flex: 1;
    padding: var(--sp-3) 0;
    text-align: right;
    min-width: 0;
  }

  .currency-input::placeholder {
    color: var(--ink-30);
  }

  .currency-input:disabled {
    cursor: not-allowed;
  }

  .currency-wrap.is-disabled {
    opacity: 0.45;
  }

  .currency-underline {
    position: absolute;
    bottom: -1.5px;
    left: 0;
    width: 0;
    height: 2px;
    background: var(--gold);
    transition: width var(--dur-normal) var(--ease-smooth);
  }

  .currency-wrap.is-focused .currency-underline {
    width: 100%;
  }

  .currency-wrap.has-error .currency-underline {
    width: 100%;
    background: var(--coral);
  }

  .currency-error {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--coral);
  }
</style>
