const VALID_CATEGORIES = ['user_preference', 'party_pattern', 'business_insight', 'workflow_note'] as const;

export function saveChatMessageImpl(
  ctx: any,
  args: {
    role: string;
    content: string;
    skillRequest?: string;
    approvalStatus?: string;
    transitionRequest?: string;
    pipelineContext?: string;
  },
  requireMember: (ctx: any) => any,
) {
  requireMember(ctx);
  ctx.db.chatMessage.insert({
    id: 0n,
    memberId: ctx.sender,
    role: args.role,
    content: args.content,
    skillRequest: args.skillRequest || undefined,
    approvalStatus: args.approvalStatus || undefined,
    transitionRequest: args.transitionRequest || undefined,
    pipelineContext: args.pipelineContext || undefined,
    createdAt: ctx.timestamp,
  });
}

export function saveAiMemoryImpl(
  ctx: any,
  args: {
    category: string;
    subject: string;
    content: string;
    confidence: number;
    source: string;
  },
  requireMember: (ctx: any) => any,
) {
  requireMember(ctx);
  if (!VALID_CATEGORIES.includes(args.category as typeof VALID_CATEGORIES[number])) {
    throw new Error(`Invalid category: ${args.category}. Valid categories: ${VALID_CATEGORIES.join(', ')}`);
  }
  ctx.db.aiMemory.insert({
    id: 0n,
    category: args.category,
    subject: args.subject,
    content: args.content,
    confidence: args.confidence,
    source: args.source,
    createdBy: ctx.sender,
    createdAt: ctx.timestamp,
    lastRelevantAt: ctx.timestamp,
    expiresAt: undefined,
  });
}

export function deleteAiMemoryImpl(
  ctx: any,
  args: { memoryId: bigint },
  requireMember: (ctx: any) => any,
  requireRole: (caller: any, ...roles: string[]) => void,
) {
  const member = requireMember(ctx);
  requireRole(member, 'Admin', 'Manager');
  const mem = ctx.db.aiMemory.id.find(args.memoryId);
  if (!mem) throw new Error(`Memory ${args.memoryId} not found`);
  ctx.db.aiMemory.id.delete(args.memoryId);
}
