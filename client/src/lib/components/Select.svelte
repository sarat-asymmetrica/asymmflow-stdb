<script lang="ts">
  let {
    options = [],
    value = $bindable(''),
    placeholder = 'Select an option',
    disabled = false,
    label = '',
    id = '',
    error = '',
    onchange = undefined,
  } = $props();

  let selectId = $derived(id || `select-${Math.random().toString(36).slice(2, 7)}`);
  let listboxId = $derived(`${selectId}-listbox`);
  let focused = $state(false);
  let isOpen = $state(false);

  let selectedLabel = $derived(
    value ? (options.find((o) => o.value === value)?.label ?? placeholder) : placeholder
  );

  function selectOption(optValue: string) {
    value = optValue;
    isOpen = false;
    onchange?.(optValue);
  }

  function handleOptionKeydown(e: KeyboardEvent, optValue: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectOption(optValue);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      isOpen = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      isOpen = !isOpen;
    } else if (e.key === 'Escape') {
      isOpen = false;
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        isOpen = true;
      } else {
        const idx = options.findIndex((o) => o.value === value);
        const next = options[idx + 1];
        if (next) value = next.value;
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const idx = options.findIndex((o) => o.value === value);
      const prev = options[idx - 1];
      if (prev) value = prev.value;
    }
  }

  function handleBlur() {
    focused = false;
    // Delay close so click on option registers first
    setTimeout(() => {
      isOpen = false;
    }, 150);
  }
</script>

<div class="select-wrap" class:is-focused={focused} class:has-error={!!error} class:is-disabled={disabled}>
  {#if label}
    <label for={selectId} class="select-label">{label}</label>
  {/if}

  <div
    class="select-trigger"
    role="combobox"
    id={selectId}
    tabindex={disabled ? -1 : 0}
    aria-expanded={isOpen}
    aria-haspopup="listbox"
    aria-controls={listboxId}
    aria-disabled={disabled}
    aria-invalid={!!error}
    onclick={() => { if (!disabled) isOpen = !isOpen; }}
    onfocus={() => (focused = true)}
    onblur={handleBlur}
    onkeydown={handleKeydown}
  >
    <span class="select-value" class:is-placeholder={!value}>{selectedLabel}</span>
    <span class="select-arrow" class:open={isOpen} aria-hidden="true">▾</span>
    <span class="select-underline" aria-hidden="true"></span>
  </div>

  {#if isOpen && !disabled}
    <ul class="select-dropdown" id={listboxId} role="listbox" aria-label={label || 'Options'}>
      {#if placeholder}
        <li
          class="select-option is-placeholder"
          role="option"
          aria-selected={!value}
          tabindex="0"
          onclick={() => selectOption('')}
          onkeydown={(e) => handleOptionKeydown(e, '')}
        >
          {placeholder}
        </li>
      {/if}
      {#each options as option}
        <li
          class="select-option"
          class:is-selected={option.value === value}
          role="option"
          aria-selected={option.value === value}
          tabindex="0"
          onclick={() => selectOption(option.value)}
          onkeydown={(e) => handleOptionKeydown(e, option.value)}
        >
          {option.label}
          {#if option.value === value}
            <span class="check-mark" aria-hidden="true">✓</span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if error}
    <span class="select-error" role="alert">{error}</span>
  {/if}
</div>

<style>
  .select-wrap {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    width: 100%;
    position: relative;
  }

  .select-label {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--ink-60);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    transition: color var(--dur-fast) var(--ease-out);
  }

  .select-wrap.is-focused .select-label {
    color: var(--gold);
  }

  .select-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-3) 0;
    border-bottom: 1.5px solid var(--ink-12);
    cursor: pointer;
    position: relative;
    outline: none;
    user-select: none;
    transition: border-color var(--dur-fast) var(--ease-out);
  }

  .select-wrap.is-disabled .select-trigger {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .select-wrap.has-error .select-trigger {
    border-bottom-color: var(--coral-soft);
  }

  .select-value {
    font-family: var(--font-body);
    font-size: var(--text-md);
    color: var(--ink);
  }

  .select-value.is-placeholder {
    color: var(--ink-30);
    font-style: italic;
  }

  .select-arrow {
    font-size: var(--text-sm);
    color: var(--ink-60);
    transition: transform var(--dur-fast) var(--ease-out);
    line-height: 1;
  }

  .select-arrow.open {
    transform: rotate(180deg);
  }

  .select-underline {
    position: absolute;
    bottom: -1.5px;
    left: 0;
    width: 0;
    height: 2px;
    background: var(--gold);
    transition: width var(--dur-normal) var(--ease-smooth);
  }

  .select-wrap.is-focused .select-underline {
    width: 100%;
  }

  .select-wrap.has-error .select-underline {
    width: 100%;
    background: var(--coral);
  }

  .select-dropdown {
    position: absolute;
    top: calc(100% + var(--sp-2));
    left: 0;
    right: 0;
    background: var(--paper-card);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    list-style: none;
    margin: 0;
    padding: var(--sp-2) 0;
    z-index: 100;
    max-height: 240px;
    overflow-y: auto;
    border: 1px solid var(--ink-06);
  }

  .select-option {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--ink);
    padding: var(--sp-3) var(--sp-8);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    transition: background-color var(--dur-instant) var(--ease-out);
  }

  .select-option:hover {
    background: var(--ink-06);
  }

  .select-option.is-selected {
    color: var(--gold);
    font-weight: 500;
  }

  .select-option.is-placeholder {
    color: var(--ink-30);
    font-style: italic;
  }

  .check-mark {
    color: var(--gold);
    font-size: var(--text-xs);
  }

  .select-error {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--coral);
  }
</style>
