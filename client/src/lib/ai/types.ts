/**
 * AsymmFlow AI — Core Type Definitions
 *
 * Shared interfaces for the chat history, AI provider configuration,
 * and the structured response contract the AI client returns to the chat UI.
 */

import type { SkillStep } from '../skills/types';

// ── Chat history ──────────────────────────────────────────────────────────────

/**
 * A single message in the conversation thread.
 *
 * In addition to the standard role/content fields, messages may carry
 * approval metadata (when the AI has proposed a skill execution that
 * awaits user confirmation) or live progress metadata (while a skill runs).
 */
export interface ChatMessage {
  /** Stable, unique identifier — use `crypto.randomUUID()` when creating. */
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** Unix timestamp in milliseconds. */
  timestamp: number;

  /**
   * Present on assistant messages that proposed a skill execution.
   * The chat UI renders an approve/reject widget based on this field.
   */
  approval?: {
    /** Machine name of the skill being proposed. */
    skillName: string;
    /**
     * Human-readable description of what the skill will do,
     * shown in the approval card before the user clicks "Approve".
     */
    plan: string;
    status: 'Proposed' | 'Approved' | 'Executed' | 'Rejected' | 'Failed';
  };

  /**
   * Present on assistant messages that are actively running a skill.
   * Updated in-place as steps complete so the UI shows a live progress list.
   */
  skillProgress?: {
    skillName: string;
    steps: SkillStep[];
  };

  /**
   * Structured result data from a completed skill execution.
   * Rendered by ChatMessage as a rich card below the text bubble.
   * For chase_payment this may include a `messages` array of draft texts.
   */
  skillResult?: Record<string, unknown>;

  /**
   * Present on assistant messages that proposed a pipeline status transition.
   * Populated by the transition_pipeline skill and consumed by the approval UI.
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

// ── Provider configuration ────────────────────────────────────────────────────

/**
 * Supported AI provider identifiers.
 *
 * - `grok`   — Grok models via AIMLAPI (OpenAI-compatible, streaming).
 * - `sarvam` — Sarvam-M / Gemma models via api.sarvam.ai.
 * - `claude` — Anthropic Claude via AIMLAPI proxy.
 */
export type AIProvider = 'grok' | 'sarvam' | 'claude';

/**
 * Runtime configuration for the AI client.
 * Stored in `localStorage` under the key `asymmflow_ai_config`
 * and editable from the Settings page.
 */
export interface AIConfig {
  provider: AIProvider;
  /** Model identifier, e.g. "grok-3-fast", "sarvam-m", "claude-sonnet-4-5". */
  model: string;
  /** API key — never committed, only lives in localStorage. */
  apiKey: string;
  /** Base URL without trailing slash, e.g. "https://api.aimlapi.com". */
  baseUrl: string;
  /** Maximum tokens in the completion response. */
  maxTokens: number;
  /** Sampling temperature (0.0–2.0). */
  temperature: number;
}

// ── AI response contract ──────────────────────────────────────────────────────

/**
 * Parsed response from the AI client.
 *
 * When the model wants to invoke a skill it embeds a JSON block in its reply:
 *
 * ```
 * {"skill":"create_invoice","params":{"customerId":42,"orderId":7}}
 * ```
 *
 * The client extracts this into `skillRequest` so the chat UI can render
 * the approval widget without the user seeing raw JSON.
 */
export interface AIResponse {
  /**
   * The text content of the reply, with the embedded JSON block stripped out
   * (if one was present) so the chat bubble shows clean prose.
   */
  content: string;

  /**
   * Populated when the model's reply contained a valid skill invocation block.
   * The UI should render an approval card referencing this field.
   */
  skillRequest?: {
    /** Must match a key in the SKILLS registry. */
    skillName: string;
    /** Parameter map keyed by `SkillParameter.name`. */
    parameters: Record<string, unknown>;
  };
}

// ── Streaming ─────────────────────────────────────────────────────────────────

/**
 * A single SSE chunk delta from a streaming completion.
 * Follows the OpenAI stream delta shape.
 */
export interface StreamDelta {
  /** Incremental text fragment to append to the in-progress bubble. */
  content: string;
  /** True when this is the final chunk (finish_reason is set). */
  done: boolean;
}
