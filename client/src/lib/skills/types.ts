/**
 * AsymmFlow Skills — Core Type Definitions
 *
 * Defines the type contract for every skill in the system. The registry
 * (registry.ts) is the single source of truth for skill definitions; these
 * interfaces describe the shape of every entry in that registry plus the
 * runtime execution artefacts (plans, steps, results).
 */

// ── Permission model ──────────────────────────────────────────────────────────

/**
 * How much human friction is required before a skill may execute.
 *
 * - `auto`       — AI may execute without prompting the user.
 * - `explicit`   — User must click "Approve" in the chat UI before execution.
 * - `admin_only` — Only users whose role is 'Admin' may approve; managers
 *                  and below see the plan but cannot unblock it.
 */
export type ApprovalLevel = 'auto' | 'explicit' | 'admin_only';

// ── Taxonomy ──────────────────────────────────────────────────────────────────

/**
 * High-level grouping shown in the skill picker UI and used to filter
 * context prompts per conversation intent.
 */
export type SkillCategory = 'data' | 'file' | 'intelligence' | 'communication';

// ── RBAC ─────────────────────────────────────────────────────────────────────

/**
 * User roles as defined in the STDB `Member.role` enum.
 * Must stay in sync with the Rust module definition.
 */
export type UserRole =
  | 'Admin'
  | 'Manager'
  | 'Sales'
  | 'Operations'
  | 'Accountant';

// ── Skill definition ──────────────────────────────────────────────────────────

/**
 * Strongly-typed descriptor for a single skill parameter.
 * The AI model must supply values for every `required` parameter
 * before the skill runner will accept the invocation.
 */
export interface SkillParameter {
  /** Machine name used in the parameters object passed to the runner. */
  name: string;
  /**
   * Primitive type hint.
   * `file_path` signals that the Neutralino file-picker dialog should be
   * offered to the user instead of free-text entry.
   */
  type: 'string' | 'number' | 'boolean' | 'date' | 'file_path';
  /** When true the AI must not omit this parameter. */
  required: boolean;
  /** Human-readable explanation shown in the approval UI. */
  description: string;
}

/**
 * The full definition of a single skill.
 * Stored in the registry; never mutated at runtime.
 */
export interface SkillDefinition {
  /** Stable machine name — used as the primary key everywhere. */
  name: string;
  /** Short title shown in the chat suggestion chips. */
  displayName: string;
  /** One-sentence explanation included in the AI system prompt. */
  description: string;
  category: SkillCategory;
  approval: ApprovalLevel;
  /** Roles that are allowed to trigger this skill. */
  requiredRoles: UserRole[];
  parameters: SkillParameter[];
}

// ── Execution artefacts ───────────────────────────────────────────────────────

/**
 * A single step within a skill execution plan.
 * The chat UI renders these as a live progress list.
 */
export interface SkillStep {
  /** Short human-readable label, e.g. "Fetching overdue invoices". */
  label: string;
  status: 'pending' | 'running' | 'done' | 'error';
  /** Optional extra detail shown on hover or error expand. */
  detail?: string;
}

/**
 * The full execution plan produced by the skill runner before it asks for
 * user approval (when `approval !== 'auto'`).
 */
export interface SkillPlan {
  skillName: string;
  /** Ordered list of steps the runner intends to perform. */
  steps: SkillStep[];
  /**
   * Rough human-readable time hint shown in the approval UI,
   * e.g. "~2 seconds" or "~30 seconds (OCR)".
   * Optional — omit for instant operations.
   */
  estimatedDuration?: string;
}

/**
 * Terminal result returned by a skill after execution completes
 * (successfully or not).
 */
export interface SkillResult {
  success: boolean;
  /** One-sentence summary displayed in the chat bubble. */
  summary: string;
  /**
   * Structured data that the AI may reference in its follow-up reply,
   * and that downstream skills may consume.
   */
  data?: Record<string, unknown>;
  /** Error message when `success` is false. */
  error?: string;
}
