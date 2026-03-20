<script lang="ts">
  import Button from '../components/Button.svelte';
  import Card from '../components/Card.svelte';
  import Input from '../components/Input.svelte';
  import Modal from '../components/Modal.svelte';
  import Toast from '../components/Toast.svelte';
  import Spinner from '../components/Spinner.svelte';
  import KPICard from '../components/KPICard.svelte';
  import Badge from '../components/Badge.svelte';
  import { reveal, animateValue, stagger, breathe, breatheScale } from '../motion/asymm-motion';

  let showModal = $state(false);
  let showToast = $state(false);
  let toastType = $state<'success' | 'danger' | 'info' | 'warning'>('success');
  let toastMessage = $state('');
  let counterValue = $state(0);
  let isLoading = $state(false);

  function fireToast(type: 'success' | 'danger' | 'info' | 'warning', msg: string) {
    toastType = type;
    toastMessage = msg;
    showToast = true;
    setTimeout(() => showToast = false, 4000);
  }

  function animateCounter() {
    animateValue(0, 42750, (v) => {
      counterValue = Math.round(v);
    }, 987);
  }

  function simulateLoad() {
    isLoading = true;
    setTimeout(() => { isLoading = false; }, 2000);
  }

  // Trigger counter on mount
  import { onMount } from 'svelte';
  onMount(() => {
    setTimeout(animateCounter, 600);
  });
</script>

<div class="showcase">
  <header class="showcase-header">
    <h1 class="showcase-title">Motion & Delight</h1>
    <p class="showcase-subtitle">Premium interactions, mathematically grounded</p>
  </header>

  <!-- Section: Buttons with Ripple -->
  <section class="section" use:reveal={{ index: 0 }}>
    <h2 class="section-title">Buttons</h2>
    <p class="section-desc">Ripple on click, spring press, letter-space breathe on hover</p>
    <div class="button-row">
      <Button variant="primary" onclick={() => fireToast('success', 'Action completed')}>Primary Gold</Button>
      <Button variant="secondary" onclick={() => fireToast('info', 'Secondary action')}>Secondary</Button>
      <Button variant="ghost" onclick={() => fireToast('warning', 'Ghost button clicked')}>Ghost</Button>
      <Button variant="danger" onclick={() => fireToast('danger', 'Careful with this one')}>Danger</Button>
      <Button variant="primary" loading={isLoading} onclick={simulateLoad}>
        {isLoading ? 'Loading...' : 'With Spinner'}
      </Button>
    </div>
  </section>

  <!-- Section: Inputs with Focus Animation -->
  <section class="section" use:reveal={{ index: 1 }}>
    <h2 class="section-title">Inputs</h2>
    <p class="section-desc">Gold underline expands on focus, label transitions</p>
    <div class="input-grid">
      <Input label="Company Name" placeholder="PH Trading WLL" />
      <Input label="Contact Email" type="email" placeholder="hello@example.com" />
      <Input label="Amount (BHD)" placeholder="1,250.000" />
      <Input label="With Error" error="This field is required" value="" />
    </div>
  </section>

  <!-- Section: Cards with Entrance & Hover -->
  <section class="section" use:reveal={{ index: 2 }}>
    <h2 class="section-title">Cards</h2>
    <p class="section-desc">Staggered entrance, lift on hover, gold border glow</p>
    <div class="card-grid">
      {#each ['Quotation', 'Invoice', 'Payment', 'Statement'] as item, i}
        <Card elevated onclick={() => fireToast('info', `${item} selected`)} padding="md">
          <div class="card-demo" style="--enter-delay: {stagger(i)}ms">
            <span class="card-demo-icon">{['📋', '📄', '💳', '📊'][i]}</span>
            <h3 class="card-demo-title">{item}</h3>
            <p class="card-demo-desc">Click to interact</p>
          </div>
        </Card>
      {/each}
    </div>
  </section>

  <!-- Section: KPI Cards with Counter -->
  <section class="section" use:reveal={{ index: 3 }}>
    <h2 class="section-title">KPI Cards</h2>
    <p class="section-desc">Value animation on mount, gold accent, hover shadow</p>
    <div class="kpi-grid">
      <KPICard
        label="Revenue"
        number={(counterValue / 1000).toFixed(3)}
        unit="BHD"
        subtitle="This month"
        subtitleColor="sage"
      />
      <KPICard
        label="Outstanding"
        number="8,240.500"
        unit="BHD"
        subtitle="15 invoices"
        subtitleColor="coral"
        variant="danger"
      />
      <KPICard
        label="Collection Rate"
        number="87.5%"
        subtitle="30-day"
        subtitleColor="sage"
      />
      <KPICard
        label="Pipeline"
        number="156,000"
        unit="BHD"
        subtitle="8 opportunities"
        subtitleColor="gold"
      />
    </div>
  </section>

  <!-- Section: Badges -->
  <section class="section" use:reveal={{ index: 4 }}>
    <h2 class="section-title">Status Badges</h2>
    <div class="badge-row">
      <span class="badge badge-sage">Paid</span>
      <span class="badge badge-coral">Overdue</span>
      <span class="badge badge-amber">Pending</span>
      <span class="badge badge-blue">Draft</span>
      <span class="badge badge-muted">Cancelled</span>
    </div>
  </section>

  <!-- Section: Modal -->
  <section class="section" use:reveal={{ index: 5 }}>
    <h2 class="section-title">Modal</h2>
    <p class="section-desc">Spring entrance, warm backdrop blur, kintsugi gold accent</p>
    <Button variant="secondary" onclick={() => showModal = true}>Open Modal</Button>
  </section>

  <!-- Section: Spinners -->
  <section class="section" use:reveal={{ index: 6 }}>
    <h2 class="section-title">Spinners</h2>
    <p class="section-desc">Breathing pulse — alive, not mechanical</p>
    <div class="spinner-row">
      <Spinner size="sm" color="gold" />
      <Spinner size="md" color="gold" />
      <Spinner size="lg" color="gold" />
      <Spinner size="md" color="ink" />
      <Spinner size="md" color="sage" />
      <Spinner size="md" color="coral" />
    </div>
  </section>

  <!-- Section: Scroll Reveal Demo -->
  <section class="section">
    <h2 class="section-title">Scroll Reveal</h2>
    <p class="section-desc">Elements animate in as they enter the viewport</p>
    <div class="reveal-grid">
      {#each Array(6) as _, i}
        <div class="reveal-card" use:reveal={{ index: i }}>
          <div class="reveal-card-inner">
            <span class="reveal-number">{String(i + 1).padStart(2, '0')}</span>
            <span class="reveal-label">Item reveals with natural stagger</span>
          </div>
        </div>
      {/each}
    </div>
  </section>
</div>

<!-- Modal -->
<Modal bind:open={showModal} title="Create Invoice" size="md">
  <div class="modal-demo-body">
    <Input label="Customer" placeholder="Select customer..." />
    <Input label="Amount" placeholder="0.000" />
    <Input label="Due Date" type="date" />
    <p class="modal-note">Notice the spring entrance and gold accent border.</p>
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => showModal = false}>Cancel</Button>
    <Button variant="primary" onclick={() => { showModal = false; fireToast('success', 'Invoice created'); }}>
      Create
    </Button>
  {/snippet}
</Modal>

<!-- Toast -->
{#if showToast}
  <div class="toast-container">
    <Toast message={toastMessage} type={toastType} onDismiss={() => showToast = false} />
  </div>
{/if}

<style>
  .showcase {
    max-width: 1000px;
    margin: 0 auto;
    padding: var(--sp-34) var(--sp-21);
  }

  .showcase-header {
    text-align: center;
    margin-bottom: var(--sp-55);
  }

  .showcase-title {
    font-family: var(--font-display);
    font-size: var(--text-2xl);
    font-weight: 400;
    color: var(--ink);
    margin: 0;
    letter-spacing: 0.06em;
  }

  .showcase-subtitle {
    font-family: var(--font-body);
    font-size: var(--text-md);
    color: var(--ink-60);
    margin: var(--sp-5) 0 0 0;
    font-style: italic;
  }

  .section {
    margin-bottom: var(--sp-55);
  }

  .section-title {
    font-family: var(--font-display);
    font-size: var(--text-lg);
    font-weight: 400;
    color: var(--ink);
    margin: 0 0 var(--sp-3) 0;
    letter-spacing: 0.04em;
  }

  .section-desc {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--ink-30);
    margin: 0 0 var(--sp-16) 0;
  }

  .button-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-8);
    align-items: center;
  }

  .input-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--sp-21);
  }

  .card-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--sp-13);
  }

  .card-demo {
    text-align: center;
    padding: var(--sp-8) 0;
  }

  .card-demo-icon {
    font-size: var(--text-xl);
    display: block;
    margin-bottom: var(--sp-5);
  }

  .card-demo-title {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--ink);
    margin: 0;
  }

  .card-demo-desc {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--ink-30);
    margin: var(--sp-2) 0 0 0;
  }

  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--sp-13);
  }

  .badge-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-8);
    align-items: center;
  }

  .spinner-row {
    display: flex;
    gap: var(--sp-21);
    align-items: center;
  }

  .reveal-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--sp-13);
  }

  .reveal-card {
    background: var(--paper-card);
    border: 1px solid var(--ink-06);
    border-radius: var(--radius-md);
    padding: var(--sp-21);
    /* Starts hidden, revealed by use:reveal action */
    opacity: 0;
    transform: translateY(21px);
    transition:
      opacity var(--dur-slow) var(--ease-out),
      transform var(--dur-slow) var(--ease-out);
    transition-delay: var(--reveal-delay, 0ms);
  }

  .reveal-card:global(.revealed) {
    opacity: 1;
    transform: translateY(0);
  }

  .reveal-card-inner {
    display: flex;
    align-items: center;
    gap: var(--sp-13);
  }

  .reveal-number {
    font-family: var(--font-data);
    font-size: var(--text-xl);
    color: var(--gold);
    font-weight: 700;
  }

  .reveal-label {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--ink-60);
  }

  .modal-demo-body {
    display: flex;
    flex-direction: column;
    gap: var(--sp-21);
  }

  .modal-note {
    font-family: var(--font-body);
    font-size: var(--text-sm);
    color: var(--ink-30);
    font-style: italic;
    margin: 0;
  }

  .toast-container {
    position: fixed;
    top: var(--sp-16);
    right: var(--sp-16);
    z-index: 500;
  }

  @media (max-width: 768px) {
    .card-grid, .kpi-grid {
      grid-template-columns: 1fr 1fr;
    }
    .reveal-grid {
      grid-template-columns: 1fr 1fr;
    }
    .input-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
