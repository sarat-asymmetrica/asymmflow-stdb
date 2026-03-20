/**
 * chatPersistence.ts — STDB-backed chat history helpers
 *
 * Two responsibilities:
 *   1. persistMessage  — fire-and-forget save after every message
 *   2. loadRecentMessages — reconstruct history from STDB on session start
 *
 * Neither function is on the hot path for latency: persistence is
 * best-effort (failures are logged, not thrown) and history loading
 * runs once at startup.
 */

import type { ChatMessage } from './ai/types';

// ── Save ──────────────────────────────────────────────────────────────────────

/**
 * Persist a single chat message to STDB via the `save_chat_message` reducer.
 *
 * Designed to be non-blocking: the chat UI should not await this call on the
 * critical render path. Any failure is swallowed and logged as a warning so
 * that a transient STDB hiccup never breaks the conversation.
 *
 * @param conn   Live SpacetimeDB connection (from `useConnection()` or context).
 * @param msg    The ChatMessage to persist.
 */
export async function persistMessage(conn: any, msg: ChatMessage): Promise<void> {
  try {
    await conn.reducers.save_chat_message({
      role: msg.role,
      content: msg.content,
      skillRequest: msg.approval
        ? JSON.stringify({
            skillName: msg.approval.skillName,
            plan: msg.approval.plan,
            status: msg.approval.status,
          })
        : '',
      approvalStatus: msg.approval?.status ?? '',
      transitionRequest: msg.transitionRequest
        ? JSON.stringify(msg.transitionRequest)
        : '',
      // pipelineContext kept as an empty JSON array for now;
      // a future sprint may serialise the active pipeline list here.
      pipelineContext: '[]',
    });
  } catch (e) {
    console.warn('[chatPersistence] Failed to save message:', e);
  }
}

// ── Load ──────────────────────────────────────────────────────────────────────

/**
 * Reconstruct recent chat history from the STDB `chat_messages` table.
 *
 * Filters to the current member's messages, sorts by `createdAt` ascending,
 * and returns the trailing `limit` entries as `ChatMessage` objects ready for
 * the UI store.
 *
 * @param chatMessages    The live STDB table rows (passed in from the store so
 *                        this helper stays pure and testable).
 * @param currentIdentity The caller's SpacetimeDB identity (stringified for
 *                        comparison since STDB identity objects vary by SDK).
 * @param limit           Maximum messages to return (default: 20). Keeps the
 *                        initial render fast; older history is available via
 *                        future infinite-scroll work.
 */
export function loadRecentMessages(
  chatMessages: any[],
  currentIdentity: any,
  limit: number = 20,
): ChatMessage[] {
  const myMessages = chatMessages
    .filter((m: any) => String(m.memberId) === String(currentIdentity))
    // createdAt is a STDB Timestamp object — Number() extracts the ms value.
    .sort((a: any, b: any) => Number(a.createdAt) - Number(b.createdAt))
    .slice(-limit);

  return myMessages.map((m: any): ChatMessage => ({
    id: `stdb-${m.id}`,
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
    timestamp: Number(m.createdAt),

    approval: m.skillRequest
      ? (() => {
          try {
            const parsed = JSON.parse(m.skillRequest);
            // Guard: only attach if the parsed object looks like approval metadata.
            return parsed.skillName ? parsed : undefined;
          } catch {
            return undefined;
          }
        })()
      : undefined,

    transitionRequest: m.transitionRequest
      ? (() => {
          try {
            return JSON.parse(m.transitionRequest);
          } catch {
            return undefined;
          }
        })()
      : undefined,
  }));
}
