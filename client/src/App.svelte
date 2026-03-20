<script lang="ts">
  import { onMount } from 'svelte';
  import { connect, connected, connectionError, currentMember, getConnection } from './lib/db';
  import { activeView, toasts, toast, type View } from './lib/stores';
  import OnboardingGate from './lib/components/OnboardingGate.svelte';
  import ChatPage from './lib/chat/ChatPage.svelte';
  import DashboardPage from './lib/pages/DashboardPage.svelte';
  import SalesHub from './lib/pages/SalesHub.svelte';
  import OperationsHub from './lib/pages/OperationsHub.svelte';
  import FinanceHub from './lib/pages/FinanceHub.svelte';
  import CRMHub from './lib/pages/CRMHub.svelte';
  import SettingsPage from './lib/pages/SettingsPage.svelte';
  import MotionShowcase from './lib/pages/MotionShowcase.svelte';

  // ── Navigation items ─────────────────────────────────────────────────────────

  interface NavItem {
    id: View;
    label: string;
    icon: string;
  }

  const navItems: NavItem[] = [
    { id: 'chat',       label: 'Chat',       icon: 'M9 2C5.4 2 2.5 4.9 2.5 8.5S5.4 15 9 15c1.2 0 2.3-.3 3.2-.9l2.8.9-.9-2.8c.6-.9.9-2 .9-3.2C15 4.9 12.6 2 9 2z' },
    { id: 'dashboard',  label: 'Dashboard',  icon: 'M2 2h6v6H2zM10 2h6v6h-6zM2 10h6v6H2zM10 10h6v6h-6z' },
    { id: 'sales',      label: 'Sales',      icon: 'M15 15H3V3M3 12l4-4 3 2 5-6' },
    { id: 'operations', label: 'Operations', icon: 'M3 4h12v10H3zM7 4V2M11 4V2M3 8h12' },
    { id: 'finance',    label: 'Finance',    icon: 'M9 2v14M5 5h6a3 3 0 010 6H5M5 11h7a3 3 0 010 6H5' },
    { id: 'crm',        label: 'Customers',  icon: 'M9 7a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2 17.5c0-3 3.5-5 7-5s7 2 7 5' },
    { id: 'settings',   label: 'Settings',   icon: 'M9 11a2 2 0 100-4 2 2 0 000 4zM14.5 9a5.5 5.5 0 01-.4 2l1.3 1.3-1.4 1.4L12.7 12.4a5.5 5.5 0 01-2 .4 5.5 5.5 0 01-2-.4L7.4 13.7 6 12.3l1.3-1.3A5.5 5.5 0 016.9 9a5.5 5.5 0 01.4-2L6 5.7 7.4 4.3l1.3 1.3a5.5 5.5 0 012-.4 5.5 5.5 0 012 .4l1.3-1.3L15.4 5.7 14.1 7a5.5 5.5 0 01.4 2z' },
    { id: 'showcase',   label: 'Showcase',   icon: 'M9 1l2.5 5.5L17 7.5l-4 4 1 5.5L9 14.5 4 17l1-5.5-4-4 5.5-1z' },
  ];

  // ── Responsive sidebar ───────────────────────────────────────────────────────

  let sidebarOpen = $state(false);
  let windowWidth = $state(typeof window !== 'undefined' ? window.innerWidth : 1200);

  $effect(() => {
    function handleResize() {
      windowWidth = window.innerWidth;
      if (windowWidth >= 1024) sidebarOpen = false;
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  });

  const isDesktop = $derived(windowWidth >= 1024);

  // ── Boot ─────────────────────────────────────────────────────────────────────

  onMount(() => {
    connect();
  });

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function setView(v: View) {
    activeView.set(v);
    if (!isDesktop) sidebarOpen = false;
  }

  function toastIconFor(kind: string): string {
    switch (kind) {
      case 'success': return '✓';
      case 'danger':  return '⚠';
      case 'warning': return '!';
      default:        return '◐';
    }
  }
  function getSessionKey(): string {
    if (typeof sessionStorage === 'undefined' || typeof crypto === 'undefined') {
      return 'session-fallback';
    }
    const existing = sessionStorage.getItem('asymm_auth_session_key');
    if (existing) return existing;
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    const generated = `session-${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`;
    sessionStorage.setItem('asymm_auth_session_key', generated);
    return generated;
  }

  function getSessionLabel(): string {
    if (typeof navigator === 'undefined') return 'Browser session';
    return navigator.userAgent.includes('Windows') ? 'Windows browser session' : 'Browser session';
  }

  let lastSessionIdentity = $state('');
  $effect(() => {
    const member = $currentMember;
    if (!$connected || !member) return;
    const identity = String((member as { identity?: unknown }).identity ?? '');
    if (!identity || lastSessionIdentity === identity) return;
    const conn = getConnection();
    if (!conn) return;
    try {
      conn.reducers.upsertAuthSession({
        sessionKey: getSessionKey(),
        sessionLabel: getSessionLabel(),
        ttlHours: 24n,
      });
      lastSessionIdentity = identity;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.warning(`Session tracking not updated: ${message}`);
    }
  });
</script>

<!-- ── Onboarding gate (connected but no member record yet) ─────────────── -->
{#if $connected && !$currentMember}
  <OnboardingGate />
{/if}

<!-- ── App Shell ────────────────────────────────────────────────────────────── -->
<div
  class="app-shell"
  class:sidebar-open={sidebarOpen}
  class:app-hidden={$connected && !$currentMember}
  aria-hidden={$connected && !$currentMember}
>

  <!-- ── Sidebar (V4 — dark, icon-only, Rams discipline) ─────────────────── -->
  <aside class="sidebar">
    <!-- Brand mark -->
    <div class="sidebar-brand">
      <span class="brand-mark" aria-hidden="true">A</span>
    </div>

    <!-- Nav (icon-only with SVG glyphs) -->
    <nav class="sidebar-nav" aria-label="Main navigation">
      {#each navItems as item (item.id)}
        <button
          class="nav-item"
          class:nav-active={$activeView === item.id}
          onclick={() => setView(item.id)}
          aria-current={$activeView === item.id ? 'page' : undefined}
          title={item.label}
          aria-label={item.label}
        >
          <svg class="nav-icon-svg" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path d={item.icon} stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      {/each}
    </nav>

    <!-- Connection dot -->
    <div class="sidebar-footer">
      <span class="conn-dot" class:conn-online={$connected} aria-hidden="true"></span>
    </div>
  </aside>

  <!-- ── Mobile overlay ───────────────────────────────────────────────────── -->
  {#if !isDesktop && sidebarOpen}
    <div
      class="sidebar-overlay"
      role="button"
      tabindex="-1"
      aria-label="Close sidebar"
      onclick={() => { sidebarOpen = false; }}
      onkeydown={(e) => { if (e.key === 'Escape') sidebarOpen = false; }}
    ></div>
  {/if}

  <!-- ── Main area ─────────────────────────────────────────────────────────── -->
  <div class="main-area">

    <!-- Header bar (V4 — Rams structural) -->
    <header class="topbar">
      <!-- Mobile hamburger -->
      {#if !isDesktop}
        <button
          class="hamburger"
          onclick={() => { sidebarOpen = !sidebarOpen; }}
          aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={sidebarOpen}
        >
          <span></span><span></span><span></span>
        </button>
      {/if}

      <!-- Brand + Page title -->
      <div class="topbar-brand">
        <span class="topbar-brand-name">ASYMMFLOW</span>
        <span class="topbar-divider"></span>
        <span class="topbar-page">{navItems.find(n => n.id === $activeView)?.label ?? 'Dashboard'}</span>
      </div>

      <!-- Connection status (desktop) -->
      {#if isDesktop}
        <div class="topbar-right">
          <div class="topbar-status" class:status-online={$connected}>
            <span class="conn-dot" aria-hidden="true"></span>
            <span>{$connected ? 'Live' : 'Offline'}</span>
          </div>
          <span class="topbar-date">{new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '.')}</span>
        </div>
      {/if}
    </header>

    <!-- Connection error banner -->
    {#if $connectionError}
      <div class="error-banner" role="alert">
        <svg class="error-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fill-rule="evenodd"
            d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
            clip-rule="evenodd"
          />
        </svg>
        <span class="error-msg">{$connectionError}</span>
      </div>
    {/if}

    <!-- Content switcher -->
    <main class="content-area" class:content-chat={$activeView === 'chat'}>
      {#if $activeView === 'chat'}
        <ChatPage />
      {:else if $activeView === 'dashboard'}
        <DashboardPage />
      {:else if $activeView === 'sales'}
        <SalesHub />
      {:else if $activeView === 'operations'}
        <OperationsHub />
      {:else if $activeView === 'finance'}
        <FinanceHub />
      {:else if $activeView === 'crm'}
        <CRMHub />
      {:else if $activeView === 'settings'}
        <SettingsPage />
      {:else if $activeView === 'showcase'}
        <MotionShowcase />
      {/if}
    </main>
  </div>
</div>

<!-- ── Toast Stack ─────────────────────────────────────────────────────────── -->
<div class="toast-stack" aria-live="polite" aria-atomic="false">
  {#each $toasts as t (t.id)}
    <div class="toast-item toast-{t.kind}" role="status">
      <span class="toast-icon" aria-hidden="true">{toastIconFor(t.kind)}</span>
      <p class="toast-msg">{t.message}</p>
      <button
        class="toast-close"
        onclick={() => toast.dismiss(t.id)}
        aria-label="Dismiss notification"
      >×</button>
    </div>
  {/each}
</div>

<style>
  /* ── Shell layout ─────────────────────────────────────────────────────── */
  .app-shell {
    display: grid;
    grid-template-columns: var(--sidebar-width) 1fr;
    min-height: 100dvh;
    background: var(--paper);
  }

  /* Hidden while onboarding gate is active */
  .app-hidden {
    visibility: hidden;
    pointer-events: none;
  }

  /* ── Sidebar (V4 — dark, icon-only) ──────────────────────────────────── */
  .sidebar {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--sp-21) 0;
    background: var(--sidebar-bg);
    height: 100dvh;
    position: sticky;
    top: 0;
    overflow-y: auto;
    z-index: var(--z-sticky);
  }

  .sidebar-brand {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: var(--sp-34);
  }

  .brand-mark {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 8px;
    border: 1.5px solid rgba(255, 255, 255, 0.12);
    font-family: var(--font-display);
    font-size: var(--text-md);
    font-weight: 700;
    color: var(--gold);
    line-height: 1;
  }

  /* Connection dot */
  .conn-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.2);
    flex-shrink: 0;
    transition: background var(--dur-normal) var(--ease-out);
  }

  .conn-dot.conn-online { background: var(--sage); box-shadow: 0 0 0 3px rgba(122, 159, 128, 0.25); }

  /* Nav items */
  .sidebar-nav {
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
    align-items: center;
    flex: 1;
  }

  .nav-item {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: rgba(255, 255, 255, 0.25);
    cursor: pointer;
    transition:
      color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
    padding: 0;
  }

  .nav-item:hover {
    color: rgba(255, 255, 255, 0.5);
  }

  .nav-active {
    color: var(--gold);
    border-left: 2px solid var(--gold);
  }

  .nav-icon-svg {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }

  /* Sidebar footer */
  .sidebar-footer {
    padding-top: var(--sp-13);
    display: flex;
    justify-content: center;
  }

  /* ── Mobile sidebar overlay ───────────────────────────────────────────── */
  .sidebar-overlay {
    position: fixed;
    inset: 0;
    background: rgba(28, 28, 28, 0.4);
    z-index: calc(var(--z-sticky) - 1);
    backdrop-filter: blur(2px);
  }

  /* ── Main area ────────────────────────────────────────────────────────── */
  .main-area {
    display: flex;
    flex-direction: column;
    min-height: 100dvh;
    overflow: hidden;
  }

  /* ── Topbar (V4 — Rams structural) ─────────────────────────────────── */
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-13);
    height: var(--header-height);
    padding: 0 var(--sp-34);
    background: var(--paper);
    border-bottom: 2px solid var(--ink);
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
  }

  .topbar-brand {
    display: flex;
    align-items: baseline;
    gap: var(--sp-13);
    flex: 1;
  }

  .topbar-brand-name {
    font-family: var(--font-ui);
    font-size: var(--text-base);
    font-weight: 700;
    color: var(--ink);
    letter-spacing: 0.08em;
  }

  .topbar-divider {
    width: 1px;
    height: 14px;
    background-color: var(--ink-12);
    align-self: center;
  }

  .topbar-page {
    font-family: var(--font-ui);
    font-size: var(--text-base);
    font-weight: 300;
    color: var(--ink-40);
  }

  .topbar-right {
    display: flex;
    align-items: center;
    gap: var(--sp-13);
  }

  .topbar-date {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 300;
    color: var(--ink-30);
  }

  .topbar-status {
    display: flex;
    align-items: center;
    gap: var(--sp-5);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 400;
    color: var(--ink-30);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .status-online {
    color: var(--sage);
  }

  .status-online .conn-dot { background: var(--sage); }

  /* ── Hamburger (mobile) ────────────────────────────────────────────────── */
  .hamburger {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 4px;
    width: 28px;
    height: 28px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    flex-shrink: 0;
  }

  .hamburger span {
    display: block;
    height: 1.5px;
    background: var(--ink);
    border-radius: 1px;
    transition: all var(--dur-fast) var(--ease-out);
  }

  /* ── Error banner ─────────────────────────────────────────────────────── */
  .error-banner {
    display: flex;
    align-items: center;
    gap: var(--sp-8);
    padding: var(--sp-8) var(--sp-24);
    background: var(--coral-soft);
    border-bottom: 1px solid var(--coral);
  }

  .error-icon {
    width: 16px;
    height: 16px;
    color: var(--coral);
    flex-shrink: 0;
  }

  .error-msg {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--coral);
  }

  /* ── Content area ─────────────────────────────────────────────────────── */
  .content-area {
    flex: 1;
    padding: var(--sp-34) var(--sp-40);
    overflow-y: auto;
    max-width: var(--max-content);
    width: 100%;
  }

  /* Chat page needs full height, no padding — it has its own layout */
  .content-chat {
    padding: 0;
    overflow: hidden;
  }

  /* ── Placeholder views (agents fill these in) ─────────────────────────── */
  .placeholder-view {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 320px;
    gap: var(--sp-13);
    text-align: center;
    color: var(--ink-30);
  }

  .placeholder-icon {
    font-size: var(--text-2xl);
    color: var(--gold-soft);
    line-height: 1;
    display: block;
  }

  .placeholder-title {
    font-family: var(--font-display);
    font-size: var(--text-lg);
    color: var(--ink-60);
    margin: 0;
    font-weight: 400;
  }

  .placeholder-sub {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--ink-30);
    margin: 0;
    max-width: 360px;
  }

  /* ── Toast stack ──────────────────────────────────────────────────────── */
  .toast-stack {
    position: fixed;
    bottom: var(--sp-24);
    right: var(--sp-24);
    z-index: var(--z-toast);
    display: flex;
    flex-direction: column;
    gap: var(--sp-8);
    max-width: 360px;
    pointer-events: none;
  }

  .toast-item {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-8);
    padding: var(--sp-13) var(--sp-16);
    background: var(--paper-card);
    border: none;
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-neu-raised);
    pointer-events: all;
    animation: toast-slide-in var(--dur-normal) var(--ease-out) both;
  }

  @keyframes toast-slide-in {
    from { transform: translateX(calc(100% + var(--sp-24))); opacity: 0; }
    to   { transform: translateX(0); opacity: 1; }
  }

  .toast-success { border-left: 3px solid var(--sage); }
  .toast-danger  { border-left: 3px solid var(--coral); }
  .toast-warning { border-left: 3px solid var(--amber); }
  .toast-info    { border-left: 3px solid var(--blue); }

  .toast-icon {
    font-size: var(--text-md);
    line-height: 1.3;
    flex-shrink: 0;
  }

  .toast-success .toast-icon { color: var(--sage); }
  .toast-danger  .toast-icon { color: var(--coral); }
  .toast-warning .toast-icon { color: var(--amber); }
  .toast-info    .toast-icon { color: var(--blue); }

  .toast-msg {
    flex: 1;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--ink);
    margin: 0;
    line-height: 1.4;
  }

  .toast-close {
    background: none;
    border: none;
    font-size: var(--text-lg);
    color: var(--ink-30);
    cursor: pointer;
    padding: 0;
    line-height: 1;
    flex-shrink: 0;
  }
  .toast-close:hover { color: var(--ink); }

  /* ── Responsive ───────────────────────────────────────────────────────── */
  @media (max-width: 1023px) {
    .app-shell {
      grid-template-columns: 1fr;
    }

    .sidebar {
      position: fixed;
      left: 0;
      top: 0;
      bottom: 0;
      width: var(--sidebar-width);
      transform: translateX(-100%);
      transition: transform var(--dur-normal) var(--ease-out);
      z-index: var(--z-modal);
      box-shadow: var(--shadow-lg);
    }

    .sidebar-open .sidebar {
      transform: translateX(0);
    }

    .content-area {
      padding: var(--sp-21) var(--sp-16);
    }
  }
</style>
