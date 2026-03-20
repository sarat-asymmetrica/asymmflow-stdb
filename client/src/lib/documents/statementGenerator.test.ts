import assert from 'node:assert/strict';

import { buildStatementDocDefinition, type StatementData } from './statementGenerator';

type PlainObject = Record<string, unknown>;

function ts(microsSinceUnixEpoch: bigint) {
  return { microsSinceUnixEpoch };
}

function extractText(node: unknown, output: string[] = []): string[] {
  if (typeof node === 'string') {
    output.push(node);
    return output;
  }
  if (Array.isArray(node)) {
    for (const child of node) extractText(child, output);
    return output;
  }
  if (!node || typeof node !== 'object') {
    return output;
  }

  const record = node as PlainObject;
  if (typeof record.image === 'string') {
    return output;
  }
  if (typeof record.text === 'string') {
    output.push(record.text);
  } else if (Array.isArray(record.text)) {
    extractText(record.text, output);
  }

  for (const [key, value] of Object.entries(record)) {
    if (key !== 'image' && value !== record.text) {
      extractText(value, output);
    }
  }
  return output;
}

function createStatementData(): StatementData {
  return {
    party: {
      id: 1n,
      name: 'BAPCO Refining',
      isCustomer: true,
      isSupplier: false,
      grade: { tag: 'A' },
      creditLimitFils: 100_000_000n,
      isCreditBlocked: false,
      paymentTermsDays: 45n,
      productTypes: 'Flow meters',
      annualGoalFils: 120_000_000n,
      notes: '',
      createdAt: ts(1n),
      updatedAt: ts(1n),
    } as never,
    moneyEvents: [
      {
        id: 1n,
        partyId: 1n,
        orderId: 1n,
        deliveryNoteId: 1n,
        kind: { tag: 'CustomerInvoice' },
        status: { tag: 'Active' },
        subtotalFils: 10_000_000n,
        vatFils: 1_000_000n,
        totalFils: 11_000_000n,
        reference: 'INV-2026-001',
        dueDate: ts(BigInt(Date.parse('2026-02-10T00:00:00Z')) * 1000n),
        paidAt: undefined,
        createdBy: 'user-1',
        createdAt: ts(BigInt(Date.parse('2026-01-10T00:00:00Z')) * 1000n),
        updatedAt: ts(BigInt(Date.parse('2026-01-10T00:00:00Z')) * 1000n),
      },
      {
        id: 2n,
        partyId: 1n,
        orderId: 1n,
        deliveryNoteId: undefined,
        kind: { tag: 'CustomerPayment' },
        status: { tag: 'Terminal' },
        subtotalFils: 5_000_000n,
        vatFils: 0n,
        totalFils: 5_000_000n,
        reference: 'RCPT-2026-014',
        dueDate: undefined,
        paidAt: ts(BigInt(Date.parse('2026-02-15T00:00:00Z')) * 1000n),
        createdBy: 'user-1',
        createdAt: ts(BigInt(Date.parse('2026-02-15T00:00:00Z')) * 1000n),
        updatedAt: ts(BigInt(Date.parse('2026-02-15T00:00:00Z')) * 1000n),
      },
    ] as never,
    dateFrom: new Date('2026-01-01T00:00:00Z'),
    dateTo: new Date('2026-03-10T00:00:00Z'),
  };
}

const cases: Array<{ name: string; fn: () => void }> = [];

function test(name: string, fn: () => void) {
  cases.push({ name, fn });
}

test('statementGenerator renders customer details, period, and transaction history', () => {
  const docDef = buildStatementDocDefinition(createStatementData());
  const allText = extractText(docDef).join(' | ');

  assert.match(allText, /STATEMENT OF ACCOUNT/);
  assert.match(allText, /BAPCO Refining/);
  assert.match(allText, /Grade A/);
  assert.match(allText, /Transaction History/);
  assert.match(allText, /INV-2026-001/);
  assert.match(allText, /RCPT-2026-014/);
});

test('statementGenerator renders aging analysis and outstanding total', () => {
  const docDef = buildStatementDocDefinition(createStatementData());
  const allText = extractText(docDef).join(' | ');

  assert.match(allText, /Aging Analysis/);
  assert.match(allText, /1 .* 30 days overdue/);
  assert.match(allText, /Total Outstanding/);
  assert.match(allText, /6,000\.000|6\.000/);
  assert.match(allText, /Payment Terms: 45 days/);
});

let failures = 0;
for (const testCase of cases) {
  try {
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
