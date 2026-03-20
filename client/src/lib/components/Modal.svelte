<script lang="ts">
  import { onMount } from 'svelte';

  let {
    open = $bindable(false),
    title = '',
    size = 'md' as 'sm' | 'md' | 'lg',
    children,
    footer,
  } = $props();

  let dialogEl: HTMLElement | null = $state(null);

  const sizeMap = {
    sm: 'modal-sm',
    md: 'modal-md',
    lg: 'modal-lg',
  };

  function close() {
    open = false;
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      close();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      close();
    }
  }

  // Trap focus and manage body scroll
  $effect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      // Focus the dialog on open
      requestAnimationFrame(() => {
        dialogEl?.focus();
      });
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  });
</script>

<svelte:window onkeydown={open ? handleKeydown : undefined} />

{#if open}
  <div
    class="modal-backdrop"
    onclick={handleBackdropClick}
    onkeydown={handleKeydown}
    role="dialog"
    aria-modal="true"
    aria-labelledby={title ? 'modal-title' : undefined}
    tabindex="-1"
  >
    <div
      class="modal-panel {sizeMap[size] ?? 'modal-md'}"
      bind:this={dialogEl}
      tabindex="-1"
      role="document"
    >
      <!-- Header -->
      <div class="modal-header">
        {#if title}
          <h2 id="modal-title" class="modal-title">{title}</h2>
        {:else}
          <div></div>
        {/if}
        <button
          class="modal-close"
          onclick={close}
          aria-label="Close modal"
          type="button"
        >
          ×
        </button>
      </div>

      <!-- Body -->
      <div class="modal-body">
        {@render children?.()}
      </div>

      <!-- Footer (named slot) -->
      {#if footer}
        <div class="modal-footer">
          {@render footer?.()}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(20, 18, 15, 0.5);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: var(--sp-13);
    animation: fadeIn var(--dur-fast) var(--ease-out);
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .modal-panel {
    background: var(--paper-elevated);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    border: 1px solid var(--ink-06);
    border-top: 2px solid var(--gold-soft);
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - var(--sp-24));
    outline: none;
    animation: slideIn var(--dur-slow) var(--ease-spring);
    overflow: hidden;
  }

  @keyframes slideIn {
    0% {
      opacity: 0;
      transform: translateY(-13px) scale(0.96);
    }
    70% {
      opacity: 1;
      transform: translateY(2px) scale(1.005);
    }
    100% {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  /* Sizes */
  .modal-sm {
    width: 100%;
    max-width: 380px;
  }

  .modal-md {
    width: 100%;
    max-width: 560px;
  }

  .modal-lg {
    width: 100%;
    max-width: 800px;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-13) var(--sp-16);
    border-bottom: 1px solid var(--ink-06);
    flex-shrink: 0;
  }

  .modal-title {
    font-family: var(--font-display);
    font-size: var(--text-lg);
    color: var(--ink);
    margin: 0;
    font-weight: 400;
    letter-spacing: 0.02em;
  }

  .modal-close {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--ink-60);
    font-size: var(--text-2xl);
    line-height: 1;
    padding: var(--sp-1) var(--sp-3);
    border-radius: var(--radius-sm);
    transition: color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal-close:hover {
    color: var(--ink);
    background: var(--ink-06);
  }

  .modal-close:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }

  .modal-body {
    padding: var(--sp-16);
    overflow-y: auto;
    flex: 1;
  }

  .modal-footer {
    padding: var(--sp-8) var(--sp-16);
    border-top: 1px solid var(--ink-06);
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--sp-5);
    flex-shrink: 0;
  }
</style>
