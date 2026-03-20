export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function ensureEmail(email: string) {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes('@') || normalized.startsWith('@') || normalized.endsWith('@')) {
    throw new Error('A valid email is required');
  }
  return normalized;
}

export function hasAnyMembers(ctx: any) {
  for (const _ of ctx.db.member.iter()) return true;
  return false;
}

export function findAccessKey(ctx: any, rawKey: string) {
  const key = rawKey.trim().toUpperCase();
  for (const row of ctx.db.accessKey.iter()) {
    if (row.key === key) return row;
  }
  return undefined;
}

export function bootstrapAdminImpl(ctx: any, args: { nickname: string; fullName: string; email: string }) {
  if (ctx.db.member.identity.find(ctx.sender)) throw new Error('Already registered');
  if (hasAnyMembers(ctx)) throw new Error('Bootstrap is only allowed for the first member');
  ctx.db.member.insert({
    identity: ctx.sender,
    nickname: args.nickname.trim(),
    fullName: args.fullName.trim(),
    email: ensureEmail(args.email),
    role: { tag: 'Admin' },
    authMethod: { tag: 'Bootstrap' },
    accessKeyId: undefined,
    joinedAt: ctx.timestamp,
    lastLoginAt: ctx.timestamp,
    updatedAt: ctx.timestamp,
  });
  ctx.db.activityLog.insert({
    id: 0n,
    actorId: ctx.sender,
    entityType: 'member',
    entityId: 0n,
    action: 'bootstrap_admin',
    detail: `Bootstrap admin created for ${args.fullName.trim()}`,
    followUpDue: undefined,
    followUpDone: false,
    createdAt: ctx.timestamp,
  });
}

export function issueAccessKeyImpl(
  ctx: any,
  caller: any,
  requireRole: (caller: any, ...roles: string[]) => void,
  args: { key: string; role: { tag: string }; assignedEmail: string; assignedName: string; notes: string; expiresAt?: unknown },
) {
  requireRole(caller, 'Admin');
  const key = args.key.trim().toUpperCase();
  if (!key) throw new Error('Access key is required');
  if (findAccessKey(ctx, key)) throw new Error(`Access key "${key}" already exists`);
  ctx.db.accessKey.insert({
    id: 0n,
    key,
    role: args.role,
    assignedEmail: normalizeEmail(args.assignedEmail),
    assignedName: args.assignedName.trim(),
    notes: args.notes.trim(),
    createdBy: ctx.sender,
    createdAt: ctx.timestamp,
    expiresAt: args.expiresAt,
    claimedBy: undefined,
    claimedAt: undefined,
    revokedAt: undefined,
  });
  ctx.db.activityLog.insert({
    id: 0n,
    actorId: ctx.sender,
    entityType: 'access_key',
    entityId: 0n,
    action: 'issued',
    detail: `Access key ${key} issued for ${args.role.tag}`,
    followUpDue: undefined,
    followUpDone: false,
    createdAt: ctx.timestamp,
  });
}

export function redeemAccessKeyImpl(ctx: any, args: { key: string; nickname: string; fullName: string; email: string }) {
  if (ctx.db.member.identity.find(ctx.sender)) throw new Error('Already registered');
  const accessKey = findAccessKey(ctx, args.key);
  if (!accessKey) throw new Error('Access key not found');
  if (accessKey.revokedAt) throw new Error('Access key has been revoked');
  if (accessKey.claimedBy) throw new Error('Access key has already been claimed');
  if (accessKey.expiresAt && accessKey.expiresAt.microsSinceUnixEpoch < ctx.timestamp.microsSinceUnixEpoch) {
    throw new Error('Access key has expired');
  }
  const email = ensureEmail(args.email);
  if (accessKey.assignedEmail && accessKey.assignedEmail !== email) {
    throw new Error(`Access key is assigned to ${accessKey.assignedEmail}`);
  }
  ctx.db.member.insert({
    identity: ctx.sender,
    nickname: args.nickname.trim(),
    fullName: args.fullName.trim(),
    email,
    role: accessKey.role,
    authMethod: { tag: 'InviteKey' },
    accessKeyId: accessKey.id,
    joinedAt: ctx.timestamp,
    lastLoginAt: ctx.timestamp,
    updatedAt: ctx.timestamp,
  });
  ctx.db.accessKey.id.update({ ...accessKey, claimedBy: ctx.sender, claimedAt: ctx.timestamp });
  ctx.db.activityLog.insert({
    id: 0n,
    actorId: ctx.sender,
    entityType: 'member',
    entityId: accessKey.id,
    action: 'redeemed_access_key',
    detail: `Access key ${accessKey.key} redeemed by ${args.fullName.trim()}`,
    followUpDue: undefined,
    followUpDone: false,
    createdAt: ctx.timestamp,
  });
}

export function upsertAuthSessionImpl(ctx: any, member: any, args: { sessionKey: string; sessionLabel: string; ttlHours?: bigint }) {
  const sessionKey = args.sessionKey.trim();
  if (!sessionKey) throw new Error('sessionKey is required');
  const ttlHours = args.ttlHours ?? 24n;
  const expiresAt = {
    microsSinceUnixEpoch: ctx.timestamp.microsSinceUnixEpoch + ttlHours * 3_600_000_000n,
  } as typeof ctx.timestamp;
  let existing;
  for (const row of ctx.db.authSession.iter()) {
    if (row.memberIdentity === ctx.sender && row.sessionKey === sessionKey) {
      existing = row;
      break;
    }
  }
  if (!existing) {
    ctx.db.authSession.insert({
      id: 0n,
      memberIdentity: ctx.sender,
      sessionKey,
      sessionLabel: args.sessionLabel.trim() || 'Browser session',
      authMethod: member.authMethod,
      issuedAt: ctx.timestamp,
      expiresAt,
      lastSeenAt: ctx.timestamp,
      revokedAt: undefined,
      revokeReason: undefined,
    });
  } else {
    ctx.db.authSession.id.update({
      ...existing,
      sessionLabel: args.sessionLabel.trim() || existing.sessionLabel,
      expiresAt,
      lastSeenAt: ctx.timestamp,
    });
  }
  ctx.db.member.identity.update({ ...member, lastLoginAt: ctx.timestamp, updatedAt: ctx.timestamp });
}

export function revokeAuthSessionImpl(
  ctx: any,
  caller: any,
  requireRole: (caller: any, ...roles: string[]) => void,
  args: { sessionKey: string; revokeReason?: string },
) {
  let session;
  for (const row of ctx.db.authSession.iter()) {
    if (row.sessionKey === args.sessionKey.trim()) {
      session = row;
      break;
    }
  }
  if (!session) throw new Error('Session not found');
  if (session.memberIdentity !== ctx.sender) requireRole(caller, 'Admin');
  ctx.db.authSession.id.update({
    ...session,
    revokedAt: ctx.timestamp,
    revokeReason: args.revokeReason?.trim() || 'revoked_by_user',
  });
}
