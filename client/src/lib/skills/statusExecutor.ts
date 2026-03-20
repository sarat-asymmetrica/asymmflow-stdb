/**
 * AsymmFlow Skills — Status Executor
 *
 * Handles status-transition and AI-memory skill cases:
 *   - update_pipeline_status  — advance pipeline + log activity
 *   - remember                — save an AI memory observation
 *   - forget                  — delete an AI memory by id
 *
 * Returns null for any skill name not handled here, allowing the caller to
 * fall through to other routers.
 */

import type { SkillResult } from './types';
import { get } from 'svelte/store';
import { pipelines, getConnection } from '../db';
import { Timestamp } from 'spacetimedb';

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleUpdatePipelineStatus(
  params: Record<string, unknown>
): Promise<SkillResult> {
  const conn = getConnection();
  if (!conn) {
    return { success: false, summary: 'Not connected to database.', error: 'no_connection' };
  }

  const pipelineId = params.pipelineId;
  const newStatus = params.newStatus ?? params.status;

  if (pipelineId == null) {
    return { success: false, summary: 'pipelineId is required.', error: 'missing_param' };
  }
  if (newStatus == null) {
    return { success: false, summary: 'newStatus is required.', error: 'missing_param' };
  }

  const numericId = Number(pipelineId);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return { success: false, summary: 'pipelineId must be a positive integer.', error: 'invalid_param' };
  }

  const pipeline = get(pipelines).find((pl) => pl.id === BigInt(numericId));
  if (!pipeline) {
    return { success: false, summary: `Pipeline #${pipelineId} not found.`, error: 'not_found' };
  }

  const statusTag = String(newStatus);
  const validStatuses = ['Draft', 'Active', 'InProgress', 'Won', 'Lost', 'OnHold'];
  if (!validStatuses.includes(statusTag)) {
    return {
      success: false,
      summary: `newStatus must be one of: ${validStatuses.join(', ')}.`,
      error: 'invalid_param',
    };
  }

  try {
    // Spread ALL pipeline fields — advance_pipeline requires the full payload.
    // Only newStatus is overridden; everything else is preserved from the current record.
    conn.reducers.advancePipeline({
      id: pipeline.id,
      partyId: pipeline.partyId,
      title: pipeline.title,
      newStatus: { tag: statusTag } as any,
      estimatedValueFils: pipeline.estimatedValueFils,
      winProbabilityBps: pipeline.winProbabilityBps,
      competitorPresent: pipeline.competitorPresent,
      oemPriceFils: pipeline.oemPriceFils,
      markupBps: pipeline.markupBps,
      additionalCostsFils: pipeline.additionalCostsFils,
      costingApproved: pipeline.costingApproved,
      offerSentAt: pipeline.offerSentAt,
      lossReason: pipeline.lossReason,
      nextFollowUp: pipeline.nextFollowUp,
    });

    // Log the status change as an activity entry
    try {
      conn.reducers.logActivity({
        entityType: 'pipeline',
        entityId: pipeline.id,
        action: 'status_changed',
        detail: `Status updated to ${statusTag}`,
        followUpDue: undefined,
      });
    } catch (logErr) {
      // Non-fatal — status was already updated
      console.warn('[handleUpdatePipelineStatus] logActivity failed:', logErr);
    }

    return {
      success: true,
      summary: `Pipeline "${pipeline.title}" status updated to ${statusTag}.`,
      data: {
        pipelineId: String(pipeline.id),
        title: pipeline.title,
        newStatus: statusTag,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      summary: `Failed to update pipeline status: ${message}`,
      error: message,
    };
  }
}

async function handleRemember(
  params: Record<string, unknown>
): Promise<SkillResult> {
  const conn = getConnection();
  if (!conn) {
    return { success: false, summary: 'Not connected to database.', error: 'no_connection' };
  }

  const category = params.category != null ? String(params.category).trim() : '';
  const subject  = params.subject  != null ? String(params.subject).trim()  : '';
  const content  = params.content  != null ? String(params.content).trim()  : '';

  if (!category) {
    return { success: false, summary: 'category is required.', error: 'missing_param' };
  }
  if (!subject) {
    return { success: false, summary: 'subject is required.', error: 'missing_param' };
  }
  if (!content) {
    return { success: false, summary: 'content is required.', error: 'missing_param' };
  }

  // The save_ai_memory reducer is not yet generated in STDB bindings.
  // When it becomes available, replace this block with:
  //   conn.reducers.saveAiMemory({ category, subject, content, confidence: 80, source: 'ai_observed' });
  const reducers = conn.reducers as any;
  if (typeof reducers.saveAiMemory !== 'function') {
    return {
      success: false,
      summary: 'AI memory persistence is not yet available in this deployment.',
      error: 'not_implemented',
    };
  }

  try {
    reducers.saveAiMemory({ category, subject, content, confidence: 80, source: 'ai_observed' });
    return {
      success: true,
      summary: `Memory saved: [${category}] ${subject}.`,
      data: { category, subject, content },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, summary: `Failed to save memory: ${message}`, error: message };
  }
}

async function handleForget(
  params: Record<string, unknown>
): Promise<SkillResult> {
  const conn = getConnection();
  if (!conn) {
    return { success: false, summary: 'Not connected to database.', error: 'no_connection' };
  }

  const id = params.memoryId ?? params.id;
  if (id == null) {
    return { success: false, summary: 'memoryId is required.', error: 'missing_param' };
  }

  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return { success: false, summary: 'memoryId must be a positive integer.', error: 'invalid_param' };
  }

  // The delete_ai_memory reducer is not yet generated in STDB bindings.
  // When it becomes available, replace this block with:
  //   conn.reducers.deleteAiMemory({ memoryId: BigInt(numericId) });
  const reducers = conn.reducers as any;
  if (typeof reducers.deleteAiMemory !== 'function') {
    return {
      success: false,
      summary: 'AI memory deletion is not yet available in this deployment.',
      error: 'not_implemented',
    };
  }

  try {
    reducers.deleteAiMemory({ memoryId: BigInt(numericId) });
    return {
      success: true,
      summary: `Memory #${numericId} deleted.`,
      data: { memoryId: String(numericId) },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, summary: `Failed to delete memory: ${message}`, error: message };
  }
}

// ── Public router ─────────────────────────────────────────────────────────────

/**
 * Route status-transition and memory skill names to their handlers.
 * Returns null if the skill name is not handled here (caller falls through).
 */
export async function executeStatusSkill(
  skillName: string,
  params: Record<string, unknown>
): Promise<SkillResult | null> {
  switch (skillName) {
    case 'update_pipeline_status':
      return handleUpdatePipelineStatus(params);

    case 'remember':
      return handleRemember(params);

    case 'forget':
      return handleForget(params);

    default:
      return null;
  }
}
