import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import { PH_LETTERHEAD_BASE64 } from './letterhead';
import type { LineItem, Party, PurchaseOrder } from '../stdb_generated/types';
import { formatBHD, formatDate } from '../format';
import { getConnection } from '../db';

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

export interface PurchaseOrderData {
  purchaseOrder: PurchaseOrder;
  supplier: Party;
  lineItems: LineItem[];
  supplierReference?: string;
  buyerOrderNumber?: string;
  paymentTerms?: string;
  deliveryTerms?: string;
  deliveryAddress?: string;
  notes?: string;
}

const pdfMakeClient = pdfMake as unknown as PdfMakeInstance;

if (typeof pdfMakeClient.vfs === 'undefined') {
  pdfMakeClient.vfs = pdfFonts;
}

const SELLER = {
  nameAr: 'شركة بي اتش التجارية ذ.م.م',
  nameEn: 'PH TRADING W.L.L.',
  address1: 'Flat/Shop No. 91, Building 198',
  address2: 'Road/Street 2803, AL SEEF, Block 428',
  address3: 'Kingdom of Bahrain',
  warehouse: 'Building 325, Road 1704, Block 117, Sitra Industrial Area, Manama, Kingdom of Bahrain',
  tel: '+973 17 587654',
  trn: '200010357800002',
};

export function getNextPurchaseOrderNumber(): string {
  const year = new Date().getFullYear();
  const key = `asymmflow_po_seq_${year}`;
  const current = parseInt(localStorage.getItem(key) || '0', 10);
  const next = current + 1;
  localStorage.setItem(key, String(next));

  try {
    const conn = getConnection();
    if (conn) {
      conn.reducers.nextDocNumber({ docType: 'purchase_order', year });
    }
  } catch {
    // Offline fallback: localStorage is enough for draft generation.
  }

  return `PO-${year}-${String(next).padStart(3, '0')}`;
}

function purchaseOrderNumber(data: PurchaseOrderData): string {
  return data.purchaseOrder.poNumber?.trim() || getNextPurchaseOrderNumber();
}

function supplierTrn(supplier: Party): string {
  const match = supplier.notes.match(/TRN:([^\n\r]+)/i);
  return match ? match[1].trim() : '—';
}

export function buildPurchaseOrderDocDefinition(
  data: PurchaseOrderData,
): { docDef: PdfDocDefinition; poNumber: string } {
  const poNumber = purchaseOrderNumber(data);
  const poDate = formatDate(data.purchaseOrder.createdAt);
  const subtotal = data.lineItems.reduce((sum, item) => sum + item.totalPriceFils, 0n);
  const vatAmount = (subtotal * 100n) / 1000n;
  const total = subtotal + vatAmount;
  const paymentTerms = data.paymentTerms?.trim() || 'Net 30 days';
  const deliveryTerms = data.deliveryTerms?.trim() || data.purchaseOrder.deliveryTerms?.trim() || 'CIF Bahrain unless otherwise specified';
  const supplierReference = data.supplierReference?.trim() || '—';
  const buyerOrderNumber = data.buyerOrderNumber?.trim() || `SO-${String(data.purchaseOrder.orderId ?? 0n).padStart(3, '0')}`;
  const deliveryAddress = data.deliveryAddress?.trim() || SELLER.warehouse;

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
        text: 'PURCHASE ORDER',
        style: 'title',
        alignment: 'right',
        margin: [0, 0, 0, 10],
      },
      {
        columns: [
          {
            width: '48%',
            stack: [
              { text: 'TO', style: 'sectionLabel' },
              { text: data.supplier.name, style: 'counterpartyName' },
              { text: `TRN: ${supplierTrn(data.supplier)}`, style: 'small' },
            ],
          },
          {
            width: '52%',
            table: {
              widths: [90, '*'],
              body: [
                [{ text: 'PO Number', style: 'metaLabel' }, { text: poNumber, style: 'metaValue' }],
                [{ text: 'Date', style: 'metaLabel' }, { text: poDate, style: 'metaValue' }],
                [{ text: 'Supplier Ref', style: 'metaLabel' }, { text: supplierReference, style: 'metaValue' }],
                [{ text: 'Buyer Order No', style: 'metaLabel' }, { text: buyerOrderNumber, style: 'metaValue' }],
                [{ text: 'Payment Terms', style: 'metaLabel' }, { text: paymentTerms, style: 'metaValue' }],
                [{ text: 'Delivery Terms', style: 'metaLabel' }, { text: deliveryTerms, style: 'metaValue' }],
              ],
            },
            layout: 'lightHorizontalLines',
          },
        ],
        margin: [0, 0, 0, 12],
      },
      {
        text: 'DELIVER TO',
        style: 'sectionLabel',
      },
      {
        text: deliveryAddress,
        style: 'small',
        margin: [0, 0, 0, 10],
      },
      {
        table: {
          headerRows: 1,
          widths: [24, '*', 36, 62, 72],
          body: [
            [
              { text: '#', style: 'tableHeader', alignment: 'center' },
              { text: 'Description', style: 'tableHeader' },
              { text: 'Qty', style: 'tableHeader', alignment: 'center' },
              { text: 'Unit Price (BHD)', style: 'tableHeader', alignment: 'right' },
              { text: 'Amount (BHD)', style: 'tableHeader', alignment: 'right' },
            ],
            ...data.lineItems.map((item, index) => [
              { text: String(index + 1), alignment: 'center' as const },
              { text: item.description },
              { text: String(item.quantity), alignment: 'center' as const },
              { text: formatBHD(item.unitPriceFils), alignment: 'right' as const },
              { text: formatBHD(item.totalPriceFils), alignment: 'right' as const },
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
        margin: [0, 0, 0, 10],
      },
      {
        columns: [
          { width: '*', text: data.notes?.trim() || '' },
          {
            width: 'auto',
            table: {
              widths: [130, 88],
              body: [
                [{ text: 'SUBTOTAL:', style: 'totalLabel' }, { text: formatBHD(subtotal), style: 'totalValue' }],
                [{ text: 'VAT 10%:', style: 'totalLabel' }, { text: formatBHD(vatAmount), style: 'totalValue' }],
                [{ text: 'TOTAL (BHD):', style: 'grandTotalLabel' }, { text: formatBHD(total), style: 'grandTotalValue' }],
              ],
            },
            layout: {
              hLineWidth: (i: number, node: { table: PdfTable }) =>
                i === 0 || i === node.table.body.length ? 1 : 0.5,
              vLineWidth: () => 0,
              hLineColor: () => '#333333',
              paddingLeft: () => 6,
              paddingRight: () => 4,
              paddingTop: () => 3,
              paddingBottom: () => 3,
              fillColor: (i: number, node: { table: PdfTable }) =>
                i === node.table.body.length - 1 ? '#f0f0f0' : null,
            },
          },
        ],
        margin: [0, 0, 0, 12],
      },
      {
        text: `Payment Terms: ${paymentTerms}`,
        style: 'small',
      },
      {
        text: `Delivery Terms: ${deliveryTerms}`,
        style: 'small',
      },
      {
        text: 'Late Delivery: Supplier to notify buyer immediately of any delays.',
        style: 'small',
        margin: [0, 0, 0, 14],
      },
      {
        columns: [
          { width: '*', text: `Issued by ${SELLER.nameEn}`, style: 'footerNote' },
          { width: 'auto', text: 'Authorized Signature', style: 'footerNote' },
        ],
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
      totalLabel: {
        fontSize: 8,
        alignment: 'right',
      },
      totalValue: {
        fontSize: 8,
        alignment: 'right',
      },
      grandTotalLabel: {
        fontSize: 9,
        bold: true,
        alignment: 'right',
      },
      grandTotalValue: {
        fontSize: 9,
        bold: true,
        alignment: 'right',
      },
      footerNote: {
        fontSize: 7,
        color: '#666666',
      },
    },
    defaultStyle: {
      fontSize: 8,
      font: 'Roboto',
    },
  };

  return { docDef, poNumber };
}

export async function generatePurchaseOrderPdf(data: PurchaseOrderData): Promise<void> {
  const { docDef, poNumber } = buildPurchaseOrderDocDefinition(data);
  const supplierName = data.supplier.name.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 30);
  pdfMakeClient.createPdf(docDef).download(`PurchaseOrder-${supplierName}-${poNumber}.pdf`);
}
