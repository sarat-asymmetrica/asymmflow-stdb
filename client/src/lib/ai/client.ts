/**
 * AsymmFlow AI — Client
 *
 * Thin wrapper around AIMLAPI (OpenAI-compatible endpoint) that supports
 * both single-shot and streaming chat completions.
 *
 * Provider matrix:
 *   grok    → https://api.aimlapi.com  /v1/chat/completions   (x-ai/grok-4-fast-non-reasoning)
 *   claude  → https://api.aimlapi.com  /v1/chat/completions   (claude-sonnet-4-5)
 *   sarvam  → https://api.sarvam.ai   /v1/chat/completions   (sarvam-m)
 *             Note: Sarvam uses header `api-subscription-key` not `Authorization`.
 *
 * Streaming uses the standard SSE format:
 *   data: {"id":"...","choices":[{"delta":{"content":"..."}}],...}
 *   data: [DONE]
 *
 * Skill extraction:
 *   After a non-streaming completion, the client scans the content for a bare
 *   JSON object matching {"skill":"...","params":{...}} and returns it in
 *   AIResponse.skillRequest, stripping the block from the visible content.
 */

import type { AIConfig, AIProvider, AIResponse, ChatMessage } from './types';

// ── Default configuration ─────────────────────────────────────────────────────

const AIMLAPI_BASE = 'https://api.aimlapi.com';
const SARVAM_BASE  = 'https://api.sarvam.ai';

const PROVIDER_DEFAULTS: Record<AIProvider, Omit<AIConfig, 'apiKey'>> = {
  grok: {
    provider: 'grok',
    model: 'x-ai/grok-4-fast-non-reasoning',
    baseUrl: AIMLAPI_BASE,
    maxTokens: 4096,
    temperature: 0.3,
  },
  claude: {
    provider: 'claude',
    model: 'claude-sonnet-4-5',
    baseUrl: AIMLAPI_BASE,
    maxTokens: 4096,
    temperature: 0.3,
  },
  sarvam: {
    provider: 'sarvam',
    model: 'sarvam-m',
    baseUrl: SARVAM_BASE,
    maxTokens: 4096,
    temperature: 0.3,
  },
};

const STORAGE_KEY = 'asymmflow_ai_config';

/**
 * Returns sensible defaults for the Grok provider via AIMLAPI.
 * The caller must supply `apiKey` before making real requests.
 */
export function createDefaultConfig(): AIConfig {
  return {
    ...PROVIDER_DEFAULTS.grok,
    apiKey: '',
  };
}

/**
 * Load the persisted config from localStorage, merged over defaults.
 * Returns the default config when nothing is stored yet.
 */
export function loadConfig(): AIConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultConfig();
    const parsed = JSON.parse(raw) as Partial<AIConfig>;
    return { ...createDefaultConfig(), ...parsed };
  } catch {
    return createDefaultConfig();
  }
}

/**
 * Persist the config to localStorage.
 * Call this whenever the user saves their Settings page.
 */
export function saveConfig(config: AIConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

// ── Error types ───────────────────────────────────────────────────────────────

export class AIClientError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'AIClientError';
  }
}

// ── Skill block extraction ────────────────────────────────────────────────────

interface SkillBlock {
  skill: string;
  params: Record<string, unknown>;
}

/**
 * Scan `content` for a bare JSON object with `skill` and `params` keys.
 * Returns the parsed block and the cleaned content (block removed) when found.
 * Returns null for skillBlock when no invocation is present.
 */
function extractSkillBlock(content: string): {
  cleanContent: string;
  skillBlock: SkillBlock | null;
} {
  // Match a JSON object at end-of-content (possibly preceded by whitespace/newlines).
  // Pattern: optional whitespace, then { ... } containing "skill" key.
  const jsonPattern = /\s*(\{"skill"\s*:[\s\S]*\})\s*$/;
  const match = jsonPattern.exec(content);

  if (!match) {
    return { cleanContent: content.trimEnd(), skillBlock: null };
  }

  try {
    const parsed = JSON.parse(match[1]) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'skill' in parsed &&
      'params' in parsed &&
      typeof (parsed as SkillBlock).skill === 'string'
    ) {
      const block = parsed as SkillBlock;
      const cleanContent = content.slice(0, match.index).trimEnd();
      return { cleanContent, skillBlock: block };
    }
  } catch {
    // Not valid JSON — leave content untouched.
  }

  return { cleanContent: content.trimEnd(), skillBlock: null };
}

// ── Request builder ───────────────────────────────────────────────────────────

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function buildMessages(
  messages: ChatMessage[],
  systemPrompt: string
): OpenAIMessage[] {
  const out: OpenAIMessage[] = [{ role: 'system', content: systemPrompt }];

  for (const m of messages) {
    // Skip system messages from history — we inject our own above.
    if (m.role === 'system') continue;
    out.push({ role: m.role, content: m.content });
  }

  return out;
}

function buildHeaders(config: AIConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (config.provider === 'sarvam') {
    // Sarvam uses a non-standard auth header.
    headers['api-subscription-key'] = config.apiKey;
  } else {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  return headers;
}

function buildBody(
  config: AIConfig,
  messages: OpenAIMessage[],
  stream: boolean
): string {
  return JSON.stringify({
    model: config.model,
    messages,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    stream,
  });
}

function endpointUrl(config: AIConfig): string {
  return `${config.baseUrl}/v1/chat/completions`;
}

// ── Error handling ────────────────────────────────────────────────────────────

async function handleHttpError(response: Response): Promise<never> {
  let message = `HTTP ${response.status}`;

  try {
    const body = await response.json() as { error?: { message?: string; code?: string } };
    if (body?.error?.message) {
      message = body.error.message;
    }
  } catch {
    // Body wasn't JSON — use status text.
    message = `${response.status} ${response.statusText}`;
  }

  if (response.status === 401) {
    throw new AIClientError(
      `Invalid API key. Check Settings → AI Configuration. (${message})`,
      401,
      'invalid_api_key'
    );
  }

  if (response.status === 429) {
    throw new AIClientError(
      `Rate limit reached. Please wait a moment and try again. (${message})`,
      429,
      'rate_limit'
    );
  }

  if (response.status === 400) {
    throw new AIClientError(
      `Bad request — the model may not be available on this provider. (${message})`,
      400,
      'bad_request'
    );
  }

  throw new AIClientError(message, response.status);
}

// ── AI Client class ───────────────────────────────────────────────────────────

export class AIClient {
  private config: AIConfig;

  constructor(config: AIConfig) {
    this.config = config;
  }

  /** Update the config at runtime (e.g. after user saves Settings). */
  updateConfig(config: AIConfig): void {
    this.config = config;
  }

  /**
   * Single-shot chat completion.
   *
   * Sends `messages` with `systemPrompt` prepended, awaits the full response,
   * then extracts any embedded skill block before returning.
   *
   * @throws AIClientError on network errors, HTTP 4xx/5xx, or missing API key.
   */
  async chat(
    messages: ChatMessage[],
    systemPrompt: string
  ): Promise<AIResponse> {
    if (!this.config.apiKey) {
      throw new AIClientError(
        'No API key configured. Open Settings → AI Configuration to set one.',
        undefined,
        'no_api_key'
      );
    }

    const builtMessages = buildMessages(messages, systemPrompt);

    let response: Response;
    try {
      response = await fetch(endpointUrl(this.config), {
        method: 'POST',
        headers: buildHeaders(this.config),
        body: buildBody(this.config, builtMessages, false),
      });
    } catch (err) {
      throw new AIClientError(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        'network_error'
      );
    }

    if (!response.ok) {
      await handleHttpError(response);
    }

    const data = await response.json() as {
      choices: Array<{ message?: { content?: string } }>;
    };

    const raw = data.choices?.[0]?.message?.content ?? '';
    const { cleanContent, skillBlock } = extractSkillBlock(raw);

    return {
      content: cleanContent,
      skillRequest: skillBlock
        ? { skillName: skillBlock.skill, parameters: skillBlock.params }
        : undefined,
    };
  }

  /**
   * Streaming chat completion via Server-Sent Events.
   *
   * Yields incremental content string deltas as they arrive.
   * The caller should accumulate these into a string and then call
   * `extractSkillBlock` on the final result if skill detection is needed.
   *
   * Usage:
   * ```typescript
   * let full = '';
   * for await (const chunk of client.chatStream(messages, prompt)) {
   *   full += chunk;
   *   updateBubble(full);
   * }
   * const { cleanContent, skillBlock } = extractSkillBlock(full);
   * ```
   *
   * @throws AIClientError on network errors or HTTP 4xx/5xx.
   */
  async *chatStream(
    messages: ChatMessage[],
    systemPrompt: string
  ): AsyncGenerator<string> {
    if (!this.config.apiKey) {
      throw new AIClientError(
        'No API key configured. Open Settings → AI Configuration to set one.',
        undefined,
        'no_api_key'
      );
    }

    const builtMessages = buildMessages(messages, systemPrompt);

    let response: Response;
    try {
      response = await fetch(endpointUrl(this.config), {
        method: 'POST',
        headers: buildHeaders(this.config),
        body: buildBody(this.config, builtMessages, true),
      });
    } catch (err) {
      throw new AIClientError(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        'network_error'
      );
    }

    if (!response.ok) {
      await handleHttpError(response);
    }

    if (!response.body) {
      throw new AIClientError('Response body is null — streaming not supported by this endpoint.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE lines are separated by "\n". We may receive partial lines
        // across chunks, so we process only complete lines and keep the
        // remainder in the buffer.
        const lines = buffer.split('\n');
        // The last element may be an incomplete line — keep it in the buffer.
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === '') continue;

          // SSE format: "data: <payload>"
          if (!trimmed.startsWith('data:')) continue;

          const payload = trimmed.slice(5).trim();

          // Terminal sentinel
          if (payload === '[DONE]') return;

          try {
            const chunk = JSON.parse(payload) as {
              choices?: Array<{
                delta?: { content?: string };
                finish_reason?: string | null;
              }>;
            };

            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) {
              yield delta;
            }

            // Some providers signal end via finish_reason in the chunk
            if (chunk.choices?.[0]?.finish_reason === 'stop') {
              return;
            }
          } catch {
            // Malformed chunk — skip and continue (non-fatal).
            console.warn('[ai/client] could not parse SSE chunk:', payload);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

// ── Skill block extractor (re-exported for chat UI use) ───────────────────────

export { extractSkillBlock };
