<script lang="ts">
  // SettingsPage.svelte — V4 Rams x Neumorphic rebuild
  // All existing logic preserved; presentation layer rebuilt.

  import { onMount } from 'svelte';
  import { members, accessKeys, authSessions, activityLogs, currentMember, connected, getConnection } from '../db';
  import { formatDate } from '../format';
  import { isAdmin, toast } from '../stores';
  import { loadConfig, saveConfig } from '../ai/client';
  import { buildAccessKeyInviteEmail, loadResendConfig, saveResendConfig, sendResendEmail } from '../integrations/resend';
  import SeedManager from '../components/SeedManager.svelte';

  // ── AI config state ─────────────────────────────────────────────────────────

  let config = $state(loadConfig());
  let aiProvider = $state(config.provider);
  let aiKey = $state(config.apiKey);
  let aiModel = $state(config.model);
  let showKey = $state(false);

  $effect(() => {
    const defaults: Record<string, string> = {
      grok: 'x-ai/grok-4-fast-non-reasoning',
      claude: 'claude-sonnet-4-5',
      sarvam: 'sarvam-m',
    };
    aiModel = defaults[aiProvider] ?? aiModel;
  });

  function saveAiConfig() {
    const baseUrls: Record<string, string> = {
      grok: 'https://api.aimlapi.com',
      claude: 'https://api.aimlapi.com',
      sarvam: 'https://api.sarvam.ai',
    };
    saveConfig({
      provider: aiProvider as any,
      model: aiModel,
      apiKey: aiKey,
      baseUrl: baseUrls[aiProvider] ?? 'https://api.aimlapi.com',
      maxTokens: 1024,
      temperature: 0.3,
    });
    toast.success('AI configuration saved!');
  }

  // ── Derived team data ────────────────────────────────────────────────────────

  function getInitials(fullName: string): string {
    return fullName
      .split(' ')
      .filter(Boolean)
      .map((w) => w[0].toUpperCase())
      .join('');
  }

  // ── System info (live) ───────────────────────────────────────────────────────

  let systemInfo = $derived({
    version: '0.2.0-alpha',
    buildDate: '2026-03-09',
    stdbModule: 'asymm-flow',
    stdbCloud: 'maincloud.spacetimedb.com',
    stdbStatus: $connected ? 'connected' : 'disconnected',
    sveltekitVersion: 'Svelte 5 + Vite 7',
    environment: 'development',
  });

  // ── Company info (static constants for PH Trading WLL) ──────────────────────

  const companyInfo = {
    name: 'PH Trading WLL',
    arabicName: 'بي اتش للتجارة ذ.م.م',
    crNumber: 'CR-BH-2019-7841',
    vatNumber: 'VAT-BH-100456789-001',
    currency: 'BHD',
    vatRate: '10%',
    country: 'Kingdom of Bahrain',
    address: 'Building 123, Road 456, Block 789, Manama',
    phone: '+973 1700 0000',
  };

  const roleColor: Record<string, string> = {
    Admin: 'gold',
    Manager: 'blue',
    Sales: 'sage',
    Operations: 'amber',
    Accountant: 'blue',
    Staff: 'sage',
  };

  let inviteRole = $state('Manager');
  let inviteEmail = $state('');
  let inviteName = $state('');
  let inviteNotes = $state('');
  let latestIssuedKey = $state('');
  let latestInviteEmail = $state('');
  let latestInviteName = $state('');
  let latestInviteRole = $state('');
  let latestInviteNotes = $state('');
  let resendApiKey = $state('');
  let resendFromEmail = $state('');

  onMount(async () => {
    const resendConfig = await loadResendConfig();
    resendApiKey = resendConfig.apiKey;
    resendFromEmail = resendConfig.fromEmail;
  });

  const recentSessions = $derived(
    [...$authSessions].sort((left, right) => Number(right.lastSeenAt.microsSinceUnixEpoch - left.lastSeenAt.microsSinceUnixEpoch))
  );
  const recentAuditRows = $derived(
    [...$activityLogs].sort((left, right) => Number(right.createdAt.microsSinceUnixEpoch - left.createdAt.microsSinceUnixEpoch)).slice(0, 20)
  );

  function generateAccessKey(role: string): string {
    const bytes = new Uint8Array(3);
    crypto.getRandomValues(bytes);
    const suffix = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('').toUpperCase();
    const prefixMap: Record<string, string> = {
      Admin: 'ADM',
      Manager: 'MGR',
      Sales: 'SLS',
      Operations: 'OPS',
      Accountant: 'ACT',
    };
    return `PH-${prefixMap[role] ?? 'USR'}-${suffix}`;
  }

  function formatTimestamp(ts: { microsSinceUnixEpoch: bigint } | null | undefined): string {
    if (!ts) return '-';
    return formatDate(ts);
  }

  function revokeSession(sessionKey: string): void {
    const conn = getConnection();
    if (!conn) {
      toast.danger('Not connected to SpacetimeDB.');
      return;
    }
    try {
      conn.reducers.revokeAuthSession({
        sessionKey,
        revokeReason: 'revoked_from_settings',
      });
      toast.success('Session revoked.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.danger(`Could not revoke session: ${message}`);
    }
  }

  function issueAccessKey(): void {
    const conn = getConnection();
    if (!conn) {
      toast.danger('Not connected to SpacetimeDB.');
      return;
    }
    const email = inviteEmail.trim().toLowerCase();
    const assignedName = inviteName.trim();
    if (!email || !email.includes('@')) {
      toast.danger('A valid invite email is required.');
      return;
    }
    if (!assignedName) {
      toast.danger('Assigned name is required.');
      return;
    }
    const key = generateAccessKey(inviteRole);
    try {
      conn.reducers.issueAccessKey({
        key,
        role: { tag: inviteRole } as never,
        assignedEmail: email,
        assignedName,
        notes: inviteNotes.trim(),
        expiresAt: undefined,
      });
      latestIssuedKey = key;
      latestInviteEmail = email;
      latestInviteName = assignedName;
      latestInviteRole = inviteRole;
      latestInviteNotes = inviteNotes.trim();
      inviteEmail = '';
      inviteName = '';
      inviteNotes = '';
      toast.success(`Access key issued: ${key}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.danger(`Could not issue access key: ${message}`);
    }
  }

  async function saveResendSettings(): Promise<void> {
    await saveResendConfig({
      apiKey: resendApiKey.trim(),
      fromEmail: resendFromEmail.trim(),
    });
    toast.success('Resend configuration saved.');
  }

  async function sendLatestInviteEmail(): Promise<void> {
    if (!latestIssuedKey || !latestInviteEmail) {
      toast.danger('Issue an access key first.');
      return;
    }
    try {
      await sendResendEmail(
        { apiKey: resendApiKey.trim(), fromEmail: resendFromEmail.trim() },
        {
          to: latestInviteEmail,
          ...buildAccessKeyInviteEmail({
            assignedName: latestInviteName,
            role: latestInviteRole,
            accessKey: latestIssuedKey,
            notes: latestInviteNotes,
          }),
        },
      );
      toast.success(`Invite email sent to ${latestInviteEmail}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.danger(`Could not send invite email: ${message}`);
    }
  }
</script>

<div class="settings-page">

  <!-- Page header -->
  <header class="page-header">
    <span class="page-label">Settings</span>
    <div class="rule"></div>
  </header>

  {#if !$isAdmin}
    <!-- Access Denied -->
    <div class="access-denied card">
      <div class="denied-icon">&#8856;</div>
      <p class="denied-title">Access Denied</p>
      <p class="denied-body">
        Settings are restricted to Admin users only.
        Contact your administrator to request access.
      </p>
    </div>
  {:else}

    <!-- ── 1. Profile Card ──────────────────────────────────────────────────── -->
    <section class="settings-section">
      <h2 class="section-heading">Profile</h2>
      <div class="card settings-card">
        {#if $currentMember}
          {@const me = $currentMember as any}
          {@const roleTag = me?.role?.tag ?? 'Member'}
          {@const initials = getInitials(me.fullName || me.nickname || '?')}
          <div class="profile-row">
            <div
              class="profile-avatar"
              style="--av-bg: var(--{roleColor[roleTag] ?? 'gold'}-soft); --av-color: var(--{roleColor[roleTag] ?? 'gold'})"
            >
              {initials}
            </div>
            <div class="profile-info">
              <div class="profile-name">{me.fullName || me.nickname}</div>
              <div class="profile-email">{me.email || me.nickname}</div>
            </div>
            <span class="badge badge-{roleColor[roleTag] ?? 'gold'}">{roleTag}</span>
          </div>
          <div class="field-rows">
            <div class="field-row">
              <span class="field-key">Joined</span>
              <span class="field-val">{formatTimestamp(me.joinedAt)}</span>
            </div>
            <div class="field-row">
              <span class="field-key">Last Login</span>
              <span class="field-val">{formatTimestamp(me.lastLoginAt)}</span>
            </div>
            <div class="field-row">
              <span class="field-key">Auth Method</span>
              <span class="field-val">{me.authMethod?.tag ?? '-'}</span>
            </div>
          </div>
        {:else}
          <p class="empty-state">Not connected — profile unavailable.</p>
        {/if}
      </div>
    </section>

    <!-- ── 2. Team ─────────────────────────────────────────────────────────── -->
    <section class="settings-section">
      <div class="section-header-row">
        <h2 class="section-heading">Team</h2>
        <span class="count-chip">{$members.length}</span>
      </div>
      <div class="card settings-card card-flush">
        {#each $members as member}
          {@const roleTag = (member.role as any)?.tag ?? 'Staff'}
          {@const initials = getInitials(member.fullName)}
          <div class="member-row">
            <div
              class="member-avatar"
              style="--av-bg: var(--{roleColor[roleTag] ?? 'gold'}-soft); --av-color: var(--{roleColor[roleTag] ?? 'gold'})"
            >
              {initials}
            </div>
            <div class="member-info">
              <div class="member-name">{member.fullName}</div>
              <div class="member-sub">{member.email || member.nickname}</div>
            </div>
            <span class="badge badge-{roleColor[roleTag] ?? 'gold'}">{roleTag}</span>
            <div class="member-meta">
              <span class="meta-label">Last Login</span>
              <span class="meta-val">{formatTimestamp(member.lastLoginAt)}</span>
            </div>
          </div>
        {/each}
        {#if $members.length === 0}
          <p class="empty-state">No members loaded — connect to SpacetimeDB.</p>
        {/if}
      </div>
    </section>

    <!-- ── 3. Connection ──────────────────────────────────────────────────── -->
    <section class="settings-section">
      <h2 class="section-heading">Connection</h2>
      <div class="card settings-card">
        <div class="conn-status-row">
          <span
            class="conn-dot"
            class:conn-dot-live={$connected}
            class:conn-dot-off={!$connected}
          ></span>
          <span
            class="conn-label"
            class:conn-label-live={$connected}
            class:conn-label-off={!$connected}
          >
            {$connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <div class="field-rows">
          <div class="field-row">
            <span class="field-key">Module</span>
            <span class="field-val field-mono">{systemInfo.stdbModule}</span>
          </div>
          <div class="field-row">
            <span class="field-key">Host</span>
            <span class="field-val field-mono">{systemInfo.stdbCloud}</span>
          </div>
          <div class="field-row">
            <span class="field-key">Protocol</span>
            <span class="field-val field-mono">WebSocket (binary)</span>
          </div>
        </div>
      </div>
    </section>

    <!-- ── 4. About ───────────────────────────────────────────────────────── -->
    <section class="settings-section">
      <h2 class="section-heading">About</h2>
      <div class="card settings-card">
        <div class="about-header">
          <div class="about-logo">AF</div>
          <div>
            <div class="about-name">AsymmFlow V5</div>
            <div class="about-sub">Chat-first agentic ERP — Rams x Neumorphic</div>
          </div>
        </div>
        <div class="field-rows">
          <div class="field-row">
            <span class="field-key">Version</span>
            <span class="field-val field-mono" style="color: var(--gold)">{systemInfo.version}</span>
          </div>
          <div class="field-row">
            <span class="field-key">Build Date</span>
            <span class="field-val field-mono">{systemInfo.buildDate}</span>
          </div>
          <div class="field-row">
            <span class="field-key">Frontend</span>
            <span class="field-val field-mono">{systemInfo.sveltekitVersion}</span>
          </div>
          <div class="field-row">
            <span class="field-key">Design System</span>
            <span class="field-val">Rams x Neumorphic — Space Grotesk, warm clay, Fibonacci spacing</span>
          </div>
          <div class="field-row">
            <span class="field-key">Environment</span>
            <span class="field-val">
              <span class="env-badge env-{systemInfo.environment}">{systemInfo.environment}</span>
            </span>
          </div>
        </div>
      </div>
    </section>

    <!-- ── AI Configuration ──────────────────────────────────────────────── -->
    <section class="settings-section">
      <h2 class="section-heading">AI Configuration</h2>
      <div class="card settings-card">
        <div class="config-form">
          <div class="config-field">
            <label class="field-label" for="ai-provider">Provider</label>
            <select id="ai-provider" class="input select-input" bind:value={aiProvider}>
              <option value="grok">Grok (AIMLAPI)</option>
              <option value="claude">Claude (AIMLAPI)</option>
              <option value="sarvam">Sarvam-M</option>
            </select>
          </div>
          <div class="config-field">
            <label class="field-label" for="ai-key">API Key</label>
            <div class="key-row">
              <input
                id="ai-key"
                class="input"
                type={showKey ? 'text' : 'password'}
                bind:value={aiKey}
                placeholder="Enter your API key..."
              />
              <button class="btn btn-ghost key-toggle" onclick={() => (showKey = !showKey)}>
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <span class="hint">
              {#if aiProvider === 'sarvam'}Get your key from api.sarvam.ai
              {:else}Get your key from aimlapi.com{/if}
            </span>
          </div>
          <div class="config-field">
            <label class="field-label" for="ai-model">Model</label>
            <input id="ai-model" class="input" type="text" bind:value={aiModel} />
          </div>
          <button class="btn btn-gold" onclick={saveAiConfig}>Save AI Configuration</button>
        </div>
      </div>
    </section>

    <!-- ── Resend Email ───────────────────────────────────────────────────── -->
    <section class="settings-section">
      <h2 class="section-heading">Resend Email</h2>
      <div class="card settings-card">
        <div class="config-form">
          <div class="config-field">
            <label class="field-label" for="resend-api-key">Resend API Key</label>
            <input id="resend-api-key" class="input" type="password" bind:value={resendApiKey} placeholder="re_..." />
          </div>
          <div class="config-field">
            <label class="field-label" for="resend-from-email">From Email</label>
            <input id="resend-from-email" class="input" type="email" bind:value={resendFromEmail} placeholder="PH Trading <noreply@yourdomain.com>" />
          </div>
          <div class="btn-row">
            <button class="btn btn-gold" onclick={saveResendSettings}>Save Resend Configuration</button>
            <button class="btn btn-ghost" onclick={sendLatestInviteEmail}>Send Latest Access Key Email</button>
          </div>
          <span class="hint">Interim implementation for this experimental client. In production this should move behind a secret-holding sidecar.</span>
        </div>
      </div>
    </section>

    <!-- ── Data Migration ─────────────────────────────────────────────────── -->
    <section class="settings-section">
      <h2 class="section-heading">Data Migration</h2>
      <SeedManager />
    </section>

    <!-- ── Company Information ────────────────────────────────────────────── -->
    <section class="settings-section">
      <h2 class="section-heading">Company Information</h2>
      <div class="card settings-card">
        <div class="company-header">
          <div class="company-logo">PH</div>
          <div>
            <div class="company-name">{companyInfo.name}</div>
            <div class="company-arabic">{companyInfo.arabicName}</div>
          </div>
        </div>
        <div class="field-rows">
          <div class="field-row">
            <span class="field-key">CR Number</span>
            <span class="field-val field-mono">{companyInfo.crNumber}</span>
          </div>
          <div class="field-row">
            <span class="field-key">VAT Number</span>
            <span class="field-val field-mono">{companyInfo.vatNumber}</span>
          </div>
          <div class="field-row">
            <span class="field-key">Currency</span>
            <span class="field-val">{companyInfo.currency} (Bahraini Dinar — 3 decimals)</span>
          </div>
          <div class="field-row">
            <span class="field-key">VAT Rate</span>
            <span class="field-val">{companyInfo.vatRate}</span>
          </div>
          <div class="field-row">
            <span class="field-key">Country</span>
            <span class="field-val">{companyInfo.country}</span>
          </div>
          <div class="field-row">
            <span class="field-key">Address</span>
            <span class="field-val">{companyInfo.address}</span>
          </div>
          <div class="field-row">
            <span class="field-key">Phone</span>
            <span class="field-val field-mono">{companyInfo.phone}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Access Keys ─────────────────────────────────────────────────────── -->
    <section class="settings-section">
      <div class="section-header-row">
        <h2 class="section-heading">Access Keys</h2>
        <span class="count-chip">{$accessKeys.length} issued</span>
      </div>
      <div class="card settings-card">
        <div class="config-form">
          <div class="config-field">
            <label class="field-label" for="invite-role">Role</label>
            <select id="invite-role" class="input select-input" bind:value={inviteRole}>
              <option value="Admin">Admin</option>
              <option value="Manager">Manager</option>
              <option value="Sales">Sales</option>
              <option value="Operations">Operations</option>
              <option value="Accountant">Accountant</option>
            </select>
          </div>
          <div class="config-field">
            <label class="field-label" for="invite-email">Assigned Email</label>
            <input id="invite-email" class="input" type="email" bind:value={inviteEmail} placeholder="user@company.com" />
          </div>
          <div class="config-field">
            <label class="field-label" for="invite-name">Assigned Name</label>
            <input id="invite-name" class="input" type="text" bind:value={inviteName} placeholder="Team member name" />
          </div>
          <div class="config-field">
            <label class="field-label" for="invite-notes">Notes</label>
            <input id="invite-notes" class="input" type="text" bind:value={inviteNotes} placeholder="Optional invite notes" />
          </div>
          <button class="btn btn-gold" onclick={issueAccessKey}>Issue Access Key</button>
          {#if latestIssuedKey}
            <div class="hint">Latest issued key: <span class="field-mono">{latestIssuedKey}</span></div>
          {/if}
        </div>
        {#if $accessKeys.length > 0}
          <div class="member-list">
            {#each [...$accessKeys].slice().reverse() as keyRow}
              {@const keyRole = (keyRow.role as any)?.tag ?? 'Staff'}
              <div class="member-row">
                <div
                  class="member-avatar"
                  style="--av-bg: var(--{roleColor[keyRole] ?? 'gold'}-soft); --av-color: var(--{roleColor[keyRole] ?? 'gold'})"
                >
                  {keyRole.slice(0, 2)}
                </div>
                <div class="member-info">
                  <div class="member-name">{keyRow.assignedName || keyRow.assignedEmail || keyRow.key}</div>
                  <div class="member-sub field-mono">{keyRow.key}</div>
                </div>
                <span class="badge badge-{roleColor[keyRole] ?? 'gold'}">{keyRole}</span>
                <div class="member-meta">
                  <span class="meta-label">{keyRow.claimedAt ? 'Claimed' : 'Issued'}</span>
                  <span class="meta-val">{formatTimestamp(keyRow.claimedAt ?? keyRow.createdAt)}</span>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </section>

    <!-- ── Active Sessions ────────────────────────────────────────────────── -->
    <section class="settings-section">
      <div class="section-header-row">
        <h2 class="section-heading">Active Sessions</h2>
        <span class="count-chip">{recentSessions.length}</span>
      </div>
      <div class="card settings-card card-flush">
        {#each recentSessions as session}
          {@const ownedByCurrent = String(session.memberIdentity) === String(($currentMember as any)?.identity ?? '')}
          <div class="member-row">
            <div class="member-avatar" style="--av-bg: var(--gold-soft); --av-color: var(--gold)">SS</div>
            <div class="member-info">
              <div class="member-name">{session.sessionLabel}</div>
              <div class="member-sub field-mono">{session.sessionKey}</div>
            </div>
            <span class="badge badge-gold">{(session.authMethod as any)?.tag ?? 'Auth'}</span>
            <div class="member-meta">
              <span class="meta-label">{session.revokedAt ? 'Revoked' : ownedByCurrent ? 'Current' : 'Last Seen'}</span>
              <span class="meta-val">{formatTimestamp(session.revokedAt ?? session.lastSeenAt)}</span>
            </div>
            {#if !session.revokedAt}
              <button class="btn btn-ghost" style="padding: var(--sp-4) var(--sp-8); font-size: var(--text-xs);" onclick={() => revokeSession(session.sessionKey)}>Revoke</button>
            {/if}
          </div>
        {/each}
        {#if recentSessions.length === 0}
          <p class="empty-state">No sessions tracked.</p>
        {/if}
      </div>
    </section>

    <!-- ── Audit Trail ─────────────────────────────────────────────────────── -->
    <section class="settings-section">
      <div class="section-header-row">
        <h2 class="section-heading">Audit Trail</h2>
        <span class="count-chip">{recentAuditRows.length} recent</span>
      </div>
      <div class="card settings-card card-flush">
        {#each recentAuditRows as row}
          <div class="member-row">
            <div class="member-avatar" style="--av-bg: var(--blue-soft); --av-color: var(--blue)">LG</div>
            <div class="member-info">
              <div class="member-name">{row.action} on {row.entityType}</div>
              <div class="member-sub">{row.detail}</div>
            </div>
            <span class="badge badge-blue">#{String(row.entityId)}</span>
            <div class="member-meta">
              <span class="meta-label">At</span>
              <span class="meta-val">{formatTimestamp(row.createdAt)}</span>
            </div>
          </div>
        {/each}
        {#if recentAuditRows.length === 0}
          <p class="empty-state">No audit events yet.</p>
        {/if}
      </div>
    </section>

    <!-- ── System Information ─────────────────────────────────────────────── -->
    <section class="settings-section">
      <h2 class="section-heading">System Information</h2>
      <div class="sys-grid">
        <!-- Application card -->
        <div class="card sys-card">
          <div class="sys-card-head">Application</div>
          <div class="field-rows">
            <div class="field-row">
              <span class="field-key">Version</span>
              <span class="field-val field-mono" style="color: var(--gold); font-weight: 600;">{systemInfo.version}</span>
            </div>
            <div class="field-row">
              <span class="field-key">Build Date</span>
              <span class="field-val field-mono">{systemInfo.buildDate}</span>
            </div>
            <div class="field-row">
              <span class="field-key">SvelteKit</span>
              <span class="field-val field-mono">{systemInfo.sveltekitVersion}</span>
            </div>
            <div class="field-row">
              <span class="field-key">Environment</span>
              <span class="field-val">
                <span class="env-badge env-{systemInfo.environment}">{systemInfo.environment}</span>
              </span>
            </div>
          </div>
        </div>
        <!-- SpacetimeDB card -->
        <div class="card sys-card">
          <div class="sys-card-head">SpacetimeDB</div>
          <div class="field-rows">
            <div class="field-row">
              <span class="field-key">Module Name</span>
              <span class="field-val field-mono" style="color: var(--blue); font-size: var(--text-xs);">{systemInfo.stdbModule}</span>
            </div>
            <div class="field-row">
              <span class="field-key">Cloud</span>
              <span class="field-val field-mono">{systemInfo.stdbCloud}</span>
            </div>
            <div class="field-row">
              <span class="field-key">Status</span>
              <span class="field-val">
                <span
                  class="conn-dot"
                  class:conn-dot-live={$connected}
                  class:conn-dot-off={!$connected}
                ></span>
                <span
                  class="conn-label"
                  class:conn-label-live={$connected}
                  class:conn-label-off={!$connected}
                >
                  {$connected ? 'Connected' : 'Disconnected'}
                </span>
              </span>
            </div>
            <div class="field-row">
              <span class="field-key">Protocol</span>
              <span class="field-val field-mono">WebSocket (binary)</span>
            </div>
          </div>
        </div>
        <!-- Sprint roadmap -->
        <div class="card sys-card sys-card-wide">
          <div class="sys-card-head">Sprint Roadmap</div>
          <div class="sprint-list">
            <div class="sprint-item sprint-done">
              <div class="sprint-icon sprint-icon-done">&#10003;</div>
              <div>
                <div class="sprint-name">Sprint 1 — Core UI Shell</div>
                <div class="sprint-desc">STDB schema, Svelte pages, chat interface, hub navigation</div>
              </div>
            </div>
            <div class="sprint-item sprint-done">
              <div class="sprint-icon sprint-icon-done">&#10003;</div>
              <div>
                <div class="sprint-name">Sprint 2 — Live Data</div>
                <div class="sprint-desc">Connect STDB stores, real-time KPIs, invoice CRUD, follow-up tracking</div>
              </div>
            </div>
            <div class="sprint-item sprint-active">
              <div class="sprint-icon sprint-icon-active"></div>
              <div>
                <div class="sprint-name">Sprint 3 — AI Agents</div>
                <div class="sprint-desc">Chat commands, Grok actions, bank reconciliation, email integration</div>
              </div>
            </div>
            <div class="sprint-item sprint-future">
              <div class="sprint-icon sprint-icon-future"></div>
              <div>
                <div class="sprint-name">Sprint 4 — Production</div>
                <div class="sprint-desc">Team onboarding, mobile optimization, export, WhatsApp integration</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

  {/if}
</div>

<style>
  /* ── Layout ── */
  .settings-page {
    display: flex;
    flex-direction: column;
    gap: var(--sp-34);
    padding: var(--sp-34) var(--sp-34) var(--sp-89);
    max-width: 960px;
    margin: 0 auto;
  }

  /* ── Page header ── */
  .page-header {
    display: flex;
    flex-direction: column;
    gap: var(--sp-8);
    padding-bottom: var(--sp-5);
  }

  .page-label {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--ink-30);
  }

  .rule {
    height: 2px;
    background-color: var(--ink);
    border: none;
  }

  /* ── Section headings ── */
  .settings-section {
    display: flex;
    flex-direction: column;
    gap: var(--sp-13);
  }

  .section-header-row {
    display: flex;
    align-items: center;
    gap: var(--sp-8);
  }

  .section-heading {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-40);
    margin: 0;
  }

  .count-chip {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--ink-40);
    background: var(--ink-06);
    padding: var(--sp-1) var(--sp-8);
    border-radius: var(--radius-pill);
  }

  /* ── Card base ── */
  .settings-card {
    overflow: hidden;
  }

  /* card-flush: no internal padding — children provide it via rows */
  .card-flush {
    padding: 0 !important;
  }

  /* ── Access Denied ── */
  .access-denied {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--sp-89) var(--sp-34);
    text-align: center;
    gap: var(--sp-13);
  }

  .denied-icon {
    font-size: 56px;
    color: var(--ink-12);
    line-height: 1;
  }

  .denied-title {
    font-family: var(--font-ui);
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--ink);
    margin: 0;
  }

  .denied-body {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--ink-60);
    line-height: 1.6;
    margin: 0;
  }

  /* ── Profile card ── */
  .profile-row {
    display: flex;
    align-items: center;
    gap: var(--sp-13);
    padding: var(--sp-16) var(--sp-21);
    border-bottom: 1px solid var(--ink-06);
  }

  .profile-avatar {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--av-bg, var(--gold-soft));
    color: var(--av-color, var(--gold));
    font-family: var(--font-ui);
    font-size: var(--text-md);
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .profile-info {
    flex: 1;
    min-width: 0;
  }

  .profile-name {
    font-family: var(--font-ui);
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--ink);
  }

  .profile-email {
    font-family: var(--font-data);
    font-size: var(--text-sm);
    color: var(--ink-60);
    margin-top: var(--sp-2);
  }

  /* ── Generic field rows (used in profile, connection, about, company) ── */
  .field-rows {
    display: flex;
    flex-direction: column;
  }

  .field-row {
    display: flex;
    align-items: center;
    padding: var(--sp-8) var(--sp-21);
    border-bottom: 1px solid var(--ink-06);
    gap: var(--sp-16);
  }

  .field-row:last-child {
    border-bottom: none;
  }

  .field-key {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--ink-40);
    min-width: 120px;
    flex-shrink: 0;
  }

  .field-val {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--ink);
    flex: 1;
    text-align: right;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--sp-5);
  }

  .field-mono {
    font-family: var(--font-data);
  }

  /* ── Connection indicator ── */
  .conn-status-row {
    display: flex;
    align-items: center;
    gap: var(--sp-8);
    padding: var(--sp-13) var(--sp-21);
    border-bottom: 1px solid var(--ink-06);
  }

  .conn-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .conn-dot-live {
    background: var(--sage);
    box-shadow: 0 0 0 3px var(--sage-soft);
    animation: breathe-dot 3s ease-in-out infinite;
  }

  .conn-dot-off {
    background: var(--ink-30);
  }

  @keyframes breathe-dot {
    0%, 100% { box-shadow: 0 0 0 2px var(--sage-soft); }
    50%       { box-shadow: 0 0 0 5px var(--sage-soft); }
  }

  .conn-label {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .conn-label-live { color: var(--sage); }
  .conn-label-off  { color: var(--ink-30); }

  /* ── About header ── */
  .about-header {
    display: flex;
    align-items: center;
    gap: var(--sp-13);
    padding: var(--sp-16) var(--sp-21);
    border-bottom: 1px solid var(--ink-06);
  }

  .about-logo {
    width: 44px;
    height: 44px;
    border-radius: var(--radius-md);
    background: var(--ink);
    color: var(--paper);
    font-family: var(--font-ui);
    font-size: var(--text-md);
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .about-name {
    font-family: var(--font-ui);
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--ink);
  }

  .about-sub {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--ink-40);
    margin-top: var(--sp-2);
  }

  /* ── Environment badge ── */
  .env-badge {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 500;
    letter-spacing: 0.06em;
    padding: var(--sp-2) var(--sp-8);
    border-radius: var(--radius-pill);
    text-transform: uppercase;
  }

  .env-development { background: var(--amber-soft); color: var(--amber); }
  .env-staging     { background: var(--blue-soft);  color: var(--blue); }
  .env-production  { background: var(--sage-soft);  color: var(--sage); }

  /* ── Company header ── */
  .company-header {
    display: flex;
    align-items: center;
    gap: var(--sp-13);
    padding: var(--sp-16) var(--sp-21);
    border-bottom: 1px solid var(--ink-06);
    background: var(--paper-elevated);
  }

  .company-logo {
    width: 44px;
    height: 44px;
    border-radius: var(--radius-md);
    background: var(--gold);
    color: #fff;
    font-family: var(--font-ui);
    font-size: var(--text-lg);
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .company-name {
    font-family: var(--font-ui);
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--ink);
  }

  .company-arabic {
    font-family: var(--font-body);
    font-size: var(--text-sm);
    color: var(--ink-60);
    direction: rtl;
    margin-top: var(--sp-2);
  }

  /* ── Config form ── */
  .config-form {
    display: flex;
    flex-direction: column;
    gap: var(--sp-16);
    padding: var(--sp-21);
  }

  .config-field {
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
  }

  .field-label {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 500;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    color: var(--ink-40);
  }

  .key-row {
    display: flex;
    gap: var(--sp-8);
  }

  .key-row .input {
    flex: 1;
  }

  .key-toggle {
    flex-shrink: 0;
    padding: var(--sp-8) var(--sp-13);
  }

  .hint {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--ink-30);
    line-height: 1.5;
  }

  .btn-row {
    display: flex;
    gap: var(--sp-8);
    flex-wrap: wrap;
  }

  .select-input {
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%231c1c1c' stroke-opacity='0.4' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right var(--sp-13) center;
    padding-right: var(--sp-34);
    cursor: pointer;
  }

  /* ── Member list (reused for team, access keys, sessions, audit) ── */
  .member-list {
    border-top: 1px solid var(--ink-06);
  }

  .member-row {
    display: flex;
    align-items: center;
    gap: var(--sp-13);
    padding: var(--sp-13) var(--sp-16);
    border-bottom: 1px solid var(--ink-06);
    transition: background var(--dur-fast) var(--ease-out);
  }

  .member-row:last-child {
    border-bottom: none;
  }

  .member-row:hover {
    background: var(--ink-03);
  }

  .member-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--av-bg, var(--gold-soft));
    color: var(--av-color, var(--gold));
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .member-info {
    flex: 1;
    min-width: 0;
  }

  .member-name {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .member-sub {
    font-family: var(--font-data);
    font-size: var(--text-xs);
    color: var(--ink-40);
    margin-top: var(--sp-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .member-meta {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--sp-1);
    min-width: 72px;
  }

  .meta-label {
    font-family: var(--font-ui);
    font-size: 10px;
    color: var(--ink-30);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .meta-val {
    font-family: var(--font-data);
    font-size: var(--text-xs);
    color: var(--ink-60);
  }

  .empty-state {
    padding: var(--sp-21) var(--sp-16);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--ink-30);
    text-align: center;
    margin: 0;
  }

  /* ── Badge variants (supplementing app.css global badges) ── */
  .badge-gold  { background-color: var(--gold-soft);  color: var(--gold); }
  .badge-blue  { background-color: var(--blue-soft);  color: var(--blue); }
  .badge-sage  { background-color: var(--sage-soft);  color: var(--sage); }
  .badge-amber { background-color: var(--amber-soft); color: var(--amber); }

  /* ── System info grid ── */
  .sys-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--sp-13);
  }

  @media (max-width: 640px) {
    .sys-grid { grid-template-columns: 1fr; }
  }

  .sys-card {
    overflow: hidden;
  }

  .sys-card-wide {
    grid-column: 1 / -1;
  }

  .sys-card-head {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 500;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    color: var(--ink-40);
    padding: var(--sp-8) var(--sp-21);
    border-bottom: 1px solid var(--ink-06);
  }

  /* ── Sprint roadmap ── */
  .sprint-list {
    display: flex;
    flex-direction: column;
  }

  .sprint-item {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-13);
    padding: var(--sp-13) var(--sp-21);
    border-bottom: 1px solid var(--ink-06);
  }

  .sprint-item:last-child {
    border-bottom: none;
  }

  .sprint-icon {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 1px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
  }

  .sprint-icon-done {
    background: var(--sage);
    color: #fff;
  }

  .sprint-icon-active {
    background: var(--gold);
    position: relative;
  }

  .sprint-icon-active::after {
    content: '';
    position: absolute;
    inset: 4px;
    border-radius: 50%;
    background: var(--paper-card);
  }

  .sprint-icon-future {
    border: 2px solid var(--ink-12);
    background: transparent;
  }

  .sprint-name {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
    margin-bottom: var(--sp-2);
  }

  .sprint-done .sprint-name {
    color: var(--ink-40);
    text-decoration: line-through;
    text-decoration-color: var(--ink-12);
  }

  .sprint-active .sprint-name {
    color: var(--gold);
  }

  .sprint-desc {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--ink-40);
    line-height: 1.5;
  }
</style>
