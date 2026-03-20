<script lang="ts">
  import Toast from './Toast.svelte';

  type ToastItem = {
    id: string;
    message: string;
    type: 'success' | 'danger' | 'info' | 'warning';
    duration?: number;
  };

  /**
   * ToastContainer — fixed top-right, manages list of toasts.
   *
   * Usage:
   *   import { toasts, addToast } from '$lib/stores/toasts';
   *   addToast({ message: 'Saved!', type: 'success' });
   *
   * Or pass toasts as a prop directly:
   *   <ToastContainer bind:toasts />
   */

  let {
    toasts = $bindable([] as ToastItem[]),
  } = $props();

  function removeToast(id: string) {
    toasts = toasts.filter((t) => t.id !== id);
  }

  // Exported helper for imperative usage
  export function addToast(toast: Partial<ToastItem> & { message: string }) {
    const id = toast.id ?? `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    toasts = [
      ...toasts,
      {
        type: 'info' as const,
        duration: 3000,
        ...toast,
        id,
      },
    ];
    return id;
  }
</script>

<div class="toast-container" aria-label="Notifications" role="region">
  {#each toasts as toast (toast.id)}
    <div class="toast-item">
      <Toast
        message={toast.message}
        type={toast.type}
        duration={toast.duration ?? 3000}
        onDismiss={() => removeToast(toast.id)}
      />
    </div>
  {/each}
</div>

<style>
  .toast-container {
    position: fixed;
    top: var(--sp-16);
    right: var(--sp-16);
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
    z-index: 9999;
    pointer-events: none;
    align-items: flex-end;
  }

  .toast-item {
    pointer-events: all;
    animation: enterDown var(--dur-normal) var(--ease-smooth);
  }

  @keyframes enterDown {
    from {
      opacity: 0;
      transform: translateY(-8px) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
</style>
