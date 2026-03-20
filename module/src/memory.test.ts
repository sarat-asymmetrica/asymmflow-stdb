// @ts-nocheck
import assert from 'node:assert/strict';

import { saveChatMessageImpl, saveAiMemoryImpl, deleteAiMemoryImpl } from './memory_logic.ts';

const cases: Array<{ name: string; fn: () => void }> = [];

function test(name: string, fn: () => void): void {
  cases.push({ name, fn });
}

type RowRecord = Record<string, unknown>;

class MockTable<T extends RowRecord> {
  rows: T[];
  private nextId: bigint;
  id: { find: (value: bigint) => T | undefined; update: (row: T) => void; delete: (value: bigint) => void };
  identity: { find: (value: string) => T | undefined; update: (row: T) => void };

  constructor(initialRows: T[] = []) {
    this.rows = initialRows.map((row) => ({ ...row }));
    this.nextId = this.computeNextId();
    this.id = {
      find: (value: bigint) => this.rows.find((row) => row.id === value),
      update: (row: T) => this.replaceBy('id', row),
      delete: (value: bigint) => {
        const index = this.rows.findIndex((row) => row.id === value);
        if (index === -1) throw new Error(`Cannot delete missing row id=${value}`);
        this.rows.splice(index, 1);
      },
    };
    this.identity = {
      find: (value: string) => this.rows.find((row) => row.identity === value),
      update: (row: T) => this.replaceBy('identity', row),
    };
  }

  iter(): IterableIterator<T> {
    return this.rows.values();
  }

  insert(row: T): T {
    const inserted = { ...row } as T;
    if ('id' in inserted && (inserted.id === 0n || inserted.id === undefined)) {
      inserted.id = this.nextId as T[Extract<keyof T, 'id'>];
      this.nextId += 1n;
    }
    this.rows.push(inserted);
    return inserted;
  }

  private computeNextId(): bigint {
    let max = 0n;
    for (const row of this.rows) {
      if (typeof row.id === 'bigint' && row.id > max) max = row.id;
    }
    return max + 1n;
  }

  private replaceBy<K extends keyof T>(key: K, row: T): void {
    const index = this.rows.findIndex((existing) => existing[key] === row[key]);
    if (index === -1) throw new Error(`Cannot update missing row by key "${String(key)}"`);
    this.rows[index] = { ...row };
  }
}

function ts(microsSinceUnixEpoch: bigint) {
  return { microsSinceUnixEpoch };
}

function expectThrows(fn: () => void, message: RegExp): void {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, message);
    return true;
  });
}

function createContext(options?: {
  sender?: string;
  senderRole?: 'Admin' | 'Manager' | 'Sales' | 'Operations' | 'Accountant';
  registerSender?: boolean;
}) {
  const sender = options?.sender ?? 'user-1';
  const memberRows = options?.registerSender
    ? [{
        identity: sender,
        nickname: 'tester',
        fullName: 'Test User',
        email: 'tester@example.com',
        role: { tag: options?.senderRole ?? 'Admin' },
        authMethod: { tag: 'Bootstrap' },
        accessKeyId: undefined,
        joinedAt: ts(1n),
        lastLoginAt: ts(1n),
        updatedAt: ts(1n),
      }]
    : [];

  const member = new MockTable<RowRecord>(memberRows);
  const chatMessage = new MockTable<RowRecord>();
  const aiMemory = new MockTable<RowRecord>();

  return {
    sender,
    timestamp: ts(1_710_000_000_000_000n),
    db: {
      member,
      chatMessage,
      aiMemory,
    },
  };
}

function requireMember(ctx: any) {
  const member = ctx.db.member.identity.find(ctx.sender);
  if (!member) throw new Error('You must join the team first - call join_member');
  return member as { role: { tag: string } };
}

function requireRole(caller: { role: { tag: string } }, ...roles: string[]) {
  if (!roles.includes(caller.role.tag)) {
    throw new Error(`Action requires role: ${roles.join(' or ')}. You are: ${caller.role.tag}`);
  }
}

// --- save_chat_message ---

test('save_chat_message inserts a row with sender identity and timestamp', () => {
  const ctx = createContext({ registerSender: true });
  saveChatMessageImpl(ctx as never, { role: 'user', content: 'Hello from Abhie!' }, requireMember);

  assert.equal(ctx.db.chatMessage.rows.length, 1);
  const row = ctx.db.chatMessage.rows[0];
  assert.equal(row.memberId, 'user-1');
  assert.equal(row.role, 'user');
  assert.equal(row.content, 'Hello from Abhie!');
  assert.equal(row.createdAt, ctx.timestamp);
  assert.equal(row.skillRequest, undefined);
  assert.equal(row.approvalStatus, undefined);
  assert.equal(row.transitionRequest, undefined);
  assert.equal(row.pipelineContext, undefined);
});

test('save_chat_message stores optional fields when provided', () => {
  const ctx = createContext({ registerSender: true });
  saveChatMessageImpl(ctx as never, {
    role: 'assistant',
    content: 'I will generate a quotation for you.',
    skillRequest: 'generate_pdf',
    approvalStatus: 'pending',
    transitionRequest: 'pipeline:Active',
    pipelineContext: '{"pipelineId":42}',
  }, requireMember);

  const row = ctx.db.chatMessage.rows[0];
  assert.equal(row.skillRequest, 'generate_pdf');
  assert.equal(row.approvalStatus, 'pending');
  assert.equal(row.transitionRequest, 'pipeline:Active');
  assert.equal(row.pipelineContext, '{"pipelineId":42}');
});

test('save_chat_message rejects unauthenticated callers', () => {
  const ctx = createContext({ registerSender: false });
  expectThrows(
    () => saveChatMessageImpl(ctx as never, { role: 'user', content: 'sneaky' }, requireMember),
    /join_member/,
  );
  assert.equal(ctx.db.chatMessage.rows.length, 0);
});

test('save_chat_message empty-string optional fields become undefined', () => {
  const ctx = createContext({ registerSender: true });
  saveChatMessageImpl(ctx as never, {
    role: 'user',
    content: 'Hi',
    skillRequest: '',
    approvalStatus: '',
  }, requireMember);

  const row = ctx.db.chatMessage.rows[0];
  assert.equal(row.skillRequest, undefined);
  assert.equal(row.approvalStatus, undefined);
});

// --- save_ai_memory ---

test('save_ai_memory inserts with valid category', () => {
  const ctx = createContext({ registerSender: true });
  saveAiMemoryImpl(ctx as never, {
    category: 'user_preference',
    subject: 'payment_terms',
    content: 'Abhie prefers 30-day payment terms',
    confidence: 90,
    source: 'chat_inference',
  }, requireMember);

  assert.equal(ctx.db.aiMemory.rows.length, 1);
  const row = ctx.db.aiMemory.rows[0];
  assert.equal(row.category, 'user_preference');
  assert.equal(row.subject, 'payment_terms');
  assert.equal(row.confidence, 90);
  assert.equal(row.createdBy, 'user-1');
  assert.equal(row.createdAt, ctx.timestamp);
  assert.equal(row.lastRelevantAt, ctx.timestamp);
  assert.equal(row.expiresAt, undefined);
});

test('save_ai_memory accepts all four valid categories', () => {
  const categories = ['user_preference', 'party_pattern', 'business_insight', 'workflow_note'];
  for (const category of categories) {
    const ctx = createContext({ registerSender: true });
    saveAiMemoryImpl(ctx as never, {
      category,
      subject: 'test',
      content: 'test content',
      confidence: 50,
      source: 'test',
    }, requireMember);
    assert.equal(ctx.db.aiMemory.rows.length, 1, `category ${category} should be accepted`);
  }
});

test('save_ai_memory rejects unknown category', () => {
  const ctx = createContext({ registerSender: true });
  expectThrows(
    () => saveAiMemoryImpl(ctx as never, {
      category: 'secret_government_plan',
      subject: 'test',
      content: 'test',
      confidence: 100,
      source: 'test',
    }, requireMember),
    /Invalid category/,
  );
  assert.equal(ctx.db.aiMemory.rows.length, 0);
});

test('save_ai_memory rejects unauthenticated callers', () => {
  const ctx = createContext({ registerSender: false });
  expectThrows(
    () => saveAiMemoryImpl(ctx as never, {
      category: 'workflow_note',
      subject: 'test',
      content: 'test',
      confidence: 80,
      source: 'test',
    }, requireMember),
    /join_member/,
  );
});

// --- delete_ai_memory ---

test('delete_ai_memory removes the row when called by Admin', () => {
  const ctx = createContext({ registerSender: true, senderRole: 'Admin' });
  ctx.db.aiMemory.insert({
    id: 0n,
    category: 'workflow_note',
    subject: 'old note',
    content: 'stale',
    confidence: 30,
    source: 'manual',
    createdBy: 'user-1',
    createdAt: ts(1n),
    lastRelevantAt: ts(1n),
    expiresAt: undefined,
  });

  assert.equal(ctx.db.aiMemory.rows.length, 1);
  const memId = ctx.db.aiMemory.rows[0].id;
  deleteAiMemoryImpl(ctx as never, { memoryId: memId }, requireMember, requireRole);
  assert.equal(ctx.db.aiMemory.rows.length, 0);
});

test('delete_ai_memory is allowed for Manager role', () => {
  const ctx = createContext({ registerSender: true, senderRole: 'Manager' });
  ctx.db.aiMemory.insert({
    id: 0n,
    category: 'party_pattern',
    subject: 'slow payer',
    content: 'consistently pays 45 days late',
    confidence: 95,
    source: 'payment_analysis',
    createdBy: 'user-1',
    createdAt: ts(1n),
    lastRelevantAt: ts(1n),
    expiresAt: undefined,
  });

  const memId = ctx.db.aiMemory.rows[0].id;
  deleteAiMemoryImpl(ctx as never, { memoryId: memId }, requireMember, requireRole);
  assert.equal(ctx.db.aiMemory.rows.length, 0);
});

test('delete_ai_memory is rejected for Sales role', () => {
  const ctx = createContext({ registerSender: true, senderRole: 'Sales' });
  ctx.db.aiMemory.insert({
    id: 0n,
    category: 'business_insight',
    subject: 'market share',
    content: 'we are growing',
    confidence: 70,
    source: 'manual',
    createdBy: 'user-1',
    createdAt: ts(1n),
    lastRelevantAt: ts(1n),
    expiresAt: undefined,
  });

  const memId = ctx.db.aiMemory.rows[0].id;
  expectThrows(
    () => deleteAiMemoryImpl(ctx as never, { memoryId: memId }, requireMember, requireRole),
    /Action requires role/,
  );
  assert.equal(ctx.db.aiMemory.rows.length, 1);
});

test('delete_ai_memory throws when memory id not found', () => {
  const ctx = createContext({ registerSender: true, senderRole: 'Admin' });
  expectThrows(
    () => deleteAiMemoryImpl(ctx as never, { memoryId: 999n }, requireMember, requireRole),
    /not found/,
  );
});

// --- runner ---

let failures = 0;
for (const testCase of cases) {
  try {
    console.log(`RUN | ${testCase.name}`);
    testCase.fn();
    console.log(`PASS | ${testCase.name}`);
  } catch (error) {
    failures += 1;
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(`FAIL | ${testCase.name}`);
    console.error(message);
  }
}

process.exit(failures);
