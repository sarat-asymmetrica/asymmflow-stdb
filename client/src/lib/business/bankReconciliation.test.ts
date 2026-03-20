import assert from 'node:assert/strict';

import {
  buildPaymentCandidates,
  parseBankStatementCsv,
  suggestMatches,
} from './bankReconciliation';

const failures: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}

function ts(iso: string) {
  return { microsSinceUnixEpoch: BigInt(Date.parse(iso)) * 1000n };
}

test('parseBankStatementCsv handles amount columns and quoted commas', () => {
  const rows = parseBankStatementCsv(
    [
      'Date,Description,Reference,Amount',
      '"2026-03-18","EWA payment, phase 2","PAY-101","1,250.500"',
      '2026-03-19,Bank fee,,(5.250)',
    ].join('\n'),
    'NBB',
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.description, 'EWA payment, phase 2');
  assert.equal(rows[0]?.reference, 'PAY-101');
  assert.equal(rows[0]?.amountFils, 1_250_500n);
  assert.equal(rows[1]?.amountFils, -5_250n);
});

test('parseBankStatementCsv derives signed amount from debit and credit columns', () => {
  const rows = parseBankStatementCsv(
    [
      'Value Date,Details,Debit,Credit,Reference',
      '20/03/2026,Supplier transfer,500.000,,SUP-44',
      '20/03/2026,Customer collection,,800.000,CUST-88',
    ].join('\n'),
    'BBK',
  );

  assert.equal(rows[0]?.amountFils, -500_000n);
  assert.equal(rows[1]?.amountFils, 800_000n);
});

test('buildPaymentCandidates excludes already matched events and signs supplier payments negative', () => {
  const candidates = buildPaymentCandidates({
    parties: [
      { id: 1n, name: 'EWA' },
      { id: 2n, name: 'Endress+Hauser' },
    ] as any,
    moneyEvents: [
      { id: 11n, partyId: 1n, kind: { tag: 'CustomerPayment' }, status: { tag: 'Terminal' }, totalFils: 900_000n, reference: '[Bank Transfer] PAY-11', createdAt: ts('2026-03-18T00:00:00Z') },
      { id: 12n, partyId: 2n, kind: { tag: 'SupplierPayment' }, status: { tag: 'Terminal' }, totalFils: 320_000n, reference: 'SUP-12', createdAt: ts('2026-03-18T00:00:00Z') },
      { id: 13n, partyId: 1n, kind: { tag: 'CustomerInvoice' }, status: { tag: 'Active' }, totalFils: 1_000_000n, reference: 'INV-13', createdAt: ts('2026-03-17T00:00:00Z') },
    ] as any,
    bankTransactions: [
      { matchedMoneyEventId: 11n },
    ] as any,
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.moneyEventId, 12n);
  assert.equal(candidates[0]?.signedAmountFils, -320_000n);
});

test('suggestMatches prioritizes exact amount plus reference and date proximity', () => {
  const suggestions = suggestMatches(
    {
      amountFils: 900_000n,
      description: 'EWA transfer PAY-11 received',
      reference: 'PAY-11',
      transactionDate: ts('2026-03-18T10:00:00Z'),
    } as any,
    [
      {
        moneyEventId: 11n,
        partyId: 1n,
        partyName: 'EWA',
        kind: 'CustomerPayment',
        reference: '[Bank Transfer] PAY-11',
        amountFils: 900_000n,
        signedAmountFils: 900_000n,
        createdAtMicros: ts('2026-03-18T09:00:00Z').microsSinceUnixEpoch,
      },
      {
        moneyEventId: 12n,
        partyId: 2n,
        partyName: 'BAPCO',
        kind: 'CustomerPayment',
        reference: 'PAY-12',
        amountFils: 900_000n,
        signedAmountFils: 900_000n,
        createdAtMicros: ts('2026-03-10T09:00:00Z').microsSinceUnixEpoch,
      },
    ],
  );

  assert.equal(suggestions[0]?.moneyEventId, 11n);
  assert.ok((suggestions[0]?.score ?? 0) > (suggestions[1]?.score ?? 0));
  assert.ok(suggestions[0]?.reasons.includes('Exact amount'));
  assert.ok(suggestions[0]?.reasons.includes('Reference match'));
});

if (failures.length > 0) {
  process.exitCode = 1;
}
