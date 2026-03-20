<script lang="ts">
  import { activeMessages } from './chatStore';

  let {
    onSend = (_msg: string) => {},
    disabled = false,
    placeholder = 'Message your Butler...',
  } = $props();

  let text = $state('');
  let textareaEl = $state<HTMLTextAreaElement | null>(null);
  let isFocused = $state(false);

  let hasText = $derived(text.trim().length > 0);
  let isDisabled = $derived(disabled);

  // Show chips only while the conversation is at the welcome-message-only state
  let showChips = $derived(
    ($activeMessages ?? []).filter((m) => m.role !== 'system').length <= 1
  );

  const SUGGESTED_PROMPTS = [
    'Who owes us the most?',
    'Create a quotation',
    'Chase overdue payments',
    'Show my dashboard summary',
    'Generate a statement',
  ];

  function send() {
    const msg = text.trim();
    if (!msg || isDisabled) return;
    onSend(msg);
    text = '';
    if (textareaEl) {
      textareaEl.style.height = 'auto';
    }
  }

  function handleChipClick(prompt: string) {
    onSend(prompt);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        send();
        return;
      }
      if (!text.includes('\n')) {
        e.preventDefault();
        send();
      }
    }
  }

  function handleInput(e: Event) {
    const el = e.target as HTMLTextAreaElement;
    text = el.value;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }

  function handleFocus() { isFocused = true; }
  function handleBlur()  { isFocused = false; }
</script>

<div class="chat-input-zone">
  <!-- Quick-action chips — visible only on fresh conversation -->
  {#if showChips}
    <div class="chips-row" aria-label="Suggested prompts">
      {#each SUGGESTED_PROMPTS as prompt}
        <button
          class="chip"
          type="button"
          disabled={isDisabled}
          onclick={() => handleChipClick(prompt)}
        >
          {prompt}
        </button>
      {/each}
    </div>
  {/if}

  <!-- Input bar: neumorphic inset container -->
  <div class="input-bar" class:focused={isFocused}>
    <!-- Gold chat icon on left -->
    <div class="input-icon" aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path
          d="M7 1.5C3.96 1.5 1.5 3.68 1.5 6.375c0 1.27.54 2.42 1.43 3.25L2.1 12l2.62-.94A6.04 6.04 0 0 0 7 11.25c3.04 0 5.5-2.18 5.5-4.875S10.04 1.5 7 1.5Z"
          stroke="currentColor"
          stroke-width="1.25"
          stroke-linejoin="round"
        />
      </svg>
    </div>

    <textarea
      bind:this={textareaEl}
      class="message-field"
      rows="1"
      {placeholder}
      disabled={isDisabled}
      aria-label="Message input"
      aria-multiline="true"
      value={text}
      oninput={handleInput}
      onkeydown={handleKeydown}
      onfocus={handleFocus}
      onblur={handleBlur}
    ></textarea>

    <!-- Ctrl+K hint on right (fades when typing) -->
    {#if !hasText && !isDisabled}
      <span class="kbd-hint" aria-hidden="true">Ctrl K</span>
    {/if}

    <button
      class="send-btn"
      class:has-text={hasText}
      disabled={!hasText || isDisabled}
      onclick={send}
      aria-label="Send message"
      title="Send (Enter)"
      type="button"
    >
      <!-- Arrow right icon -->
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M2.5 7h9M8 3.5L11.5 7 8 10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
  </div>

  <p class="hint" aria-live="polite">
    {#if isFocused}
      <span>Enter to send &nbsp;&middot;&nbsp; Ctrl+Enter for new line</span>
    {/if}
  </p>
</div>

<style>
  .chat-input-zone {
    padding: var(--sp-8) var(--sp-21) var(--sp-13);
    position: sticky;
    bottom: 0;
    z-index: var(--z-sticky);
    background: var(--paper);
  }

  /* ── Suggested prompt chips ── */
  .chips-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-5);
    margin-bottom: var(--sp-8);
  }

  .chip {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 400;
    color: var(--ink-60);
    background: var(--paper-card);
    border: none;
    border-radius: var(--radius-sm);
    padding: var(--sp-4) var(--sp-13);
    cursor: pointer;
    box-shadow: var(--shadow-neu-btn);
    line-height: 1.4;
    white-space: nowrap;
    transition:
      box-shadow var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      transform var(--dur-instant) var(--ease-out);
  }

  .chip:hover:not(:disabled) {
    color: var(--gold);
    box-shadow:
      -3px -3px 6px rgba(253, 251, 247, 0.7),
      3px 3px 6px rgba(170, 160, 142, 0.28);
    transform: translateY(-1px);
  }

  .chip:active:not(:disabled) {
    box-shadow: var(--shadow-neu-inset);
    transform: scale(0.97);
  }

  .chip:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }

  .chip:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* ── Input bar — neumorphic inset (concave = type here) ── */
  .input-bar {
    display: flex;
    align-items: flex-end;
    gap: var(--sp-8);
    background: var(--paper-card);
    box-shadow: var(--shadow-neu-inset);
    border-radius: var(--radius-lg);
    padding: var(--sp-8) var(--sp-8) var(--sp-8) var(--sp-13);
    transition:
      box-shadow var(--dur-fast) var(--ease-out);
  }

  .input-bar.focused {
    box-shadow:
      var(--shadow-neu-inset),
      0 0 0 2px var(--gold-soft);
  }

  /* Gold chat icon */
  .input-icon {
    color: var(--gold);
    flex-shrink: 0;
    padding-bottom: var(--sp-3);
    opacity: 0.7;
  }

  /* Textarea */
  .message-field {
    flex: 1;
    resize: none;
    border: none;
    background: transparent;
    font-family: var(--font-body);
    font-size: var(--text-base);
    color: var(--ink);
    line-height: 1.6;
    outline: none;
    min-height: 24px;
    max-height: 160px;
    overflow-y: auto;
    padding: var(--sp-3) 0;
    scrollbar-width: thin;
    scrollbar-color: var(--ink-12) transparent;
  }

  .message-field::placeholder {
    color: var(--ink-30);
    font-style: italic;
  }

  .message-field:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Keyboard shortcut hint */
  .kbd-hint {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-30);
    padding-bottom: var(--sp-4);
    flex-shrink: 0;
    white-space: nowrap;
  }

  /* Send button — neumorphic raised, gold when active */
  .send-btn {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-sm);
    border: none;
    background: var(--paper-card);
    box-shadow: var(--shadow-neu-btn);
    color: var(--ink-30);
    font-size: var(--text-md);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    opacity: 0.5;
    transition:
      opacity var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out),
      transform var(--dur-instant) var(--ease-out);
  }

  .send-btn.has-text {
    opacity: 1;
    color: var(--gold);
    box-shadow:
      -3px -3px 6px rgba(253, 251, 247, 0.7),
      3px 3px 6px rgba(170, 160, 142, 0.28);
  }

  .send-btn.has-text:hover {
    transform: scale(1.06);
  }

  .send-btn:active:not(:disabled) {
    box-shadow: var(--shadow-neu-inset);
    transform: scale(0.95);
  }

  .send-btn:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }

  /* Hint text */
  .hint {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 400;
    letter-spacing: 0.05em;
    color: var(--ink-30);
    margin: var(--sp-4) 0 0;
    text-align: center;
    min-height: 14px;
  }
</style>
