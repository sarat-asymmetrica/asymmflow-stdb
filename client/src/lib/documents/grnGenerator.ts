import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import { PH_LETTERHEAD_BASE64 } from './letterhead';

type PdfTextNode = {
  text: string;
  style?: string;
  alignment?: 'left' | 'center' | 'right';
  bold?: boolean;
  margin?: [number, number, number, number];
  color?: string;
  background?: string;
};

type PdfTableCell = PdfTextNode | string;

type PdfTable = {
  widths: Array<number | string>;
  body: PdfTableCell[][];
  headerRows?: number;
};

type PdfContentNode =
  | PdfTextNode
  | {
      image: string;
      width: number;
      margin?: [number, number, number, number];
    }
  | {
      columns: Array<Record<string, unknown>>;
      margin?: [number, number, number, number];
    }
  | {
      table: PdfTable;
      layout?: Record<string, unknown> | string;
      margin?: [number, number, number, number];
    };

type PdfDocDefinition = {
  pageSize: 'A4';
  pageMargins: [number, number, number, number];
  content: PdfContentNode[];
  styles: Record<string, Record<string, unknown>>;
  defaultStyle: Record<string, unknown>;
};

type PdfMakeInstance = {
  vfs?: unknown;
  createPdf: (definition: unknown) => { download: (filename: string) => void };
};

export interface GRNItem {
  description: string;
  quantityOrdered: number;
  quantityReceived: number;
  quantityAccepted: number;
  notes: string;
}

export interface GRNPdfInput {
  grnNumber: string;
  purchaseOrderNumber: string;
  supplierName: string;
  receivedDate: string; // ISO date
  receivedBy: string;
  inspectionNotes: string;
  status: string; // Draft, Inspecting, Accepted, Rejected
  items: GRNItem[];
}

const pdfMakeClient = pdfMake as unknown as PdfMakeInstance;

if (typeof pdfMakeClient.vfs === 'undefined') {
  pdfMakeClient.vfs = pdfFonts;
}

function formatIsoDate(isoDate: string): string {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function statusColor(status: string): string {
  switch (status.toLowerCase()) {
    case 'accepted':
      return '#2e7d32'; // green
    case 'rejected':
      return '#c62828'; // red
    case 'inspecting':
      return '#f57f17'; // amber
    default:
      return '#555555'; // grey for Draft / unknown
  }
}

/** Build the pdfmake document definition (exported for testing) */
export function buildGrnDocDefinition(input: GRNPdfInput): Record<string, unknown> {
  const totalOrdered = input.items.reduce((sum, item) => sum + item.quantityOrdered, 0);
  const totalReceived = input.items.reduce((sum, item) => sum + item.quantityReceived, 0);
  const totalAccepted = input.items.reduce((sum, item) => sum + item.quantityAccepted, 0);

  const docDef: PdfDocDefinition = {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 60],
    content: [
      {
        image: PH_LETTERHEAD_BASE64,
        width: 515,
        margin: [0, 0, 0, 8],
      },
      {
        text: 'GOODS RECEIVED NOTE',
        style: 'title',
        alignment: 'center',
        margin: [0, 0, 0, 10],
      },
      {
        columns: [
          {
            width: '50%',
            stack: [
              { text: 'Supplier', style: 'sectionLabel' },
              { text: input.supplierName, style: 'counterpartyName' },
            ],
          },
          {
            width: '50%',
            table: {
              widths: [80, '*'],
              body: [
                [
                  { text: 'GRN Number', style: 'metaLabel' },
                  { text: input.grnNumber, style: 'metaValue' },
                ],
                [
                  { text: 'PO Number', style: 'metaLabel' },
                  { text: input.purchaseOrderNumber, style: 'metaValue' },
                ],
                [
                  { text: 'Received Date', style: 'metaLabel' },
                  { text: formatIsoDate(input.receivedDate), style: 'metaValue' },
                ],
                [
                  { text: 'Received By', style: 'metaLabel' },
                  { text: input.receivedBy, style: 'metaValue' },
                ],
                [
                  { text: 'Status', style: 'metaLabel' },
                  {
                    text: input.status,
                    style: 'metaValue',
                    bold: true,
                    color: statusColor(input.status),
                  },
                ],
              ],
            },
            layout: 'lightHorizontalLines',
          },
        ],
        margin: [0, 0, 0, 12],
      },
      {
        table: {
          headerRows: 1,
          widths: [24, '*', 52, 52, 52, 90],
          body: [
            [
              { text: '#', style: 'tableHeader', alignment: 'center' },
              { text: 'Description', style: 'tableHeader' },
              { text: 'Qty Ordered', style: 'tableHeader', alignment: 'center' },
              { text: 'Qty Received', style: 'tableHeader', alignment: 'center' },
              { text: 'Qty Accepted', style: 'tableHeader', alignment: 'center' },
              { text: 'Notes', style: 'tableHeader' },
            ],
            ...input.items.map((item, index) => [
              { text: String(index + 1), alignment: 'center' as const },
              { text: item.description },
              { text: String(item.quantityOrdered), alignment: 'center' as const },
              { text: String(item.quantityReceived), alignment: 'center' as const },
              { text: String(item.quantityAccepted), alignment: 'center' as const },
              { text: item.notes || '\u2014' },
            ]),
            [
              { text: '', alignment: 'center' as const },
              { text: 'Totals', bold: true },
              { text: String(totalOrdered), alignment: 'center' as const, bold: true },
              { text: String(totalReceived), alignment: 'center' as const, bold: true },
              { text: String(totalAccepted), alignment: 'center' as const, bold: true },
              { text: '' },
            ],
          ],
        },
        layout: {
          hLineWidth: (i: number, node: { table: PdfTable }) =>
            i === 0 || i === 1 || i === node.table.body.length ? 1 : 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#333333',
          vLineColor: () => '#aaaaaa',
          fillColor: (i: number) => (i === 0 ? '#e8e8e8' : null),
          paddingLeft: () => 4,
          paddingRight: () => 4,
          paddingTop: () => 3,
          paddingBottom: () => 3,
        },
        margin: [0, 0, 0, 12],
      },
      {
        text: 'Inspection Notes',
        style: 'sectionLabel',
        margin: [0, 0, 0, 2],
      },
      {
        text: input.inspectionNotes || 'No inspection notes recorded.',
        style: 'small',
        margin: [0, 0, 0, 12],
      },
      {
        text: 'This document confirms receipt of goods as listed above.',
        style: 'small',
        margin: [0, 8, 0, 0],
      },
    ],
    styles: {
      title: {
        fontSize: 16,
        bold: true,
      },
      sectionLabel: {
        fontSize: 8,
        bold: true,
        color: '#555555',
        margin: [0, 0, 0, 2],
      },
      counterpartyName: {
        fontSize: 11,
        bold: true,
      },
      small: {
        fontSize: 8,
        color: '#333333',
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
    },
    defaultStyle: {
      fontSize: 8,
      font: 'Roboto',
    },
  };

  return docDef as unknown as Record<string, unknown>;
}

/** Generate a GRN PDF document definition for pdfmake */
export function generateGrnPdf(input: GRNPdfInput): void {
  const docDef = buildGrnDocDefinition(input);
  const sanitizedSupplier = input.supplierName.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 30);
  pdfMakeClient.createPdf(docDef).download(`GRN-${sanitizedSupplier}-${input.grnNumber}.pdf`);
}
