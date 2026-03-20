import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateAlerts,
  filterBySeverity,
  filterByCategory,
  sortAlerts,
  countBySeverity,
  formatAlertSummary,
} from './alertSystem';
import type {
  AlertInput,
  AlertMoneyEvent,
  AlertParty,
  AlertPipeline,
} from './alertSystem';

// ─── Helpers ──────────────────────────────────────────────────────────────

const MICROS_PER_MS = 1000n;
const MICROS_PER_DAY = 86_400_000_000n;

function ts(iso: string): { microsSinceUnixEpoch: bigint } {
  return { microsSinceUnixEpoch: BigInt(Date.parse(iso)) * MICROS_PER_MS };
}

function nowMicros(iso: string): bigint {
  return BigInt(Date.parse(iso)) * MICROS_PER_MS;
}

function makeParty(overrides: Partial<AlertParty> & { id: bigint; name: string }): AlertParty {
  return {
    isCustomer: true,
    isSupplier: false,
    grade: { tag: 'A' },
    creditLimitFils: 30_000n,
    isCreditBlocked: false,
    ...overrides,
  };
}

function makeInvoice(
  id: bigint,
  partyId: bigint,
  totalFils: bigint,
  dueIso: string,
  createdIso: string,
): AlertMoneyEvent {
  return {
    id,
    partyId,
    kind: { tag: 'CustomerInvoice' },
    totalFils,
    dueDate: ts(dueIso),
    createdAt: ts(createdIso),
  };
}

function makePayment(
  id: bigint,
  partyId: bigint,
  totalFils: bigint,
  createdIso: string,
  kind = 'CustomerPayment',
): AlertMoneyEvent {
  return {
    id,
    partyId,
    kind: { tag: kind },
    totalFils,
    createdAt: ts(createdIso),
  };
}

function makePipeline(overrides: Partial<AlertPipeline> & { id: bigint; title: string }): AlertPipeline {
  return {
    partyId: 1n,
    status: { tag: 'Active' },
    estimatedValueFils: 10_000n,
    ...overrides,
  };
}

function emptyInput(now: string): AlertInput {
  return { parties: [], moneyEvents: [], pipelines: [], nowMicros: nowMicros(now) };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('alertSystem', () => {
  // 1. Credit limit breach → critical
  describe('rule: credit limit breach', () => {
    it('generates critical alert when outstanding exceeds credit limit', () => {
      const input: AlertInput = {
        parties: [makeParty({ id: 1n, name: 'EWA', creditLimitFils: 30_000n })],
        moneyEvents: [
          makeInvoice(1n, 1n, 45_000n, '2025-12-01', '2025-11-01'),
        ],
        pipelines: [],
        nowMicros: nowMicros('2026-01-15'),
      };
      const alerts = evaluateAlerts(input);
      const breach = alerts.find((a) => a.id === 'alert-credit-breach-1');
      assert.ok(breach, 'should produce a credit breach alert');
      assert.equal(breach.severity, 'critical');
      assert.equal(breach.category, 'finance');
      assert.ok(breach.message.includes('EWA'));
      assert.ok(breach.message.includes('45'));
      assert.ok(breach.message.includes('30'));
    });

    // 2. No breach when under limit
    it('does not generate alert when outstanding is under credit limit', () => {
      const input: AlertInput = {
        parties: [makeParty({ id: 1n, name: 'EWA', creditLimitFils: 50_000n })],
        moneyEvents: [
          makeInvoice(1n, 1n, 30_000n, '2025-12-01', '2025-11-01'),
        ],
        pipelines: [],
        nowMicros: nowMicros('2026-01-15'),
      };
      const alerts = evaluateAlerts(input);
      const breach = alerts.find((a) => a.id === 'alert-credit-breach-1');
      assert.equal(breach, undefined, 'should not produce credit breach alert');
    });
  });

  // 3. Severely overdue >90 days → critical
  describe('rule: severely overdue', () => {
    it('generates critical alert for invoices >90 days overdue', () => {
      const input: AlertInput = {
        parties: [makeParty({ id: 2n, name: 'BAPCO', creditLimitFils: 100_000n })],
        moneyEvents: [
          makeInvoice(10n, 2n, 8_000n, '2025-09-01', '2025-08-01'),
        ],
        pipelines: [],
        nowMicros: nowMicros('2026-01-15'), // >90 days after Sep 1
      };
      const alerts = evaluateAlerts(input);
      const overdue = alerts.find((a) => a.id === 'alert-severe-overdue-2');
      assert.ok(overdue, 'should produce severely overdue alert');
      assert.equal(overdue.severity, 'critical');
      assert.ok(overdue.message.includes('BAPCO'));
      assert.ok(overdue.message.includes('>90 days'));
    });
  });

  // 4. Moderately overdue 30-90 days → warning
  describe('rule: moderately overdue', () => {
    it('generates warning alert for invoices 30-90 days overdue', () => {
      const input: AlertInput = {
        parties: [makeParty({ id: 3n, name: 'Al Ezzel', creditLimitFils: 100_000n })],
        moneyEvents: [
          makeInvoice(20n, 3n, 5_000n, '2025-11-15', '2025-10-15'),
        ],
        pipelines: [],
        nowMicros: nowMicros('2026-01-15'), // ~61 days after Nov 15
      };
      const alerts = evaluateAlerts(input);
      const overdue = alerts.find((a) => a.id === 'alert-moderate-overdue-3');
      assert.ok(overdue, 'should produce moderately overdue alert');
      assert.equal(overdue.severity, 'warning');
      assert.ok(overdue.message.includes('Al Ezzel'));
      assert.ok(overdue.message.includes('30-90'));
    });
  });

  // 5. Not overdue → no alert
  describe('rule: not overdue', () => {
    it('generates no overdue alert for current invoices', () => {
      const input: AlertInput = {
        parties: [makeParty({ id: 4n, name: 'Fresh Co', creditLimitFils: 100_000n })],
        moneyEvents: [
          makeInvoice(30n, 4n, 5_000n, '2026-02-15', '2026-01-10'),
        ],
        pipelines: [],
        nowMicros: nowMicros('2026-01-15'), // due date is in the future
      };
      const alerts = evaluateAlerts(input);
      const severeOverdue = alerts.find((a) => a.id === 'alert-severe-overdue-4');
      const modOverdue = alerts.find((a) => a.id === 'alert-moderate-overdue-4');
      assert.equal(severeOverdue, undefined);
      assert.equal(modOverdue, undefined);
    });
  });

  // 6. Stale pipeline >14 days → warning
  describe('rule: stale pipeline', () => {
    it('generates warning alert when pipeline follow-up is >14 days overdue', () => {
      const input: AlertInput = {
        parties: [],
        moneyEvents: [],
        pipelines: [
          makePipeline({
            id: 100n,
            title: 'BAPCO Cerabar',
            status: { tag: 'Active' },
            nextFollowUp: ts('2025-12-01'),
          }),
        ],
        nowMicros: nowMicros('2026-01-15'), // 45 days after Dec 1
      };
      const alerts = evaluateAlerts(input);
      const stale = alerts.find((a) => a.id === 'alert-stale-pipeline-100');
      assert.ok(stale, 'should produce stale pipeline alert');
      assert.equal(stale.severity, 'warning');
      assert.ok(stale.message.includes('BAPCO Cerabar'));
      assert.ok(stale.message.includes('follow-up overdue'));
    });
  });

  // 7. Grade D with open invoices → warning
  describe('rule: grade D customer', () => {
    it('generates warning for grade D customer with open invoices', () => {
      const input: AlertInput = {
        parties: [makeParty({ id: 5n, name: 'SULB', grade: { tag: 'D' }, creditLimitFils: 50_000n })],
        moneyEvents: [
          makeInvoice(40n, 5n, 10_000n, '2026-02-01', '2026-01-01'),
        ],
        pipelines: [],
        nowMicros: nowMicros('2026-01-15'),
      };
      const alerts = evaluateAlerts(input);
      const gradeD = alerts.find((a) => a.id === 'alert-grade-d-5');
      assert.ok(gradeD, 'should produce grade D alert');
      assert.equal(gradeD.severity, 'warning');
      assert.ok(gradeD.message.includes('SULB'));
      assert.ok(gradeD.message.includes('advance payment'));
    });
  });

  // 8. filterBySeverity
  describe('filterBySeverity', () => {
    it('returns only alerts matching the given severity', () => {
      const input: AlertInput = {
        parties: [
          makeParty({ id: 1n, name: 'Over', creditLimitFils: 10_000n }),
        ],
        moneyEvents: [
          makeInvoice(1n, 1n, 20_000n, '2025-06-01', '2025-05-01'), // breach + severe overdue
        ],
        pipelines: [],
        nowMicros: nowMicros('2026-01-15'),
      };
      const alerts = evaluateAlerts(input);
      const critical = filterBySeverity(alerts, 'critical');
      assert.ok(critical.length > 0);
      for (const a of critical) {
        assert.equal(a.severity, 'critical');
      }
      const info = filterBySeverity(alerts, 'info');
      for (const a of info) {
        assert.equal(a.severity, 'info');
      }
    });
  });

  // 9. sortAlerts: critical before warning before info
  describe('sortAlerts', () => {
    it('sorts critical before warning before info', () => {
      const input: AlertInput = {
        parties: [
          makeParty({ id: 1n, name: 'BAPCO', creditLimitFils: 10_000n, grade: { tag: 'D' } }),
        ],
        moneyEvents: [
          // breach (critical) + severe overdue (critical) + grade D (warning) + new invoice (info)
          makeInvoice(1n, 1n, 20_000n, '2025-06-01', '2026-01-12'),
        ],
        pipelines: [],
        nowMicros: nowMicros('2026-01-15'),
      };
      const alerts = evaluateAlerts(input);
      const sorted = sortAlerts(alerts);
      assert.ok(sorted.length >= 3, `expected >=3 alerts, got ${sorted.length}`);

      // Verify ordering
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1].severity;
        const curr = sorted[i].severity;
        const order = { critical: 0, warning: 1, info: 2 } as const;
        assert.ok(
          order[prev] <= order[curr],
          `alert at index ${i - 1} (${prev}) should come before or equal to index ${i} (${curr})`,
        );
      }
    });
  });

  // 10. countBySeverity
  describe('countBySeverity', () => {
    it('returns correct counts per severity', () => {
      const input: AlertInput = {
        parties: [
          makeParty({ id: 1n, name: 'BAPCO', creditLimitFils: 10_000n }),
        ],
        moneyEvents: [
          makeInvoice(1n, 1n, 20_000n, '2025-06-01', '2026-01-12'),
        ],
        pipelines: [],
        nowMicros: nowMicros('2026-01-15'),
      };
      const alerts = evaluateAlerts(input);
      const counts = countBySeverity(alerts);
      assert.equal(typeof counts.critical, 'number');
      assert.equal(typeof counts.warning, 'number');
      assert.equal(typeof counts.info, 'number');
      assert.equal(
        counts.critical + counts.warning + counts.info,
        alerts.length,
        'counts should sum to total alerts',
      );
    });
  });

  // 11. Multiple rules: mixed alerts generated correctly
  describe('multiple rules combined', () => {
    it('generates mixed alerts from various rules simultaneously', () => {
      const now = '2026-01-15';
      const input: AlertInput = {
        parties: [
          makeParty({ id: 1n, name: 'EWA', creditLimitFils: 30_000n }),       // breach
          makeParty({ id: 2n, name: 'BAPCO', creditLimitFils: 100_000n }),     // severe overdue
          makeParty({ id: 3n, name: 'SULB', grade: { tag: 'D' }, creditLimitFils: 50_000n }), // grade D
        ],
        moneyEvents: [
          makeInvoice(1n, 1n, 45_000n, '2025-12-01', '2025-11-01'),           // breach for EWA
          makeInvoice(2n, 2n, 8_000n, '2025-09-01', '2025-08-01'),            // severe overdue for BAPCO
          makeInvoice(3n, 3n, 5_000n, '2026-02-01', '2026-01-10'),            // grade D for SULB + new invoice
          makePayment(4n, 1n, 2_000n, '2026-01-12'),                          // recent payment
        ],
        pipelines: [
          makePipeline({
            id: 100n,
            title: 'BAPCO expansion',
            nextFollowUp: ts('2026-01-16'), // 1 day from now → follow-up soon
          }),
          makePipeline({
            id: 101n,
            title: 'BAPCO Cerabar',
            nextFollowUp: ts('2025-12-01'), // stale
          }),
        ],
        nowMicros: nowMicros(now),
      };

      const alerts = evaluateAlerts(input);

      // Critical: credit breach (EWA) + severe overdue (BAPCO)
      const criticals = filterBySeverity(alerts, 'critical');
      assert.ok(criticals.length >= 2, `expected >=2 critical, got ${criticals.length}`);

      // Warning: grade D (SULB) + stale pipeline (Cerabar)
      const warnings = filterBySeverity(alerts, 'warning');
      assert.ok(warnings.length >= 2, `expected >=2 warnings, got ${warnings.length}`);

      // Info: new invoices this week + payments this week + follow-up soon
      const infos = filterBySeverity(alerts, 'info');
      assert.ok(infos.length >= 2, `expected >=2 info, got ${infos.length}`);

      // Verify deterministic IDs (no duplicates)
      const ids = alerts.map((a) => a.id);
      assert.equal(ids.length, new Set(ids).size, 'alert IDs must be unique');

      // Verify summary format
      const summary = formatAlertSummary(alerts);
      assert.ok(summary.includes('critical'));
      assert.ok(summary.includes('warning'));
      assert.ok(summary.includes('info'));
    });
  });

  describe('formatAlertSummary', () => {
    it('returns "No alerts" for empty list', () => {
      assert.equal(formatAlertSummary([]), 'No alerts');
    });
  });
});
