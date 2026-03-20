<script lang="ts">
  interface TransitionRequest {
    pipelineId: string;
    pipelineName: string;
    customerName: string;
    amountBhd: string;
    oldStatus: string;
    newStatus: string;
    signedBy: string;
    status: 'Proposed' | 'Approved' | 'Rejected';
  }

  interface Props {
    request: TransitionRequest;
    onconfirm: () => void;
    onreject: () => void;
  }

  let { request, onconfirm, onreject }: Props = $props();
  let isPending = $derived(request.status === 'Proposed');
</script>

<div
  class="transition-card"
  class:state-proposed={request.status === 'Proposed'}
  class:state-approved={request.status === 'Approved'}
  class:state-rejected={request.status === 'Rejected'}
>
  <div class="card-header">
    <span class="header-icon">&#x1F504;</span>
    <span class="header-title">Status Change Request</span>
    {#if request.status === 'Approved'}
      <span class="state-badge badge-approved">Confirmed</span>
    {:else if request.status === 'Rejected'}
      <span class="state-badge badge-rejected">Cancelled</span>
    {/if}
  </div>

  <div class="card-body">
    <div class="field-row">
      <span class="field-label">Pipeline</span>
      <span class="field-value">
        <span class="pipeline-id">{request.pipelineId}</span>
        {request.pipelineName}
      </span>
    </div>
    <div class="field-row">
      <span class="field-label">Customer</span>
      <span class="field-value">{request.customerName}</span>
    </div>
    <div class="field-row">
      <span class="field-label">Amount</span>
      <span class="field-value amount">{request.amountBhd} BHD</span>
    </div>
  </div>

  <div class="transition-arrow-section">
    <span class="status-chip old">{request.oldStatus}</span>
    <span class="arrow">&#x2192;</span>
    <span class="status-chip new">{request.newStatus}</span>
  </div>

  <div class="card-footer">
    <span class="signed-by">Signed by: <strong>{request.signedBy}</strong></span>

    {#if isPending}
      <div class="action-buttons">
        <button class="btn-confirm" onclick={onconfirm}>
          &#x2713; Confirm Transition
        </button>
        <button class="btn-cancel" onclick={onreject}>
          &#x2715; Cancel
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .transition-card {
    background: var(--paper-card);
    border-radius: var(--radius-md);
    border: 1.5px solid var(--ink-12);
    overflow: hidden;
    animation: asymm-enter var(--dur-slow) var(--ease-out) both;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      opacity var(--dur-fast) var(--ease-out);
  }

  .state-proposed {
    border-color: var(--gold);
    box-shadow: 0 0 0 3px var(--gold-glow);
  }

  .state-approved {
    border-color: var(--sage);
    opacity: 0.75;
  }

  .state-rejected {
    border-color: var(--coral);
    opacity: 0.65;
  }

  /* Header */
  .card-header {
    display: flex;
    align-items: center;
    gap: var(--sp-8);
    padding: var(--sp-13) var(--sp-16);
    border-bottom: 1px solid var(--ink-06);
  }

  .header-icon {
    font-size: var(--text-md);
    line-height: 1;
  }

  .header-title {
    font-family: var(--font-ui);
    font-weight: 600;
    font-size: var(--text-base);
    color: var(--ink);
    flex: 1;
  }

  .state-badge {
    display: inline-flex;
    align-items: center;
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.05em;
    padding: var(--sp-2) var(--sp-8);
    border-radius: var(--radius-pill);
  }

  .badge-approved {
    background: var(--sage-soft);
    color: var(--sage);
  }

  .badge-rejected {
    background: var(--coral-soft);
    color: var(--coral);
  }

  /* Body fields */
  .card-body {
    padding: var(--sp-13) var(--sp-16);
    display: flex;
    flex-direction: column;
    gap: var(--sp-8);
  }

  .field-row {
    display: flex;
    gap: var(--sp-8);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    line-height: 1.5;
  }

  .field-label {
    color: var(--ink-40);
    min-width: 72px;
    flex-shrink: 0;
  }

  .field-value {
    color: var(--ink);
    font-weight: 500;
  }

  .field-value.amount {
    color: var(--gold);
    font-weight: 600;
  }

  .pipeline-id {
    font-family: var(--font-data);
    font-size: var(--text-xs);
    color: var(--ink-60);
    background: var(--ink-06);
    padding: 1px var(--sp-4);
    border-radius: var(--radius-sm);
    margin-right: var(--sp-5);
  }

  /* Transition arrow section */
  .transition-arrow-section {
    display: flex;
    align-items: center;
    gap: var(--sp-13);
    padding: var(--sp-13) var(--sp-16);
    background: #f5f5f0;
    border-top: 1px solid var(--ink-06);
    border-bottom: 1px solid var(--ink-06);
  }

  .status-chip {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 500;
    padding: var(--sp-3) var(--sp-8);
    border-radius: var(--radius-pill);
  }

  .status-chip.old {
    background: var(--ink-12);
    color: var(--ink-60);
  }

  .status-chip.new {
    background: var(--gold-soft);
    color: var(--gold);
    font-weight: 600;
  }

  .arrow {
    color: var(--gold);
    font-size: var(--text-md);
    font-weight: 700;
    line-height: 1;
  }

  /* Footer */
  .card-footer {
    padding: var(--sp-13) var(--sp-16);
    display: flex;
    align-items: center;
    gap: var(--sp-13);
    flex-wrap: wrap;
  }

  .signed-by {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--ink-60);
    flex: 1;
  }

  .signed-by strong {
    color: var(--ink);
    font-weight: 600;
  }

  .action-buttons {
    display: flex;
    gap: var(--sp-8);
  }

  .btn-confirm {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-4);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 600;
    padding: var(--sp-5) var(--sp-13);
    border-radius: var(--radius-pill);
    border: 1.5px solid var(--gold);
    background: var(--gold);
    color: #fff;
    cursor: pointer;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
    white-space: nowrap;
  }

  .btn-confirm:hover {
    background: color-mix(in srgb, var(--gold) 85%, #000);
    border-color: color-mix(in srgb, var(--gold) 85%, #000);
    transform: translateY(-1px);
    box-shadow: var(--shadow-sm);
  }

  .btn-confirm:active {
    transform: translateY(0);
    box-shadow: none;
  }

  .btn-confirm:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }

  .btn-cancel {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-4);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 500;
    padding: var(--sp-5) var(--sp-13);
    border-radius: var(--radius-pill);
    border: 1.5px solid var(--ink-30);
    background: transparent;
    color: var(--ink-60);
    cursor: pointer;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-out);
    white-space: nowrap;
  }

  .btn-cancel:hover {
    border-color: var(--coral);
    color: var(--coral);
    background: var(--coral-soft);
    transform: translateY(-1px);
  }

  .btn-cancel:active {
    transform: translateY(0);
  }

  .btn-cancel:focus-visible {
    outline: 2px solid var(--ink-30);
    outline-offset: 2px;
  }
</style>
