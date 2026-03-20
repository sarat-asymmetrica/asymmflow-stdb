<script lang="ts">
  let {
    size = 'md' as 'sm' | 'md' | 'lg',
    color = 'gold' as 'gold' | 'white' | 'ink' | 'sage' | 'coral',
  } = $props();

  const sizeMap = {
    sm: '16px',
    md: '24px',
    lg: '36px',
  };

  const colorMap = {
    gold: 'var(--gold)',
    white: 'rgba(255,255,255,0.9)',
    ink: 'var(--ink-60)',
    sage: 'var(--sage)',
    coral: 'var(--coral)',
  };

  let diameter = $derived(sizeMap[size] ?? sizeMap.md);
  let strokeColor = $derived(colorMap[color] ?? colorMap.gold);
  let strokeWidth = $derived(size === 'sm' ? 2 : size === 'lg' ? 3.5 : 2.5);
</script>

<span
  class="spinner"
  style="--diameter: {diameter}; --stroke-color: {strokeColor}; --stroke-width: {strokeWidth}px;"
  role="status"
  aria-label="Loading"
>
  <svg
    class="spinner-svg"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <!-- Track circle -->
    <circle
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      stroke-width={strokeWidth}
      opacity="0.15"
    />
    <!-- Spinning arc — top segment in accent color -->
    <circle
      cx="12"
      cy="12"
      r="10"
      stroke="var(--stroke-color)"
      stroke-width={strokeWidth}
      stroke-linecap="round"
      stroke-dasharray="31.4 94.2"
      stroke-dashoffset="0"
    />
  </svg>
  <span class="sr-only">Loading...</span>
</span>

<style>
  .spinner {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--diameter);
    height: var(--diameter);
    color: var(--ink-12);
    flex-shrink: 0;
  }

  .spinner-svg {
    width: 100%;
    height: 100%;
    animation: breathe-spin 987ms ease-in-out infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  @keyframes breathe-spin {
    0% {
      transform: rotate(0deg) scale(1);
      opacity: 0.8;
    }
    50% {
      transform: rotate(180deg) scale(1.08);
      opacity: 1;
    }
    100% {
      transform: rotate(360deg) scale(1);
      opacity: 0.8;
    }
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }
</style>
