<script lang="ts">
  let {
    message = '',
    type = 'info' as 'success' | 'danger' | 'info' | 'warning',
    duration = 3000,
    onDismiss = undefined,
  } = $props();

  let visible = $state(true);
  let progress = $state(100);

  const typeConfig = {
    success: { icon: '✓', colorClass: 'toast-success' },
    danger: { icon: '✕', colorClass: 'toast-danger' },
    info: { icon: 'ℹ', colorClass: 'toast-info' },
    warning: { icon: '⚠', colorClass: 'toast-warning' },
  };

  let config = $derived(typeConfig[type] ?? typeConfig.info);

  function dismiss() {
    visible = false;
    setTimeout(() => {
      onDismiss?.();
    }, 233);
  }

  $effect(() => {
    if (duration <= 0) return;

    // Progress bar countdown
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      progress = Math.max(0, 100 - (elapsed / duration) * 100);
    }, 16);

    const timer = setTimeout(() => {
      dismiss();
    }, duration);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  });
</script>

{#if visible}
  <div
    class="toast {config.colorClass}"
    role="alert"
    aria-live="assertive"
    aria-atomic="true"
  >
    <span class="toast-icon" aria-hidden="true">{config.icon}</span>
    <span class="toast-message">{message}</span>
    <button
      class="toast-close"
      onclick={dismiss}
      aria-label="Dismiss notification"
      type="button"
    >
      ×
    </button>

    {#if duration > 0}
      <div class="toast-progress" aria-hidden="true">
        <div class="toast-progress-bar" style="width: {progress}%"></div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .toast {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-5);
    padding: var(--sp-8) var(--sp-13);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    border: 1px solid transparent;
    position: relative;
    overflow: hidden;
    min-width: 280px;
    max-width: 400px;
    animation: slideInRight var(--dur-slow) var(--ease-smooth);
    will-change: transform, opacity;
    background: var(--paper-elevated);
  }

  @keyframes slideInRight {
    0% {
      opacity: 0;
      transform: translateX(55px) scale(0.95);
    }
    70% {
      transform: translateX(-3px) scale(1.01);
    }
    100% {
      opacity: 1;
      transform: translateX(0) scale(1);
    }
  }

  @keyframes slideOutRight {
    to {
      opacity: 0;
      transform: translateX(34px) scale(0.95);
    }
  }

  .toast-success {
    border-left: 3px solid var(--sage);
    border-color: var(--sage-soft);
  }

  .toast-danger {
    border-left: 3px solid var(--coral);
    border-color: var(--coral-soft);
  }

  .toast-info {
    border-left: 3px solid var(--blue);
    border-color: var(--blue-soft);
  }

  .toast-warning {
    border-left: 3px solid var(--amber);
    border-color: var(--amber-soft);
  }

  .toast-icon {
    font-size: var(--text-md);
    line-height: 1.4;
    flex-shrink: 0;
  }

  .toast-success .toast-icon { color: var(--sage); }
  .toast-danger .toast-icon { color: var(--coral); }
  .toast-info .toast-icon { color: var(--blue); }
  .toast-warning .toast-icon { color: var(--amber); }

  .toast-message {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--ink);
    flex: 1;
    line-height: 1.5;
    padding-top: 2px;
  }

  .toast-close {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--ink-30);
    font-size: var(--text-xl);
    line-height: 1;
    padding: 0;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color var(--dur-fast) var(--ease-out);
    margin-top: -2px;
  }

  .toast-close:hover {
    color: var(--ink);
  }

  .toast-close:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }

  .toast-progress {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--ink-06);
  }

  .toast-progress-bar {
    height: 100%;
    transition: width 16ms linear;
  }

  .toast-success .toast-progress-bar { background: var(--sage); }
  .toast-danger .toast-progress-bar { background: var(--coral); }
  .toast-info .toast-progress-bar { background: var(--blue); }
  .toast-warning .toast-progress-bar { background: var(--amber); }
</style>
