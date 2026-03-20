<script lang="ts">
  /**
   * tabs: Array<{ id: string, label: string, badge?: number }>
   * activeTab: string (bindable)
   */

  let {
    tabs = [],
    activeTab = $bindable(''),
  } = $props();

  // Auto-select first tab if nothing selected
  $effect(() => {
    if (!activeTab && tabs.length > 0) {
      activeTab = tabs[0].id;
    }
  });

  function selectTab(id: string) {
    activeTab = id;
  }

  function handleKeydown(e: KeyboardEvent, id: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectTab(id);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const idx = tabs.findIndex((t) => t.id === activeTab);
      const next = tabs[idx + 1];
      if (next) activeTab = next.id;
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const idx = tabs.findIndex((t) => t.id === activeTab);
      const prev = tabs[idx - 1];
      if (prev) activeTab = prev.id;
    } else if (e.key === 'Home') {
      e.preventDefault();
      if (tabs.length) activeTab = tabs[0].id;
    } else if (e.key === 'End') {
      e.preventDefault();
      if (tabs.length) activeTab = tabs[tabs.length - 1].id;
    }
  }
</script>

<div class="tabs-wrap">
  <div
    class="tabs-bar"
    role="tablist"
    aria-label="Navigation tabs"
  >
    {#each tabs as tab}
      <button
        class="tab-item"
        class:active={activeTab === tab.id}
        role="tab"
        aria-selected={activeTab === tab.id}
        tabindex={activeTab === tab.id ? 0 : -1}
        onclick={() => selectTab(tab.id)}
        onkeydown={(e) => handleKeydown(e, tab.id)}
        id="tab-{tab.id}"
        aria-controls="panel-{tab.id}"
        type="button"
      >
        <span class="tab-label">{tab.label}</span>
        {#if tab.badge != null && tab.badge > 0}
          <span class="tab-badge" aria-label="{tab.badge} items">{tab.badge}</span>
        {/if}
      </button>
    {/each}

    <!-- Invisible underline track -->
    <span class="tabs-track" aria-hidden="true"></span>
  </div>
</div>

<style>
  .tabs-wrap {
    width: 100%;
  }

  .tabs-bar {
    display: flex;
    align-items: flex-end;
    border-bottom: 1.5px solid var(--ink-12);
    gap: 0;
    position: relative;
  }

  .tab-item {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-3);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 400;
    color: var(--ink-60);
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    padding: var(--sp-5) var(--sp-8);
    cursor: pointer;
    transition:
      color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
    margin-bottom: -1.5px;
    white-space: nowrap;
    outline: none;
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  }

  .tab-item:hover:not(.active) {
    color: var(--ink);
    background: var(--ink-06);
  }

  .tab-item.active {
    color: var(--gold);
    font-weight: 600;
    border-bottom-color: var(--gold);
  }

  .tab-item:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: -2px;
  }

  .tab-label {
    line-height: 1;
  }

  .tab-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-ui);
    font-size: 0.65rem;
    font-weight: 700;
    color: var(--paper);
    background: var(--ink-30);
    border-radius: var(--radius-pill);
    min-width: 16px;
    height: 16px;
    padding: 0 var(--sp-2);
    line-height: 1;
  }

  .tab-item.active .tab-badge {
    background: var(--gold);
  }

  .tabs-track {
    display: block;
    flex: 1;
  }
</style>
