import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import { PH_LETTERHEAD_BASE64 } from './letterhead';
import type { Party } from '../stdb_generated/types';
import { formatBHD } from '../format';
import { getConnection } from '../db';

// Initialize pdfmake fonts
if (typeof pdfMake.vfs === 'undefined') {
  pdfMake.vfs = pdfFonts;
}

// ---- Types ----------------------------------------------------------------

export interface QuotationItem {
  itemCode?: string;         // e.g. "LPRQ146408"
  description: string;       // e.g. "SENSOR CABLE SET DK9SS-ABB"
  quantity: number;
  unit: string;              // EA, KG, SET, LOT, MTR, PCS
  unitPriceFils: bigint;
}

export interface QuotationData {
  party: Party;
  items: QuotationItem[];
  validityDays: number;          // default 30
  deliveryTimeline?: string;     // e.g. "4-6 weeks from PO receipt"
  notes?: string;
  competitorRef?: string;        // internal only, never on PDF
  buyerAddress?: string;         // multi-line address below party name
  buyerTrn?: string;             // buyer's TRN (VAT number)
  attention?: string;            // "Attn:" contact name
  ourReference?: string;         // e.g. "03-26 INTERCOL DTD 6-1-26"
  yourReference?: string;        // e.g. "PO NO :INT20262000314"
  deliveryAddress?: string;      // if different from billing
  documentTitle?: string;        // "PROFORMA INVOICE" or "QUOTATION" (default: PROFORMA INVOICE)
}

// ---- PH Trading constants -------------------------------------------------

const SELLER = {
  nameAr: 'شركة بي اتش التجارية ذ.م.م',
  nameEn: 'PH TRADING W.L.L.',
  address1: 'P.O. Box 815, Manama',
  address2: 'Kingdom of Bahrain',
  tel: '+973 17 587654',
  fax: '+973 17 564456',
  trn: '200010357800002',
  cr: '68034-1',
};

const BANK_DETAILS = [
  { bank: 'National Bank of Bahrain BSC', ac: '99570076', bic: 'NBOBBHBM', iban: 'BH16NBOB00000099570076' },
  { bank: 'Ahli United Bank', ac: '0010521957001', swift: 'AUBBBHBM', iban: 'BH04AUBB0010521957001' },
  { bank: 'Al Salam Bank', ac: '205220101000', swift: 'ALSABHBM', iban: 'BH37ALSA00205220101000' },
  { bank: 'BBK', ac: '100000451009', bic: 'BBKUBHBM', iban: 'BH71BBKU0010000451009' },
];

const VAT_RATE = 10; // percent

// ---- BHD Amount to Words converter ----------------------------------------

function filsToWords(totalFils: bigint): string {
  const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE',
    'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN',
    'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
  const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];

  function numberToWords(n: number): string {
    if (n === 0) return '';
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    if (n < 1000) return ones[Math.floor(n / 100)] + ' HUNDRED' + (n % 100 ? ' AND ' + numberToWords(n % 100) : '');
    if (n < 100000) return numberToWords(Math.floor(n / 1000)) + ' THOUSAND' + (n % 1000 ? ' ' + numberToWords(n % 1000) : '');
    if (n < 10000000) return numberToWords(Math.floor(n / 100000)) + ' LAKH' + (n % 100000 ? ' ' + numberToWords(n % 100000) : '');
    return numberToWords(Math.floor(n / 10000000)) + ' CRORE' + (n % 10000000 ? ' ' + numberToWords(n % 10000000) : '');
  }

  const abs = totalFils < 0n ? -totalFils : totalFils;
  const dinars = Number(abs / 1000n);
  const fils = Number(abs % 1000n);

  let result = '(Total BHD ';
  if (dinars === 0) {
    result += 'ZERO';
  } else {
    result += numberToWords(dinars);
  }

  if (fils > 0) {
    result += ` AND FILS ${fils}/1000`;
  }

  result += ' ONLY)';
  return result;
}

// ---- Quotation number helper ----------------------------------------------

export function getNextQuotationNumber(): string {
  const year = new Date().getFullYear();
  const key = `asymmflow_quote_seq_${year}`;
  const current = parseInt(localStorage.getItem(key) || '0', 10);
  const next = current + 1;
  localStorage.setItem(key, String(next));

  try {
    const conn = getConnection();
    if (conn) {
      conn.reducers.nextDocNumber({ docType: 'quotation', year });
    }
  } catch { /* offline — localStorage is the fallback */ }

  return `PH${String(next).padStart(4, '0')}-${year}`;
}

// ---- Date helpers ---------------------------------------------------------

function todayFormatted(): string {
  const d = new Date();
  return `${d.getDate()}-${d.getMonth() + 1}-${String(d.getFullYear()).slice(2)}`;
}

function validUntilFormatted(validityDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + validityDays);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ---- Grade-based payment terms text ---------------------------------------

function gradePaymentTermsText(party: Party): string {
  const tag = (party.grade as any)?.tag ?? String(party.grade);
  switch (tag) {
    case 'A': return 'Net 45 days';
    case 'B': return 'Net 90 days';
    case 'C': return '50% advance, balance on delivery';
    case 'D': return '100% advance payment required';
    default:  return `${party.paymentTermsDays} days`;
  }
}

// ---- Build pdfmake document definition ------------------------------------

export function buildQuotationDocDefinition(data: QuotationData): { docDef: object; quotNo: string } {
  const { party, items, validityDays } = data;

  const quotNo = getNextQuotationNumber();
  const quotDate = todayFormatted();
  const validUntil = validUntilFormatted(validityDays);
  const paymentTermsText = gradePaymentTermsText(party);
  const deliveryText = data.deliveryTimeline ?? 'To be confirmed upon PO receipt';
  const docTitle = data.documentTitle ?? 'PROFORMA INVOICE';

  // Ensure at least one row
  const rows: QuotationItem[] = items.length > 0
    ? items
    : [{ description: 'As per specification', quantity: 1, unit: 'EA', unitPriceFils: 0n }];

  // Compute line totals
  const computedRows = rows.map((item) => {
    const qty = BigInt(item.quantity);
    const lineTotal = qty * item.unitPriceFils;
    return { ...item, lineTotal };
  });

  // Table header — matches PH Trading format exactly
  const tableHeader = [
    { text: 'Sl No', style: 'tableHeader', alignment: 'center' as const },
    { text: 'Description', style: 'tableHeader' },
    { text: 'Qty', style: 'tableHeader', alignment: 'center' as const },
    { text: 'Unit', style: 'tableHeader', alignment: 'center' as const },
    { text: 'Unit Price BD', style: 'tableHeader', alignment: 'right' as const },
    { text: 'Total Price BD', style: 'tableHeader', alignment: 'right' as const },
  ];

  // Build table body rows
  const tableBody = computedRows.map((item, idx) => {
    // Description with item code on separate line if present
    const descriptionContent = item.itemCode
      ? { stack: [
          { text: `ITEM CODE:${item.itemCode}`, style: 'itemCode' },
          { text: item.description, fontSize: 8 },
        ]}
      : { text: item.description, fontSize: 8 };

    return [
      { text: String(idx + 1), alignment: 'center' as const, fontSize: 8 },
      descriptionContent,
      { text: String(item.quantity), alignment: 'center' as const, fontSize: 8 },
      { text: item.unit || 'EA', alignment: 'center' as const, fontSize: 8 },
      { text: formatBHD(item.unitPriceFils), alignment: 'right' as const, fontSize: 8 },
      { text: formatBHD(item.lineTotal), alignment: 'right' as const, fontSize: 8 },
    ];
  });

  // Totals
  const subtotal = computedRows.reduce((sum, r) => sum + r.lineTotal, 0n);
  const vatAmount = BigInt(Math.round(Number(subtotal) * VAT_RATE / 100));
  const grandTotal = subtotal + vatAmount;

  // Amount in words
  const amountInWords = filsToWords(grandTotal);

  // VAT + Total rows added to table
  const vatRow = [
    { text: '', border: [false, false, false, false] },
    { text: '', border: [false, false, false, false] },
    { text: '', border: [false, false, false, false] },
    { text: '', border: [false, false, false, false] },
    { text: `VAT ${VAT_RATE}%`, alignment: 'right' as const, fontSize: 8, bold: true },
    { text: formatBHD(vatAmount), alignment: 'right' as const, fontSize: 8 },
  ];
  const totalRow = [
    { text: '', border: [false, false, false, false] },
    { text: '', border: [false, false, false, false] },
    { text: '', border: [false, false, false, false] },
    { text: '', border: [false, false, false, false] },
    { text: 'TOTAL', alignment: 'right' as const, fontSize: 9, bold: true },
    { text: formatBHD(grandTotal), alignment: 'right' as const, fontSize: 9, bold: true },
  ];

  // Column widths (A4 usable ~515pt with 40pt margins each side)
  const colWidths = [28, '*', 30, 30, 75, 75];

  // Build buyer address block
  const buyerAddressLines: object[] = [];
  if (data.buyerAddress) {
    data.buyerAddress.split('\n').forEach((line: string) => {
      buyerAddressLines.push({ text: line, style: 'small' });
    });
  }
  if (data.buyerTrn) {
    buyerAddressLines.push({ text: `TRN ${data.buyerTrn}`, style: 'small' });
  }
  // Delivery address (if different)
  if (data.deliveryAddress) {
    buyerAddressLines.push({ text: '', margin: [0, 4, 0, 0] });
    buyerAddressLines.push({ text: 'Delivery to:', style: 'sectionLabel' });
    data.deliveryAddress.split('\n').forEach((line: string) => {
      buyerAddressLines.push({ text: line, style: 'small' });
    });
  }

  // Bank details for footer
  const bankLines = BANK_DETAILS.map((b, i) =>
    `${i + 1}. ${b.bank}, A/c No: ${b.ac}, ${b.bic ? 'BIC' : 'Swift code'}: ${b.bic || b.swift}, IBAN:${b.iban}`
  );

  const docDef = {
    pageSize: 'A4' as const,
    // Top margin = 90pt to leave room for letterhead header
    // Bottom margin = 80pt to leave room for bank details footer
    pageMargins: [40, 90, 40, 80] as [number, number, number, number],

    // Letterhead as BACKGROUND — renders behind content on every page
    background: [
      {
        image: PH_LETTERHEAD_BASE64,
        width: 595,  // A4 width in points
        absolutePosition: { x: 0, y: 0 },
      },
    ],

    footer: {
      stack: [
        { canvas: [{ type: 'line', x1: 40, y1: 0, x2: 555, y2: 0, lineWidth: 0.5, lineColor: '#cccccc' }] },
        { text: 'BANK DETAILS:', style: 'bankHeader', margin: [40, 4, 40, 2] },
        ...bankLines.map(line => ({
          text: line, style: 'bankDetail', margin: [40, 0, 40, 0],
        })),
      ],
    },

    content: [
      // Title — PROFORMA INVOICE: NO: PH2610/2026
      // (letterhead is now in background, content starts in the margin gap)
      {
        text: `${docTitle}: NO: ${quotNo}`,
        style: 'title',
        alignment: 'center' as const,
        margin: [0, 4, 0, 12],
      },

      // Bill to + Date (two columns)
      {
        columns: [
          {
            width: '65%',
            stack: [
              { text: 'Bill to', style: 'sectionLabel' },
              { text: party.name, style: 'buyerName' },
              ...(data.attention
                ? [{ text: `Attn: ${data.attention}`, style: 'small', margin: [0, 1, 0, 0] }]
                : []),
              ...buyerAddressLines,
            ],
          },
          {
            width: '35%',
            stack: [
              {
                table: {
                  widths: ['auto', '*'],
                  body: [
                    [
                      { text: 'Date:', style: 'metaLabel', border: [false, false, false, false] },
                      { text: quotDate, style: 'metaValue', alignment: 'right' as const, border: [false, false, false, false] },
                    ],
                  ],
                },
                layout: 'noBorders',
              },
            ],
            alignment: 'right' as const,
          },
        ],
        margin: [0, 0, 0, 8],
      },

      // Our Reference / Your Reference
      ...(data.ourReference || data.yourReference ? [
        {
          stack: [
            ...(data.ourReference ? [{ text: `Our Reference: ${data.ourReference}`, style: 'refText' }] : []),
            ...(data.yourReference ? [{ text: `Your Reference: ${data.yourReference}`, style: 'refText' }] : []),
          ],
          margin: [0, 0, 0, 10],
        },
      ] : []),

      // Line items table (with VAT and TOTAL rows)
      {
        table: {
          headerRows: 1,
          widths: colWidths,
          body: [tableHeader, ...tableBody, vatRow, totalRow],
        },
        layout: {
          hLineWidth: (i: number, node: any) => {
            if (i === 0 || i === 1) return 1; // top and after header
            if (i === node.table.body.length) return 1; // bottom
            if (i === node.table.body.length - 2) return 0.5; // above VAT
            return 0.5;
          },
          vLineWidth: () => 0.5,
          hLineColor: () => '#333333',
          vLineColor: () => '#aaaaaa',
          fillColor: (i: number) => (i === 0 ? '#e8e8e8' : null),
          paddingLeft: () => 4,
          paddingRight: () => 4,
          paddingTop: () => 3,
          paddingBottom: () => 3,
        },
        margin: [0, 0, 0, 4],
      },

      // Amount in words
      {
        text: amountInWords,
        fontSize: 8,
        bold: true,
        alignment: 'center' as const,
        margin: [0, 2, 0, 12],
      },

      // Payment Details
      {
        stack: [
          { text: 'Payment Details:  Direct bank Transfer or cheque to:', style: 'paymentHeader' },
          { text: 'M/S PH TRADING W.L.L', style: 'small', bold: true },
          { text: `AC NO: ${BANK_DETAILS[0].ac}`, style: 'small' },
          { text: `BIC: ${BANK_DETAILS[0].bic}, IBAN: ${BANK_DETAILS[0].iban}, ${BANK_DETAILS[0].bank}`, style: 'small' },
        ],
        margin: [0, 0, 0, 10],
      },

      // Other terms and conditions
      {
        stack: [
          { text: 'Other terms and conditions:', style: 'paymentHeader' },
          {
            ol: [
              { text: `Terms of Payment: ${paymentTermsText}`, style: 'termsItem' },
              { text: `Specification of materials: Endress+Hauser`, style: 'termsItem' },
              ...(deliveryText !== 'To be confirmed upon PO receipt'
                ? [{ text: `Delivery: ${deliveryText}`, style: 'termsItem' }]
                : []),
              { text: `Validity: This offer is valid for ${validityDays} days from the date of issue.`, style: 'termsItem' },
              ...(data.notes ? [{ text: data.notes, style: 'termsItem' }] : []),
            ],
          },
        ],
        margin: [0, 0, 0, 14],
      },

      // Signature block
      {
        stack: [
          { text: 'FOR PH TRADING W.L.L', style: 'signatureLabel', margin: [0, 0, 0, 34] },
          { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 160, y2: 0, lineWidth: 0.5, lineColor: '#333333' }] },
          { text: 'ABHISHEK KORE', style: 'signatureName', margin: [0, 2, 0, 0] },
          { text: 'General Manager', style: 'signatureTitle' },
        ],
        margin: [0, 0, 0, 6],
      },

      // E. & O.E + generation timestamp
      {
        columns: [
          {
            width: '*',
            text: `Computer generated document. Generated: ${new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}.`,
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
        fontSize: 12,
        bold: true,
        decoration: 'underline' as const,
      },
      sectionLabel: {
        fontSize: 8,
        bold: true,
        color: '#333333',
        margin: [0, 0, 0, 2],
      },
      buyerName: {
        fontSize: 10,
        bold: true,
      },
      small: {
        fontSize: 8,
        color: '#333333',
      },
      refText: {
        fontSize: 9,
        color: '#111111',
      },
      metaLabel: {
        fontSize: 9,
        bold: true,
        color: '#333333',
      },
      metaValue: {
        fontSize: 9,
        color: '#111111',
      },
      tableHeader: {
        fontSize: 8,
        bold: true,
        color: '#111111',
      },
      itemCode: {
        fontSize: 7.5,
        bold: true,
        color: '#333333',
      },
      paymentHeader: {
        fontSize: 9,
        bold: true,
        color: '#111111',
        margin: [0, 0, 0, 4],
      },
      termsItem: {
        fontSize: 8,
        color: '#333333',
        margin: [0, 1, 0, 1],
      },
      signatureLabel: {
        fontSize: 10,
        bold: true,
        color: '#111111',
      },
      signatureName: {
        fontSize: 9,
        bold: true,
        color: '#333333',
      },
      signatureTitle: {
        fontSize: 8,
        color: '#555555',
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
      fontSize: 8,
      font: 'Roboto',
    },
  };

  return { docDef, quotNo };
}

// ---- Public API -----------------------------------------------------------

/**
 * Generate a PH Trading proforma invoice PDF and download it.
 * Format matches actual PH Trading quotation template exactly.
 * Filename format: {QuotNo}_{PartyName}.pdf
 */
export async function generateQuotationPdf(data: QuotationData): Promise<void> {
  const { docDef, quotNo } = buildQuotationDocDefinition(data);
  const partyName = data.party.name.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 30);
  const filename = `${quotNo}_${partyName}.pdf`;
  pdfMake.createPdf(docDef as any).download(filename);
}

/**
 * Alias for generateQuotationPdf.
 */
export async function downloadQuotationPdf(data: QuotationData): Promise<void> {
  return generateQuotationPdf(data);
}
