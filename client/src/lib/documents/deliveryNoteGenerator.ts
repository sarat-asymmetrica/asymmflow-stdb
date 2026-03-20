import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import { PH_LETTERHEAD_BASE64 } from './letterhead';
import type { DeliveryNote, DeliveryNoteItem, LineItem, Party } from '../stdb_generated/types';
import { formatDate } from '../format';

type PdfTextNode = {
  text: string;
  style?: string;
  alignment?: 'left' | 'center' | 'right';
  bold?: boolean;
  margin?: [number, number, number, number];
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

type DeliveryRow = {
  description: string;
  quantityDelivered: bigint;
  notes: string;
};

export interface DeliveryNoteData {
  deliveryNote: DeliveryNote;
  party: Party;
  orderReference?: string;
  items: Array<{
    deliveryItem: DeliveryNoteItem;
    lineItem?: LineItem;
  }>;
}

const pdfMakeClient = pdfMake as unknown as PdfMakeInstance;

if (typeof pdfMakeClient.vfs === 'undefined') {
  pdfMakeClient.vfs = pdfFonts;
}

function buildRows(data: DeliveryNoteData): DeliveryRow[] {
  return data.items.map(({ deliveryItem, lineItem }) => ({
    description: lineItem?.description || `Line Item #${deliveryItem.lineItemId}`,
    quantityDelivered: deliveryItem.quantityDelivered,
    notes: deliveryItem.notes,
  }));
}

export function buildDeliveryNoteDocDefinition(
  data: DeliveryNoteData,
): { docDef: PdfDocDefinition; dnNumber: string } {
  const rows = buildRows(data);
  const orderReference = data.orderReference?.trim() || `Order #${data.deliveryNote.orderId}`;
  const receiverLabel = data.deliveryNote.receiverName.trim() || 'Pending signature';

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
        text: 'DELIVERY NOTE',
        style: 'title',
        alignment: 'center',
        margin: [0, 0, 0, 10],
      },
      {
        columns: [
          {
            width: '50%',
            stack: [
              { text: 'Customer', style: 'sectionLabel' },
              { text: data.party.name, style: 'counterpartyName' },
              { text: data.deliveryNote.deliveryAddress, style: 'small' },
            ],
          },
          {
            width: '50%',
            table: {
              widths: [72, '*'],
              body: [
                [{ text: 'DN Number', style: 'metaLabel' }, { text: data.deliveryNote.dnNumber, style: 'metaValue' }],
                [{ text: 'Date', style: 'metaLabel' }, { text: formatDate(data.deliveryNote.deliveryDate), style: 'metaValue' }],
                [{ text: 'Order Ref', style: 'metaLabel' }, { text: orderReference, style: 'metaValue' }],
                [{ text: 'Status', style: 'metaLabel' }, { text: data.deliveryNote.status.tag, style: 'metaValue' }],
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
          widths: [28, '*', 52, 90],
          body: [
            [
              { text: '#', style: 'tableHeader', alignment: 'center' },
              { text: 'Description', style: 'tableHeader' },
              { text: 'Qty Delivered', style: 'tableHeader', alignment: 'center' },
              { text: 'Notes', style: 'tableHeader' },
            ],
            ...rows.map((row, index) => [
              { text: String(index + 1), alignment: 'center' as const },
              { text: row.description },
              { text: String(row.quantityDelivered), alignment: 'center' as const },
              { text: row.notes || '—' },
            ]),
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
        columns: [
          {
            width: '50%',
            stack: [
              { text: 'Dispatch Details', style: 'sectionLabel' },
              { text: `Driver: ${data.deliveryNote.driverName || '—'}`, style: 'small' },
              { text: `Vehicle: ${data.deliveryNote.vehicleNumber || '—'}`, style: 'small' },
            ],
          },
          {
            width: '50%',
            stack: [
              { text: 'Receiver', style: 'sectionLabel' },
              { text: receiverLabel, style: 'small' },
              { text: 'Signature: ____________________', style: 'small', margin: [0, 12, 0, 0] },
            ],
          },
        ],
        margin: [0, 0, 0, 10],
      },
      {
        text: data.deliveryNote.notes || 'Goods received in good condition.',
        style: 'small',
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

  return { docDef, dnNumber: data.deliveryNote.dnNumber };
}

export async function generateDeliveryNotePdf(data: DeliveryNoteData): Promise<void> {
  const { docDef, dnNumber } = buildDeliveryNoteDocDefinition(data);
  const customerName = data.party.name.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 30);
  pdfMakeClient.createPdf(docDef).download(`DeliveryNote-${customerName}-${dnNumber}.pdf`);
}
