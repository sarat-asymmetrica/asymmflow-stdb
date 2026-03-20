import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getQuarterlyPeriods,
  getMonthlyPeriods,
  computeVATReturn,
  formatVATReturnReport,
  type VATMoneyEvent,
  type VATParty,
  type VATReturnPeriod,
} from "./vatReturn.js";

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Build a microsecond timestamp from an ISO date string */
function dateToMicros(dateStr: string): bigint {
  return BigInt(new Date(dateStr + "T12:00:00Z").getTime()) * 1000n;
}

function makeEvent(
  overrides: Partial<VATMoneyEvent> & { id: bigint; reference: string; kind: { tag: string } },
): VATMoneyEvent {
  return {
    partyId: 1n,
    subtotalFils: 0n,
    totalFils: 0n,
    createdAt: { microsSinceUnixEpoch: dateToMicros("2026-02-15") },
    ...overrides,
  };
}

const PARTIES: VATParty[] = [
  { id: 1n, name: "EWA" },
  { id: 2n, name: "BAPCO" },
  { id: 3n, name: "Endress+Hauser" },
];

const Q1_2026: VATReturnPeriod = {
  startDate: "2026-01-01",
  endDate: "2026-03-31",
  label: "Q1 2026",
};

// ─── getQuarterlyPeriods ──────────────────────────────────────────────────

describe("getQuarterlyPeriods", () => {
  it("returns 4 quarters with correct dates and labels", () => {
    const periods = getQuarterlyPeriods(2026);
    assert.equal(periods.length, 4);

    assert.deepStrictEqual(periods[0], {
      startDate: "2026-01-01",
      endDate: "2026-03-31",
      label: "Q1 2026",
    });
    assert.deepStrictEqual(periods[1], {
      startDate: "2026-04-01",
      endDate: "2026-06-30",
      label: "Q2 2026",
    });
    assert.deepStrictEqual(periods[2], {
      startDate: "2026-07-01",
      endDate: "2026-09-30",
      label: "Q3 2026",
    });
    assert.deepStrictEqual(periods[3], {
      startDate: "2026-10-01",
      endDate: "2026-12-31",
      label: "Q4 2026",
    });
  });

  it("handles leap year correctly (Feb end date)", () => {
    const periods = getQuarterlyPeriods(2024);
    assert.equal(periods[0].endDate, "2024-03-31");
    // Leap year doesn't change Q1 end, but let's check monthly for Feb
    const monthly = getMonthlyPeriods(2024);
    assert.equal(monthly[1].endDate, "2024-02-29");
  });
});

// ─── getMonthlyPeriods ────────────────────────────────────────────────────

describe("getMonthlyPeriods", () => {
  it("returns 12 months with correct dates", () => {
    const periods = getMonthlyPeriods(2026);
    assert.equal(periods.length, 12);

    assert.equal(periods[0].startDate, "2026-01-01");
    assert.equal(periods[0].endDate, "2026-01-31");
    assert.equal(periods[0].label, "January 2026");

    assert.equal(periods[1].startDate, "2026-02-01");
    assert.equal(periods[1].endDate, "2026-02-28");
    assert.equal(periods[1].label, "February 2026");

    assert.equal(periods[11].startDate, "2026-12-01");
    assert.equal(periods[11].endDate, "2026-12-31");
    assert.equal(periods[11].label, "December 2026");
  });
});

// ─── computeVATReturn: empty ──────────────────────────────────────────────

describe("computeVATReturn", () => {
  it("returns zeros when no events", () => {
    const result = computeVATReturn(Q1_2026, [], PARTIES);

    assert.equal(result.outputVAT.invoiceCount, 0);
    assert.equal(result.outputVAT.totalVATFils, 0n);
    assert.equal(result.outputVAT.totalSubtotalFils, 0n);
    assert.equal(result.outputVAT.totalFils, 0n);
    assert.equal(result.inputVAT.invoiceCount, 0);
    assert.equal(result.inputVAT.totalVATFils, 0n);
    assert.equal(result.netVATPayableFils, 0n);
  });

  // ─── Sales only ───────────────────────────────────────────────────────

  it("computes output VAT from customer invoices", () => {
    const events: VATMoneyEvent[] = [
      makeEvent({
        id: 1n,
        partyId: 1n,
        kind: { tag: "CustomerInvoice" },
        subtotalFils: 2000_000n,
        totalFils: 2200_000n,
        reference: "INV-001",
      }),
      makeEvent({
        id: 2n,
        partyId: 2n,
        kind: { tag: "CustomerInvoice" },
        subtotalFils: 1500_000n,
        totalFils: 1650_000n,
        reference: "INV-002",
      }),
    ];

    const result = computeVATReturn(Q1_2026, events, PARTIES);

    assert.equal(result.outputVAT.invoiceCount, 2);
    assert.equal(result.outputVAT.totalSubtotalFils, 3500_000n);
    assert.equal(result.outputVAT.totalVATFils, 350_000n);
    assert.equal(result.outputVAT.totalFils, 3850_000n);
    assert.equal(result.inputVAT.invoiceCount, 0);
    assert.equal(result.netVATPayableFils, 350_000n);
  });

  // ─── Purchases only ──────────────────────────────────────────────────

  it("computes input VAT from supplier invoices", () => {
    const events: VATMoneyEvent[] = [
      makeEvent({
        id: 10n,
        partyId: 3n,
        kind: { tag: "SupplierInvoice" },
        subtotalFils: 5000_000n,
        totalFils: 5500_000n,
        reference: "SINV-001",
      }),
    ];

    const result = computeVATReturn(Q1_2026, events, PARTIES);

    assert.equal(result.inputVAT.invoiceCount, 1);
    assert.equal(result.inputVAT.totalSubtotalFils, 5000_000n);
    assert.equal(result.inputVAT.totalVATFils, 500_000n);
    assert.equal(result.inputVAT.totalFils, 5500_000n);
    assert.equal(result.outputVAT.invoiceCount, 0);
    assert.equal(result.netVATPayableFils, -500_000n);
  });

  // ─── Mixed: positive net ──────────────────────────────────────────────

  it("computes correct net payable when output > input", () => {
    const events: VATMoneyEvent[] = [
      makeEvent({
        id: 1n,
        partyId: 1n,
        kind: { tag: "CustomerInvoice" },
        subtotalFils: 10000_000n,
        totalFils: 11000_000n,
        reference: "INV-001",
      }),
      makeEvent({
        id: 2n,
        partyId: 3n,
        kind: { tag: "SupplierInvoice" },
        subtotalFils: 3000_000n,
        totalFils: 3300_000n,
        reference: "SINV-001",
      }),
    ];

    const result = computeVATReturn(Q1_2026, events, PARTIES);

    // Output VAT = 1,000.000, Input VAT = 300.000, Net = 700.000
    assert.equal(result.outputVAT.totalVATFils, 1000_000n);
    assert.equal(result.inputVAT.totalVATFils, 300_000n);
    assert.equal(result.netVATPayableFils, 700_000n);
  });

  // ─── Refund scenario ─────────────────────────────────────────────────

  it("returns negative net when input VAT exceeds output (refund)", () => {
    const events: VATMoneyEvent[] = [
      makeEvent({
        id: 1n,
        partyId: 1n,
        kind: { tag: "CustomerInvoice" },
        subtotalFils: 1000_000n,
        totalFils: 1100_000n,
        reference: "INV-001",
      }),
      makeEvent({
        id: 2n,
        partyId: 3n,
        kind: { tag: "SupplierInvoice" },
        subtotalFils: 8000_000n,
        totalFils: 8800_000n,
        reference: "SINV-001",
      }),
    ];

    const result = computeVATReturn(Q1_2026, events, PARTIES);

    assert.equal(result.outputVAT.totalVATFils, 100_000n);
    assert.equal(result.inputVAT.totalVATFils, 800_000n);
    assert.equal(result.netVATPayableFils, -700_000n);
    assert.ok(result.netVATPayableFils < 0n, "net should be negative for refund");
  });

  // ─── Period filtering ────────────────────────────────────────────────

  it("excludes events outside the period", () => {
    const events: VATMoneyEvent[] = [
      // Inside Q1 2026
      makeEvent({
        id: 1n,
        partyId: 1n,
        kind: { tag: "CustomerInvoice" },
        subtotalFils: 1000_000n,
        totalFils: 1100_000n,
        reference: "INV-IN",
        createdAt: { microsSinceUnixEpoch: dateToMicros("2026-02-15") },
      }),
      // Before Q1 2026
      makeEvent({
        id: 2n,
        partyId: 1n,
        kind: { tag: "CustomerInvoice" },
        subtotalFils: 2000_000n,
        totalFils: 2200_000n,
        reference: "INV-BEFORE",
        createdAt: { microsSinceUnixEpoch: dateToMicros("2025-12-31") },
      }),
      // After Q1 2026
      makeEvent({
        id: 3n,
        partyId: 1n,
        kind: { tag: "CustomerInvoice" },
        subtotalFils: 3000_000n,
        totalFils: 3300_000n,
        reference: "INV-AFTER",
        createdAt: { microsSinceUnixEpoch: dateToMicros("2026-04-01") },
      }),
    ];

    const result = computeVATReturn(Q1_2026, events, PARTIES);

    assert.equal(result.outputVAT.invoiceCount, 1);
    assert.equal(result.outputVAT.items[0].reference, "INV-IN");
  });

  // ─── VAT derivation from totals ──────────────────────────────────────

  it("derives subtotal from total when subtotalFils is 0", () => {
    const events: VATMoneyEvent[] = [
      makeEvent({
        id: 1n,
        partyId: 1n,
        kind: { tag: "CustomerInvoice" },
        subtotalFils: 0n,            // zero — should be derived
        totalFils: 1100_000n,        // BHD 1,100.000 inclusive of 10% VAT
        reference: "INV-DERIVED",
      }),
    ];

    const result = computeVATReturn(Q1_2026, events, PARTIES);

    // subtotal = 1100_000 * 100 / 110 = 1000_000
    assert.equal(result.outputVAT.totalSubtotalFils, 1000_000n);
    assert.equal(result.outputVAT.totalVATFils, 100_000n);
    assert.equal(result.outputVAT.totalFils, 1100_000n);
  });

  it("does not derive when subtotalFils is provided", () => {
    const events: VATMoneyEvent[] = [
      makeEvent({
        id: 1n,
        partyId: 1n,
        kind: { tag: "CustomerInvoice" },
        subtotalFils: 1000_000n,
        totalFils: 1100_000n,
        reference: "INV-NORMAL",
      }),
    ];

    const result = computeVATReturn(Q1_2026, events, PARTIES);

    assert.equal(result.outputVAT.totalSubtotalFils, 1000_000n);
    assert.equal(result.outputVAT.totalVATFils, 100_000n);
  });

  // ─── Non-invoice events ignored ──────────────────────────────────────

  it("ignores payment events", () => {
    const events: VATMoneyEvent[] = [
      makeEvent({
        id: 1n,
        partyId: 1n,
        kind: { tag: "CustomerPayment" },
        subtotalFils: 1000_000n,
        totalFils: 1100_000n,
        reference: "PAY-001",
      }),
    ];

    const result = computeVATReturn(Q1_2026, events, PARTIES);

    assert.equal(result.outputVAT.invoiceCount, 0);
    assert.equal(result.inputVAT.invoiceCount, 0);
  });

  // ─── Summary text ────────────────────────────────────────────────────

  it("generates correct summary text", () => {
    const events: VATMoneyEvent[] = [
      makeEvent({
        id: 1n,
        partyId: 1n,
        kind: { tag: "CustomerInvoice" },
        subtotalFils: 2000_000n,
        totalFils: 2200_000n,
        reference: "INV-001",
      }),
      makeEvent({
        id: 2n,
        partyId: 3n,
        kind: { tag: "SupplierInvoice" },
        subtotalFils: 1000_000n,
        totalFils: 1100_000n,
        reference: "SINV-001",
      }),
    ];

    const result = computeVATReturn(Q1_2026, events, PARTIES);

    assert.ok(result.summary.includes("Q1 2026"));
    assert.ok(result.summary.includes("Output VAT BHD 200.000"));
    assert.ok(result.summary.includes("1 invoices"));
    assert.ok(result.summary.includes("Input VAT BHD 100.000"));
    assert.ok(result.summary.includes("1 purchases"));
    assert.ok(result.summary.includes("Net payable: BHD 100.000"));
  });
});

// ─── formatVATReturnReport ────────────────────────────────────────────────

describe("formatVATReturnReport", () => {
  it("contains expected sections and formatting", () => {
    const events: VATMoneyEvent[] = [
      makeEvent({
        id: 1n,
        partyId: 1n,
        kind: { tag: "CustomerInvoice" },
        subtotalFils: 2000_000n,
        totalFils: 2200_000n,
        reference: "INV-2026-001",
      }),
      makeEvent({
        id: 2n,
        partyId: 2n,
        kind: { tag: "CustomerInvoice" },
        subtotalFils: 1500_000n,
        totalFils: 1650_000n,
        reference: "INV-2026-002",
      }),
      makeEvent({
        id: 3n,
        partyId: 3n,
        kind: { tag: "SupplierInvoice" },
        subtotalFils: 5000_000n,
        totalFils: 5500_000n,
        reference: "SINV-001",
      }),
    ];

    const result = computeVATReturn(Q1_2026, events, PARTIES);
    const report = formatVATReturnReport(result);

    // Header
    assert.ok(report.includes("PH TRADING WLL — VAT RETURN"));
    assert.ok(report.includes("Period: Q1 2026 (2026-01-01 to 2026-03-31)"));

    // Section headers
    assert.ok(report.includes("OUTPUT VAT (Sales)"));
    assert.ok(report.includes("INPUT VAT (Purchases)"));

    // Line items
    assert.ok(report.includes("INV-2026-001"));
    assert.ok(report.includes("EWA"));
    assert.ok(report.includes("SINV-001"));
    assert.ok(report.includes("Endress+Hauser"));

    // Totals
    assert.ok(report.includes("TOTAL"));
    assert.ok(report.includes("2 invoices"));
    assert.ok(report.includes("1 invoices"));

    // Net
    assert.ok(report.includes("NET VAT PAYABLE: BHD"));

    // Separator lines
    assert.ok(report.includes("═══"));
    assert.ok(report.includes("───"));
  });
});
