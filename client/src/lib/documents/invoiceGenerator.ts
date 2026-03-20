import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import { PH_LETTERHEAD_BASE64 } from './letterhead';
import { filsToBahrainiWords } from './moneyWords';
import type { MoneyEvent, Party, LineItem } from '../stdb_generated/types';
import { formatBHD, formatDate } from '../format';
import { getConnection } from '../db';

type TimestampLike = { microsSinceUnixEpoch: bigint };

type PdfTextNode = {
  text: string | Array<{ text: string; style?: string }>;
  style?: string;
  alignment?: 'left' | 'center' | 'right';
  bold?: boolean;
  italics?: boolean;
  margin?: [number, number, number, number];
  colSpan?: number;
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
      width?: string | number;
    };

type PdfDocDefinition = {
  pageSize: 'A4';
  pageMargins: [number, number, number, number];
  content: PdfContentNode[];
  styles: Record<string, Record<string, unknown>>;
  defaultStyle: Record<string, unknown>;
};

type CostingColumnVisibility = {
  fob: boolean;
  freight: boolean;
  margin: boolean;
};

type InvoiceFieldDate = TimestampLike | Date | string | undefined;

export interface InvoiceData {
  invoice: MoneyEvent;
  party: Party;
  lineItems: LineItem[];
  deliveryNoteNumber?: string;
  deliveryNoteDate?: InvoiceFieldDate;
  customerPoNumber?: string;
  customerPoDate?: InvoiceFieldDate;
  placeOfSupply?: string;
  destination?: string;
  dispatchThrough?: string;
  termsOfDelivery?: string;
  otherReferences?: string;
  showCostingColumns?: Partial<CostingColumnVisibility>;
}

type InvoiceDisplayRow = {
  description: string;
  quantity: bigint;
  unitPriceFils: bigint;
  totalPriceFils: bigint;
  fobCostFils: bigint;
  freightCostFils: bigint;
  marginBps: number;
};

type PdfMakeInstance = {
  vfs?: unknown;
  createPdf: (definition: unknown) => { download: (filename: string) => void };
};

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
  poBox: 'P.O. Box 815, Manama, Kingdom of Bahrain',
  tel: '+973 17 587654',
  fax: '+973 17 564456',
  trn: '200010357800002',
  cr: '68034-1',
};

const VAT_RATE = 10;

export function filsToWords(fils: bigint): string {
  return filsToBahrainiWords(fils);
}

export function getNextInvoiceNumber(): string {
  const year = new Date().getFullYear();
  const key = `asymmflow_inv_seq_${year}`;
  const current = parseInt(localStorage.getItem(key) || '0', 10);
  const next = current + 1;
  localStorage.setItem(key, String(next));

  try {
    const conn = getConnection();
    if (conn) {
      conn.reducers.nextDocNumber({ docType: 'invoice', year });
    }
  } catch {
    // Offline fallback: localStorage is enough for draft generation.
  }

  return `INV-${year}-${String(next).padStart(3, '0')}`;
}

function invoiceNumber(invoice: MoneyEvent): string {
  if (invoice.reference && invoice.reference.trim().length > 0) {
    return invoice.reference.trim();
  }
  return getNextInvoiceNumber();
}

function timestampToDisplay(value: InvoiceFieldDate): string {
  if (!value) return '—';
  if (typeof value === 'string') return value.trim() || '—';
  if (value instanceof Date) {
    return value.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  try {
    return formatDate(value);
  } catch {
    return '—';
  }
}

function invoiceDate(invoice: MoneyEvent): string {
  return timestampToDisplay(invoice.createdAt);
}

function extractPartyTrn(party: Party): string {
  const match = party.notes.match(/TRN:([^\n\r]+)/i);
  return match ? match[1].trim() : '—';
}

function resolveCostingColumns(data: InvoiceData): CostingColumnVisibility {
  return {
    fob: data.showCostingColumns?.fob ?? false,
    freight: data.showCostingColumns?.freight ?? false,
    margin: data.showCostingColumns?.margin ?? false,
  };
}

function formatMarginBps(marginBps: number): string {
  const percent = marginBps / 100;
  return Number.isInteger(percent) ? `${percent}%` : `${percent.toFixed(2)}%`;
}

function buildInvoiceRows(data: InvoiceData, invNo: string): InvoiceDisplayRow[] {
  if (data.lineItems.length > 0) {
    return data.lineItems.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPriceFils: item.unitPriceFils,
      totalPriceFils: item.totalPriceFils,
      fobCostFils: item.fobCostFils ?? 0n,
      freightCostFils: item.freightCostFils ?? 0n,
      marginBps: item.marginBps ?? 0,
    }));
  }

  return [{
    description: data.invoice.reference || `Invoice ${invNo}`,
    quantity: 1n,
    unitPriceFils: data.invoice.subtotalFils,
    totalPriceFils: data.invoice.subtotalFils,
    fobCostFils: 0n,
    freightCostFils: 0n,
    marginBps: 0,
  }];
}

function buildHeaderMetadataTable(data: InvoiceData, invNo: string): PdfContentNode {
  const fields: PdfTableCell[][] = [
    [
      { text: 'Invoice No.', style: 'metaLabel' },
      { text: invNo, style: 'metaValue' },
      { text: 'Date', style: 'metaLabel' },
      { text: invoiceDate(data.invoice), style: 'metaValue' },
    ],
    [
      { text: 'Delivery Note#', style: 'metaLabel' },
      { text: data.deliveryNoteNumber?.trim() || '—', style: 'metaValue' },
      { text: 'DN Date', style: 'metaLabel' },
      { text: timestampToDisplay(data.deliveryNoteDate), style: 'metaValue' },
    ],
    [
      { text: 'Customer PO#', style: 'metaLabel' },
      { text: data.customerPoNumber?.trim() || '—', style: 'metaValue' },
      { text: 'PO Date', style: 'metaLabel' },
      { text: timestampToDisplay(data.customerPoDate), style: 'metaValue' },
    ],
    [
      { text: 'Place of Supply', style: 'metaLabel' },
      { text: data.placeOfSupply?.trim() || 'Kingdom of Bahrain', style: 'metaValue' },
      { text: 'Destination', style: 'metaLabel' },
      { text: data.destination?.trim() || 'Bahrain', style: 'metaValue' },
    ],
    [
      { text: 'Dispatch Through', style: 'metaLabel' },
      { text: data.dispatchThrough?.trim() || 'Direct', style: 'metaValue' },
      { text: 'Terms of Delivery', style: 'metaLabel' },
      { text: data.termsOfDelivery?.trim() || `${String(data.party.paymentTermsDays)} days credit`, style: 'metaValue' },
    ],
    [
      { text: 'Other References', style: 'metaLabel' },
      { text: data.otherReferences?.trim() || '—', style: 'metaValue', colSpan: 3 },
      '',
      '',
    ],
  ];

  return {
    table: {
      widths: [68, '*', 68, '*'],
      body: fields,
    },
    layout: 'lightHorizontalLines',
  };
}

function buildLineItemsTable(
  rows: InvoiceDisplayRow[],
  visibility: CostingColumnVisibility,
): PdfContentNode {
  const widths: Array<number | string> = [22, '*', 24, 42];
  const header: PdfTableCell[] = [
    { text: 'Sl No.', style: 'tableHeader', alignment: 'center' },
    { text: 'Description', style: 'tableHeader' },
    { text: 'Qty', style: 'tableHeader', alignment: 'center' },
    { text: 'Rate (BHD)', style: 'tableHeader', alignment: 'right' },
  ];

  if (visibility.fob) {
    widths.push(44);
    header.push({ text: 'FOB (BHD)', style: 'tableHeader', alignment: 'right' });
  }
  if (visibility.freight) {
    widths.push(48);
    header.push({ text: 'Freight (BHD)', style: 'tableHeader', alignment: 'right' });
  }
  if (visibility.margin) {
    widths.push(34);
    header.push({ text: 'Margin %', style: 'tableHeader', alignment: 'right' });
  }

  widths.push(26, 54, 48, 56);
  header.push(
    { text: 'VAT %', style: 'tableHeader', alignment: 'center' },
    { text: 'Taxable (BHD)', style: 'tableHeader', alignment: 'right' },
    { text: 'VAT (BHD)', style: 'tableHeader', alignment: 'right' },
    { text: 'Total (BHD)', style: 'tableHeader', alignment: 'right' },
  );

  const body = rows.map((item, index) => {
    const vatValue = BigInt(Math.round(Number(item.totalPriceFils) * VAT_RATE / 100));
    const totalInclVat = item.totalPriceFils + vatValue;
    const row: PdfTableCell[] = [
      { text: String(index + 1), alignment: 'center' },
      { text: item.description },
      { text: String(item.quantity), alignment: 'center' },
      { text: formatBHD(item.unitPriceFils), alignment: 'right' },
    ];

    if (visibility.fob) {
      row.push({ text: formatBHD(item.fobCostFils), alignment: 'right' });
    }
    if (visibility.freight) {
      row.push({ text: formatBHD(item.freightCostFils), alignment: 'right' });
    }
    if (visibility.margin) {
      row.push({ text: formatMarginBps(item.marginBps), alignment: 'right' });
    }

    row.push(
      { text: `${VAT_RATE}%`, alignment: 'center' },
      { text: formatBHD(item.totalPriceFils), alignment: 'right' },
      { text: formatBHD(vatValue), alignment: 'right' },
      { text: formatBHD(totalInclVat), alignment: 'right' },
    );

    return row;
  });

  return {
    table: {
      headerRows: 1,
      widths,
      body: [header, ...body],
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
  };
}

export function buildInvoiceDocDefinition(data: InvoiceData): { docDef: PdfDocDefinition; invNo: string } {
  const invNo = invoiceNumber(data.invoice);
  const rows = buildInvoiceRows(data, invNo);
  const visibility = resolveCostingColumns(data);
  const buyerTrn = extractPartyTrn(data.party);
  const subtotal = data.invoice.subtotalFils;
  const vatAmount = data.invoice.vatFils;
  const grandTotal = data.invoice.totalFils;
  const amountInWords = filsToWords(grandTotal);

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
        text: 'TAX INVOICE',
        style: 'title',
        alignment: 'center',
        margin: [0, 0, 0, 10],
      },
      {
        columns: [
          {
            width: '45%',
            stack: [
              { text: 'Seller', style: 'sectionLabel' },
              { text: SELLER.nameEn, style: 'sellerName' },
              { text: SELLER.nameAr, style: 'sellerNameAr', alignment: 'right' },
              { text: SELLER.address1, style: 'small' },
              { text: SELLER.address2, style: 'small' },
              { text: SELLER.address3, style: 'small' },
              { text: SELLER.poBox, style: 'small' },
              { text: `Tel: ${SELLER.tel} | Fax: ${SELLER.fax}`, style: 'small' },
              { text: `TRN (VAT No): ${SELLER.trn}`, style: 'small', bold: true },
              { text: `CR No: ${SELLER.cr}`, style: 'small' },
              { text: '', margin: [0, 6, 0, 0] },
              { text: 'Buyer', style: 'sectionLabel' },
              { text: data.party.name, style: 'buyerName' },
              { text: `TRN: ${buyerTrn}`, style: 'small' },
              { text: `Payment Terms: ${String(data.party.paymentTermsDays)} Days`, style: 'small' },
            ],
          },
          {
            width: '55%',
            ...buildHeaderMetadataTable(data, invNo),
          },
        ],
        margin: [0, 0, 0, 14],
      },
      buildLineItemsTable(rows, visibility),
      {
        columns: [
          { width: '*', text: '' },
          {
            width: 'auto',
            table: {
              widths: [136, 86],
              body: [
                [
                  { text: 'Sub Total (BHD):', style: 'totalLabel' },
                  { text: formatBHD(subtotal), style: 'totalValue' },
                ],
                [
                  { text: `VAT @ ${VAT_RATE}% (BHD):`, style: 'totalLabel' },
                  { text: formatBHD(vatAmount), style: 'totalValue' },
                ],
                [
                  { text: 'Grand Total (BHD):', style: 'grandTotalLabel' },
                  { text: formatBHD(grandTotal), style: 'grandTotalValue' },
                ],
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
        margin: [0, 0, 0, 10],
      },
      {
        table: {
          widths: ['*'],
          body: [[{
            text: [
              { text: 'Amount Chargeable (in words): ', style: 'amtLabel' },
              { text: amountInWords, style: 'amtWords' },
            ],
            margin: [4, 4, 4, 4],
          }]],
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#333333',
          vLineColor: () => '#333333',
        },
        margin: [0, 0, 0, 10],
      },
      {
        text: 'VAT Summary',
        style: 'sectionLabel',
        margin: [0, 0, 0, 4],
      },
      {
        table: {
          headerRows: 1,
          widths: [60, 90, 90, 90],
          body: [
            [
              { text: 'VAT Rate', style: 'tableHeader', alignment: 'center' },
              { text: 'Taxable Amount (BHD)', style: 'tableHeader', alignment: 'right' },
              { text: 'VAT Amount (BHD)', style: 'tableHeader', alignment: 'right' },
              { text: 'Total (BHD)', style: 'tableHeader', alignment: 'right' },
            ],
            [
              { text: `${VAT_RATE}%`, alignment: 'center' },
              { text: formatBHD(subtotal), alignment: 'right' },
              { text: formatBHD(vatAmount), alignment: 'right' },
              { text: formatBHD(grandTotal), alignment: 'right' },
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
        margin: [0, 0, 0, 14],
      },
      {
        columns: [
          {
            width: '*',
            text: `This is a computer generated invoice. Generated on: ${new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}.`,
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
      sellerName: {
        fontSize: 10,
        bold: true,
      },
      sellerNameAr: {
        fontSize: 10,
        bold: true,
      },
      buyerName: {
        fontSize: 10,
        bold: true,
      },
      small: {
        fontSize: 8,
        color: '#333333',
      },
      metaLabel: {
        fontSize: 7,
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
        color: '#333333',
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
      amtLabel: {
        fontSize: 8,
        bold: true,
      },
      amtWords: {
        fontSize: 8,
        italics: true,
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

  return { docDef, invNo };
}

export async function generateInvoicePdf(data: InvoiceData): Promise<void> {
  const { docDef, invNo } = buildInvoiceDocDefinition(data);
  const partyName = data.party.name.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 30);
  const safeInvNo = invNo.replace(/[^a-zA-Z0-9-]/g, '_');
  const filename = `Invoice-${partyName}-${safeInvNo}.pdf`;
  pdfMakeClient.createPdf(docDef).download(filename);
}

export async function downloadInvoicePdf(data: InvoiceData): Promise<void> {
  return generateInvoicePdf(data);
}
