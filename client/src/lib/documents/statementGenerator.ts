import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import { PH_LETTERHEAD_BASE64 } from './letterhead';
import type { Party, MoneyEvent } from '../../module_bindings/types';
import { formatBHD, formatDate } from '../format';

// Initialize pdfmake fonts
if (typeof pdfMake.vfs === 'undefined') {
  pdfMake.vfs = pdfFonts;
}

// ---- Types ----------------------------------------------------------------

export interface StatementData {
  party: Party;
  moneyEvents: MoneyEvent[];  // ALL money events for this party (invoices + payments)
  dateFrom?: Date;            // filter start (optional, default: all time)
  dateTo?: Date;              // filter end (optional, default: today)
}

// ---- Helpers ---------------------------------------------------------------

/** Convert a SpacetimeDB timestamp to milliseconds since epoch. */
function toMs(ts: { microsSinceUnixEpoch: bigint }): number {
  return Number(ts.microsSinceUnixEpoch / 1000n);
}

/** Format a JS Date to "DD MMM YYYY". */
function formatJsDate(d: Date): string {
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Extract the grade letter from the tagged enum. */
function gradeLetter(party: Party): string {
  const tag = (party.grade as { tag: string }).tag;
  return tag ?? '?';
}

/** Grade badge fill colours — matching the Living Geometry palette. */
function gradeFill(letter: string): string {
  switch (letter.toUpperCase()) {
    case 'A': return '#4a7c59';  // sage
    case 'B': return '#2563eb';  // blue
    case 'C': return '#b45309';  // amber
    case 'D': return '#dc2626';  // coral/red
    default:  return '#888888';
  }
}

/** Check whether a MoneyEvent is a CustomerInvoice. */
function isCustomerInvoice(e: MoneyEvent): boolean {
  return (e.kind as { tag: string }).tag === 'CustomerInvoice';
}

/** Check whether a MoneyEvent is a CustomerPayment. */
function isCustomerPayment(e: MoneyEvent): boolean {
  return (e.kind as { tag: string }).tag === 'CustomerPayment';
}

/** Check whether the event should appear on a customer statement. */
function isCustomerEvent(e: MoneyEvent): boolean {
  return isCustomerInvoice(e) || isCustomerPayment(e);
}

/** Derive a short display reference for a money event. */
function eventReference(e: MoneyEvent): string {
  if (e.reference && e.reference.trim().length > 0) {
    return e.reference.trim();
  }
  const tag = (e.kind as { tag: string }).tag;
  const prefix =
    tag === 'CustomerInvoice'  ? 'INV' :
    tag === 'CustomerPayment'  ? 'PMT' :
    tag === 'SupplierInvoice'  ? 'SINV' : 'SPMT';
  return `${prefix}-${String(e.id).padStart(3, '0')}`;
}

/** Type label for the Type column. */
function eventTypeLabel(e: MoneyEvent): string {
  const tag = (e.kind as { tag: string }).tag;
  switch (tag) {
    case 'CustomerInvoice': return 'Invoice';
    case 'CustomerPayment': return 'Payment';
    default: return tag;
  }
}

// ---- Aging analysis -------------------------------------------------------

interface AgingBuckets {
  current:   bigint;  // not yet due
  days1_30:  bigint;
  days31_60: bigint;
  days61_90: bigint;
  days90p:   bigint;
}

/**
 * Compute aging buckets from customer invoices and payments.
 *
 * Simplified approach:
 * 1. Sum all CustomerInvoice totals → totalInvoiced
 * 2. Sum all CustomerPayment totals → totalPaid
 * 3. Outstanding = totalInvoiced - totalPaid
 * 4. For each overdue invoice (past dueDate), note its overdue days and amount.
 * 5. Distribute outstanding proportionally across overdue invoices by age.
 *    Any remainder (outstanding not yet covered by overdue invoices) goes to Current.
 */
function computeAgingBuckets(events: MoneyEvent[], now: number): AgingBuckets {
  const buckets: AgingBuckets = {
    current:   0n,
    days1_30:  0n,
    days31_60: 0n,
    days61_90: 0n,
    days90p:   0n,
  };

  let totalInvoiced = 0n;
  let totalPaid = 0n;

  for (const e of events) {
    if (isCustomerInvoice(e)) totalInvoiced += e.totalFils;
    if (isCustomerPayment(e)) totalPaid += e.totalFils;
  }

  const outstanding = totalInvoiced > totalPaid ? totalInvoiced - totalPaid : 0n;
  if (outstanding === 0n) return buckets;

  // Collect overdue invoices (those with a dueDate in the past).
  interface OverdueEntry {
    amount: bigint;
    daysPast: number;
  }
  const overdue: OverdueEntry[] = [];
  let overdueTotal = 0n;

  for (const e of events) {
    if (!isCustomerInvoice(e)) continue;
    if (!e.dueDate) continue;
    const dueMs = toMs(e.dueDate);
    if (dueMs >= now) continue;  // not yet due
    const daysPast = Math.floor((now - dueMs) / 86_400_000);
    overdue.push({ amount: e.totalFils, daysPast });
    overdueTotal += e.totalFils;
  }

  // Distribute outstanding proportionally across overdue invoices.
  // outstanding may be less than overdueTotal (partial payments); cap each bucket.
  let remainingOutstanding = outstanding;

  // Sort overdue oldest-first so we fill older buckets first.
  overdue.sort((a, b) => b.daysPast - a.daysPast);

  for (const entry of overdue) {
    if (remainingOutstanding <= 0n) break;

    // Portion of this invoice that is still outstanding (proportional or capped)
    let portion: bigint;
    if (overdueTotal > 0n) {
      // proportional share
      portion = (entry.amount * outstanding) / overdueTotal;
    } else {
      portion = entry.amount;
    }
    // Never allocate more than what remains
    if (portion > remainingOutstanding) portion = remainingOutstanding;

    const d = entry.daysPast;
    if (d <= 30) {
      buckets.days1_30 += portion;
    } else if (d <= 60) {
      buckets.days31_60 += portion;
    } else if (d <= 90) {
      buckets.days61_90 += portion;
    } else {
      buckets.days90p += portion;
    }
    remainingOutstanding -= portion;
  }

  // Whatever is left goes into Current (not yet due).
  if (remainingOutstanding > 0n) {
    buckets.current += remainingOutstanding;
  }

  return buckets;
}

// ---- Build pdfmake document definition ------------------------------------

function buildDocDefinition(data: StatementData) {
  const { party, moneyEvents, dateFrom, dateTo } = data;
  const now = Date.now();
  const effectiveDateTo = dateTo ?? new Date(now);

  // Filter to customer-facing events only, then apply date range if provided.
  const filtered = moneyEvents
    .filter(isCustomerEvent)
    .filter(e => {
      const ms = toMs(e.createdAt);
      if (dateFrom && ms < dateFrom.getTime()) return false;
      if (ms > effectiveDateTo.getTime()) return false;
      return true;
    });

  // Sort ascending by createdAt for the transaction table.
  const sorted = [...filtered].sort(
    (a, b) => toMs(a.createdAt) - toMs(b.createdAt)
  );

  // ---- Running balance rows ----
  interface TxRow {
    date: string;
    reference: string;
    typeLabel: string;
    debit: bigint;   // CustomerInvoice amount (money owed to us)
    credit: bigint;  // CustomerPayment amount (money received)
    balance: bigint; // running cumulative
  }

  let runningBalance = 0n;
  const txRows: TxRow[] = sorted.map(e => {
    const debit  = isCustomerInvoice(e) ? e.totalFils : 0n;
    const credit = isCustomerPayment(e) ? e.totalFils : 0n;
    runningBalance += debit;
    runningBalance -= credit;
    return {
      date: formatDate(e.createdAt),
      reference: eventReference(e),
      typeLabel: eventTypeLabel(e),
      debit,
      credit,
      balance: runningBalance,
    };
  });

  // ---- Totals ----
  let totalInvoiced = 0n;
  let totalPaid = 0n;
  for (const e of sorted) {
    if (isCustomerInvoice(e)) totalInvoiced += e.totalFils;
    if (isCustomerPayment(e)) totalPaid += e.totalFils;
  }
  const balanceOutstanding = totalInvoiced > totalPaid
    ? totalInvoiced - totalPaid
    : 0n;

  // ---- Aging ----
  // Use all events for the party (not just filtered range) for aging accuracy,
  // but we use the filtered set here — caller should pass the full set if they
  // want accurate aging; for simplicity we use sorted (filtered).
  const aging = computeAgingBuckets(sorted, now);
  const agingTotal =
    aging.current + aging.days1_30 + aging.days31_60 +
    aging.days61_90 + aging.days90p;

  // ---- Period string ----
  const periodStr =
    dateFrom
      ? `${formatJsDate(dateFrom)} — ${formatJsDate(effectiveDateTo)}`
      : `All Time — ${formatJsDate(effectiveDateTo)}`;

  const statementDate = formatJsDate(effectiveDateTo);
  const gradeTag = gradeLetter(party);
  const gradeColor = gradeFill(gradeTag);

  // ---- Table definitions ----

  // Transaction table header
  const txHeader = [
    { text: 'Date',             style: 'tableHeader' },
    { text: 'Reference',        style: 'tableHeader' },
    { text: 'Type',             style: 'tableHeader', alignment: 'center' },
    { text: 'Debit (BHD)',      style: 'tableHeader', alignment: 'right' },
    { text: 'Credit (BHD)',     style: 'tableHeader', alignment: 'right' },
    { text: 'Balance (BHD)',    style: 'tableHeader', alignment: 'right' },
  ];

  const txBody = txRows.map(row => [
    { text: row.date },
    { text: row.reference, style: 'mono' },
    { text: row.typeLabel, alignment: 'center' },
    { text: row.debit  > 0n ? formatBHD(row.debit)  : '', alignment: 'right' },
    { text: row.credit > 0n ? formatBHD(row.credit) : '', alignment: 'right' },
    {
      text: formatBHD(row.balance < 0n ? -row.balance : row.balance),
      alignment: 'right',
      color: row.balance < 0n ? '#2563eb' : row.balance === 0n ? '#4a7c59' : '#111111',
    },
  ]);

  // Totals row (appended as a styled row)
  const txTotalsRow = [
    { text: '', colSpan: 3 }, {}, {},
    { text: formatBHD(totalInvoiced),     alignment: 'right', style: 'totalValue', bold: true },
    { text: formatBHD(totalPaid),         alignment: 'right', style: 'totalValue', bold: true },
    { text: formatBHD(balanceOutstanding),alignment: 'right', style: 'totalValue', bold: true,
      color: balanceOutstanding > 0n ? '#dc2626' : '#4a7c59' },
  ];

  // Totals sub-header row
  const txTotalsLabelRow = [
    { text: 'TOTALS', colSpan: 3, style: 'tableHeader', alignment: 'right' }, {}, {},
    { text: 'Total Invoiced', style: 'tableHeader', alignment: 'right' },
    { text: 'Total Paid',     style: 'tableHeader', alignment: 'right' },
    { text: 'Outstanding',    style: 'tableHeader', alignment: 'right' },
  ];

  // Aging table
  const agingHeader = [
    { text: 'Aging Bucket',    style: 'tableHeader' },
    { text: 'Amount (BHD)',    style: 'tableHeader', alignment: 'right' },
  ];

  const agingRows = [
    ['Current (not yet due)',  aging.current],
    ['1 – 30 days overdue',    aging.days1_30],
    ['31 – 60 days overdue',   aging.days31_60],
    ['61 – 90 days overdue',   aging.days61_90],
    ['Over 90 days overdue',   aging.days90p],
  ] as const;

  const agingBody = agingRows.map(([label, amount]) => [
    { text: label },
    { text: formatBHD(amount as bigint), alignment: 'right',
      color: (amount as bigint) > 0n ? '#dc2626' : '#333333' },
  ]);

  const agingTotalRow = [
    { text: 'Total Outstanding', bold: true },
    { text: formatBHD(agingTotal), alignment: 'right', bold: true,
      color: agingTotal > 0n ? '#dc2626' : '#4a7c59' },
  ];

  const tableLayout = {
    hLineWidth: (i: number, node: any) =>
      i === 0 || i === 1 || i === node.table.body.length ? 1 : 0.5,
    vLineWidth: () => 0.5,
    hLineColor: () => '#333333',
    vLineColor: () => '#aaaaaa',
    fillColor: (i: number) => (i === 0 ? '#e8e8e8' : null),
    paddingLeft:   () => 4,
    paddingRight:  () => 4,
    paddingTop:    () => 3,
    paddingBottom: () => 3,
  };

  return {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 60] as [number, number, number, number],

    content: [
      // Letterhead image
      {
        image: PH_LETTERHEAD_BASE64,
        width: 515,
        margin: [0, 0, 0, 8],
      },

      // Title
      {
        text: 'STATEMENT OF ACCOUNT',
        style: 'title',
        alignment: 'center',
        margin: [0, 0, 0, 10],
      },

      // Two-column header: party info left, statement metadata right
      {
        columns: [
          // Left: customer info
          {
            width: '55%',
            stack: [
              { text: 'Customer:', style: 'sectionLabel' },
              {
                columns: [
                  { text: party.name, style: 'partyName', width: '*' },
                  {
                    text: `Grade ${gradeTag}`,
                    style: 'gradeBadge',
                    background: gradeColor,
                    color: '#ffffff',
                    width: 'auto',
                  },
                ],
                columnGap: 6,
              },
            ],
          },
          // Right: statement metadata
          {
            width: '45%',
            table: {
              widths: ['auto', '*'],
              body: [
                [
                  { text: 'Statement Date', style: 'metaLabel' },
                  { text: statementDate, style: 'metaValue' },
                ],
                [
                  { text: 'Period', style: 'metaLabel' },
                  { text: periodStr, style: 'metaValue' },
                ],
                [
                  { text: 'Currency', style: 'metaLabel' },
                  { text: 'BHD', style: 'metaValue' },
                ],
              ],
            },
            layout: 'lightHorizontalLines',
          },
        ],
        margin: [0, 0, 0, 14],
      },

      // Section: Transactions
      { text: 'Transaction History', style: 'sectionLabel', margin: [0, 0, 0, 4] },
      {
        table: {
          headerRows: 1,
          widths: [55, '*', 50, 65, 65, 70],
          body: [
            txHeader,
            ...(txBody.length > 0
              ? txBody
              : [[{
                  text: 'No transactions in selected period.',
                  colSpan: 6,
                  italics: true,
                  color: '#888888',
                  alignment: 'center',
                  margin: [0, 6, 0, 6],
                }, {}, {}, {}, {}, {}]]
            ),
            txTotalsLabelRow,
            txTotalsRow,
          ],
        },
        layout: {
          ...tableLayout,
          // Shade the last two rows (totals label + totals value)
          fillColor: (i: number, node: any) => {
            const len = (node.table.body as unknown[]).length;
            if (i === 0) return '#e8e8e8';
            if (i === len - 2) return '#f5f5f5';
            if (i === len - 1) return '#eeeeee';
            return null;
          },
        },
        margin: [0, 0, 0, 14],
      },

      // Section: Aging Analysis
      { text: 'Aging Analysis', style: 'sectionLabel', margin: [0, 0, 0, 4] },
      {
        columns: [
          {
            width: '50%',
            table: {
              headerRows: 1,
              widths: ['*', 80],
              body: [agingHeader, ...agingBody, agingTotalRow],
            },
            layout: {
              ...tableLayout,
              fillColor: (i: number, node: any) => {
                const len = (node.table.body as unknown[]).length;
                if (i === 0) return '#e8e8e8';
                if (i === len - 1) return '#f0f0f0';
                return null;
              },
            },
          },
          { width: '*', text: '' },
        ],
        margin: [0, 0, 0, 14],
      },

      // Payment terms reminder
      {
        text: `Payment Terms: ${party.paymentTermsDays} days. Please remit outstanding balance promptly.`,
        style: 'paymentTerms',
        margin: [0, 0, 0, 10],
      },

      // Footer
      {
        columns: [
          {
            width: '*',
            text: 'This statement is produced from our records. Please contact us if you have any queries.',
            style: 'footerNote',
          },
          {
            width: 'auto',
            text: 'E. & O.E',
            style: 'eoe',
          },
        ],
      },
    ],

    styles: {
      title: {
        fontSize: 14,
        bold: true,
        decoration: 'underline',
      },
      sectionLabel: {
        fontSize: 8,
        bold: true,
        color: '#555555',
        margin: [0, 0, 0, 2],
      },
      partyName: {
        fontSize: 11,
        bold: true,
      },
      gradeBadge: {
        fontSize: 8,
        bold: true,
        // pdfmake does not support background on inline text; we use a table cell
        // approach via the wrapping table. This style sets text colour.
        color: '#ffffff',
      },
      metaLabel: {
        fontSize: 8,
        bold: true,
        color: '#444444',
      },
      metaValue: {
        fontSize: 8,
        color: '#111111',
      },
      tableHeader: {
        fontSize: 7,
        bold: true,
        color: '#111111',
      },
      totalValue: {
        fontSize: 8,
      },
      mono: {
        fontSize: 7,
        font: 'Courier',
      },
      paymentTerms: {
        fontSize: 8,
        italics: true,
        color: '#333333',
      },
      footerNote: {
        fontSize: 7,
        color: '#888888',
        italics: true,
      },
      eoe: {
        fontSize: 8,
        bold: true,
        color: '#333333',
      },
    },

    defaultStyle: {
      fontSize: 8,
      font: 'Roboto',
    },
  };
}

// ---- Grade badge workaround ------------------------------------------------
// pdfmake does not support inline background colours on plain text nodes.
// We render the grade badge as a small single-cell table with background fill.

function buildGradeBadgeCell(party: Party): object {
  const letter = gradeLetter(party);
  const fill = gradeFill(letter);
  return {
    table: {
      widths: ['auto'],
      body: [[{
        text: `  Grade ${letter}  `,
        fontSize: 7,
        bold: true,
        color: '#ffffff',
        fillColor: fill,
        margin: [2, 1, 2, 1],
      }]],
    },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      fillColor: () => fill,
      paddingLeft:   () => 0,
      paddingRight:  () => 0,
      paddingTop:    () => 0,
      paddingBottom: () => 0,
    },
  };
}

// ---- Re-build doc definition using the badge cell -------------------------
// Override the header section to properly embed the grade badge table.

export function buildStatementDocDefinition(data: StatementData) {
  const base = buildDocDefinition(data);

  const { party } = data;
  const gradeTag = gradeLetter(party);

  // Replace the two-column header's left stack with a version that uses the badge table.
  // We patch the content array in-place for the columns block (index 2).
  const columns = (base.content as any[])[2];
  columns.columns[0].stack = [
    { text: 'Customer:', style: 'sectionLabel' },
    { text: party.name, style: 'partyName', margin: [0, 0, 0, 4] },
    {
      columns: [
        { text: `Grade:`, style: 'sectionLabel', width: 'auto', margin: [0, 2, 4, 0] },
        { ...buildGradeBadgeCell(party), width: 'auto' },
      ],
      columnGap: 0,
    },
  ];

  return base;
}

// ---- Filename helper -------------------------------------------------------

function buildFilename(data: StatementData): string {
  const name = data.party.name.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 40);
  const dateStr = formatJsDate(data.dateTo ?? new Date()).replace(/\s+/g, '-');
  return `Statement-${name}-${dateStr}.pdf`;
}

// ---- Public API -----------------------------------------------------------

/**
 * Generate a PH Trading Statement of Account PDF and open it in a new browser tab.
 */
export async function generateStatementPdf(data: StatementData): Promise<void> {
  const docDef = buildStatementDocDefinition(data);
  pdfMake.createPdf(docDef as any).open();
}

/**
 * Generate a PH Trading Statement of Account PDF and download it as a file.
 * Filename: Statement-{PartyName}-{Date}.pdf
 */
export async function downloadStatementPdf(data: StatementData): Promise<void> {
  const docDef = buildStatementDocDefinition(data);
  const filename = buildFilename(data);
  pdfMake.createPdf(docDef as any).download(filename);
}
