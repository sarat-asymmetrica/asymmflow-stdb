import { writable, derived, get } from 'svelte/store';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StoredMessageApproval {
  skillName: string;
  params: Record<string, unknown>;
  plan?: string;
  actionId?: string;
  status: 'pending' | 'approved' | 'rejected';
}

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number; // unix ms — serializable
  /** Present when this message carries a skill approval card. */
  approval?: StoredMessageApproval;
  /** Skill progress steps (runtime-only, not persisted meaningfully). */
  skillProgress?: { skillName: string; steps: Array<{ label: string; status: string }> };
  /** Structured data rendered alongside the bubble. */
  skillResult?: Record<string, unknown>;
  /**
   * Present on assistant messages that proposed a pipeline status transition.
   * Consumed by TransitionCard to render the approval widget.
   */
  transitionRequest?: {
    pipelineId: string;
    pipelineName: string;
    customerName: string;
    amountBhd: string;
    oldStatus: string;
    newStatus: string;
    signedBy: string;
    status: 'Proposed' | 'Approved' | 'Rejected';
  };
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: StoredMessage[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const LS_KEY = 'asymmflow_conversations';
const LS_ACTIVE_KEY = 'asymmflow_active_conversation';
const MAX_CONVERSATIONS = 50; // prune oldest beyond this

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadFromStorage(): Conversation[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Conversation[];
  } catch {
    return [];
  }
}

function saveToStorage(convs: Conversation[]): void {
  try {
    // Keep only the most-recent MAX_CONVERSATIONS
    const pruned = [...convs]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_CONVERSATIONS);
    localStorage.setItem(LS_KEY, JSON.stringify(pruned));
  } catch {
    // localStorage full — silently ignore
  }
}

function loadActiveId(): string | null {
  try {
    return localStorage.getItem(LS_ACTIVE_KEY);
  } catch {
    return null;
  }
}

function saveActiveId(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem(LS_ACTIVE_KEY, id);
    } else {
      localStorage.removeItem(LS_ACTIVE_KEY);
    }
  } catch {
    // ignore
  }
}

function generateTitle(firstUserMessage: string): string {
  const cleaned = firstUserMessage.trim().replace(/\s+/g, ' ');
  return cleaned.length <= 50 ? cleaned : cleaned.slice(0, 47) + '...';
}

function makeWelcomeMessage(): StoredMessage {
  return {
    id: 'welcome',
    role: 'assistant',
    content:
      "Good morning! I'm your Business Butler — here to help you manage invoices, customers, and deals.\n\nHere are some things I can help with:\n- **Check overdue invoices** and who owes you money\n- **Create a quotation** for a customer\n- **Chase payments** with WhatsApp-ready messages\n- **Analyze your sales pipeline** and follow-ups\n- **Generate statements** of account\n\nJust type your question below, or try one of the suggested prompts!",
    timestamp: Date.now(),
  };
}

// ── Store initialisation ──────────────────────────────────────────────────────

const _conversations = writable<Conversation[]>(loadFromStorage());
const _activeId = writable<string | null>(loadActiveId());

// Persist whenever either store changes
_conversations.subscribe((convs) => saveToStorage(convs));
_activeId.subscribe((id) => saveActiveId(id));

// ── Public derived values ─────────────────────────────────────────────────────

/** All conversations sorted newest-first */
export const conversations = derived(_conversations, ($c) =>
  [...$c].sort((a, b) => b.updatedAt - a.updatedAt)
);

/** The currently active conversation object (or null) */
export const activeConversation = derived(
  [_conversations, _activeId],
  ([$convs, $id]) => $convs.find((c) => c.id === $id) ?? null
);

/** Messages for the active conversation, restored as Date objects */
export const activeMessages = derived(activeConversation, ($conv) => {
  if (!$conv) return [makeWelcomeMessage()];
  return $conv.messages;
});

/** The active conversation id */
export const activeConversationId = derived(_activeId, ($id) => $id);

// ── Actions ───────────────────────────────────────────────────────────────────

/**
 * Create a brand-new conversation and make it active.
 * Returns the new conversation id.
 */
export function createConversation(): string {
  const id = crypto.randomUUID();
  const now = Date.now();
  const conv: Conversation = {
    id,
    title: 'New chat',
    createdAt: now,
    updatedAt: now,
    messages: [makeWelcomeMessage()],
  };

  _conversations.update((convs) => [conv, ...convs]);
  _activeId.set(id);
  return id;
}

/**
 * Switch to an existing conversation by id.
 */
export function switchConversation(id: string): void {
  const convs = get(_conversations);
  if (convs.find((c) => c.id === id)) {
    _activeId.set(id);
  }
}

/**
 * Delete a conversation. If it was active, switch to the next one or create a new one.
 */
export function deleteConversation(id: string): void {
  _conversations.update((convs) => convs.filter((c) => c.id !== id));

  const activeId = get(_activeId);
  if (activeId === id) {
    const remaining = get(_conversations);
    if (remaining.length > 0) {
      const sorted = [...remaining].sort((a, b) => b.updatedAt - a.updatedAt);
      _activeId.set(sorted[0].id);
    } else {
      // No conversations left — create a fresh one
      createConversation();
    }
  }
}

/**
 * Add a message to the active conversation.
 * Automatically sets the conversation title from the first user message.
 * If no active conversation exists, creates one first.
 */
export function addMessage(msg: StoredMessage): void {
  let activeId = get(_activeId);

  if (!activeId) {
    activeId = createConversation();
  }

  _conversations.update((convs) => {
    return convs.map((conv) => {
      if (conv.id !== activeId) return conv;

      const updatedMessages = [...conv.messages, msg];

      // Auto-title: use first user message if still "New chat"
      let title = conv.title;
      if (title === 'New chat' && msg.role === 'user') {
        title = generateTitle(msg.content);
      }

      return {
        ...conv,
        title,
        updatedAt: Date.now(),
        messages: updatedMessages,
      };
    });
  });
}

/**
 * Update the approval status on a specific message.
 * Used when the user clicks Approve or Reject on a skill card.
 */
export function updateApprovalStatus(
  id: string,
  status: 'approved' | 'rejected'
): void {
  const activeId = get(_activeId);
  if (!activeId) return;

  _conversations.update((convs) =>
    convs.map((conv) => {
      if (conv.id !== activeId) return conv;
      const msgs = conv.messages.map((m) => {
        if (m.id !== id || !m.approval) return m;
        return { ...m, approval: { ...m.approval, status } };
      });
      return { ...conv, messages: msgs, updatedAt: Date.now() };
    })
  );
}

/**
 * Replace the last message in the active conversation (used for streaming updates).
 */
export function updateLastMessage(id: string, content: string): void {
  const activeId = get(_activeId);
  if (!activeId) return;

  _conversations.update((convs) => {
    return convs.map((conv) => {
      if (conv.id !== activeId) return conv;
      const msgs = conv.messages.map((m) =>
        m.id === id ? { ...m, content } : m
      );
      return { ...conv, messages: msgs, updatedAt: Date.now() };
    });
  });
}

/**
 * Ensure there is at least one conversation and an active id on app boot.
 * Call this once when the chat page mounts.
 */
export function ensureActiveConversation(): void {
  const convs = get(_conversations);
  const activeId = get(_activeId);

  if (convs.length === 0) {
    createConversation();
    return;
  }

  // Validate that the stored activeId still exists
  if (!activeId || !convs.find((c) => c.id === activeId)) {
    const sorted = [...convs].sort((a, b) => b.updatedAt - a.updatedAt);
    _activeId.set(sorted[0].id);
  }
}

// ── Relative time helper (exported for sidebar) ───────────────────────────────

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
