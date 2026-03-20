<script lang="ts">
  let {
    skillName = '',
    plan = '',
    status = 'Proposed' as 'Proposed' | 'Approved' | 'Executed' | 'Rejected' | 'Failed',
    onApprove = undefined,
    onReject = undefined,
  } = $props();

  // Parse plan if it looks like JSON, else treat as plain text
  let parsedSteps = $derived.by(() => {
    if (!plan) return null;
    try {
      const data = JSON.parse(plan);
      if (Array.isArray(data)) return data.map((s: unknown) => (typeof s === 'string' ? s : JSON.stringify(s)));
      if (data.steps && Array.isArray(data.steps)) return data.steps.map((s: unknown) => (typeof s === 'string' ? s : JSON.stringify(s)));
      return Object.entries(data).map(([k, v]) => `${k}: ${v}`);
    } catch {
      return null;
    }
  });

  const statusColorMap: Record<'Proposed' | 'Approved' | 'Executed' | 'Rejected' | 'Failed', string> = {
    Proposed: 'amber',
    Approved:  'blue',
    Executed:  'sage',
    Rejected:  'coral',
    Failed:    'coral',
  };

  let statusColor = $derived(statusColorMap[status] ?? 'amber');
  let isPending   = $derived(status === 'Proposed');
</script>

<div
  class="approval-card"
  class:is-pending={isPending}
  role="region"
  aria-label="Skill approval: {skillName}"
>
  <!-- Coral left accent for warning/action-required state -->
  <div class="left-accent" aria-hidden="true"></div>

  <!-- Header -->
  <div class="card-header">
    <div class="header-left">
      <!-- Document icon -->
      <svg class="plan-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <rect x="2" y="1" width="10" height="12" rx="1.5" stroke="currentColor" stroke-width="1.25"/>
        <path d="M4.5 5h5M4.5 7.5h3.5M4.5 10h4" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
      </svg>
      <span class="skill-name">{skillName}</span>
    </div>
    <span class="status-badge" data-color={statusColor}>{status}</span>
  </div>

  <!-- Plan body -->
  <div class="card-body">
    {#if parsedSteps}
      <ol class="step-list">
        {#each parsedSteps as step, i (i)}
          <li class="step-item">
            <span class="step-num">{i + 1}</span>
            <span class="step-text">{step}</span>
          </li>
        {/each}
      </ol>
    {:else}
      <p class="plan-text">{plan}</p>
    {/if}
  </div>

  <!-- Action footer — only when Proposed -->
  {#if isPending && (onApprove || onReject)}
    <div class="card-footer">
      {#if onReject}
        <button class="action-btn action-reject" onclick={onReject} aria-label="Reject skill execution">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          Reject
        </button>
      {/if}
      {#if onApprove}
        <button class="action-btn action-approve" onclick={onApprove} aria-label="Approve skill execution">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M2 6L4.5 8.5L10 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Approve
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .approval-card {
    position: relative;
    background: var(--paper-card);
    border-radius: var(--radius-md);
    padding: var(--sp-13) var(--sp-13) var(--sp-13) calc(var(--sp-13) + 6px);
    box-shadow: var(--shadow-neu-raised);
    overflow: hidden;
    transition:
      box-shadow var(--dur-normal) var(--ease-out);
  }

  .approval-card.is-pending {
    animation: pending-pulse var(--dur-slowest) var(--ease-smooth) infinite alternate;
  }

  @keyframes pending-pulse {
    from { box-shadow: var(--shadow-neu-raised); }
    to   { box-shadow: var(--shadow-neu-raised), 0 0 16px 2px rgba(196, 121, 107, 0.12); }
  }

  /* Coral left accent — signals action needed */
  .left-accent {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: linear-gradient(
      to bottom,
      var(--coral) 0%,
      rgba(196, 121, 107, 0.4) 100%
    );
    border-radius: var(--radius-md) 0 0 var(--radius-md);
  }

  /* Header */
  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-8);
    margin-bottom: var(--sp-8);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: var(--sp-5);
    color: var(--ink-60);
  }

  .plan-icon {
    flex-shrink: 0;
    color: var(--ink-40);
  }

  .skill-name {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--ink);
    letter-spacing: 0.01em;
  }

  /* Status badge */
  .status-badge {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    padding: 2px var(--sp-8);
    border-radius: var(--radius-pill);
    white-space: nowrap;
  }

  .status-badge[data-color="amber"] {
    background: var(--amber-soft);
    color: var(--amber);
  }
  .status-badge[data-color="blue"] {
    background: var(--blue-soft);
    color: var(--blue);
  }
  .status-badge[data-color="sage"] {
    background: var(--sage-soft);
    color: var(--sage);
  }
  .status-badge[data-color="coral"] {
    background: var(--coral-soft);
    color: var(--coral);
  }

  /* Body */
  .card-body { margin: 0; }

  .step-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
  }

  .step-item {
    display: flex;
    gap: var(--sp-8);
    align-items: baseline;
  }

  .step-num {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.05em;
    color: var(--coral);
    min-width: 14px;
    flex-shrink: 0;
  }

  .step-text {
    font-family: var(--font-body);
    font-size: var(--text-sm);
    color: var(--ink);
    line-height: 1.5;
  }

  .plan-text {
    font-family: var(--font-body);
    font-size: var(--text-sm);
    color: var(--ink);
    line-height: 1.6;
    margin: 0;
  }

  /* Footer */
  .card-footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-8);
    margin-top: var(--sp-13);
    padding-top: var(--sp-8);
    border-top: 1px solid var(--ink-06);
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-4);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 500;
    padding: var(--sp-5) var(--sp-13);
    border-radius: var(--radius-sm);
    border: none;
    cursor: pointer;
    box-shadow: var(--shadow-neu-btn);
    background: var(--paper-card);
    transition:
      box-shadow var(--dur-fast) var(--ease-out),
      transform var(--dur-instant) var(--ease-out);
  }

  .action-btn:hover {
    box-shadow:
      -3px -3px 6px rgba(253, 251, 247, 0.7),
      3px 3px 6px rgba(170, 160, 142, 0.28);
    transform: translateY(-1px);
  }

  .action-btn:active {
    box-shadow: var(--shadow-neu-inset);
    transform: scale(0.97);
  }

  .action-btn:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }

  .action-reject {
    color: var(--coral);
  }

  .action-approve {
    color: var(--gold);
    font-weight: 600;
  }
</style>
