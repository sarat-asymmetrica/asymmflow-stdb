<script>
  import Button from './Button.svelte';

  let {
    icon = '◎',
    title = 'Nothing here',
    message = '',
    actionLabel = '',
    onAction = undefined,
  } = $props();
</script>

<div class="empty-state" role="status" aria-label="{title}">
  <span class="empty-icon" aria-hidden="true">{icon}</span>
  <h3 class="empty-title">{title}</h3>
  {#if message}
    <p class="empty-message">{message}</p>
  {/if}
  {#if actionLabel && onAction}
    <div class="empty-action">
      <Button variant="secondary" onclick={onAction}>
        {actionLabel}
      </Button>
    </div>
  {/if}
</div>

<style>
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: var(--sp-40) var(--sp-21);
    gap: var(--sp-5);
  }

  .empty-icon {
    font-size: 3rem;
    color: var(--ink-12);
    line-height: 1;
    display: block;
    margin-bottom: var(--sp-3);
  }

  .empty-title {
    font-family: var(--font-display);
    font-size: var(--text-lg);
    color: var(--ink-60);
    font-weight: 400;
    margin: 0;
    letter-spacing: 0.02em;
  }

  .empty-message {
    font-family: var(--font-body);
    font-size: var(--text-sm);
    color: var(--ink-30);
    margin: 0;
    max-width: 340px;
    line-height: 1.6;
  }

  .empty-action {
    margin-top: var(--sp-5);
  }
</style>
