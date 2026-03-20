<script lang="ts">
  import Spinner from './Spinner.svelte';
  import { ripple } from '$lib/motion/asymm-motion';

  let {
    variant = 'primary' as 'primary' | 'secondary' | 'ghost' | 'danger',
    size = 'md' as 'sm' | 'md' | 'lg',
    disabled = false,
    loading = false,
    onclick = undefined,
    children,
  } = $props();

  let isDisabled = $derived(disabled || loading);

  const sizeClasses = {
    sm: 'btn-sm',
    md: 'btn-md',
    lg: 'btn-lg',
  };

  const variantClasses = {
    primary: 'btn-primary',
    secondary: 'btn-secondary',
    ghost: 'btn-ghost',
    danger: 'btn-danger',
  };

  function handleClick(e: MouseEvent) {
    if (isDisabled) return;
    const target = e.currentTarget as HTMLElement;
    const rippleColor = variant === 'primary' || variant === 'danger'
      ? 'rgba(255, 255, 255, 0.25)'
      : 'rgba(197, 160, 89, 0.2)';
    ripple(e, target, rippleColor);
    onclick?.(e);
  }
</script>

<button
  class="btn {variantClasses[variant] ?? 'btn-primary'} {sizeClasses[size] ?? 'btn-md'}"
  disabled={isDisabled}
  aria-disabled={isDisabled}
  aria-busy={loading}
  onclick={handleClick}
>
  {#if loading}
    <span class="btn-spinner">
      <Spinner size={size === 'lg' ? 'sm' : 'sm'} color={variant === 'primary' || variant === 'danger' ? 'white' : 'gold'} />
    </span>
  {/if}
  <span class="btn-label" class:hidden={loading}>
    {@render children?.()}
  </span>
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--sp-3);
    font-family: var(--font-ui);
    font-weight: 500;
    letter-spacing: 0.025em;
    border-radius: var(--radius-pill);
    border: 1.5px solid transparent;
    cursor: pointer;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out),
      opacity var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-out);
    position: relative;
    white-space: nowrap;
    text-decoration: none;
    outline: none;
  }

  /* Sizes */
  .btn-sm {
    font-size: var(--text-xs);
    padding: var(--sp-2) var(--sp-8);
    min-height: 28px;
  }

  .btn-md {
    font-size: var(--text-sm);
    padding: var(--sp-3) var(--sp-13);
    min-height: 36px;
  }

  .btn-lg {
    font-size: var(--text-md);
    padding: var(--sp-5) var(--sp-16);
    min-height: 44px;
  }

  /* Primary */
  .btn-primary {
    background: var(--gold);
    color: #fff;
    border-color: var(--gold);
  }

  .btn-primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--gold) 85%, #000);
    border-color: color-mix(in srgb, var(--gold) 85%, #000);
    box-shadow: var(--shadow-sm);
    transform: translateY(-1px);
    letter-spacing: 0.04em;
  }

  .btn-primary:active:not(:disabled) {
    transform: translateY(0);
    box-shadow: none;
  }

  /* Secondary */
  .btn-secondary {
    background: transparent;
    color: var(--ink);
    border-color: var(--ink-30);
  }

  .btn-secondary:hover:not(:disabled) {
    border-color: var(--ink-60);
    background: var(--ink-06);
    transform: translateY(-1px);
  }

  .btn-secondary:active:not(:disabled) {
    transform: translateY(0);
  }

  /* Ghost */
  .btn-ghost {
    background: transparent;
    color: var(--ink-60);
    border-color: transparent;
  }

  .btn-ghost:hover:not(:disabled) {
    background: var(--ink-06);
    color: var(--ink);
  }

  /* Danger */
  .btn-danger {
    background: var(--coral);
    color: #fff;
    border-color: var(--coral);
  }

  .btn-danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--coral) 85%, #000);
    border-color: color-mix(in srgb, var(--coral) 85%, #000);
    box-shadow: var(--shadow-sm);
    transform: translateY(-1px);
  }

  .btn-danger:active:not(:disabled) {
    transform: translateY(0);
    box-shadow: none;
  }

  /* Disabled */
  .btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    transform: none !important;
    box-shadow: none !important;
  }

  /* Active press — satisfying micro-feedback */
  .btn:active:not(:disabled) {
    transform: scale(0.97);
    transition-duration: 89ms;
  }

  /* Focus visible */
  .btn:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }

  .btn-spinner {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .btn-label {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }

  .btn-label.hidden {
    display: none;
  }
</style>
