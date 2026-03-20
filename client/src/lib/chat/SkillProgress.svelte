<script>
  let {
    skillName = '',
    steps = [],
  } = $props();
</script>

<div class="skill-progress" role="status" aria-label="Skill: {skillName}">
  {#if skillName}
    <p class="skill-name">{skillName}</p>
  {/if}

  <ol class="steps" aria-live="polite">
    {#each steps as step, i (i)}
      <li class="step" data-status={step.status}>
        <span class="dot" aria-hidden="true">
          {#if step.status === 'done'}
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 5.5L4 7.5L8 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          {:else if step.status === 'error'}
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M3 3L7 7M7 3L3 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          {:else if step.status === 'running'}
            <span class="pulse-ring"></span>
          {/if}
        </span>

        {#if i < steps.length - 1}
          <span class="connector" data-status={step.status} aria-hidden="true"></span>
        {/if}

        <span class="label">{step.label}</span>
      </li>
    {/each}
  </ol>
</div>

<style>
  .skill-progress {
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
    padding: var(--sp-8) var(--sp-4);
  }

  .skill-name {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--ink-60);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin: 0 0 var(--sp-4) 0;
  }

  .steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .step {
    display: grid;
    grid-template-columns: 16px 1fr;
    grid-template-rows: auto 1fr;
    column-gap: var(--sp-8);
    align-items: start;
    position: relative;
  }

  /* Dot */
  .dot {
    grid-row: 1;
    grid-column: 1;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    z-index: 1;
    transition: background-color var(--dur-normal) var(--ease-out);
  }

  .step[data-status="pending"] .dot {
    background: var(--ink-12);
    border: 1.5px solid var(--ink-30);
    color: transparent;
  }

  .step[data-status="running"] .dot {
    background: var(--gold);
    border: 1.5px solid var(--gold);
    color: #fff;
  }

  .step[data-status="done"] .dot {
    background: var(--sage);
    border: 1.5px solid var(--sage);
    color: #fff;
  }

  .step[data-status="error"] .dot {
    background: var(--coral);
    border: 1.5px solid var(--coral);
    color: #fff;
  }

  .pulse-ring {
    position: absolute;
    inset: -3px;
    border-radius: 50%;
    border: 1.5px solid var(--gold);
    animation: pulse-expand var(--dur-slowest) var(--ease-out) infinite;
    opacity: 0;
  }

  @keyframes pulse-expand {
    0%   { transform: scale(0.8); opacity: 0.8; }
    100% { transform: scale(1.6); opacity: 0; }
  }

  /* Connector line between dot and next dot */
  .connector {
    grid-row: 2;
    grid-column: 1;
    width: 1.5px;
    min-height: var(--sp-13);
    margin: 1px auto 0;
    transition: background-color var(--dur-normal) var(--ease-out);
  }

  .step[data-status="done"] .connector {
    background: var(--sage);
  }

  .step[data-status="running"] .connector {
    background: linear-gradient(to bottom, var(--gold), var(--ink-12));
  }

  .step[data-status="pending"] .connector,
  .step[data-status="error"] .connector {
    background: var(--ink-12);
  }

  /* Label */
  .label {
    grid-row: 1;
    grid-column: 2;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--ink);
    padding: 1px 0 var(--sp-13);
    line-height: 1.4;
    transition: color var(--dur-normal) var(--ease-out);
  }

  .step[data-status="pending"] .label {
    color: var(--ink-30);
  }

  .step[data-status="running"] .label {
    color: var(--ink);
    font-weight: 500;
  }

  .step[data-status="error"] .label {
    color: var(--coral);
  }

  .step[data-status="done"] .label {
    color: var(--ink-60);
    text-decoration: line-through;
    text-decoration-color: var(--ink-30);
  }
</style>
