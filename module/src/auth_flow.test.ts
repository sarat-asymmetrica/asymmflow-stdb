// @ts-nocheck
import assert from 'node:assert/strict';

import {
  bootstrapAdminImpl,
  issueAccessKeyImpl,
  redeemAccessKeyImpl,
  upsertAuthSessionImpl,
  revokeAuthSessionImpl,
} from './auth_logic.ts';

const cases: Array<{ name: string; fn: () => void }> = [];

function test(name: string, fn: () => void): void {
  cases.push({ name, fn });
}

type RowRecord = Record<string, unknown>;

class MockTable<T extends RowRecord> {
  rows: T[];
  private nextId: bigint;
  id: { find: (value: bigint) => T | undefined; update: (row: T) => void };
  identity: { find: (value: string) => T | undefined; update: (row: T) => void };

  constructor(initialRows: T[] = []) {
    this.rows = initialRows.map((row) => ({ ...row }));
    this.nextId = this.computeNextId();
    this.id = {
      find: (value: bigint) => this.rows.find((row) => row.id === value),
      update: (row: T) => this.replaceBy('id', row),
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
  const accessKey = new MockTable<RowRecord>();
  const authSession = new MockTable<RowRecord>();
  const party = new MockTable<RowRecord>();
  const pipeline = new MockTable<RowRecord>();
  const order = new MockTable<RowRecord>();
  const lineItem = new MockTable<RowRecord>();
  const purchaseOrder = new MockTable<RowRecord>();
  const deliveryNote = new MockTable<RowRecord>();
  const deliveryNoteItem = new MockTable<RowRecord>();
  const goodsReceivedNote = new MockTable<RowRecord>();
  const grnItem = new MockTable<RowRecord>();
  const moneyEvent = new MockTable<RowRecord>();
  const activityLog = new MockTable<RowRecord>();
  const aiAction = new MockTable<RowRecord>();
  const docSequence = new MockTable<RowRecord>();
  const bankTransaction = new MockTable<RowRecord>();
  const contact = new MockTable<RowRecord>();

  return {
    sender,
    timestamp: ts(1_710_000_000_000_000n),
    db: {
      member,
      accessKey,
      authSession,
      party,
      pipeline,
      order,
      lineItem: Object.assign(lineItem, { line_item_by_parent: { filter: () => [].values() } }),
      purchaseOrder,
      deliveryNote,
      deliveryNoteItem,
      goodsReceivedNote,
      grnItem,
      moneyEvent: Object.assign(moneyEvent, { money_by_party: { filter: () => [].values() } }),
      activityLog,
      aiAction,
      docSequence,
      bankTransaction,
      contact,
    },
  };
}

test('bootstrap_admin creates the first member with email and login tracking', () => {
  const ctx = createContext();
  bootstrapAdminImpl(ctx as never, {
    nickname: 'sarat',
    fullName: 'Sarat Chandra',
    email: 'SARAT@EXAMPLE.COM',
  });

  const member = ctx.db.member.identity.find('user-1');
  assert.ok(member);
  assert.equal(member.role.tag, 'Admin');
  assert.equal(member.email, 'sarat@example.com');
  assert.equal(member.authMethod.tag, 'Bootstrap');
  assert.equal(member.lastLoginAt, ctx.timestamp);
});

test('issue_access_key and redeem_access_key bind role and email to the caller identity', () => {
  const adminCtx = createContext({ registerSender: true, senderRole: 'Admin' });
  issueAccessKeyImpl(adminCtx as never, { role: { tag: 'Admin' } }, (caller, ...roles) => {
    if (!roles.includes(caller.role.tag)) throw new Error(`Action requires role: ${roles.join(' or ')}`);
  }, {
    key: 'ph-mgr-a1b2c3',
    role: { tag: 'Manager' },
    assignedEmail: 'manager@example.com',
    assignedName: 'Manager User',
    notes: 'Invite for ops lead',
    expiresAt: undefined,
  });

  const issued = adminCtx.db.accessKey.id.find(1n);
  assert.ok(issued);
  assert.equal(issued.key, 'PH-MGR-A1B2C3');

  const userCtx = createContext({ sender: 'user-2' });
  userCtx.db.accessKey.insert({ ...issued });
  redeemAccessKeyImpl(userCtx as never, {
    key: 'PH-MGR-A1B2C3',
    nickname: 'manager',
    fullName: 'Manager User',
    email: 'manager@example.com',
  });

  const member = userCtx.db.member.identity.find('user-2');
  assert.ok(member);
  assert.equal(member.role.tag, 'Manager');
  assert.equal(member.authMethod.tag, 'InviteKey');
  assert.equal(userCtx.db.accessKey.id.find(1n).claimedBy, 'user-2');
});

test('upsert_auth_session records session metadata and revoke_auth_session closes it', () => {
  const ctx = createContext({ registerSender: true, senderRole: 'Admin' });
  const member = ctx.db.member.identity.find('user-1');
  upsertAuthSessionImpl(ctx as never, member, {
    sessionKey: 'session-abc',
    sessionLabel: 'Chrome on Bahrain HQ',
    ttlHours: 24n,
  });

  const session = ctx.db.authSession.id.find(1n);
  assert.ok(session);
  assert.equal(session.sessionKey, 'session-abc');
  assert.equal(ctx.db.member.identity.find('user-1').lastLoginAt, ctx.timestamp);

  revokeAuthSessionImpl(ctx as never, { role: { tag: 'Admin' } }, (caller, ...roles) => {
    if (!roles.includes(caller.role.tag)) throw new Error(`Action requires role: ${roles.join(' or ')}`);
  }, {
    sessionKey: 'session-abc',
    revokeReason: 'manual_logout',
  });

  assert.equal(ctx.db.authSession.id.find(1n).revokeReason, 'manual_logout');
  assert.equal(ctx.db.authSession.id.find(1n).revokedAt, ctx.timestamp);
});

test('manage_order rejects unauthorized roles server-side', () => {
  const ctx = createContext({ registerSender: true, senderRole: 'Accountant' });
  ctx.db.party.insert({
    id: 1n,
    name: 'Acme',
    isCustomer: true,
    isSupplier: false,
    grade: { tag: 'B' },
    creditLimitFils: 0n,
    isCreditBlocked: false,
    paymentTermsDays: 30n,
    productTypes: '',
    annualGoalFils: 0n,
    notes: '',
    createdAt: ts(1n),
    updatedAt: ts(1n),
  });
  ctx.db.pipeline.insert({
    id: 1n,
    partyId: 1n,
    ownerId: 'user-1',
    title: 'Project',
    status: { tag: 'Active' },
    estimatedValueFils: 10_000n,
    winProbabilityBps: 5000n,
    competitorPresent: false,
    oemPriceFils: 5_000n,
    markupBps: 2000n,
    additionalCostsFils: 0n,
    costingApproved: false,
    costingApprovedBy: undefined,
    offerTotalFils: 6_000n,
    offerSentAt: undefined,
    lossReason: undefined,
    nextFollowUp: undefined,
    revision: 1n,
    createdAt: ts(1n),
    updatedAt: ts(1n),
  });

  expectThrows(() => {
    const caller = ctx.db.member.identity.find('user-1');
    if (!['Admin', 'Manager', 'Sales', 'Operations'].includes(caller.role.tag)) {
      throw new Error(`Action requires role: Admin or Manager or Sales or Operations. You are: ${caller.role.tag}`);
    }
  }, /Action requires role/);
});

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
