import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import { PH_LETTERHEAD_BASE64 } from './letterhead';
import type { Party, Pipeline } from '../stdb_generated/types';
import { formatBHD } from '../format';

// Initialize pdfmake fonts (idempotent guard)
if (typeof pdfMake.vfs === 'undefined') {
  pdfMake.vfs = pdfFonts;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CoverLetterItem {
  description: string;
  quantity: number;
  unit: string;
}

export interface CoverLetterData {
  party: Party;
  contact?: string;             // Attn: contact name
  pipeline?: Pipeline;          // linked pipeline (for ref / value)
  items: CoverLetterItem[];
  deliveryTerms?: string;       // e.g. "DDP Bahrain Site"
  notes?: string;               // any special remarks
  senderName?: string;          // defaults to "Abhishek Kore"
}

// ── PH Trading constants ──────────────────────────────────────────────────────

const SENDER_DEFAULT   = 'Abhishek Kore';
const SENDER_TITLE     = 'General Manager';
const COMPANY_NAME_EN  = 'PH TRADING W.L.L.';
const COMPANY_TEL      = '+973 17 587654';
const BANK_DETAILS = [
  { bank: 'National Bank of Bahrain BSC', ac: '99570076', bic: 'NBOBBHBM', iban: 'BH16NBOB00000099570076' },
  { bank: 'Ahli United Bank', ac: '0010521957001', swift: 'AUBBBHBM', iban: 'BH04AUBB0010521957001' },
  { bank: 'Al Salam Bank', ac: '205220101000', swift: 'ALSABHBM', iban: 'BH37ALSA00205220101000' },
  { bank: 'BBK', ac: '100000451009', bic: 'BBKUBHBM', iban: 'BH71BBKU0010000451009' },
];

// ── Local date helper (NOT using formatDate — that takes StdbTimestamp) ──────

function formatLetterDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Grade-based payment terms ─────────────────────────────────────────────────

function gradePaymentTermsText(party: Party): string {
  const tag = (party.grade as any)?.tag ?? String(party.grade);
  switch (tag) {
    case 'A': return 'Net 45 days';
    case 'B': return 'Net 90 days';
    case 'C': return '50% advance, balance on delivery';
    case 'D': return '100% advance payment required';
    default:  return `${Number(party.paymentTermsDays)} days`;
  }
}

// ── Reference number helper ───────────────────────────────────────────────────

function buildRefNumber(pipeline?: Pipeline): string {
  const suffix = Date.now().toString().slice(-6);
  if (pipeline) return `REF: CL/${Number(pipeline.id)}/${suffix}`;
  return `REF: CL/${suffix}`;
}

// ── Document definition ───────────────────────────────────────────────────────

export function buildCoverLetterDocDefinition(data: CoverLetterData): object {
  const { party, contact, pipeline, items, deliveryTerms, notes, senderName } = data;
  const sender       = senderName ?? SENDER_DEFAULT;
  const dateStr      = formatLetterDate(new Date());
  const refStr       = buildRefNumber(pipeline);
  const paymentText  = gradePaymentTermsText(party);
  const deliveryText = deliveryTerms ?? 'DDP Bahrain (unless otherwise specified)';

  // Items table
  const tableHeader = [
    { text: '#',           style: 'tableHeader', alignment: 'center' as const },
    { text: 'Description', style: 'tableHeader' },
    { text: 'Qty',         style: 'tableHeader', alignment: 'center' as const },
    { text: 'Unit',        style: 'tableHeader', alignment: 'center' as const },
  ];

  const tableRows = items.map((item, idx) => [
    { text: String(idx + 1), alignment: 'center' as const, fontSize: 9 },
    { text: item.description, fontSize: 9 },
    { text: String(item.quantity), alignment: 'center' as const, fontSize: 9 },
    { text: item.unit || 'EA', alignment: 'center' as const, fontSize: 9 },
  ]);

  // Total items count footer row
  const totalsRow = [
    { text: '', border: [false, false, false, false] },
    {
      text: `Total: ${items.length} line item${items.length !== 1 ? 's' : ''}`,
      fontSize: 8,
      bold: true,
      border: [false, true, false, false],
      colSpan: 3,
    },
    {},
    {},
  ];

  // Offer value line (from pipeline if available)
  const offerValueContent = pipeline && pipeline.offerTotalFils > 0n
    ? [
        {
          text: `Total Offer Value: BHD ${formatBHD(pipeline.offerTotalFils)}`,
          fontSize: 10,
          bold: true,
          alignment: 'right' as const,
          margin: [0, 4, 0, 0] as [number, number, number, number],
        },
      ]
    : [];

  // Bank footer lines
  const bankLines = BANK_DETAILS.map((b, i) =>
    `${i + 1}. ${b.bank}, A/c: ${b.ac}, ${b.bic ? 'BIC' : 'Swift'}: ${b.bic || b.swift}, IBAN: ${b.iban}`
  );

  return {
    pageSize: 'A4' as const,
    pageMargins: [40, 90, 40, 80] as [number, number, number, number],

    // Letterhead as background — renders behind content on every page
    background: [
      {
        image: PH_LETTERHEAD_BASE64,
        width: 595,
        absolutePosition: { x: 0, y: 0 },
      },
    ],

    footer: {
      stack: [
        { canvas: [{ type: 'line', x1: 40, y1: 0, x2: 555, y2: 0, lineWidth: 0.5, lineColor: '#cccccc' }] },
        { text: 'BANK DETAILS:', style: 'bankHeader', margin: [40, 4, 40, 2] },
        ...bankLines.map((line) => ({
          text: line, style: 'bankDetail', margin: [40, 0, 40, 0],
        })),
      ],
    },

    content: [
      // Date and reference — right-aligned
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
        margin: [0, 0, 0, 16] as [number, number, number, number],
      },

      // Addressee block
      {
        stack: [
          { text: 'To:', style: 'sectionLabel' },
          { text: party.name, style: 'addressName' },
          ...(contact ? [{ text: `Attn: ${contact}`, style: 'addressLine' }] : []),
          { text: 'Bahrain', style: 'addressLine' },
        ],
        margin: [0, 0, 0, 16] as [number, number, number, number],
      },

      // Subject line
      {
        text: pipeline
          ? `Subject: Cover Letter — ${pipeline.title}`
          : `Subject: Cover Letter — Offer / Submittal`,
        style: 'subjectLine',
        margin: [0, 0, 0, 14] as [number, number, number, number],
      },

      // Salutation
      {
        text: contact ? `Dear ${contact},` : `Dear Sir / Madam,`,
        style: 'bodyText',
        margin: [0, 0, 0, 10] as [number, number, number, number],
      },

      // Opening paragraph
      {
        text: pipeline
          ? `We are pleased to submit our offer for ${pipeline.title}. Please find herein the details of the goods / services proposed, along with our commercial terms.`
          : `We are pleased to submit our offer as detailed below. Please find the items included in this submittal for your review and approval.`,
        style: 'bodyText',
        margin: [0, 0, 0, 12] as [number, number, number, number],
      },

      // Items table
      {
        table: {
          headerRows: 1,
          widths: [28, '*', 40, 40],
          body: [tableHeader, ...tableRows, totalsRow],
        },
        layout: {
          hLineWidth: (i: number, node: any) => {
            if (i === 0 || i === 1 || i === node.table.body.length) return 1;
            return 0.5;
          },
          vLineWidth: () => 0.5,
          hLineColor: () => '#333333',
          vLineColor: () => '#aaaaaa',
          fillColor: (i: number) => (i === 0 ? '#e8e8e8' : null),
          paddingLeft:   () => 5,
          paddingRight:  () => 5,
          paddingTop:    () => 4,
          paddingBottom: () => 4,
        },
        margin: [0, 0, 0, 4] as [number, number, number, number],
      },

      // Offer value (if pipeline present)
      ...offerValueContent,

      // Terms block
      {
        stack: [
          { text: 'Terms & Conditions:', style: 'termsHeader', margin: [0, 14, 0, 6] as [number, number, number, number] },
          {
            ol: [
              { text: `Payment Terms: ${paymentText}`, style: 'termsItem' },
              { text: `Delivery Terms: ${deliveryText}`, style: 'termsItem' },
              { text: `Offer Validity: 30 days from the date of this letter`, style: 'termsItem' },
              ...(notes ? [{ text: notes, style: 'termsItem' }] : []),
            ],
          },
        ],
        margin: [0, 0, 0, 16] as [number, number, number, number],
      },

      // Closing
      {
        text: `We trust the above meets your requirements and look forward to your valued order. Please do not hesitate to contact us should you require any clarification.`,
        style: 'bodyText',
        margin: [0, 0, 0, 10] as [number, number, number, number],
      },

      { text: 'Yours faithfully,', style: 'bodyText', margin: [0, 0, 0, 36] as [number, number, number, number] },

      // Signature block
      {
        stack: [
          { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 160, y2: 0, lineWidth: 0.5, lineColor: '#333333' }] },
          { text: sender,          style: 'signatureName', margin: [0, 3, 0, 0] as [number, number, number, number] },
          { text: SENDER_TITLE,    style: 'signatureTitle' },
          { text: COMPANY_NAME_EN, style: 'signatureCompany' },
          { text: `Tel: ${COMPANY_TEL}`, style: 'signatureTitle' },
        ],
      },

      // Generation timestamp
      {
        text: `Computer generated document. Generated: ${new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}.`,
        style: 'footerNote',
        margin: [0, 16, 0, 0] as [number, number, number, number],
      },
    ],

    styles: {
      metaText: {
        fontSize: 8,
        color: '#555555',
        alignment: 'right' as const,
      },
      sectionLabel: {
        fontSize: 8,
        bold: true,
        color: '#333333',
        margin: [0, 0, 0, 2],
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
      termsHeader: {
        fontSize: 9,
        bold: true,
        color: '#111111',
      },
      termsItem: {
        fontSize: 9,
        color: '#333333',
        margin: [0, 1, 0, 1],
      },
      signatureName: {
        fontSize: 10,
        bold: true,
        color: '#111111',
      },
      signatureTitle: {
        fontSize: 9,
        color: '#555555',
      },
      signatureCompany: {
        fontSize: 9,
        bold: true,
        color: '#333333',
      },
      footerNote: {
        fontSize: 7,
        color: '#888888',
        italics: true,
      },
      bankHeader: {
        fontSize: 7,
        bold: true,
        decoration: 'underline' as const,
        color: '#333333',
      },
      bankDetail: {
        fontSize: 6.5,
        color: '#444444',
      },
    },

    defaultStyle: {
      fontSize: 9,
      font: 'Roboto',
    },
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate a PH Trading cover letter PDF and download it.
 * Filename format: CoverLetter_{PartyName}_{Date}.pdf
 */
export async function generateCoverLetterPdf(data: CoverLetterData): Promise<void> {
  const docDef = buildCoverLetterDocDefinition(data);
  const partySlug = data.party.name.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 30);
  const dateSlug  = formatLetterDate(new Date()).replace(/ /g, '-');
  const filename  = `CoverLetter_${partySlug}_${dateSlug}.pdf`;
  pdfMake.createPdf(docDef as any).download(filename);
}
