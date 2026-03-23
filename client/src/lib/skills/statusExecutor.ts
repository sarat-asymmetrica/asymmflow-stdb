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
import { pipelines, aiMemories, getConnection } from '../db';
import { Timestamp } from 'spacetimedb';

const VALID_MEMORY_CATEGORIES = new Set([
  'user_preference',
  'party_pattern',
  'business_insight',
  'workflow_note',
]);

function normalizeMemoryCategory(rawCategory: unknown): string {
  return String(rawCategory ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

async function waitForMemoryInsert(
  previousIds: Set<bigint>,
  matcher: (memory: { category: string; subject: string; content: string }) => boolean,
  timeoutMs = 4000
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const next = get(aiMemories).find(
      (memory) => !previousIds.has(memory.id) && matcher(memory)
    );
    if (next) return next;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for AI memory to sync from the server.');
}

async function waitForMemoryDeletion(memoryId: bigint, timeoutMs = 4000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const stillExists = get(aiMemories).some((memory) => memory.id === memoryId);
    if (!stillExists) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for memory #${memoryId} to be deleted.`);
}

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

  const requestedStatus = String(newStatus);
  const statusTag =
    requestedStatus === 'Won' ? 'Terminal' :
    requestedStatus === 'Lost' ? 'Cancelled' :
    requestedStatus === 'OnHold' ? 'InProgress' :
    requestedStatus;
  const validStatuses = ['Draft', 'Active', 'InProgress', 'Terminal', 'Cancelled', 'Won', 'Lost', 'OnHold'];
  if (!validStatuses.includes(requestedStatus)) {
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
      legacyYear: pipeline.legacyYear,
      opportunityNumber: pipeline.opportunityNumber,
      folderNumber: pipeline.folderNumber,
      folderName: pipeline.folderName,
      sfdcTitle: pipeline.sfdcTitle,
      comment: pipeline.comment,
      ehReference: pipeline.ehReference,
      paymentTerms: pipeline.paymentTerms,
      ownerName: pipeline.ownerName,
      source: pipeline.source,
      sourceNotes: pipeline.sourceNotes,
      deliverySummary: pipeline.deliverySummary,
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

  const category = normalizeMemoryCategory(params.category);
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

  if (!VALID_MEMORY_CATEGORIES.has(category)) {
    return {
      success: false,
      summary:
        'category must be one of: user_preference, party_pattern, business_insight, workflow_note.',
      error: 'invalid_param',
    };
  }

  try {
    const reducers = conn.reducers as {
      saveAiMemory?: (args: {
        category: string;
        subject: string;
        content: string;
        confidence: number;
        source: string;
      }) => void;
    };
    if (typeof reducers.saveAiMemory !== 'function') {
      throw new Error('saveAiMemory reducer is unavailable on the current connection.');
    }

    const existingIds = new Set(get(aiMemories).map((memory) => memory.id));
    reducers.saveAiMemory({
      category,
      subject,
      content,
      confidence: 80,
      source: 'ai_observed',
    });
    const savedMemory = await waitForMemoryInsert(
      existingIds,
      (memory) =>
        memory.category === category &&
        memory.subject === subject &&
        memory.content === content
    );

    return {
      success: true,
      summary: `Memory #${savedMemory.id} saved: [${category}] ${subject}.`,
      data: {
        memoryId: String(savedMemory.id),
        category,
        subject,
        content,
      },
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

  try {
    const reducers = conn.reducers as {
      deleteAiMemory?: (args: { memoryId: bigint }) => void;
    };
    if (typeof reducers.deleteAiMemory !== 'function') {
      throw new Error('deleteAiMemory reducer is unavailable on the current connection.');
    }

    const memoryId = BigInt(numericId);
    reducers.deleteAiMemory({ memoryId });
    await waitForMemoryDeletion(memoryId);
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
