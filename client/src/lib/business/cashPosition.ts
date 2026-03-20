// ─── Input types (decoupled from STDB store types) ────────────────────────

export interface CashMoneyEvent {
  partyId: bigint;
  kind: { tag: string };
  totalFils: bigint;
  dueDate?: { microsSinceUnixEpoch: bigint };
  createdAt: { microsSinceUnixEpoch: bigint };
}

export interface CashParty {
  id: bigint;
  isCustomer: boolean;
  isSupplier: boolean;
  grade: { tag: string };
  paymentTermsDays: bigint | number;
}

export interface CashBankTransaction {
  amountFils: bigint;
  matchStatus: { tag: string };
  isCredit: boolean;
}

// ─── Output types ──────────────────────────────────────────────────────────

export interface CashPositionSnapshot {
  /** Net cash position: total customer payments received minus total supplier payments made, in fils */
  netCashFils: bigint;
  /** Total customer payments received to date */
  totalCustomerPaymentsFils: bigint;
  /** Total supplier payments made to date */
  totalSupplierPaymentsFils: bigint;
  /** Reconciled bank balance from matched transactions (null if no bank data) */
  reconciledBankBalanceFils: bigint | null;
  /** Unreconciled difference (netCash - bankBalance, null if no bank data) */
  unreconciledDifferenceFils: bigint | null;
  /** Total outstanding receivables (customer invoices - customer payments) */
  totalReceivablesFils: bigint;
  /** Total outstanding payables (supplier invoices - supplier payments) */
  totalPayablesFils: bigint;
  /** Net working capital position (receivables - payables) */
  netWorkingCapitalFils: bigint;
}

export interface CashForecastBucket {
  /** Horizon in days (e.g. 30, 60, 90) */
  horizonDays: number;
  /** Expected inflows in this period (weighted by collection probability) */
  expectedInflowsFils: bigint;
  /** Expected outflows in this period */
  expectedOutflowsFils: bigint;
  /** Projected cash position at this horizon */
  projectedCashFils: bigint;
}

export interface CashForecast {
  currentPosition: CashPositionSnapshot;
  buckets: CashForecastBucket[];
  /** Cash runway in days at current monthly burn rate */
  runwayDays: number | null;
  /** Monthly burn rate (average of last 3 months supplier payments) */
  monthlyBurnFils: bigint;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const MICROS_PER_DAY = 86_400_000_000n;
const DEFAULT_MONTHLY_BURN_FILS = 4_500_000n;
const FORECAST_HORIZONS = [30, 60, 90] as const;

// ─── Helpers ───────────────────────────────────────────────────────────────

function microsToDate(micros: bigint): Date {
  return new Date(Number(micros / 1000n));
}

/** Return the UTC month key "YYYY-MM" for grouping by calendar month. */
function utcMonthKey(micros: bigint): string {
  const date = microsToDate(micros);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Calculate days between two timestamps in microseconds.
 * Positive if `target` is in the future relative to `now`, negative if in the past.
 */
function daysUntil(nowMicros: bigint, targetMicros: bigint): number {
  const diffMicros = targetMicros - nowMicros;
  // Use floating point division for sign-preserving day count, then truncate toward zero
  return Math.trunc(Number(diffMicros) / Number(MICROS_PER_DAY));
}

// ─── Collection probability ────────────────────────────────────────────────

/** Grade-based collection probability weight (0-1) for forecast */
export function collectionProbability(grade: string, daysUntilDue: number): number {
  // daysUntilDue > 0 means not yet due; <= 0 means due or overdue
  const daysOverdue = daysUntilDue <= 0 ? -daysUntilDue : 0;

  switch (grade) {
    case 'A': {
      if (daysOverdue > 90) return 0.60;
      if (daysOverdue > 30) return 0.80;
      return 0.95;
    }
    case 'B': {
      if (daysOverdue > 90) return 0.40;
      if (daysOverdue > 30) return 0.65;
      return 0.85;
    }
    case 'C': {
      if (daysOverdue > 30) return 0.30;
      return 0.50;
    }
    case 'D': {
      if (daysOverdue > 0) return 0.10;
      return 0.20;
    }
    default: {
      return 0.50;
    }
  }
}

// ─── Core: cash position snapshot ──────────────────────────────────────────

/** Compute the current cash position snapshot */
export function computeCashPosition(
  moneyEvents: CashMoneyEvent[],
  bankTransactions: CashBankTransaction[],
): CashPositionSnapshot {
  let totalCustomerPaymentsFils = 0n;
  let totalSupplierPaymentsFils = 0n;
  let totalCustomerInvoicesFils = 0n;
  let totalSupplierInvoicesFils = 0n;

  for (const event of moneyEvents) {
    switch (event.kind.tag) {
      case 'CustomerPayment':
        totalCustomerPaymentsFils += event.totalFils;
        break;
      case 'SupplierPayment':
        totalSupplierPaymentsFils += event.totalFils;
        break;
      case 'CustomerInvoice':
        totalCustomerInvoicesFils += event.totalFils;
        break;
      case 'SupplierInvoice':
        totalSupplierInvoicesFils += event.totalFils;
        break;
    }
  }

  const netCashFils = totalCustomerPaymentsFils - totalSupplierPaymentsFils;

  // Receivables: what customers owe us (invoiced - paid), floored at zero
  const rawReceivables = totalCustomerInvoicesFils - totalCustomerPaymentsFils;
  const totalReceivablesFils = rawReceivables > 0n ? rawReceivables : 0n;

  // Payables: what we owe suppliers (invoiced - paid), floored at zero
  const rawPayables = totalSupplierInvoicesFils - totalSupplierPaymentsFils;
  const totalPayablesFils = rawPayables > 0n ? rawPayables : 0n;

  const netWorkingCapitalFils = totalReceivablesFils - totalPayablesFils;

  // Bank reconciliation
  let reconciledBankBalanceFils: bigint | null = null;
  let unreconciledDifferenceFils: bigint | null = null;

  if (bankTransactions.length > 0) {
    let bankBalance = 0n;
    for (const txn of bankTransactions) {
      if (txn.matchStatus.tag === 'Matched') {
        bankBalance += txn.isCredit ? txn.amountFils : -txn.amountFils;
      }
    }
    reconciledBankBalanceFils = bankBalance;
    unreconciledDifferenceFils = netCashFils - bankBalance;
  }

  return {
    netCashFils,
    totalCustomerPaymentsFils,
    totalSupplierPaymentsFils,
    reconciledBankBalanceFils,
    unreconciledDifferenceFils,
    totalReceivablesFils,
    totalPayablesFils,
    netWorkingCapitalFils,
  };
}

// ─── Monthly burn rate ─────────────────────────────────────────────────────

function computeMonthlyBurn(moneyEvents: CashMoneyEvent[], nowMicros: bigint): bigint {
  // Gather supplier payments grouped by calendar month
  const monthTotals = new Map<string, bigint>();

  for (const event of moneyEvents) {
    if (event.kind.tag !== 'SupplierPayment') continue;
    const key = utcMonthKey(event.createdAt.microsSinceUnixEpoch);
    monthTotals.set(key, (monthTotals.get(key) ?? 0n) + event.totalFils);
  }

  if (monthTotals.size === 0) return DEFAULT_MONTHLY_BURN_FILS;

  // Sort months descending and take the last 3 complete calendar months
  // Exclude the current month (may be incomplete)
  const currentMonthKey = utcMonthKey(nowMicros);
  const sortedMonths = [...monthTotals.keys()]
    .filter((key) => key !== currentMonthKey)
    .sort()
    .reverse()
    .slice(0, 3);

  if (sortedMonths.length === 0) {
    // Only current month data exists — use it as-is
    return monthTotals.get(currentMonthKey) ?? DEFAULT_MONTHLY_BURN_FILS;
  }

  let total = 0n;
  for (const month of sortedMonths) {
    total += monthTotals.get(month) ?? 0n;
  }

  return total / BigInt(sortedMonths.length);
}

// ─── Core: cash forecast ───────────────────────────────────────────────────

/** Compute 30/60/90 day cash forecast */
export function computeCashForecast(
  moneyEvents: CashMoneyEvent[],
  parties: CashParty[],
  bankTransactions: CashBankTransaction[],
  nowMicros: bigint,
): CashForecast {
  const currentPosition = computeCashPosition(moneyEvents, bankTransactions);

  // Build party lookup for grade resolution
  const partyMap = new Map<bigint, CashParty>();
  for (const party of parties) {
    partyMap.set(party.id, party);
  }

  // Separate outstanding invoices by direction
  // An invoice contributes to inflows (customer) or outflows (supplier) if there is
  // net outstanding balance for that party in that direction.
  // For simplicity, we accumulate per-party net balances, then attribute individual
  // invoices' due dates for forecasting.

  // Collect all customer invoices with due dates (potential inflows)
  const customerInvoices: Array<{
    partyId: bigint;
    totalFils: bigint;
    dueMicros: bigint;
  }> = [];

  // Collect all supplier invoices with due dates (potential outflows)
  const supplierInvoices: Array<{
    totalFils: bigint;
    dueMicros: bigint;
  }> = [];

  // Track per-party payment totals to determine outstanding amounts
  const customerInvoicedByParty = new Map<bigint, bigint>();
  const customerPaidByParty = new Map<bigint, bigint>();
  const supplierInvoicedTotal = { value: 0n };
  const supplierPaidTotal = { value: 0n };

  for (const event of moneyEvents) {
    switch (event.kind.tag) {
      case 'CustomerInvoice': {
        customerInvoicedByParty.set(
          event.partyId,
          (customerInvoicedByParty.get(event.partyId) ?? 0n) + event.totalFils,
        );
        if (event.dueDate) {
          customerInvoices.push({
            partyId: event.partyId,
            totalFils: event.totalFils,
            dueMicros: event.dueDate.microsSinceUnixEpoch,
          });
        }
        break;
      }
      case 'CustomerPayment': {
        customerPaidByParty.set(
          event.partyId,
          (customerPaidByParty.get(event.partyId) ?? 0n) + event.totalFils,
        );
        break;
      }
      case 'SupplierInvoice': {
        supplierInvoicedTotal.value += event.totalFils;
        if (event.dueDate) {
          supplierInvoices.push({
            totalFils: event.totalFils,
            dueMicros: event.dueDate.microsSinceUnixEpoch,
          });
        }
        break;
      }
      case 'SupplierPayment': {
        supplierPaidTotal.value += event.totalFils;
        break;
      }
    }
  }

  // Determine which customer invoices are still outstanding (per-party net > 0)
  // and cap the forecast-eligible amount at the outstanding balance.
  // Sort invoices by due date (earliest first) and attribute payments FIFO.
  const outstandingCustomerInvoices: Array<{
    partyId: bigint;
    remainingFils: bigint;
    dueMicros: bigint;
  }> = [];

  // Group customer invoices by party, sort by due date, apply payments FIFO
  const invoicesByParty = new Map<bigint, typeof customerInvoices>();
  for (const inv of customerInvoices) {
    const list = invoicesByParty.get(inv.partyId) ?? [];
    list.push(inv);
    invoicesByParty.set(inv.partyId, list);
  }

  for (const [partyId, invoices] of invoicesByParty) {
    const paid = customerPaidByParty.get(partyId) ?? 0n;
    let remainingPayment = paid;

    // Sort by due date ascending (pay off oldest first)
    const sorted = invoices.slice().sort((a, b) =>
      a.dueMicros < b.dueMicros ? -1 : a.dueMicros > b.dueMicros ? 1 : 0,
    );

    for (const inv of sorted) {
      if (remainingPayment >= inv.totalFils) {
        remainingPayment -= inv.totalFils;
        // Fully paid — skip
      } else {
        const remaining = inv.totalFils - remainingPayment;
        remainingPayment = 0n;
        outstandingCustomerInvoices.push({
          partyId,
          remainingFils: remaining,
          dueMicros: inv.dueMicros,
        });
      }
    }
  }

  // For supplier invoices, apply payments FIFO globally (simplified)
  const outstandingSupplierInvoices: Array<{
    remainingFils: bigint;
    dueMicros: bigint;
  }> = [];

  {
    let remainingPayment = supplierPaidTotal.value;
    const sorted = supplierInvoices.slice().sort((a, b) =>
      a.dueMicros < b.dueMicros ? -1 : a.dueMicros > b.dueMicros ? 1 : 0,
    );

    for (const inv of sorted) {
      if (remainingPayment >= inv.totalFils) {
        remainingPayment -= inv.totalFils;
      } else {
        const remaining = inv.totalFils - remainingPayment;
        remainingPayment = 0n;
        outstandingSupplierInvoices.push({
          remainingFils: remaining,
          dueMicros: inv.dueMicros,
        });
      }
    }
  }

  // Build forecast buckets
  const buckets: CashForecastBucket[] = FORECAST_HORIZONS.map((horizonDays) => {
    const horizonMicros = nowMicros + BigInt(horizonDays) * MICROS_PER_DAY;

    // Expected inflows: outstanding customer invoices due within this horizon,
    // weighted by collection probability
    let expectedInflowsFils = 0n;
    for (const inv of outstandingCustomerInvoices) {
      if (inv.dueMicros <= horizonMicros) {
        const party = partyMap.get(inv.partyId);
        const grade = party?.grade.tag ?? 'C';
        const days = daysUntil(nowMicros, inv.dueMicros);
        const probability = collectionProbability(grade, days);
        // Convert to bigint: multiply fils by probability (use integer math with 10000 scale)
        const scaledProbability = BigInt(Math.round(probability * 10000));
        expectedInflowsFils += (inv.remainingFils * scaledProbability) / 10000n;
      }
    }

    // Expected outflows: outstanding supplier invoices due within this horizon
    let expectedOutflowsFils = 0n;
    for (const inv of outstandingSupplierInvoices) {
      if (inv.dueMicros <= horizonMicros) {
        expectedOutflowsFils += inv.remainingFils;
      }
    }

    const projectedCashFils = currentPosition.netCashFils + expectedInflowsFils - expectedOutflowsFils;

    return {
      horizonDays,
      expectedInflowsFils,
      expectedOutflowsFils,
      projectedCashFils,
    };
  });

  // Monthly burn and runway
  const monthlyBurnFils = computeMonthlyBurn(moneyEvents, nowMicros);

  let runwayDays: number | null = null;
  if (monthlyBurnFils > 0n) {
    if (currentPosition.netCashFils <= 0n) {
      runwayDays = 0;
    } else {
      const dailyBurnFils = Number(monthlyBurnFils) / 30;
      runwayDays = dailyBurnFils > 0 ? Math.floor(Number(currentPosition.netCashFils) / dailyBurnFils) : null;
    }
  }

  return {
    currentPosition,
    buckets,
    runwayDays,
    monthlyBurnFils,
  };
}
