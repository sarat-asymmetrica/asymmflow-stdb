import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import { PH_LETTERHEAD_BASE64 } from './letterhead';
import type { Party } from '../../module_bindings/types';
import { formatBHD } from '../format';

// Initialize pdfmake fonts (idempotent guard matches invoiceGenerator pattern)
if (typeof pdfMake.vfs === 'undefined') {
  pdfMake.vfs = pdfFonts;
}

// ── Public types ─────────────────────────────────────────────────────────────

export type ChaseChannel = 'whatsapp' | 'email' | 'formal_letter';
export type ChaseTone = 'friendly' | 'firm' | 'final_notice';

export interface ChaseData {
  party: Party;
  outstandingFils: bigint;
  overdueDays: number;
  overdueInvoices: Array<{
    reference: string;
    totalFils: bigint;
    dueDate?: string;
  }>;
  channel: ChaseChannel;
  toneOverride?: ChaseTone;
}

export interface ChaseResult {
  subject: string;
  body: string;
  tone: ChaseTone;
  channel: ChaseChannel;
}

// ── PH Trading constants ──────────────────────────────────────────────────────

const SELLER_NAME = 'PH Trading W.L.L.';
const SELLER_TEL = '+973 17 587654';
const SELLER_NAME_FORMAL = 'PH TRADING W.L.L.';
const SELLER_ADDRESS1 = 'Flat/Shop No. 91, Building 198';
const SELLER_ADDRESS2 = 'Road/Street 2803, AL SEEF, Block 428';
const SELLER_ADDRESS3 = 'Kingdom of Bahrain';

// ── Tone determination ────────────────────────────────────────────────────────

/**
 * Derive the appropriate chase tone from the customer grade tag ('A'|'B'|'C'|'D')
 * and the number of days the payment is overdue.
 *
 * Grade A (excellent payer — unusual to be late):
 *   0–30d  → friendly
 *   31–60d → firm
 *   61+d   → final_notice
 *
 * Grade B (standard):
 *   0–15d  → friendly
 *   16–45d → firm
 *   46+d   → final_notice
 *
 * Grade C (cash terms, should not have credit):
 *   0–7d   → firm
 *   8+d    → final_notice
 *
 * Grade D (chronic non-payer):
 *   always → final_notice
 */
export function determineTone(gradeTag: string, overdueDays: number): ChaseTone {
  const grade = gradeTag.toUpperCase();

  switch (grade) {
    case 'A':
      if (overdueDays <= 30) return 'friendly';
      if (overdueDays <= 60) return 'firm';
      return 'final_notice';

    case 'B':
      if (overdueDays <= 15) return 'friendly';
      if (overdueDays <= 45) return 'firm';
      return 'final_notice';

    case 'C':
      if (overdueDays <= 7) return 'firm';
      return 'final_notice';

    case 'D':
    default:
      return 'final_notice';
  }
}

// ── Invoice list formatters ───────────────────────────────────────────────────

interface InvoiceLine {
  reference: string;
  totalFils: bigint;
  dueDate?: string;
}

function formatInvoiceLinesFriendly(invoices: InvoiceLine[]): string {
  return invoices
    .map((inv) => {
      const due = inv.dueDate ? ` (due: ${inv.dueDate})` : '';
      return `• ${inv.reference} — BHD ${formatBHD(inv.totalFils)}${due}`;
    })
    .join('\n');
}

function formatInvoiceLinesOverdue(invoices: InvoiceLine[], overdueDays: number): string {
  return invoices
    .map((inv) => {
      return `• ${inv.reference} — BHD ${formatBHD(inv.totalFils)} (${overdueDays} days past due)`;
    })
    .join('\n');
}

function formatInvoiceLinesOverdueLabel(invoices: InvoiceLine[], overdueDays: number): string {
  return invoices
    .map((inv) => {
      return `• ${inv.reference} — BHD ${formatBHD(inv.totalFils)} (${overdueDays} days overdue)`;
    })
    .join('\n');
}

// ── Message body builders ─────────────────────────────────────────────────────

function buildFriendlyWhatsApp(data: ChaseData): string {
  const { party, outstandingFils, overdueDays, overdueInvoices } = data;
  const invoiceLines = formatInvoiceLinesFriendly(overdueInvoices);

  return [
    `Salaam ${party.name},`,
    '',
    `Hope you're doing well! This is a gentle reminder regarding the following invoice(s):`,
    '',
    invoiceLines,
    '',
    `Total outstanding: BHD ${formatBHD(outstandingFils)}`,
    '',
    `Could you kindly arrange the payment at your earliest convenience? If already processed, please share the transfer reference so we can update our records.`,
    '',
    `Thank you!`,
    SELLER_NAME,
  ].join('\n');
}

function buildFirmWhatsApp(data: ChaseData): string {
  const { party, outstandingFils, overdueDays, overdueInvoices } = data;
  const invoiceLines = formatInvoiceLinesOverdue(overdueInvoices, overdueDays);

  return [
    `Dear ${party.name},`,
    '',
    `We are writing regarding overdue payment(s) on your account:`,
    '',
    invoiceLines,
    '',
    `Total outstanding: BHD ${formatBHD(outstandingFils)}`,
    '',
    `As per our agreed terms, this amount was due ${overdueDays} days ago. We kindly request immediate settlement to avoid any impact on your account terms.`,
    '',
    `Please remit to our bank account and share the reference. If there are any concerns regarding these invoices, please contact us immediately.`,
    '',
    SELLER_NAME,
    `Tel: ${SELLER_TEL}`,
  ].join('\n');
}

function buildFinalNoticeWhatsApp(data: ChaseData): string {
  const { party, outstandingFils, overdueDays, overdueInvoices } = data;
  const invoiceLines = formatInvoiceLinesOverdueLabel(overdueInvoices, overdueDays);

  return [
    `URGENT — Final Payment Notice`,
    '',
    `Dear ${party.name},`,
    '',
    `Despite previous reminders, the following invoices remain unpaid:`,
    '',
    invoiceLines,
    '',
    `Total outstanding: BHD ${formatBHD(outstandingFils)}`,
    '',
    `Please note:`,
    `- Your account has been flagged for credit review`,
    `- No further orders will be processed until this balance is cleared`,
    `- We reserve the right to pursue formal collection proceedings`,
    '',
    `We urge you to settle this amount within 7 business days.`,
    '',
    SELLER_NAME,
    `Tel: ${SELLER_TEL}`,
  ].join('\n');
}

// ── Subject lines ─────────────────────────────────────────────────────────────

function buildSubject(party: Party, tone: ChaseTone): string {
  switch (tone) {
    case 'friendly':
      return `Payment Reminder — ${party.name}`;
    case 'firm':
      return `Overdue Payment Notice — ${party.name}`;
    case 'final_notice':
      return `URGENT: Final Payment Notice — ${party.name}`;
  }
}

// ── Main text generator ───────────────────────────────────────────────────────

/**
 * Generate a chase message (text for WhatsApp/email, or a ChaseResult for
 * formal_letter channel — use generateChasePdf to produce the actual PDF).
 */
export function generateChaseMessage(data: ChaseData): ChaseResult {
  const gradeTag = (data.party.grade as any)?.tag ?? 'C';
  const tone = data.toneOverride ?? determineTone(gradeTag, data.overdueDays);

  let body: string;

  switch (tone) {
    case 'friendly':
      body = buildFriendlyWhatsApp(data);
      break;
    case 'firm':
      body = buildFirmWhatsApp(data);
      break;
    case 'final_notice':
      body = buildFinalNoticeWhatsApp(data);
      break;
  }

  return {
    subject: buildSubject(data.party, tone),
    body,
    tone,
    channel: data.channel,
  };
}

// ── PDF (formal letter) ───────────────────────────────────────────────────────

function todayFormatted(): string {
  return new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function buildLetterDocDefinition(data: ChaseData) {
  const { party, outstandingFils, overdueDays, overdueInvoices } = data;
  const dateStr = todayFormatted();
  const refStr = `REF: CHASE/${party.id}/${Date.now().toString().slice(-6)}`;

  // Build invoice rows for the PDF table
  const invoiceTableHeader = [
    { text: 'Invoice Reference', style: 'tableHeader' },
    { text: 'Amount (BHD)', style: 'tableHeader', alignment: 'right' as const },
    { text: 'Days Overdue', style: 'tableHeader', alignment: 'center' as const },
  ];

  const invoiceTableRows = overdueInvoices.map((inv) => [
    { text: inv.reference },
    { text: formatBHD(inv.totalFils), alignment: 'right' as const },
    { text: String(overdueDays), alignment: 'center' as const },
  ]);

  const letterBody = [
    `Despite previous reminders, the above invoice(s) remain outstanding on your account. The total amount due is BHD ${formatBHD(outstandingFils)}, which is now ${overdueDays} days past the agreed payment terms.`,
    '',
    `We wish to bring to your attention the following:`,
    `  1. Your account has been flagged for credit review and no further orders will be processed until this balance is cleared.`,
    `  2. We reserve the right to pursue formal collection proceedings, including legal recourse, if settlement is not received within 7 business days of this notice.`,
    `  3. Interest and collection costs may be applied in accordance with our standard terms.`,
    '',
    `We urge you to treat this matter with the utmost priority. Please arrange immediate payment to our bank account and forward the remittance advice to our accounts department.`,
    '',
    `Should you wish to discuss any aspect of this notice or raise a query regarding the above invoices, please contact us without delay at ${SELLER_TEL}.`,
    '',
    `We trust this matter can be resolved promptly and look forward to continuing our business relationship on a sound footing.`,
  ].join('\n');

  return {
    pageSize: 'A4',
    pageMargins: [60, 40, 60, 60] as [number, number, number, number],

    content: [
      // Letterhead
      {
        image: PH_LETTERHEAD_BASE64,
        width: 475,
        margin: [0, 0, 0, 20],
      },

      // Date and reference
      {
        columns: [
          { width: '*', text: '' },
          {
            width: 'auto',
            stack: [
              { text: dateStr, style: 'metaText' },
              { text: refStr, style: 'metaText' },
            ],
          },
        ],
        margin: [0, 0, 0, 16],
      },

      // Addressee
      {
        stack: [
          { text: party.name, style: 'addressName' },
          { text: 'Bahrain', style: 'addressLine' },
        ],
        margin: [0, 0, 0, 20],
      },

      // Subject line
      {
        text: 'RE: Outstanding Payment — Final Notice',
        style: 'subjectLine',
        margin: [0, 0, 0, 14],
      },

      // Salutation
      {
        text: `Dear Sir / Madam,`,
        style: 'bodyText',
        margin: [0, 0, 0, 10],
      },

      // Opening
      {
        text: `We refer to the following outstanding invoice(s) on your account with PH Trading W.L.L.:`,
        style: 'bodyText',
        margin: [0, 0, 0, 10],
      },

      // Invoice table
      {
        table: {
          headerRows: 1,
          widths: ['*', 100, 80],
          body: [invoiceTableHeader, ...invoiceTableRows],
        },
        layout: {
          hLineWidth: (i: number, node: any) =>
            i === 0 || i === 1 || i === node.table.body.length ? 1 : 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#333333',
          vLineColor: () => '#aaaaaa',
          fillColor: (i: number) => (i === 0 ? '#e8e8e8' : null),
          paddingLeft: () => 6,
          paddingRight: () => 6,
          paddingTop: () => 4,
          paddingBottom: () => 4,
        },
        margin: [0, 0, 0, 14],
      },

      // Total outstanding highlight
      {
        columns: [
          { width: '*', text: '' },
          {
            width: 'auto',
            table: {
              widths: [150, 90],
              body: [
                [
                  { text: 'Total Outstanding (BHD):', style: 'totalLabel' },
                  { text: formatBHD(outstandingFils), style: 'totalValue' },
                ],
              ],
            },
            layout: {
              hLineWidth: () => 1,
              vLineWidth: () => 0,
              hLineColor: () => '#333333',
              paddingLeft: () => 6,
              paddingRight: () => 4,
              paddingTop: () => 4,
              paddingBottom: () => 4,
              fillColor: () => '#f0f0f0',
            },
          },
        ],
        margin: [0, 0, 0, 14],
      },

      // Letter body paragraphs
      ...letterBody.split('\n\n').map((para) => ({
        text: para.trim(),
        style: 'bodyText',
        margin: [0, 0, 0, 10] as [number, number, number, number],
      })),

      // Closing
      {
        text: `Yours faithfully,`,
        style: 'bodyText',
        margin: [0, 20, 0, 40],
      },

      // Signature block
      {
        stack: [
          { text: '____________________________', style: 'signatureLine' },
          { text: 'For and on behalf of', style: 'signatureFor' },
          { text: SELLER_NAME_FORMAL, style: 'signatureName' },
          { text: 'Accounts Department', style: 'signatureDept' },
        ],
      },
    ],

    styles: {
      metaText: {
        fontSize: 8,
        color: '#555555',
        alignment: 'right' as const,
      },
      addressName: {
        fontSize: 10,
        bold: true,
      },
      addressLine: {
        fontSize: 9,
        color: '#333333',
      },
      subjectLine: {
        fontSize: 11,
        bold: true,
        decoration: 'underline' as const,
      },
      bodyText: {
        fontSize: 10,
        color: '#111111',
        lineHeight: 1.4,
      },
      tableHeader: {
        fontSize: 8,
        bold: true,
        color: '#111111',
      },
      totalLabel: {
        fontSize: 9,
        bold: true,
        alignment: 'right' as const,
        color: '#333333',
      },
      totalValue: {
        fontSize: 9,
        bold: true,
        alignment: 'right' as const,
      },
      signatureLine: {
        fontSize: 10,
        color: '#999999',
      },
      signatureFor: {
        fontSize: 9,
        color: '#555555',
        margin: [0, 4, 0, 0],
      },
      signatureName: {
        fontSize: 10,
        bold: true,
      },
      signatureDept: {
        fontSize: 9,
        color: '#555555',
      },
    },

    defaultStyle: {
      fontSize: 10,
      font: 'Roboto',
    },
  };
}

/**
 * Generate a formal chase letter as a PDF and open it in a new browser tab.
 * Always uses final_notice tone regardless of the channel tone override.
 */
export async function generateChasePdf(data: ChaseData): Promise<void> {
  const docDef = buildLetterDocDefinition(data);
  pdfMake.createPdf(docDef as any).open();
}
