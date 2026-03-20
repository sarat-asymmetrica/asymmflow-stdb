<script lang="ts">
  import ButlerAvatar from './ButlerAvatar.svelte';
  import SkillProgress from './SkillProgress.svelte';
  import ApprovalCard from './ApprovalCard.svelte';
  import { markdownToHtml } from './markdown';

  let {
    role = 'user',
    content = '',
    timestamp = undefined,
    skillResult = undefined,
    approval = undefined,
    skillProgress = undefined,
  } = $props();

  function formatTime(ts: Date | number | string | undefined) {
    if (!ts) return '';
    const d = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  let timeLabel = $derived(formatTime(timestamp));
  let renderedHtml = $derived(role === 'assistant' ? markdownToHtml(content) : '');

  // Chase message rendering
  let chaseMessages = $derived(
    Array.isArray(skillResult?.messages) && skillResult.messages.length > 0
      ? skillResult.messages
      : null
  );

  let genericResultEntries = $derived(
    skillResult && !chaseMessages
      ? Object.entries(skillResult).filter(([k]) => k !== 'messages')
      : []
  );

  const TONE_LABELS: Record<string, string> = {
    friendly: 'Friendly',
    firm: 'Firm',
    final_notice: 'Final Notice',
  };

  let copiedIndex = $state<number | null>(null);

  async function copyMessage(body: string, index: number) {
    try {
      await navigator.clipboard.writeText(body);
      copiedIndex = index;
      setTimeout(() => { copiedIndex = null; }, 1800);
    } catch {
      // Clipboard write failed — silently ignore
    }
  }
</script>

{#if role === 'system'}
  <!-- System message: centered, muted, no bubble -->
  <div class="msg-system" role="status">
    <span class="system-text">{content}</span>
    {#if timeLabel}
      <time class="ts" datetime={timestamp instanceof Date ? timestamp.toISOString() : String(timestamp)}>{timeLabel}</time>
    {/if}
  </div>

{:else if role === 'assistant'}
  <!-- Assistant message: left-aligned with avatar -->
  <div class="msg-row msg-assistant" role="article" aria-label="Butler message">
    <ButlerAvatar size="sm" />

    <div class="bubble-col">
      <div class="bubble bubble-assistant">
        {#if content}
          <div class="bubble-content bubble-rich">{@html renderedHtml}</div>
        {/if}

        {#if skillProgress}
          <div class="bubble-extra">
            <SkillProgress skillName={skillProgress.skillName} steps={skillProgress.steps} />
          </div>
        {/if}

        {#if chaseMessages}
          <!-- Chase payment: render each message as a copy-ready card -->
          <div class="chase-results" role="complementary" aria-label="Chase messages">
            {#each chaseMessages as msg, i (i)}
              <div class="chase-card" data-tone={msg.tone}>
                <div class="chase-card-header">
                  <span class="chase-name">{msg.partyName}</span>
                  <span class="chase-badge" data-tone={msg.tone}>
                    {TONE_LABELS[msg.tone] ?? msg.tone}
                  </span>
                </div>
                {#if msg.subject}
                  <p class="chase-subject">{msg.subject}</p>
                {/if}
                <pre class="chase-body">{msg.body}</pre>
                <button
                  class="chase-copy-btn"
                  type="button"
                  aria-label="Copy message for {msg.partyName}"
                  onclick={() => copyMessage(msg.body, i)}
                >
                  {#if copiedIndex === i}
                    Copied
                  {:else}
                    Copy
                  {/if}
                </button>
              </div>
            {/each}
          </div>
        {:else if skillResult && genericResultEntries.length > 0}
          <!-- Generic skill result: key-value pairs -->
          <div class="skill-result-card" role="complementary" aria-label="Skill result">
            {#each genericResultEntries as [key, value] (key)}
              <div class="skill-result-row">
                <span class="skill-result-key">{key}</span>
                <span class="skill-result-val">{value}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      {#if approval}
        <div class="approval-wrap">
          <ApprovalCard
            skillName={approval.skillName}
            plan={approval.plan}
            status={approval.status}
            onApprove={approval.onApprove}
            onReject={approval.onReject}
          />
        </div>
      {/if}

      {#if timeLabel}
        <time class="ts ts-left" datetime={timestamp instanceof Date ? timestamp.toISOString() : String(timestamp)}>{timeLabel}</time>
      {/if}
    </div>
  </div>

{:else}
  <!-- User message: right-aligned -->
  <div class="msg-row msg-user" role="article" aria-label="Your message">
    <div class="bubble-col bubble-col-right">
      <div class="bubble bubble-user">
        <p class="bubble-content">{content}</p>
      </div>
      {#if timeLabel}
        <time class="ts ts-right" datetime={timestamp instanceof Date ? timestamp.toISOString() : String(timestamp)}>{timeLabel}</time>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* ── Row layout ── */
  .msg-row {
    display: flex;
    align-items: flex-end;
    gap: var(--sp-8);
    animation: slide-up var(--dur-normal) var(--ease-out) both;
  }

  .msg-assistant { justify-content: flex-start; }
  .msg-user      { justify-content: flex-end; }

  @keyframes slide-up {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* ── Bubble column ── */
  .bubble-col {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    max-width: min(82%, 680px);
  }

  .bubble-col-right { align-items: flex-end; }

  /* ── Bubbles ── */
  .bubble {
    padding: var(--sp-8) var(--sp-13);
    border-radius: var(--radius-md);
    line-height: 1.6;
  }

  /* User bubble — neumorphic raised, right-angled bottom-right corner */
  .bubble-user {
    background: var(--paper-card);
    box-shadow: var(--shadow-neu-raised);
    border-radius: var(--radius-md) var(--radius-md) var(--radius-sm) var(--radius-md);
  }

  /* Assistant bubble — warm clay with gold left border */
  .bubble-assistant {
    background: var(--paper-card);
    box-shadow: var(--shadow-neu-raised);
    border-left: 2px solid var(--gold);
    border-radius: var(--radius-md) var(--radius-md) var(--radius-md) var(--radius-sm);
  }

  .bubble-content {
    font-family: var(--font-body);
    font-size: var(--text-base);
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--ink);
  }

  /* User text — slightly muted, italic for distinction */
  .bubble-user .bubble-content {
    color: var(--ink);
    font-style: italic;
    opacity: 0.85;
  }

  /* ── Rich markdown in assistant bubbles ── */
  .bubble-rich { white-space: normal; }

  .bubble-rich :global(.md-h) {
    font-family: var(--font-display);
    font-weight: 600;
    color: var(--ink);
    margin: 0.9em 0 0.35em;
    line-height: 1.3;
  }
  .bubble-rich :global(.md-h:first-child) { margin-top: 0; }
  .bubble-rich :global(h3.md-h) { font-size: var(--text-md); }
  .bubble-rich :global(h4.md-h) { font-size: var(--text-base); }
  .bubble-rich :global(h5.md-h) { font-size: var(--text-sm); font-weight: 700; }

  .bubble-rich :global(.md-p) { margin: 0.45em 0; line-height: 1.65; }
  .bubble-rich :global(.md-p:first-child) { margin-top: 0; }
  .bubble-rich :global(.md-p:last-child) { margin-bottom: 0; }

  .bubble-rich :global(.md-ul),
  .bubble-rich :global(.md-ol) { margin: 0.4em 0; padding-left: 1.4em; }
  .bubble-rich :global(.md-ul li),
  .bubble-rich :global(.md-ol li) { margin: 0.2em 0; line-height: 1.55; }

  .bubble-rich :global(.md-hr) {
    border: none;
    border-top: 1px solid var(--ink-12);
    margin: 0.7em 0;
  }

  .bubble-rich :global(strong) { font-weight: 700; color: var(--ink); }
  .bubble-rich :global(em)     { font-style: italic; color: var(--ink-60); }

  .bubble-rich :global(code) {
    font-family: var(--font-data);
    font-size: 0.88em;
    background: var(--ink-06);
    padding: 0.12em 0.35em;
    border-radius: var(--radius-sm);
    color: var(--ink);
  }

  .bubble-rich :global(.md-pre) {
    background: var(--ink-06);
    border: 1px solid var(--ink-12);
    border-radius: var(--radius-sm);
    padding: var(--sp-8) var(--sp-13);
    margin: 0.5em 0;
    overflow-x: auto;
    font-size: 0.85em;
  }

  .bubble-rich :global(.md-code-block) {
    font-family: var(--font-data);
    color: var(--ink);
    background: none;
    padding: 0;
    border-radius: 0;
  }

  /* ── Extra content inside assistant bubble ── */
  .bubble-extra {
    margin-top: var(--sp-8);
    padding-top: var(--sp-8);
    border-top: 1px solid var(--ink-06);
  }

  /* ── Inline skill result card ── */
  .skill-result-card {
    margin-top: var(--sp-8);
    padding: var(--sp-8);
    background: var(--paper-elevated);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-neu-inset);
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
  }

  .skill-result-row {
    display: flex;
    gap: var(--sp-8);
    align-items: baseline;
  }

  .skill-result-key {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 500;
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    min-width: 80px;
    flex-shrink: 0;
  }

  .skill-result-val {
    font-family: var(--font-data);
    font-size: var(--text-sm);
    color: var(--ink);
    font-weight: 600;
  }

  /* ── Chase payment message cards ── */
  .chase-results {
    margin-top: var(--sp-8);
    display: flex;
    flex-direction: column;
    gap: var(--sp-8);
  }

  .chase-card {
    background: var(--paper-elevated);
    border-radius: var(--radius-sm);
    border-left: 2px solid var(--gold);
    padding: var(--sp-8) var(--sp-13);
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
  }

  .chase-card[data-tone="firm"]         { border-left-color: #c4923a; }
  .chase-card[data-tone="final_notice"] { border-left-color: var(--coral); }

  .chase-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-8);
  }

  .chase-name {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
  }

  .chase-badge {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 2px var(--sp-8);
    border-radius: var(--radius-pill);
    background: var(--gold-soft);
    color: var(--gold);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .chase-badge[data-tone="firm"] {
    background: rgba(196, 146, 58, 0.1);
    color: #9a6418;
  }

  .chase-badge[data-tone="final_notice"] {
    background: var(--coral-soft);
    color: var(--coral);
  }

  .chase-subject {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--ink-60);
    margin: 0;
    font-style: italic;
  }

  .chase-body {
    font-family: var(--font-data);
    font-size: var(--text-sm);
    color: var(--ink);
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
    background: var(--ink-03);
    padding: var(--sp-8);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-neu-inset);
  }

  .chase-copy-btn {
    align-self: flex-end;
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: var(--sp-3) var(--sp-8);
    border-radius: var(--radius-pill);
    border: none;
    background: var(--paper-card);
    box-shadow: var(--shadow-neu-btn);
    color: var(--ink-60);
    cursor: pointer;
    transition:
      box-shadow var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .chase-copy-btn:hover {
    color: var(--gold);
    box-shadow:
      -3px -3px 6px rgba(253, 251, 247, 0.7),
      3px 3px 6px rgba(170, 160, 142, 0.28);
  }

  .chase-copy-btn:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }

  /* ── Approval card wrapper ── */
  .approval-wrap { width: 100%; }

  /* ── Timestamps ── */
  .ts {
    font-family: var(--font-ui);
    font-size: 10px;
    color: var(--ink-30);
    display: block;
    letter-spacing: 0.03em;
  }

  .ts-left  { text-align: left;  padding-left: var(--sp-4); }
  .ts-right { text-align: right; padding-right: var(--sp-4); }

  /* ── System message ── */
  .msg-system {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-2);
    animation: slide-up var(--dur-normal) var(--ease-out) both;
  }

  .system-text {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-30);
    background: var(--ink-03);
    box-shadow: var(--shadow-neu-inset);
    padding: var(--sp-3) var(--sp-13);
    border-radius: var(--radius-pill);
    display: inline-block;
  }
</style>
