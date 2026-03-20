import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import { PH_LETTERHEAD_BASE64 } from './letterhead';
import type { Pipeline } from '../stdb_generated/types';

// Initialize pdfmake fonts (idempotent guard)
if (typeof pdfMake.vfs === 'undefined') {
  pdfMake.vfs = pdfFonts;
}

// ── Types ─────────────────────────────────────────────────────────────────────

/** Document type abbreviations used in Bahrain process instrumentation submittals */
export type SubmittalDocType = 'TI' | 'DWG' | 'Sizing' | 'Spec' | 'Datasheet' | 'Certificate' | 'Other';

export interface SubmittalDocument {
  name: string;               // e.g. "SITRANS P DS III — Technical Datasheet"
  type: SubmittalDocType;     // category column in the table
  pages?: number;             // page count (optional)
}

export interface TechnicalSubmittalData {
  pipeline?: Pipeline;        // linked pipeline for title / ref
  partyName?: string;         // customer name (if no pipeline)
  documents: SubmittalDocument[];
  preparedBy?: string;        // defaults to "Abhishek Kore"
}

// ── PH Trading constants ──────────────────────────────────────────────────────

const PREPARER_DEFAULT = 'Abhishek Kore';
const PREPARER_TITLE   = 'General Manager';
const COMPANY_NAME     = 'PH TRADING W.L.L.';
const COMPANY_TEL      = '+973 17 587654';

// ── Local date helper ─────────────────────────────────────────────────────────

function formatLetterDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Reference helper ──────────────────────────────────────────────────────────

function buildRefNumber(pipeline?: Pipeline): string {
  const suffix = Date.now().toString().slice(-6);
  if (pipeline) return `REF: TS/${Number(pipeline.id)}/${suffix}`;
  return `REF: TS/${suffix}`;
}

// ── Document definition ───────────────────────────────────────────────────────

export function buildTechnicalSubmittalDocDefinition(data: TechnicalSubmittalData): object {
  const { pipeline, partyName, documents, preparedBy } = data;
  const preparer    = preparedBy ?? PREPARER_DEFAULT;
  const dateStr     = formatLetterDate(new Date());
  const refStr      = buildRefNumber(pipeline);
  const addressee   = partyName ?? (pipeline ? undefined : 'Customer');

  // Compute totals
  const totalPages  = documents.reduce((sum, d) => sum + (d.pages ?? 0), 0);
  const totalDocs   = documents.length;

  // Table header
  const tableHeader = [
    { text: '#',             style: 'tableHeader', alignment: 'center' as const },
    { text: 'Document Name', style: 'tableHeader' },
    { text: 'Type',          style: 'tableHeader', alignment: 'center' as const },
    { text: 'Pages',         style: 'tableHeader', alignment: 'center' as const },
  ];

  // Table rows
  const tableRows = documents.map((doc, idx) => [
    { text: String(idx + 1), alignment: 'center' as const, fontSize: 9 },
    { text: doc.name,        fontSize: 9 },
    { text: doc.type,        alignment: 'center' as const, fontSize: 9, bold: true },
    { text: doc.pages !== undefined ? String(doc.pages) : '—', alignment: 'center' as const, fontSize: 9 },
  ]);

  // Totals row
  const totalsRow = [
    { text: '',             border: [false, false, false, false] },
    {
      text: `Total: ${totalDocs} document${totalDocs !== 1 ? 's' : ''}`,
      fontSize: 9,
      bold: true,
      border: [false, true, false, false],
    },
    { text: '',             border: [false, false, false, false] },
    {
      text: totalPages > 0 ? String(totalPages) : '—',
      alignment: 'center' as const,
      fontSize: 9,
      bold: true,
      border: [false, true, false, false],
    },
  ];

  // Type legend
  const typeLabels: Record<SubmittalDocType, string> = {
    TI:          'Technical Information',
    DWG:         'Engineering Drawing',
    Sizing:      'Sizing Calculation',
    Spec:        'Technical Specification',
    Datasheet:   'Product Datasheet',
    Certificate: 'Quality / Compliance Certificate',
    Other:       'Other Document',
  };
  const legendLines = (Object.entries(typeLabels) as [SubmittalDocType, string][])
    .map(([k, v]) => `${k} = ${v}`)
    .join('   |   ');

  return {
    pageSize: 'A4' as const,
    pageMargins: [40, 90, 40, 60] as [number, number, number, number],

    // Letterhead as background
    background: [
      {
        image: PH_LETTERHEAD_BASE64,
        width: 595,
        absolutePosition: { x: 0, y: 0 },
      },
    ],

    content: [
      // Date and reference
      {
        columns: [
          { width: '*', text: '' },
          {
            width: 'auto',
            stack: [
              { text: dateStr, style: 'metaText' },
              { text: refStr,  style: 'metaText' },
            ],
          },
        ],
        margin: [0, 0, 0, 14] as [number, number, number, number],
      },

      // Addressee (if known)
      ...(addressee
        ? [
            {
              stack: [
                { text: 'To:', style: 'sectionLabel' },
                { text: addressee, style: 'addressName' },
              ],
              margin: [0, 0, 0, 12] as [number, number, number, number],
            },
          ]
        : []),

      // Title
      {
        text: pipeline
          ? `TECHNICAL SUBMITTAL — ${pipeline.title.toUpperCase()}`
          : `TECHNICAL SUBMITTAL`,
        style: 'docTitle',
        alignment: 'center' as const,
        margin: [0, 0, 0, 14] as [number, number, number, number],
      },

      // Intro paragraph
      {
        text: `The following technical documents are submitted herewith for your review, approval, and records:`,
        style: 'bodyText',
        margin: [0, 0, 0, 12] as [number, number, number, number],
      },

      // Document index table
      {
        table: {
          headerRows: 1,
          widths: [28, '*', 70, 40],
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
        margin: [0, 0, 0, 8] as [number, number, number, number],
      },

      // Type legend
      {
        text: `Document Types: ${legendLines}`,
        style: 'legendText',
        margin: [0, 0, 0, 16] as [number, number, number, number],
      },

      // Note
      {
        text: `All documents are proprietary to their respective manufacturers. This submittal is prepared by ${COMPANY_NAME} for the sole purpose of this project. Please review and revert with any technical comments or approval status.`,
        style: 'bodyText',
        margin: [0, 0, 0, 10] as [number, number, number, number],
      },

      // Closing
      { text: 'Prepared by:', style: 'sectionLabel', margin: [0, 10, 0, 36] as [number, number, number, number] },

      // Signature block
      {
        stack: [
          { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 160, y2: 0, lineWidth: 0.5, lineColor: '#333333' }] },
          { text: preparer,       style: 'signatureName', margin: [0, 3, 0, 0] as [number, number, number, number] },
          { text: PREPARER_TITLE, style: 'signatureTitle' },
          { text: COMPANY_NAME,   style: 'signatureCompany' },
          { text: `Tel: ${COMPANY_TEL}`, style: 'signatureTitle' },
        ],
      },

      // Generation timestamp
      {
        text: `Computer generated document. Generated: ${new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}.`,
        style: 'footerNote',
        margin: [0, 14, 0, 0] as [number, number, number, number],
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
      docTitle: {
        fontSize: 12,
        bold: true,
        decoration: 'underline' as const,
        color: '#111111',
      },
      bodyText: {
        fontSize: 9,
        color: '#111111',
        lineHeight: 1.4,
      },
      tableHeader: {
        fontSize: 8,
        bold: true,
        color: '#111111',
      },
      legendText: {
        fontSize: 7,
        color: '#555555',
        italics: true,
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
    },

    defaultStyle: {
      fontSize: 9,
      font: 'Roboto',
    },
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate a technical submittal index PDF and download it.
 * Filename format: TechSubmittal_{PipelineTitle|Customer}_{Date}.pdf
 */
export async function generateTechnicalSubmittalPdf(data: TechnicalSubmittalData): Promise<void> {
  const docDef = buildTechnicalSubmittalDocDefinition(data);
  const nameSlug = (data.pipeline?.title ?? data.partyName ?? 'Submittal')
    .replace(/[^a-zA-Z0-9-]/g, '_')
    .slice(0, 30);
  const dateSlug = formatLetterDate(new Date()).replace(/ /g, '-');
  const filename = `TechSubmittal_${nameSlug}_${dateSlug}.pdf`;
  pdfMake.createPdf(docDef as any).download(filename);
}
