<script lang="ts">
  let {
    size = 'md' as 'sm' | 'md' | 'lg',
    speaking = false,
  } = $props();

  const sizeMap: Record<'sm' | 'md' | 'lg', number> = {
    sm: 28,
    md: 36,
    lg: 48,
  };

  const fontSizeMap: Record<'sm' | 'md' | 'lg', string> = {
    sm: '11px',
    md: '13px',
    lg: '16px',
  };

  let px = $derived(sizeMap[size] ?? 36);
  let fs = $derived(fontSizeMap[size] ?? '13px');
</script>

<div
  class="butler-avatar"
  class:speaking
  style="--avatar-size:{px}px; --avatar-font:{fs};"
  aria-label="AsymmFlow Butler"
  role="img"
>
  <span class="monogram" aria-hidden="true">A</span>
</div>

<style>
  .butler-avatar {
    width: var(--avatar-size);
    height: var(--avatar-size);
    border-radius: 50%;
    background: var(--paper-card);
    box-shadow: var(--shadow-neu-btn);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: box-shadow var(--dur-normal) var(--ease-out);
    border: 1.5px solid var(--gold-soft);
  }

  .butler-avatar.speaking {
    animation: breath var(--dur-breath) var(--ease-smooth) infinite;
    box-shadow:
      var(--shadow-neu-btn),
      0 0 0 2px var(--gold-soft);
  }

  .monogram {
    font-family: var(--font-ui);
    font-size: var(--avatar-font);
    font-weight: 600;
    color: var(--gold);
    letter-spacing: 0;
    line-height: 1;
    user-select: none;
  }

  @keyframes breath {
    0%, 100% { transform: scale(1); box-shadow: var(--shadow-neu-btn), 0 0 0 2px var(--gold-soft); }
    50%       { transform: scale(1.04); box-shadow: var(--shadow-neu-raised), 0 0 0 3px rgba(197, 160, 89, 0.2); }
  }
</style>
