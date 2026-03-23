<script lang="ts">
  import { tick } from 'svelte';
  import { get } from 'svelte/store';
  import ChatMessage from './ChatMessage.svelte';
  import ChatInput from './ChatInput.svelte';
  import ButlerAvatar from './ButlerAvatar.svelte';
  import { AIClient, loadConfig, extractSkillBlock } from '../ai/client';
  import { buildBusinessState, buildSystemPrompt } from '../ai/context';
  import { currentMember, parties, moneyEvents, chatMessages, aiMemories, identity, aiActions, getConnection } from '../db';
  import { persistMessage } from '../chatPersistence';
  import TransitionCard from '../components/TransitionCard.svelte';
  import { toast } from '../stores';
  import { formatBHDFull } from '../format';
  import type { ChatMessage as AIChatMessage } from '../ai/types';
  import { executeSkill } from '../skills/executor';
  import { getSkillByName } from '../skills/registry';
  import {
    conversations,
    activeConversationId,
    activeMessages,
    createConversation,
    switchConversation,
    deleteConversation,
    addMessage,
    updateLastMessage,
    updateApprovalStatus,
    ensureActiveConversation,
    relativeTime,
    type StoredMessage,
  } from './chatStore';

  // Display message: same as StoredMessage but timestamp is resolved to Date
  type DisplayMessage = Omit<StoredMessage, 'timestamp'> & { timestamp: Date };

  import { loadRecentMessages } from '../chatPersistence';

  // ── Bootstrap ────────────────────────────────────────────────────────────────
  ensureActiveConversation();

  // Track whether we've already loaded STDB history this session so we don't
  // re-import on every store update after the first successful load.
  let stdbHistoryLoaded = $state(false);

  // ── Local UI state ────────────────────────────────────────────────────────────
  let isThinking = $state(false);
  let messageListEl = $state<HTMLElement | null>(null);
  let sidebarOpen = $state(true);
  let hoveredConvId = $state<string | null>(null);
  let offlineBannerDismissed = $state(false);
  let briefingCollapsed = $state(false);
  type ProactiveBriefingPrefs = {
    enabled: boolean;
    snoozedUntil?: string;
  };

  // ── Offline / demo-mode detection ─────────────────────────────────────────────
  let isOffline = $derived(
    $parties.length === 0 && $moneyEvents.length === 0
  );

  // AI client
  let aiClient = $state(new AIClient(loadConfig()));

  // ── Derive messages from active conversation ──────────────────────────────────
  let messages = $derived(
    $activeMessages.map((m) => ({
      ...m,
      timestamp: new Date(m.timestamp),
    }))
  );

  // ── Living Briefing Card data ──────────────────────────────────────────────────
  // Computes key business facts from live STDB stores.

  // Total pipeline value and deal count
  let pipelineTotal = $derived(() => {
    if ($parties.length === 0) return null;
    return $parties.length;
  });

  // Today's date formatted
  let todayLabel = $derived(() => {
    const d = new Date();
    return d.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).toUpperCase();
  });

  // Overdue invoices: moneyEvents with kind='invoice' and status='overdue' or past due date
  let overdueEvents = $derived(
    $moneyEvents.filter((e: any) => e.status === 'overdue' || e.kind === 'overdue')
  );

  // Briefing action chips
  const BRIEFING_ACTIONS = [
    { label: 'Morning brief', prompt: 'Give me a morning briefing summary' },
    { label: 'Chase overdue', prompt: 'Chase overdue payments' },
    { label: 'Create quotation', prompt: 'Create a quotation' },
  ];

  const PROACTIVE_BRIEFING_KEY = 'asymmflow_proactive_briefing';
  const PROACTIVE_BRIEFING_PREFS_KEY = 'asymmflow_proactive_briefing_prefs';

  function loadProactiveBriefingPrefs(): ProactiveBriefingPrefs {
    try {
      const raw = localStorage.getItem(PROACTIVE_BRIEFING_PREFS_KEY);
      if (!raw) return { enabled: true };
      const parsed = JSON.parse(raw) as Partial<ProactiveBriefingPrefs>;
      return {
        enabled: parsed.enabled ?? true,
        snoozedUntil: parsed.snoozedUntil,
      };
    } catch {
      return { enabled: true };
    }
  }

  let proactiveBriefingPrefs = $state<ProactiveBriefingPrefs>(loadProactiveBriefingPrefs());

  function saveProactiveBriefingPrefs(): void {
    localStorage.setItem(PROACTIVE_BRIEFING_PREFS_KEY, JSON.stringify(proactiveBriefingPrefs));
  }

  function proactiveBriefingStorageKey(identityValue: unknown, date = new Date()): string {
    const day = date.toISOString().slice(0, 10);
    return `${PROACTIVE_BRIEFING_KEY}:${String(identityValue)}:${day}`;
  }

  function startOfDay(date = new Date()): string {
    return date.toISOString().slice(0, 10);
  }

  function addDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  let proactiveBriefingStatus = $derived.by(() => {
    if (!proactiveBriefingPrefs.enabled) return 'Disabled';
    if (proactiveBriefingPrefs.snoozedUntil && proactiveBriefingPrefs.snoozedUntil > startOfDay()) {
      return `Snoozed until ${proactiveBriefingPrefs.snoozedUntil}`;
    }
    return 'Active';
  });

  function buildProactiveBriefingContent() {
    const state = buildBusinessState();
    if (state.isMockData) return null;

    const lines = ['Daily proactive briefing from Butler:'];
    if (state.topOverdueCustomers.length > 0) {
      const lead = state.topOverdueCustomers[0];
      lines.push(
        `- Collections pressure: ${lead.name} leads overdue exposure at BHD ${lead.outstandingBHD} (${lead.overdueDays} days overdue).`
      );
    }
    if (state.openPipelineCount > 0) {
      lines.push(
        `- Commercial pipeline: ${state.openPipelineCount} open deals worth ${formatBHDFull(state.pipelineValueFils)}.`
      );
    }
    if (state.activeOrderCount > 0) {
      lines.push(`- Fulfilment pressure: ${state.activeOrderCount} active orders need operational follow-through.`);
    }
    lines.push('Suggested next asks: "Give me a morning briefing summary", "Chase overdue payments", or "Show order fulfilment risks".');
    return lines.join('\n');
  }

  function canIssueProactiveBriefing(): boolean {
    if (!proactiveBriefingPrefs.enabled) return false;
    if (!proactiveBriefingPrefs.snoozedUntil) return true;
    return proactiveBriefingPrefs.snoozedUntil <= startOfDay();
  }

  function issueProactiveBriefing(options?: { force?: boolean }): boolean {
    const currentIdentity = get(identity);
    if (!currentIdentity || isOffline) return false;
    if (!options?.force && !canIssueProactiveBriefing()) return false;

    const content = buildProactiveBriefingContent();
    if (!content) return false;

    const storageKey = proactiveBriefingStorageKey(currentIdentity);
    if (!options?.force && localStorage.getItem(storageKey)) return false;

    const proactiveMessage: StoredMessage = {
      id: uid(),
      role: 'assistant',
      content,
      timestamp: Date.now(),
    };

    addMessage(proactiveMessage);
    const conn = getConnection();
    if (conn) {
      void persistMessage(conn, proactiveMessage as AIChatMessage);
    }
    localStorage.setItem(storageKey, proactiveMessage.id);
    return true;
  }

  function toggleProactiveBriefings(): void {
    proactiveBriefingPrefs = {
      ...proactiveBriefingPrefs,
      enabled: !proactiveBriefingPrefs.enabled,
      snoozedUntil: !proactiveBriefingPrefs.enabled ? undefined : proactiveBriefingPrefs.snoozedUntil,
    };
    saveProactiveBriefingPrefs();
    toast.success(
      proactiveBriefingPrefs.enabled
        ? 'Daily Butler briefings enabled.'
        : 'Daily Butler briefings paused.'
    );
  }

  function snoozeProactiveBriefings(): void {
    const tomorrow = startOfDay(addDays(new Date(), 1));
    proactiveBriefingPrefs = {
      ...proactiveBriefingPrefs,
      enabled: true,
      snoozedUntil: tomorrow,
    };
    saveProactiveBriefingPrefs();
    toast.success(`Daily Butler briefing snoozed until ${tomorrow}.`);
  }

  function clearProactiveBriefingForToday(): void {
    const currentIdentity = get(identity);
    if (!currentIdentity) return;
    localStorage.removeItem(proactiveBriefingStorageKey(currentIdentity));
  }

  function rerunProactiveBriefing(): void {
    clearProactiveBriefingForToday();
    const issued = issueProactiveBriefing({ force: true });
    if (issued) {
      toast.success('Fresh Butler briefing added to the conversation.');
    } else {
      toast.warning('Unable to generate a proactive briefing right now.');
    }
  }

  function dismissProactiveBriefingToday(): void {
    const currentIdentity = get(identity);
    if (!currentIdentity) return;
    localStorage.setItem(proactiveBriefingStorageKey(currentIdentity), 'dismissed');
    toast.success("Today's proactive Butler briefing dismissed.");
  }

  // ── Auto-scroll ───────────────────────────────────────────────────────────────
  $effect(() => {
    const _ = messages.length;
    scrollToBottom();
  });

  // ── Load STDB conversation history on first connection ────────────────────────
  $effect(() => {
    const stdbMsgs = $chatMessages;
    const currentIdentity = $identity;
    if (stdbHistoryLoaded || stdbMsgs.length === 0 || !currentIdentity) return;
    stdbHistoryLoaded = true;

    const restored = loadRecentMessages(stdbMsgs, currentIdentity, 20);
    if (restored.length === 0) return;

    // Map ChatMessage → StoredMessage and prepend to active conversation
    for (const m of restored) {
      const storedMsg: StoredMessage = {
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        transitionRequest: m.transitionRequest,
        approval: m.approval
          ? {
              skillName: m.approval.skillName,
              params: m.approval.params ?? {},
              plan: m.approval.plan,
              actionId: m.approval.actionId,
              status: (
                m.approval.status === 'Proposed' ? 'pending' :
                m.approval.status === 'Approved' ? 'approved' : 'rejected'
              ) as 'pending' | 'approved' | 'rejected',
            }
          : undefined,
      };
      addMessage(storedMsg);
    }
  });

  $effect(() => {
    const currentIdentity = $identity;
    if (!stdbHistoryLoaded || !currentIdentity || isOffline) return;
    issueProactiveBriefing();
  });

  async function scrollToBottom() {
    await tick();
    if (messageListEl) {
      messageListEl.scrollTo({ top: messageListEl.scrollHeight, behavior: 'smooth' });
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function uid(): string {
    return Math.random().toString(36).slice(2, 9);
  }

  function hasApiKey(): boolean {
    return Boolean(loadConfig().apiKey);
  }

  function resolvePartyName(partyId: unknown): string {
    if (partyId == null) return 'Unknown';
    const id = Number(partyId);
    const found = get(parties).find((p) => Number(p.id) === id);
    return found?.name ?? `Party #${id}`;
  }

  function humanizeSkillParams(skillName: string, params: Record<string, unknown>): string {
    try {
      switch (skillName) {
        case 'create_invoice': {
          const customer = params.partyId != null
            ? resolvePartyName(params.partyId)
            : (params.customerName as string | undefined) ?? 'Unknown customer';
          const amountRaw = params.amountFils ?? params.amount;
          const amount = amountRaw != null
            ? formatBHDFull(BigInt(String(amountRaw)))
            : '(amount not specified)';
          const due = params.dueDate ?? params.due ?? '(no due date)';
          return `Create an invoice for ${customer} worth ${amount}, due ${due}`;
        }
        case 'generate_delivery_note': {
          const orderId = params.orderId ?? '(order not specified)';
          const deliveryAddress = params.deliveryAddress ?? '(address not specified)';
          let itemCount = 0;
          try {
            const parsed = typeof params.items === 'string' ? JSON.parse(params.items) : params.items;
            if (Array.isArray(parsed)) itemCount = parsed.length;
          } catch { itemCount = 0; }
          return `Create a delivery note for order #${orderId} to ${deliveryAddress} with ${itemCount} delivery line${itemCount === 1 ? '' : 's'}`;
        }
        case 'query_order_status': {
          const orderId = params.orderId ?? '(order not specified)';
          return `Check lifecycle status for order #${orderId}`;
        }
        case 'generate_purchase_order': {
          const supplier = params.supplierId != null
            ? resolvePartyName(params.supplierId)
            : 'Unknown supplier';
          const deliveryTerms = params.deliveryTerms ?? '(delivery terms not specified)';
          let itemCount = 0;
          try {
            const parsed = typeof params.items === 'string' ? JSON.parse(params.items) : params.items;
            if (Array.isArray(parsed)) itemCount = parsed.length;
          } catch { itemCount = 0; }
          return `Create a purchase order for ${supplier} with ${itemCount} line item${itemCount === 1 ? '' : 's'} and delivery terms "${deliveryTerms}"`;
        }
        case 'record_payment': {
          const customer = params.partyId != null
            ? resolvePartyName(params.partyId)
            : (params.customerName as string | undefined) ?? 'Unknown customer';
          const amountRaw = params.amountFils ?? params.amount;
          const amount = amountRaw != null
            ? formatBHDFull(BigInt(String(amountRaw)))
            : '(amount not specified)';
          const ref = params.reference ?? params.ref ?? '(no reference)';
          return `Record a payment of ${amount} from ${customer}, ref: ${ref}`;
        }
        case 'chase_payment': {
          if (params.partyId != null) {
            const customer = resolvePartyName(params.partyId);
            return `Send payment reminders to ${customer} for overdue invoices`;
          }
          return 'Send payment reminders to overdue customers';
        }
        case 'update_customer_grade': {
          const customer = params.partyId != null
            ? resolvePartyName(params.partyId)
            : (params.customerName as string | undefined) ?? 'Unknown customer';
          const oldGrade = params.oldGrade ?? params.from ?? '?';
          const newGrade = params.newGrade ?? params.to ?? params.grade ?? '?';
          return `Change ${customer} grade from ${oldGrade} to ${newGrade}`;
        }
        case 'generate_statement': {
          const customer = params.partyId != null
            ? resolvePartyName(params.partyId)
            : (params.customerName as string | undefined) ?? 'Unknown customer';
          return `Generate a statement of account for ${customer}`;
        }
        default: {
          const lines = Object.entries(params).map(([k, v]) => {
            const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
            if ((k === 'partyId' || k === 'customerId' || k === 'supplierId') && v != null) {
              return `${label}: ${resolvePartyName(v)}`;
            }
            if ((k.endsWith('Fils') || k.endsWith('Amount')) && v != null) {
              try { return `${label}: ${formatBHDFull(BigInt(String(v)))}`; } catch { /* fall through */ }
            }
            return `${label}: ${v ?? '(not specified)'}`;
          });
          return lines.join('\n') || '(no parameters)';
        }
      }
    } catch {
      return Object.entries(params).map(([k, v]) => `${k}: ${v}`).join('\n') || '(no parameters)';
    }
  }

  // ── Persistence helper ────────────────────────────────────────────────────────
  /**
   * Convert a StoredMessage to the ChatMessage shape that persistMessage expects
   * and fire-and-forget save it to STDB. Errors are swallowed by persistMessage.
   */
  function firePersist(msg: StoredMessage): void {
    const conn = getConnection();
    if (!conn) return;
    // Map StoredMessage.approval (pending/approved/rejected) → ChatMessage.approval
    const approvalForPersist = msg.approval
      ? {
          skillName: msg.approval.skillName,
          params: msg.approval.params,
          plan: msg.approval.plan ?? '',
          actionId: msg.approval.actionId,
          status: (
            msg.approval.status === 'pending' ? 'Proposed' :
            msg.approval.status === 'approved' ? 'Approved' : 'Rejected'
          ) as 'Proposed' | 'Approved' | 'Executed' | 'Rejected' | 'Failed',
        }
      : undefined;
    persistMessage(conn, {
      id: msg.id,
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp,
      approval: approvalForPersist,
      transitionRequest: msg.transitionRequest,
    });
  }

  // ── Send handler ──────────────────────────────────────────────────────────────
  async function waitForAiActionId(previousIds: Set<bigint>, timeoutMs = 4000): Promise<bigint> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const next = get(aiActions).find((row) => !previousIds.has(row.id));
      if (next) return next.id;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Timed out waiting for AI action audit record.');
  }

  async function proposeAiAction(skillName: string, plan: string): Promise<string | undefined> {
    const conn = getConnection();
    if (!conn) return undefined;

    const existingIds = new Set(get(aiActions).map((row) => row.id));
    await conn.reducers.proposeAiAction({ skillName, plan });
    const actionId = await waitForAiActionId(existingIds);
    return String(actionId);
  }

  async function handleSend(text: string) {
    const userMsg: StoredMessage = {
      id: uid(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    addMessage(userMsg);
    firePersist(userMsg);

    if (!hasApiKey()) {
      addMessage({
        id: uid(),
        role: 'assistant',
        content:
          "I'm not connected to an AI provider yet. Go to **Settings** and enter your AIMLAPI key to enable AI chat. In the meantime, you can explore the Dashboard, Sales, and Finance hubs from the sidebar!",
        timestamp: Date.now(),
      });
      return;
    }

    isThinking = true;

    try {
      const member = get(currentMember);
      const memories = get(aiMemories);
      let systemPrompt: string;
      if (member) {
        const state = buildBusinessState();
        systemPrompt = buildSystemPrompt(member, state, memories);
      } else {
        systemPrompt =
          'You are AsymmFlow Butler, an AI assistant for PH Trading WLL, Bahrain. Help the user with business queries about invoices, payments, pipeline, and operations.';
      }

      const aiMessages: AIChatMessage[] = $activeMessages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          timestamp: m.timestamp,
        }));

      const assistantId = uid();
      addMessage({
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      });

      isThinking = false;

      aiClient = new AIClient(loadConfig());

      let fullContent = '';
      for await (const chunk of aiClient.chatStream(aiMessages, systemPrompt)) {
        fullContent += chunk;
        updateLastMessage(assistantId, fullContent);
      }

      if (!fullContent.trim()) {
        updateLastMessage(assistantId, 'I received an empty response. Please try again.');
        return;
      }

      // Persist assistant message to STDB (fire-and-forget)
      firePersist({
        id: assistantId,
        role: 'assistant',
        content: fullContent,
        timestamp: Date.now(),
      });

      const { cleanContent, skillBlock } = extractSkillBlock(fullContent);

      if (cleanContent !== fullContent) {
        updateLastMessage(assistantId, cleanContent);
      }

      if (skillBlock) {
        const skillDef = getSkillByName(skillBlock.skill);
        const needsApproval = !skillDef || skillDef.approval !== 'auto';
        const plan = humanizeSkillParams(skillBlock.skill, skillBlock.params);

        if (needsApproval) {
          let actionId: string | undefined;
          try {
            actionId = await proposeAiAction(skillBlock.skill, plan);
          } catch (auditError) {
            const message = auditError instanceof Error ? auditError.message : String(auditError);
            addMessage({
              id: uid(),
              role: 'assistant',
              content: `I couldn't persist the approval request to the audit log: ${message}`,
              timestamp: Date.now(),
            });
          }

          const approvalId = uid();
          addMessage({
            id: approvalId,
            role: 'assistant',
            content: skillDef
              ? `I can run the **${skillDef.displayName}** skill for you. Review the parameters below and approve when ready.`
              : `I want to invoke the skill \`${skillBlock.skill}\`. Please review and approve.`,
            timestamp: Date.now(),
            approval: {
              skillName: skillBlock.skill,
              params: skillBlock.params,
              plan,
              actionId,
              status: 'pending',
            },
          });
        } else {
          await handleSkillExecution(skillBlock.skill, skillBlock.params);
        }
      }
    } catch (err) {
      isThinking = false;
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[chat] AI error:', errorMsg);

      addMessage({
        id: uid(),
        role: 'assistant',
        content: `I encountered an error: ${errorMsg}\n\nPlease check your AI configuration in Settings.`,
        timestamp: Date.now(),
      });

      toast.danger('AI request failed: ' + errorMsg.slice(0, 100));
    } finally {
      isThinking = false;
    }
  }

  // ── Skill execution ───────────────────────────────────────────────────────────
  async function handleSkillExecution(skillName: string, params: Record<string, unknown>) {
    const resultId = uid();
    const skillDef = getSkillByName(skillName);
    const label = skillDef?.displayName ?? skillName;

    addMessage({
      id: resultId,
      role: 'assistant',
      content: `Running **${label}**...`,
      timestamp: Date.now(),
    });

    try {
      const result = await executeSkill(skillName, params);
      const summaryText = result.success
        ? `**${label}** completed: ${result.summary}`
        : `**${label}** failed: ${result.error ?? result.summary}`;

      updateLastMessage(resultId, summaryText);

      if (result.success && result.data && typeof result.data === 'object') {
        addMessage({
          id: uid(),
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          skillResult: result.data as Record<string, unknown>,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateLastMessage(resultId, `**${label}** encountered an unexpected error: ${msg}`);
    }
  }

  async function handleApprove(msg: DisplayMessage) {
    if (!msg.approval || msg.approval.status !== 'pending') return;
    const conn = getConnection();
    if (msg.approval.actionId && conn) {
      await conn.reducers.resolveAiAction({
        actionId: BigInt(msg.approval.actionId),
        approve: true,
        result: `Approved in chat for ${msg.approval.skillName}`,
      });
    }
    updateApprovalStatus(msg.id, 'approved');
    await handleSkillExecution(msg.approval.skillName, msg.approval.params);
  }

  async function handleReject(msg: DisplayMessage) {
    if (!msg.approval || msg.approval.status !== 'pending') return;
    const conn = getConnection();
    if (msg.approval.actionId && conn) {
      await conn.reducers.resolveAiAction({
        actionId: BigInt(msg.approval.actionId),
        approve: false,
        result: `Rejected in chat for ${msg.approval.skillName}`,
      });
    }
    updateApprovalStatus(msg.id, 'rejected');
    addMessage({
      id: uid(),
      role: 'assistant',
      content: 'Skill execution cancelled.',
      timestamp: Date.now(),
    });
  }

  // ── TransitionCard handlers ───────────────────────────────────────────────────

  function updateTransitionStatus(
    msgId: string,
    status: 'Approved' | 'Rejected'
  ): void {
    // chatStore doesn't yet have an updateTransitionStatus export.
    // Use a local reactive override map — TransitionCard reads from it via
    // the override spread in the template. This is correct and reactive.
    transitionOverrides.set(msgId, status);
    // Trigger Svelte reactivity by replacing the Map reference
    transitionOverrides = new Map(transitionOverrides);
  }

  // Local override map: msgId → resolved transition status (Approved|Rejected)
  // Used until a proper chatStore.updateTransitionStatus is wired.
  let transitionOverrides = $state(new Map<string, 'Approved' | 'Rejected'>());

  async function handleTransitionConfirm(msg: DisplayMessage) {
    const req = msg.transitionRequest;
    if (!req || req.status !== 'Proposed') return;
    updateTransitionStatus(msg.id, 'Approved');
    await handleSkillExecution('update_pipeline_status', {
      pipelineId: req.pipelineId,
      newStatus: req.newStatus,
    });
  }

  function handleTransitionReject(msg: DisplayMessage) {
    const req = msg.transitionRequest;
    if (!req || req.status !== 'Proposed') return;
    updateTransitionStatus(msg.id, 'Rejected');
    addMessage({
      id: uid(),
      role: 'assistant',
      content: 'Status transition cancelled.',
      timestamp: Date.now(),
    });
  }

  // ── Sidebar actions ───────────────────────────────────────────────────────────
  function handleNewChat() { createConversation(); }
  function handleSwitchConversation(id: string) { switchConversation(id); }
  function handleDeleteConversation(e: MouseEvent, id: string) {
    e.stopPropagation();
    deleteConversation(id);
  }

  // ── Status line ───────────────────────────────────────────────────────────────
  let msgCount = $derived(messages.filter((m) => m.role !== 'system').length);
  let isConfigured = $derived(hasApiKey());
</script>

<div class="chat-workspace" role="main" aria-label="AsymmFlow Chat">
  <!-- ── Mobile sidebar backdrop ── -->
  {#if sidebarOpen}
    <div
      class="sidebar-backdrop"
      aria-hidden="true"
      onclick={() => (sidebarOpen = false)}
    ></div>
  {/if}

  <!-- ── Conversation Sidebar ── -->
  <aside
    class="conv-sidebar"
    class:collapsed={!sidebarOpen}
    aria-label="Conversation history"
  >
    <div class="sidebar-header">
      {#if sidebarOpen}
        <span class="sidebar-label">History</span>
      {/if}
      <button
        class="sidebar-toggle"
        title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        aria-label={sidebarOpen ? 'Collapse conversation sidebar' : 'Expand conversation sidebar'}
        onclick={() => (sidebarOpen = !sidebarOpen)}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          {#if sidebarOpen}
            <path d="M9 11L5 7l4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          {:else}
            <path d="M5 3l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          {/if}
        </svg>
      </button>
    </div>

    <!-- New chat button -->
    <button
      class="new-chat-btn"
      title="New chat"
      aria-label="Start a new conversation"
      onclick={handleNewChat}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
      </svg>
      {#if sidebarOpen}
        <span>New Chat</span>
      {/if}
    </button>

    <!-- Conversation list -->
    {#if sidebarOpen}
      <nav class="conv-list" aria-label="Past conversations">
        {#each $conversations as conv (conv.id)}
          {@const isActive = conv.id === $activeConversationId}
          <div
            class="conv-item"
            class:active={isActive}
            role="button"
            tabindex="0"
            title={conv.title}
            aria-label="Conversation: {conv.title}"
            aria-current={isActive ? 'true' : undefined}
            onclick={() => handleSwitchConversation(conv.id)}
            onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && handleSwitchConversation(conv.id)}
            onmouseenter={() => (hoveredConvId = conv.id)}
            onmouseleave={() => (hoveredConvId = null)}
          >
            <span class="conv-title">{conv.title}</span>
            <span class="conv-meta">
              <span class="conv-time">{relativeTime(conv.updatedAt)}</span>
              {#if hoveredConvId === conv.id || isActive}
                <button
                  class="conv-delete"
                  title="Delete conversation"
                  aria-label="Delete conversation: {conv.title}"
                  onclick={(e) => handleDeleteConversation(e, conv.id)}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                    <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  </svg>
                </button>
              {/if}
            </span>
          </div>
        {/each}

        {#if $conversations.length === 0}
          <p class="conv-empty">No conversations yet</p>
        {/if}
      </nav>
    {/if}
  </aside>

  <!-- ── Chat panel ── -->
  <div class="chat-page" aria-label="Chat area">

    <!-- ── Offline banner ── -->
    {#if isOffline && !offlineBannerDismissed}
      <div class="offline-banner" role="alert" aria-live="assertive">
        <span class="offline-banner-text">
          Demo Mode — Not connected to live database. Numbers shown are for demonstration only.
        </span>
        <button
          class="offline-banner-dismiss"
          aria-label="Dismiss offline warning"
          onclick={() => (offlineBannerDismissed = true)}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    {/if}

    <!-- ── Zone 1: Living Briefing Card ── -->
    <div class="briefing-card" class:collapsed={briefingCollapsed} aria-label="Business briefing">
      <div class="briefing-header">
        <div class="briefing-meta">
          <!-- Small vertical gold rule -->
          <span class="briefing-rule" aria-hidden="true"></span>
          <div class="briefing-meta-text">
            <span class="briefing-date">{todayLabel()}</span>
            <span class="briefing-org">PH TRADING</span>
          </div>
        </div>
        <div class="briefing-header-actions">
          <span class="briefing-status-pill" data-state={proactiveBriefingPrefs.enabled ? (proactiveBriefingPrefs.snoozedUntil && proactiveBriefingPrefs.snoozedUntil > startOfDay() ? 'snoozed' : 'active') : 'disabled'}>
            {proactiveBriefingStatus}
          </span>
        <button
          class="briefing-collapse-btn"
          aria-label={briefingCollapsed ? 'Expand briefing' : 'Collapse briefing'}
          onclick={() => (briefingCollapsed = !briefingCollapsed)}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            {#if briefingCollapsed}
              <!-- Chevron down -->
              <path d="M3 5l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            {:else}
              <!-- Chevron up -->
              <path d="M3 9l4-4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            {/if}
          </svg>
        </button>
        </div>
      </div>

      {#if !briefingCollapsed}
        <div class="briefing-body">
          <!-- Fact rows -->
          <div class="briefing-facts">
            {#if $parties.length > 0}
              <div class="briefing-fact">
                <span class="fact-label">Customers</span>
                <span class="fact-value">{$parties.length}</span>
              </div>
            {:else}
              <div class="briefing-fact briefing-fact-demo">
                <span class="fact-label">Demo Mode</span>
                <span class="fact-value fact-muted">No live data</span>
              </div>
            {/if}

            {#if $moneyEvents.length > 0}
              <div class="briefing-fact">
                <span class="fact-label">Transactions</span>
                <span class="fact-value">{$moneyEvents.length}</span>
              </div>
            {/if}

            {#if overdueEvents.length > 0}
              <div class="briefing-fact briefing-fact-warn">
                <span class="fact-label">Overdue</span>
                <span class="fact-value fact-coral">{overdueEvents.length} invoices</span>
              </div>
            {/if}

            {#if $parties.length === 0}
              <div class="briefing-fact">
                <span class="fact-label">Pipeline</span>
                <span class="fact-value fact-muted">Connect database</span>
              </div>
              <div class="briefing-fact">
                <span class="fact-label">Cash in</span>
                <span class="fact-value fact-muted">Connect database</span>
              </div>
            {/if}
          </div>

          <!-- Action chips -->
          <div class="briefing-actions">
            {#each BRIEFING_ACTIONS as action}
              <button
                class="briefing-action-chip"
                type="button"
                onclick={() => handleSend(action.prompt)}
                disabled={isThinking}
              >
                {action.label}
              </button>
            {/each}
          </div>

          <div class="briefing-controls">
            <button
              class="briefing-control-btn"
              type="button"
              onclick={toggleProactiveBriefings}
            >
              {proactiveBriefingPrefs.enabled ? 'Pause daily briefing' : 'Enable daily briefing'}
            </button>
            <button
              class="briefing-control-btn"
              type="button"
              onclick={snoozeProactiveBriefings}
              disabled={!proactiveBriefingPrefs.enabled}
            >
              Snooze until tomorrow
            </button>
            <button
              class="briefing-control-btn"
              type="button"
              onclick={rerunProactiveBriefing}
            >
              Re-run briefing now
            </button>
            <button
              class="briefing-control-btn briefing-control-btn-muted"
              type="button"
              onclick={dismissProactiveBriefingToday}
            >
              Dismiss today
            </button>
          </div>
        </div>
      {/if}
    </div>

    <!-- ── Zone 2: Message thread ── -->
    <div
      class="message-list"
      bind:this={messageListEl}
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label="Conversation"
    >
      <div class="message-list-inner">
        {#each messages as msg (msg.id)}
          <ChatMessage
            role={msg.role}
            content={msg.content}
            timestamp={msg.timestamp}
            approval={msg.approval
              ? {
                  skillName: msg.approval.skillName,
                  plan:
                    msg.approval.plan ??
                    humanizeSkillParams(msg.approval.skillName, msg.approval.params),
                  status: msg.approval.status === 'pending'
                    ? 'Proposed'
                    : msg.approval.status === 'approved'
                    ? 'Approved'
                    : 'Rejected',
                  onApprove: msg.approval.status === 'pending'
                    ? () => handleApprove(msg)
                    : undefined,
                  onReject: msg.approval.status === 'pending'
                    ? () => handleReject(msg)
                    : undefined,
                }
              : undefined}
            skillProgress={msg.skillProgress}
            skillResult={msg.skillResult}
          />
          {#if msg.transitionRequest}
            {@const override = transitionOverrides.get(msg.id)}
            <TransitionCard
              request={{
                ...msg.transitionRequest,
                status: override ?? msg.transitionRequest.status,
              }}
              onconfirm={() => handleTransitionConfirm(msg)}
              onreject={() => handleTransitionReject(msg)}
            />
          {/if}
        {/each}

        <!-- Thinking indicator -->
        {#if isThinking}
          <div class="thinking-row" aria-label="Butler is thinking" role="status">
            <ButlerAvatar size="sm" speaking={true} />
            <div class="thinking-bubble">
              <span class="typing-dots">
                <span></span><span></span><span></span>
              </span>
            </div>
          </div>
        {/if}

        <div class="scroll-anchor" aria-hidden="true"></div>
      </div>
    </div>

    <!-- ── Zone 3: Input bar ── -->
    <ChatInput
      onSend={handleSend}
      disabled={isThinking}
      placeholder={isThinking ? 'Butler is thinking...' : 'Ask your Butler anything...'}
    />
  </div>
</div>

<style>
  /* ── Workspace: sidebar + chat side by side ── */
  .chat-workspace {
    display: flex;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  /* ── Conversation Sidebar ── */
  .conv-sidebar {
    display: flex;
    flex-direction: column;
    width: 220px;
    flex-shrink: 0;
    background: var(--paper-elevated);
    border-right: 1px solid var(--ink-06);
    transition: width var(--dur-fast) var(--ease-out);
    overflow: hidden;
    box-shadow: 3px 0 8px rgba(170, 160, 142, 0.12);
  }

  .conv-sidebar.collapsed { width: 44px; }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-13) var(--sp-8) var(--sp-8) var(--sp-13);
    flex-shrink: 0;
    min-height: 44px;
  }

  .conv-sidebar.collapsed .sidebar-header {
    justify-content: center;
    padding: var(--sp-13) var(--sp-8);
  }

  .sidebar-label {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--ink-30);
    white-space: nowrap;
    overflow: hidden;
  }

  .sidebar-toggle {
    width: 26px;
    height: 26px;
    border: none;
    background: var(--paper-card);
    box-shadow: var(--shadow-neu-btn);
    color: var(--ink-40);
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition:
      box-shadow var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .sidebar-toggle:hover {
    color: var(--ink);
    box-shadow:
      -2px -2px 5px rgba(253, 251, 247, 0.7),
      2px 2px 5px rgba(170, 160, 142, 0.3);
  }

  .sidebar-toggle:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }

  /* New Chat button */
  .new-chat-btn {
    display: flex;
    align-items: center;
    gap: var(--sp-8);
    margin: 0 var(--sp-8) var(--sp-8);
    padding: var(--sp-5) var(--sp-13);
    border: none;
    border-radius: var(--radius-sm);
    background: var(--paper-card);
    box-shadow: var(--shadow-neu-btn);
    color: var(--ink-40);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 400;
    cursor: pointer;
    transition:
      box-shadow var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      transform var(--dur-instant) var(--ease-out);
    white-space: nowrap;
    overflow: hidden;
  }

  .conv-sidebar.collapsed .new-chat-btn {
    justify-content: center;
    padding: var(--sp-8);
    margin: 0 var(--sp-8) var(--sp-8);
  }

  .new-chat-btn:hover {
    color: var(--gold);
    box-shadow:
      -3px -3px 6px rgba(253, 251, 247, 0.7),
      3px 3px 6px rgba(170, 160, 142, 0.28);
  }

  .new-chat-btn:active {
    box-shadow: var(--shadow-neu-inset);
    transform: scale(0.97);
  }

  .new-chat-btn:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }

  /* Conversation list */
  .conv-list {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 var(--sp-4) var(--sp-8);
    scrollbar-width: thin;
    scrollbar-color: var(--ink-12) transparent;
  }

  .conv-item {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--sp-8) var(--sp-8) var(--sp-8) var(--sp-13);
    border-left: 2px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    cursor: pointer;
    text-align: left;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
    min-width: 0;
    position: relative;
    box-sizing: border-box;
  }

  .conv-item:hover  { background: var(--ink-03); }

  .conv-item.active {
    background: var(--gold-glow);
    border-left-color: var(--gold);
  }

  .conv-item:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: -2px;
  }

  .conv-title {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: block;
    max-width: 100%;
  }

  .conv-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-4);
    min-height: 14px;
  }

  .conv-time {
    font-family: var(--font-ui);
    font-size: 10px;
    color: var(--ink-30);
    white-space: nowrap;
    overflow: hidden;
  }

  .conv-delete {
    width: 18px;
    height: 18px;
    border: none;
    background: transparent;
    color: var(--ink-30);
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    padding: 0;
    transition: color var(--dur-fast) var(--ease-out);
  }

  .conv-delete:hover { color: var(--coral); }

  .conv-delete:focus-visible {
    outline: 2px solid var(--coral);
    outline-offset: 2px;
  }

  .conv-empty {
    font-family: var(--font-ui);
    font-size: 10px;
    color: var(--ink-30);
    text-align: center;
    padding: var(--sp-21) var(--sp-13);
    margin: 0;
    letter-spacing: 0.05em;
  }

  /* ── Chat panel ── */
  .chat-page {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
    background: var(--paper);
    position: relative;
  }

  /* ── Zone 1: Living Briefing Card ── */
  .briefing-card {
    flex-shrink: 0;
    margin: var(--sp-13) var(--sp-21) 0;
    background: var(--paper-card);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-neu-raised);
    overflow: hidden;
    transition: box-shadow var(--dur-fast) var(--ease-out);
  }

  .briefing-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-8) var(--sp-13);
    border-bottom: 1px solid var(--ink-06);
  }

  .briefing-header-actions {
    display: flex;
    align-items: center;
    gap: var(--sp-8);
  }

  /* No bottom border when collapsed */
  .briefing-card.collapsed .briefing-header {
    border-bottom-color: transparent;
  }

  .briefing-meta {
    display: flex;
    align-items: center;
    gap: var(--sp-8);
  }

  /* Vertical gold rule */
  .briefing-rule {
    display: block;
    width: 2px;
    height: 28px;
    background: var(--gold);
    border-radius: 1px;
    opacity: 0.6;
    flex-shrink: 0;
  }

  .briefing-meta-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .briefing-date {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.12em;
    color: var(--ink);
  }

  .briefing-org {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 400;
    letter-spacing: 0.15em;
    color: var(--ink-40);
  }

  .briefing-status-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 24px;
    padding: 0 var(--sp-8);
    border-radius: 999px;
    background: rgba(134, 160, 119, 0.14);
    color: #55724b;
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .briefing-status-pill[data-state='snoozed'] {
    background: rgba(198, 146, 65, 0.14);
    color: #8b6221;
  }

  .briefing-status-pill[data-state='disabled'] {
    background: rgba(104, 94, 82, 0.1);
    color: var(--ink-45);
  }

  .briefing-collapse-btn {
    width: 24px;
    height: 24px;
    border: none;
    background: transparent;
    color: var(--ink-30);
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: color var(--dur-fast) var(--ease-out);
    flex-shrink: 0;
  }

  .briefing-collapse-btn:hover  { color: var(--ink); }

  .briefing-collapse-btn:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }

  .briefing-body {
    padding: var(--sp-8) var(--sp-13) var(--sp-13);
    display: flex;
    flex-direction: column;
    gap: var(--sp-8);
  }

  /* Fact grid — horizontal row of key facts */
  .briefing-facts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-5) var(--sp-21);
  }

  .briefing-fact {
    display: flex;
    align-items: baseline;
    gap: var(--sp-5);
  }

  .fact-label {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-40);
    white-space: nowrap;
  }

  .fact-value {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--ink);
    white-space: nowrap;
  }

  .fact-muted { color: var(--ink-30); font-weight: 400; }
  .fact-coral { color: var(--coral); }

  .briefing-fact-warn .fact-label { color: var(--coral); opacity: 0.7; }

  /* Briefing action chips */
  .briefing-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-5);
  }

  .briefing-controls {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-5);
    padding-top: var(--sp-5);
    border-top: 1px solid rgba(91, 74, 58, 0.08);
  }

  .briefing-action-chip {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-60);
    background: var(--paper-card);
    border: none;
    border-radius: var(--radius-sm);
    padding: var(--sp-4) var(--sp-13);
    cursor: pointer;
    box-shadow: var(--shadow-neu-btn);
    transition:
      color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out),
      transform var(--dur-instant) var(--ease-out);
    white-space: nowrap;
  }

  .briefing-action-chip:hover:not(:disabled) {
    color: var(--gold);
    box-shadow:
      -3px -3px 6px rgba(253, 251, 247, 0.7),
      3px 3px 6px rgba(170, 160, 142, 0.28);
    transform: translateY(-1px);
  }

  .briefing-action-chip:active:not(:disabled) {
    box-shadow: var(--shadow-neu-inset);
    transform: scale(0.97);
  }

  .briefing-action-chip:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }

  .briefing-action-chip:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .briefing-control-btn {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-55);
    background: rgba(255, 255, 255, 0.55);
    border: 1px solid rgba(91, 74, 58, 0.1);
    border-radius: 999px;
    padding: var(--sp-4) var(--sp-10);
    cursor: pointer;
    transition:
      color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out),
      transform var(--dur-instant) var(--ease-out);
  }

  .briefing-control-btn:hover:not(:disabled) {
    color: var(--ink);
    border-color: rgba(198, 146, 65, 0.28);
    background: rgba(255, 250, 242, 0.92);
    transform: translateY(-1px);
  }

  .briefing-control-btn:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }

  .briefing-control-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    transform: none;
  }

  .briefing-control-btn-muted {
    color: var(--ink-40);
  }

  /* ── Zone 2: Message list ── */
  .message-list {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
    scroll-behavior: smooth;
    scrollbar-width: thin;
    scrollbar-color: var(--ink-12) transparent;
  }

  .message-list-inner {
    display: flex;
    flex-direction: column;
    gap: var(--sp-13);
    padding: var(--sp-16) var(--sp-21) var(--sp-8);
    max-width: 840px;
    margin: 0 auto;
    width: 100%;
  }

  /* ── Thinking indicator ── */
  .thinking-row {
    display: flex;
    align-items: flex-end;
    gap: var(--sp-8);
    animation: slide-up var(--dur-normal) var(--ease-out) both;
  }

  .thinking-bubble {
    background: var(--paper-card);
    box-shadow: var(--shadow-neu-raised);
    border-left: 2px solid var(--gold);
    border-radius: var(--radius-md) var(--radius-md) var(--radius-md) var(--radius-sm);
    padding: var(--sp-13) var(--sp-16);
    display: flex;
    align-items: center;
  }

  /* ── Typing dots ── */
  :global(.typing-dots) {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }

  :global(.typing-dots span) {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--gold);
    animation: dot-bounce 1.2s var(--ease-smooth) infinite;
    display: inline-block;
  }

  :global(.typing-dots span:nth-child(2)) { animation-delay: 0.2s; }
  :global(.typing-dots span:nth-child(3)) { animation-delay: 0.4s; }

  @keyframes dot-bounce {
    0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
    40%           { transform: translateY(-5px); opacity: 1; }
  }

  @keyframes slide-up {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .scroll-anchor {
    height: 1px;
    width: 100%;
    flex-shrink: 0;
  }

  /* ── Offline banner ── */
  .offline-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-8);
    padding: var(--sp-5) var(--sp-13);
    background: var(--coral-soft);
    border-bottom: 1px solid rgba(196, 121, 107, 0.2);
    flex-shrink: 0;
    z-index: var(--z-sticky);
  }

  .offline-banner-text {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.05em;
    color: var(--coral);
    flex: 1;
    min-width: 0;
  }

  .offline-banner-dismiss {
    width: 22px;
    height: 22px;
    border: none;
    background: transparent;
    color: var(--coral);
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    opacity: 0.6;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .offline-banner-dismiss:hover    { opacity: 1; }

  .offline-banner-dismiss:focus-visible {
    outline: 2px solid var(--coral);
    outline-offset: 2px;
  }

  /* ── Mobile sidebar backdrop ── */
  .sidebar-backdrop { display: none; }

  @media (max-width: 640px) {
    .conv-sidebar { width: 44px; }

    .conv-sidebar:not(.collapsed) {
      position: absolute;
      top: 0;
      left: 0;
      bottom: 0;
      width: 220px;
      z-index: var(--z-overlay, 100);
      box-shadow: var(--shadow-neu-raised);
    }

    .sidebar-backdrop {
      display: block;
      position: fixed;
      inset: 0;
      background: rgba(42, 39, 34, 0.2);
      z-index: calc(var(--z-overlay, 100) - 1);
    }

    .briefing-card {
      margin: var(--sp-8) var(--sp-13) 0;
    }

    .message-list-inner {
      padding: var(--sp-13) var(--sp-13) var(--sp-8);
    }
  }
</style>
