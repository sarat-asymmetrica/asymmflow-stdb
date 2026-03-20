// ─── Input types (decoupled from STDB store types) ────────────────────────

export interface VATMoneyEvent {
  id: bigint;
  partyId: bigint;
  kind: { tag: string };
  subtotalFils: bigint;
  totalFils: bigint;
  reference: string;
  createdAt: { microsSinceUnixEpoch: bigint };
}

export interface VATParty {
  id: bigint;
  name: string;
}

// ─── Output types ─────────────────────────────────────────────────────────

export interface VATReturnPeriod {
  /** Period start (inclusive), ISO date string YYYY-MM-DD */
  startDate: string;
  /** Period end (inclusive), ISO date string YYYY-MM-DD */
  endDate: string;
  /** Human label, e.g. "Q1 2026" or "March 2026" */
  label: string;
}

export interface VATReturnLineItem {
  /** Money event reference */
  reference: string;
  /** Party name */
  partyName: string;
  /** Event date ISO string */
  date: string;
  /** Subtotal (pre-VAT) in fils */
  subtotalFils: bigint;
  /** VAT amount in fils */
  vatFils: bigint;
  /** Total (inc VAT) in fils */
  totalFils: bigint;
}

export interface VATReturnSection {
  items: VATReturnLineItem[];
  totalSubtotalFils: bigint;
  totalVATFils: bigint;
  totalFils: bigint;
  invoiceCount: number;
}

export interface VATReturnResult {
  period: VATReturnPeriod;
  /** Output VAT: VAT collected on customer invoices */
  outputVAT: VATReturnSection;
  /** Input VAT: VAT paid on supplier invoices */
  inputVAT: VATReturnSection;
  /** Net VAT payable (output - input). Positive = owe tax authority, negative = refund due */
  netVATPayableFils: bigint;
  /** Summary text */
  summary: string;
}

// ─── Period helpers ───────────────────────────────────────────────────────

const QUARTER_LABELS = ["Q1", "Q2", "Q3", "Q4"] as const;
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Last day of a given month (1-indexed) in a given year */
function lastDayOfMonth(year: number, month: number): number {
  // Day 0 of next month = last day of this month
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Create standard Bahrain VAT periods (quarterly) for a given year */
export function getQuarterlyPeriods(year: number): VATReturnPeriod[] {
  return QUARTER_LABELS.map((label, qi) => {
    const startMonth = qi * 3 + 1;
    const endMonth = startMonth + 2;
    return {
      startDate: `${year}-${pad2(startMonth)}-01`,
      endDate: `${year}-${pad2(endMonth)}-${pad2(lastDayOfMonth(year, endMonth))}`,
      label: `${label} ${year}`,
    };
  });
}

/** Create monthly periods for a given year */
export function getMonthlyPeriods(year: number): VATReturnPeriod[] {
  return MONTH_NAMES.map((name, i) => {
    const month = i + 1;
    return {
      startDate: `${year}-${pad2(month)}-01`,
      endDate: `${year}-${pad2(month)}-${pad2(lastDayOfMonth(year, month))}`,
      label: `${name} ${year}`,
    };
  });
}

// ─── Core computation ─────────────────────────────────────────────────────

/** Convert an ISO date string (YYYY-MM-DD) to microseconds since Unix epoch at 00:00:00 UTC */
function dateToMicros(dateStr: string, endOfDay: boolean): bigint {
  const d = new Date(dateStr + "T00:00:00Z");
  let ms = BigInt(d.getTime());
  if (endOfDay) {
    // 23:59:59.999999 → add (24h - 1μs) worth of milliseconds then handle micros
    // More precisely: 23*3600 + 59*60 + 59 = 86399 seconds, plus 999999 microseconds
    const dayEndMicros = 86399n * 1_000_000n + 999_999n;
    return ms * 1000n + dayEndMicros;
  }
  return ms * 1000n;
}

/** Derive subtotal and VAT from an event. Handles the zero-subtotal case. */
function deriveAmounts(event: VATMoneyEvent): {
  subtotalFils: bigint;
  vatFils: bigint;
  totalFils: bigint;
} {
  let subtotalFils = event.subtotalFils;
  const totalFils = event.totalFils;

  // If subtotalFils is 0 but totalFils > 0, reverse-calculate from 10% VAT
  if (subtotalFils === 0n && totalFils > 0n) {
    subtotalFils = totalFils * 100n / 110n;
  }

  const vatFils = totalFils - subtotalFils;
  return { subtotalFils, vatFils, totalFils };
}

function buildSection(
  events: VATMoneyEvent[],
  partyMap: Map<bigint, string>,
): VATReturnSection {
  const items: VATReturnLineItem[] = [];
  let totalSubtotalFils = 0n;
  let totalVATFils = 0n;
  let totalFils = 0n;

  for (const ev of events) {
    const amounts = deriveAmounts(ev);
    const eventMicros = ev.createdAt.microsSinceUnixEpoch;
    const eventMs = Number(eventMicros / 1000n);
    const eventDate = new Date(eventMs).toISOString().slice(0, 10);

    items.push({
      reference: ev.reference,
      partyName: partyMap.get(ev.partyId) ?? "Unknown",
      date: eventDate,
      subtotalFils: amounts.subtotalFils,
      vatFils: amounts.vatFils,
      totalFils: amounts.totalFils,
    });

    totalSubtotalFils += amounts.subtotalFils;
    totalVATFils += amounts.vatFils;
    totalFils += amounts.totalFils;
  }

  return { items, totalSubtotalFils, totalVATFils, totalFils, invoiceCount: items.length };
}

/** Compute VAT for a specific period from the MoneyEvent ledger */
export function computeVATReturn(
  period: VATReturnPeriod,
  moneyEvents: VATMoneyEvent[],
  parties: VATParty[],
): VATReturnResult {
  const partyMap = new Map<bigint, string>();
  for (const p of parties) {
    partyMap.set(p.id, p.name);
  }

  const startMicros = dateToMicros(period.startDate, false);
  const endMicros = dateToMicros(period.endDate, true);

  const inPeriod = moneyEvents.filter((ev) => {
    const t = ev.createdAt.microsSinceUnixEpoch;
    return t >= startMicros && t <= endMicros;
  });

  const salesEvents = inPeriod.filter((ev) => ev.kind.tag === "CustomerInvoice");
  const purchaseEvents = inPeriod.filter((ev) => ev.kind.tag === "SupplierInvoice");

  const outputVAT = buildSection(salesEvents, partyMap);
  const inputVAT = buildSection(purchaseEvents, partyMap);
  const netVATPayableFils = outputVAT.totalVATFils - inputVAT.totalVATFils;

  const summary =
    `${period.label}: Output VAT BHD ${formatBHD(outputVAT.totalVATFils)} on ${outputVAT.invoiceCount} invoices, ` +
    `Input VAT BHD ${formatBHD(inputVAT.totalVATFils)} on ${inputVAT.invoiceCount} purchases. ` +
    `Net payable: BHD ${formatBHD(netVATPayableFils)}`;

  return { period, outputVAT, inputVAT, netVATPayableFils, summary };
}

// ─── Formatting ───────────────────────────────────────────────────────────

/** Format fils as BHD string with thousands separators, e.g. "4,500.000" */
export function formatBHD(fils: bigint): string {
  const negative = fils < 0n;
  const absFils = negative ? -fils : fils;
  const raw = (Number(absFils) / 1000).toFixed(3);
  // Add thousands separators to integer part
  const [intPart, decPart] = raw.split(".");
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (negative ? "-" : "") + withCommas + "." + decPart;
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s : s + " ".repeat(len - s.length);
}

function padLeft(s: string, len: number): string {
  return s.length >= len ? s : " ".repeat(len - s.length) + s;
}

function formatSectionLines(section: VATReturnSection, label: string): string {
  const lines: string[] = [];
  lines.push(`${label}`);
  lines.push("───────────────────────────────────────────");

  for (const item of section.items) {
    lines.push(
      `  ${padRight(item.reference, 14)} ${padRight(item.partyName, 16)} ` +
      `${padLeft(formatBHD(item.subtotalFils), 12)} ` +
      `${padLeft(formatBHD(item.vatFils), 10)} ` +
      `${padLeft(formatBHD(item.totalFils), 12)}`,
    );
  }

  const countLabel = `${section.invoiceCount} invoices`;
  lines.push(
    `  ${"TOTAL".padEnd(14)} ${padRight(countLabel, 16)} ` +
    `${padLeft(formatBHD(section.totalSubtotalFils), 12)} ` +
    `${padLeft(formatBHD(section.totalVATFils), 10)} ` +
    `${padLeft(formatBHD(section.totalFils), 12)}`,
  );

  return lines.join("\n");
}

/** Format a VAT return as a text report */
export function formatVATReturnReport(result: VATReturnResult): string {
  const lines: string[] = [];
  lines.push("PH TRADING WLL — VAT RETURN");
  lines.push(`Period: ${result.period.label} (${result.period.startDate} to ${result.period.endDate})`);
  lines.push("═══════════════════════════════════════════");
  lines.push("");
  lines.push(formatSectionLines(result.outputVAT, "OUTPUT VAT (Sales)"));
  lines.push("");
  lines.push(formatSectionLines(result.inputVAT, "INPUT VAT (Purchases)"));
  lines.push("");
  lines.push(`NET VAT PAYABLE: BHD ${formatBHD(result.netVATPayableFils)}`);
  return lines.join("\n");
}
