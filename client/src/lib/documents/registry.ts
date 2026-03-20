import type {
  DocumentTemplate,
  ContextField,
  ContextCheckResult,
  ContextStatus,
  DocumentContext,
} from './types';
import { get } from 'svelte/store';
import { parties, moneyEvents } from '../db';
import type { Party } from '../../module_bindings/types';

// ── Grade → payment terms label ──────────────────────────────────────────────

function gradeLabel(party: Party): string {
  const grade = party.grade.tag ?? String(party.grade);
  const terms = Number(party.paymentTermsDays);
  switch (grade) {
    case 'A': return `Grade A — ${terms} days credit`;
    case 'B': return `Grade B — ${terms} days credit`;
    case 'C': return `Grade C — 50% advance required`;
    case 'D': return `Grade D — 100% advance required`;
    default:  return `${terms} days`;
  }
}

// ── Template definitions ──────────────────────────────────────────────────────

const TAX_INVOICE: DocumentTemplate = {
  id: 'tax_invoice',
  name: 'Tax Invoice',
  description: 'VAT tax invoice for a customer — 10% VAT, BHD currency, PH Trading letterhead',
  category: 'finance',
  outputFormat: 'pdf',
  fields: [
    {
      name: 'partyId',
      label: 'Customer',
      layer: 'hard',
      type: 'party',
      description: 'The customer this invoice is billed to',
    },
    {
      name: 'subtotalFils',
      label: 'Subtotal (fils)',
      layer: 'hard',
      type: 'bigint',
      description: 'Invoice subtotal before VAT, in fils (1 BHD = 1000 fils)',
    },
    {
      name: 'reference',
      label: 'Invoice Reference',
      layer: 'hard',
      type: 'string',
      description: 'Invoice or PO reference number (e.g. INV-042 or PO-2024-001)',
    },
    {
      name: 'deliveryNoteNumber',
      label: 'Delivery Note #',
      layer: 'soft',
      type: 'string',
      description: 'Delivery note reference to print in the Tally header',
    },
    {
      name: 'deliveryNoteDate',
      label: 'Delivery Note Date',
      layer: 'soft',
      type: 'date',
      description: 'Delivery note date shown in the Tally header',
    },
    {
      name: 'customerPoNumber',
      label: 'Customer PO #',
      layer: 'soft',
      type: 'string',
      description: 'Customer purchase order number for the Tally header',
    },
    {
      name: 'customerPoDate',
      label: 'Customer PO Date',
      layer: 'soft',
      type: 'date',
      description: 'Customer purchase order date for the Tally header',
    },
    {
      name: 'placeOfSupply',
      label: 'Place of Supply',
      layer: 'soft',
      type: 'string',
      description: 'Place of supply for VAT reporting',
    },
    {
      name: 'destination',
      label: 'Destination',
      layer: 'soft',
      type: 'string',
      description: 'Customer delivery destination shown in the header',
    },
    {
      name: 'dispatchThrough',
      label: 'Dispatch Through',
      layer: 'soft',
      type: 'string',
      description: 'Courier, vehicle, or dispatch method',
    },
    {
      name: 'termsOfDelivery',
      label: 'Terms of Delivery',
      layer: 'soft',
      type: 'string',
      description: 'Delivery terms such as DDP, EXW, or site delivery notes',
    },
    {
      name: 'otherReferences',
      label: 'Other References',
      layer: 'soft',
      type: 'string',
      description: 'RFQ number, project reference, or other freeform references',
    },
    {
      name: 'showCostingColumns',
      label: 'Show Costing Columns',
      layer: 'soft',
      type: 'string',
      defaultValue: '{"fob":false,"freight":false,"margin":false}',
      description: 'JSON visibility map for optional FOB, freight, and margin columns',
    },
    {
      name: 'dueDate',
      label: 'Due Date',
      layer: 'soft',
      type: 'date',
      description: 'Payment due date — defaults to today + customer payment terms',
    },
    {
      name: 'orderId',
      label: 'Linked Order ID',
      layer: 'soft',
      type: 'number',
      description: 'Internal order number to link this invoice to a sales order',
    },
    {
      name: 'vatFils',
      label: 'VAT Amount (fils)',
      layer: 'auto',
      type: 'bigint',
      source: 'subtotalFils × 10%',
      description: 'Calculated automatically as 10% of subtotal',
    },
    {
      name: 'totalFils',
      label: 'Grand Total (fils)',
      layer: 'auto',
      type: 'bigint',
      source: 'subtotalFils + vatFils',
      description: 'Calculated automatically',
    },
    {
      name: 'partyName',
      label: 'Customer Name',
      layer: 'auto',
      type: 'string',
      source: 'Party.name',
      description: 'Pulled from customer record',
    },
    {
      name: 'paymentTerms',
      label: 'Payment Terms',
      layer: 'auto',
      type: 'string',
      source: 'Party.paymentTermsDays',
      description: 'Pulled from customer record',
    },
    {
      name: 'letterhead',
      label: 'Letterhead',
      layer: 'auto',
      type: 'string',
      source: 'PH_LETTERHEAD_BASE64',
      description: 'PH Trading letterhead image embedded in PDF',
    },
  ],
};

const QUOTATION: DocumentTemplate = {
  id: 'quotation',
  name: 'Quotation',
  description: 'Sales quotation / offer for a customer with line items and pricing',
  category: 'sales',
  outputFormat: 'pdf',
  fields: [
    {
      name: 'partyId',
      label: 'Customer',
      layer: 'hard',
      type: 'party',
      description: 'The customer this quotation is addressed to',
    },
    {
      name: 'products',
      label: 'Product Descriptions',
      layer: 'hard',
      type: 'string',
      description: 'List of products or services being quoted (one per line)',
    },
    {
      name: 'quantities',
      label: 'Quantities',
      layer: 'hard',
      type: 'string',
      description: 'Quantity for each product line (matching order of products)',
    },
    {
      name: 'unitPrices',
      label: 'Unit Prices (BHD)',
      layer: 'hard',
      type: 'string',
      description: 'Unit price per item in BHD (matching order of products)',
    },
    {
      name: 'validityDays',
      label: 'Validity Period (days)',
      layer: 'soft',
      type: 'number',
      defaultValue: 30,
      description: 'How many days this quotation remains valid (default: 30)',
    },
    {
      name: 'deliveryTimeline',
      label: 'Delivery Timeline',
      layer: 'soft',
      type: 'string',
      description: 'Expected delivery or lead time (e.g. "4-6 weeks from order")',
    },
    {
      name: 'competitorRef',
      label: 'Competitor Reference',
      layer: 'soft',
      type: 'string',
      description: 'If competing against another offer, note it here for context',
    },
    {
      name: 'notes',
      label: 'Additional Notes',
      layer: 'soft',
      type: 'string',
      description: 'Any special terms, exclusions, or remarks to include',
    },
    {
      name: 'partyName',
      label: 'Customer Name',
      layer: 'auto',
      type: 'string',
      source: 'Party.name',
      description: 'Pulled from customer record',
    },
    {
      name: 'partyGrade',
      label: 'Customer Grade',
      layer: 'auto',
      type: 'string',
      source: 'Party.grade',
      description: 'Pulled from customer record',
    },
    {
      name: 'paymentTerms',
      label: 'Payment Terms',
      layer: 'auto',
      type: 'string',
      source: 'Party.grade → standard terms',
      description: 'Derived from customer grade',
    },
    {
      name: 'quotationNumber',
      label: 'Quotation Number',
      layer: 'auto',
      type: 'string',
      source: 'generated',
      description: 'Auto-generated quotation reference number',
    },
    {
      name: 'letterhead',
      label: 'Letterhead',
      layer: 'auto',
      type: 'string',
      source: 'PH_LETTERHEAD_BASE64',
      description: 'PH Trading letterhead image embedded in PDF',
    },
  ],
};

const STATEMENT_OF_ACCOUNT: DocumentTemplate = {
  id: 'statement_of_account',
  name: 'Statement of Account',
  description: 'Full account statement for a customer showing all invoices, payments, running balance and aging buckets',
  category: 'finance',
  outputFormat: 'pdf',
  fields: [
    {
      name: 'partyId',
      label: 'Customer',
      layer: 'hard',
      type: 'party',
      description: 'The customer whose account statement to generate',
    },
    {
      name: 'dateFrom',
      label: 'From Date',
      layer: 'soft',
      type: 'date',
      description: 'Start of statement period (default: all history)',
    },
    {
      name: 'dateTo',
      label: 'To Date',
      layer: 'soft',
      type: 'date',
      defaultValue: 'today',
      description: 'End of statement period (default: today)',
    },
    {
      name: 'includePayments',
      label: 'Include Payments',
      layer: 'soft',
      type: 'string',
      defaultValue: true,
      description: 'Whether to show payment entries alongside invoices (default: yes)',
    },
    {
      name: 'partyName',
      label: 'Customer Name',
      layer: 'auto',
      type: 'string',
      source: 'Party.name',
      description: 'Pulled from customer record',
    },
    {
      name: 'moneyEvents',
      label: 'All Transactions',
      layer: 'auto',
      type: 'string',
      source: 'MoneyEvent where partyId matches',
      description: 'All invoices and payments for this customer from STDB',
    },
    {
      name: 'outstandingFils',
      label: 'Total Outstanding',
      layer: 'auto',
      type: 'bigint',
      source: 'sum(invoices) - sum(payments)',
      description: 'Computed from MoneyEvents — never stored directly',
    },
    {
      name: 'agingBuckets',
      label: 'Aging Analysis',
      layer: 'auto',
      type: 'string',
      source: 'MoneyEvent.dueDate vs today',
      description: 'Overdue split into 30/60/90/120+ day buckets',
    },
  ],
};

const PAYMENT_CHASE: DocumentTemplate = {
  id: 'payment_chase',
  name: 'Payment Chase',
  description: 'Payment reminder message or letter for an overdue customer — tone adapts to customer grade',
  category: 'communication',
  outputFormat: 'text',
  fields: [
    {
      name: 'partyId',
      label: 'Customer',
      layer: 'hard',
      type: 'party',
      description: 'The customer with overdue payments to chase',
    },
    {
      name: 'channel',
      label: 'Channel',
      layer: 'soft',
      type: 'enum',
      defaultValue: 'whatsapp',
      description: 'Delivery channel: whatsapp (short/friendly), email (formal), formal_letter (legal tone)',
    },
    {
      name: 'toneOverride',
      label: 'Tone Override',
      layer: 'soft',
      type: 'string',
      description: 'Override the auto-selected tone (e.g. "urgent", "gentle reminder")',
    },
    {
      name: 'partyName',
      label: 'Customer Name',
      layer: 'auto',
      type: 'string',
      source: 'Party.name',
      description: 'Pulled from customer record',
    },
    {
      name: 'partyGrade',
      label: 'Customer Grade',
      layer: 'auto',
      type: 'string',
      source: 'Party.grade',
      description: 'Determines baseline tone (A=polite, D=firm)',
    },
    {
      name: 'outstandingFils',
      label: 'Outstanding Amount',
      layer: 'auto',
      type: 'bigint',
      source: 'sum(CustomerInvoice) - sum(CustomerPayment)',
      description: 'Computed from MoneyEvents',
    },
    {
      name: 'overdueDays',
      label: 'Days Overdue',
      layer: 'auto',
      type: 'number',
      source: 'oldest unpaid MoneyEvent.dueDate vs today',
      description: 'How many days past due the oldest overdue invoice is',
    },
    {
      name: 'lastActivityDate',
      label: 'Last Activity',
      layer: 'auto',
      type: 'date',
      source: 'max(MoneyEvent.updatedAt)',
      description: 'Date of last transaction with this customer',
    },
    {
      name: 'gradeTone',
      label: 'Grade-Appropriate Tone',
      layer: 'auto',
      type: 'string',
      source: 'Party.grade → tone mapping',
      description: 'A=collegial, B=professional, C=firm, D=formal demand',
    },
  ],
};

const PURCHASE_ORDER: DocumentTemplate = {
  id: 'purchase_order',
  name: 'Purchase Order',
  description: 'Purchase order sent to a supplier for goods or services',
  category: 'operations',
  outputFormat: 'pdf',
  fields: [
    {
      name: 'partyId',
      label: 'Supplier',
      layer: 'hard',
      type: 'party',
      description: 'The supplier this purchase order is issued to',
    },
    {
      name: 'items',
      label: 'Items / Description',
      layer: 'hard',
      type: 'string',
      description: 'What is being ordered (product names, specs, quantities)',
    },
    {
      name: 'totalFils',
      label: 'Total Amount (fils)',
      layer: 'hard',
      type: 'bigint',
      description: 'Total PO value in fils (1 BHD = 1000 fils)',
    },
    {
      name: 'linkedOrderId',
      label: 'Linked Sales Order ID',
      layer: 'soft',
      type: 'number',
      description: 'Internal sales order this PO fulfils (if any)',
    },
    {
      name: 'deliveryDate',
      label: 'Required Delivery Date',
      layer: 'soft',
      type: 'date',
      description: 'When the goods must arrive',
    },
    {
      name: 'supplierReference',
      label: 'Supplier Reference',
      layer: 'soft',
      type: 'string',
      description: 'Supplier RFQ or quotation reference to print on the PO',
    },
    {
      name: 'buyerOrderNumber',
      label: 'Buyer Order Number',
      layer: 'soft',
      type: 'string',
      description: 'Customer sales order or internal project order reference',
    },
    {
      name: 'paymentTerms',
      label: 'Payment Terms',
      layer: 'soft',
      type: 'string',
      description: 'Commercial payment terms shown on the PO footer and metadata block',
    },
    {
      name: 'deliveryTerms',
      label: 'Delivery Terms',
      layer: 'soft',
      type: 'string',
      description: 'Incoterms or delivery conditions for the supplier',
    },
    {
      name: 'deliveryAddress',
      label: 'Delivery Address',
      layer: 'soft',
      type: 'string',
      description: 'Warehouse or site delivery address for the supplier shipment',
    },
    {
      name: 'notes',
      label: 'Special Instructions',
      layer: 'soft',
      type: 'string',
      description: 'Packaging, labelling, delivery address, or other requirements',
    },
    {
      name: 'partyName',
      label: 'Supplier Name',
      layer: 'auto',
      type: 'string',
      source: 'Party.name',
      description: 'Pulled from supplier record',
    },
    {
      name: 'poNumber',
      label: 'PO Number',
      layer: 'auto',
      type: 'string',
      source: 'generated',
      description: 'Auto-generated purchase order reference',
    },
    {
      name: 'createdBy',
      label: 'Created By',
      layer: 'auto',
      type: 'string',
      source: 'current Member.fullName',
      description: 'The logged-in user issuing this PO',
    },
    {
      name: 'letterhead',
      label: 'Letterhead',
      layer: 'auto',
      type: 'string',
      source: 'PH_LETTERHEAD_BASE64',
      description: 'PH Trading letterhead image embedded in PDF',
    },
  ],
};

const DELIVERY_NOTE: DocumentTemplate = {
  id: 'delivery_note',
  name: 'Delivery Note',
  description: 'Delivery note sent with dispatched goods for customer acknowledgement',
  category: 'operations',
  outputFormat: 'pdf',
  fields: [
    {
      name: 'partyId',
      label: 'Customer',
      layer: 'hard',
      type: 'party',
      description: 'The customer receiving the goods',
    },
    {
      name: 'orderReference',
      label: 'Order Reference',
      layer: 'hard',
      type: 'string',
      description: 'Sales order number or internal order reference linked to this delivery',
    },
    {
      name: 'items',
      label: 'Delivered Items',
      layer: 'hard',
      type: 'string',
      description: 'Delivered line items with quantities and any delivery notes',
    },
    {
      name: 'deliveryAddress',
      label: 'Delivery Address',
      layer: 'soft',
      type: 'string',
      description: 'Customer site or warehouse address for this dispatch',
    },
    {
      name: 'driverName',
      label: 'Driver Name',
      layer: 'soft',
      type: 'string',
      description: 'Driver assigned to the dispatch',
    },
    {
      name: 'vehicleNumber',
      label: 'Vehicle Number',
      layer: 'soft',
      type: 'string',
      description: 'Vehicle or van registration used for the delivery',
    },
    {
      name: 'receiverName',
      label: 'Receiver Name',
      layer: 'soft',
      type: 'string',
      description: 'Customer receiver name if known at generation time',
    },
    {
      name: 'notes',
      label: 'Delivery Notes',
      layer: 'soft',
      type: 'string',
      description: 'Handling, packing, or dispatch remarks to print on the DN',
    },
    {
      name: 'dnNumber',
      label: 'DN Number',
      layer: 'auto',
      type: 'string',
      source: 'deliveryNote.dnNumber',
      description: 'Auto-generated delivery note reference',
    },
    {
      name: 'deliveryDate',
      label: 'Delivery Date',
      layer: 'auto',
      type: 'date',
      source: 'deliveryNote.deliveryDate',
      description: 'Delivery note date from STDB',
    },
    {
      name: 'status',
      label: 'Delivery Status',
      layer: 'auto',
      type: 'string',
      source: 'deliveryNote.status',
      description: 'Current delivery note status',
    },
    {
      name: 'partyName',
      label: 'Customer Name',
      layer: 'auto',
      type: 'string',
      source: 'Party.name',
      description: 'Pulled from customer record',
    },
    {
      name: 'letterhead',
      label: 'Letterhead',
      layer: 'auto',
      type: 'string',
      source: 'PH_LETTERHEAD_BASE64',
      description: 'PH Trading letterhead image embedded in PDF',
    },
  ],
};

const EMAIL_DRAFT: DocumentTemplate = {
  id: 'email_draft',
  name: 'Email Draft',
  description: 'Professional email draft for 5 commercial variants: RFQ response, offer submission, follow-up, revision notice, PO acknowledgment',
  category: 'communication',
  outputFormat: 'text',
  fields: [
    {
      name: 'partyId',
      label: 'Customer / Supplier',
      layer: 'hard',
      type: 'party',
      description: 'The party this email is addressed to',
    },
    {
      name: 'variant',
      label: 'Email Variant',
      layer: 'hard',
      type: 'enum',
      description: 'rfq_response | offer_submission | follow_up | revision_notice | po_acknowledgment',
    },
    {
      name: 'pipelineId',
      label: 'Linked Pipeline',
      layer: 'soft',
      type: 'number',
      description: 'Pipeline to reference for title, value, and revision number',
    },
    {
      name: 'points',
      label: 'Key Points',
      layer: 'soft',
      type: 'string',
      description: 'Extra bullet points to include in the email body (one per line)',
    },
    {
      name: 'contactName',
      label: 'Contact Name',
      layer: 'auto',
      type: 'string',
      source: 'Contact.name for this party',
      description: 'Primary contact name pulled from party contacts',
    },
    {
      name: 'senderName',
      label: 'Sender Name',
      layer: 'auto',
      type: 'string',
      source: 'current Member.fullName',
      description: 'Auto-filled from the logged-in user; defaults to Abhishek Kore',
    },
  ],
};

const COVER_LETTER: DocumentTemplate = {
  id: 'cover_letter',
  name: 'Cover Letter',
  description: 'Formal PDF cover letter with PH Trading letterhead, item table, and commercial terms — sent with quotations or offers',
  category: 'communication',
  outputFormat: 'pdf',
  fields: [
    {
      name: 'partyId',
      label: 'Customer',
      layer: 'hard',
      type: 'party',
      description: 'The customer this cover letter is addressed to',
    },
    {
      name: 'pipelineId',
      label: 'Linked Pipeline',
      layer: 'hard',
      type: 'number',
      description: 'Pipeline providing the title, items, and offer value for the letter',
    },
    {
      name: 'notes',
      label: 'Special Remarks',
      layer: 'soft',
      type: 'string',
      description: 'Any additional terms, exclusions, or special remarks to include',
    },
    {
      name: 'contactName',
      label: 'Attn Contact Name',
      layer: 'auto',
      type: 'string',
      source: 'Contact.name for this party',
      description: 'Primary contact name for the Attn: line',
    },
    {
      name: 'totalFils',
      label: 'Offer Total (fils)',
      layer: 'auto',
      type: 'bigint',
      source: 'Pipeline.offerTotalFils',
      description: 'Total offer value pulled from the linked pipeline',
    },
    {
      name: 'validityDays',
      label: 'Validity (days)',
      layer: 'auto',
      type: 'number',
      source: 'default 30',
      description: 'Offer validity period — always 30 days',
    },
    {
      name: 'paymentTerms',
      label: 'Payment Terms',
      layer: 'auto',
      type: 'string',
      source: 'Party.grade → standard terms',
      description: 'Derived from customer grade (A=Net 45, B=Net 90, C=50% advance, D=100% advance)',
    },
  ],
};

const TECHNICAL_SUBMITTAL: DocumentTemplate = {
  id: 'technical_submittal',
  name: 'Technical Submittal',
  description: 'PDF index / checklist of technical documents included with an offer — datasheets, drawings, sizing, certificates',
  category: 'operations',
  outputFormat: 'pdf',
  fields: [
    {
      name: 'pipelineId',
      label: 'Linked Pipeline',
      layer: 'hard',
      type: 'number',
      description: 'Pipeline this submittal belongs to — used for title and reference number',
    },
    {
      name: 'documents',
      label: 'Document List',
      layer: 'hard',
      type: 'string',
      description: 'List of documents to include: name, type (TI/DWG/Sizing/Spec/Datasheet/Certificate/Other), and page count',
    },
    {
      name: 'partyName',
      label: 'Customer Name',
      layer: 'auto',
      type: 'string',
      source: 'Party.name via Pipeline.partyId',
      description: 'Customer name pulled from the party linked to the pipeline',
    },
    {
      name: 'preparedBy',
      label: 'Prepared By',
      layer: 'auto',
      type: 'string',
      source: 'current Member.fullName',
      description: 'Auto-filled from the logged-in user; defaults to Abhishek Kore',
    },
  ],
};

// ── Registry map ──────────────────────────────────────────────────────────────

const REGISTRY = new Map<string, DocumentTemplate>([
  [TAX_INVOICE.id,           TAX_INVOICE],
  [QUOTATION.id,             QUOTATION],
  [STATEMENT_OF_ACCOUNT.id,  STATEMENT_OF_ACCOUNT],
  [PAYMENT_CHASE.id,         PAYMENT_CHASE],
  [PURCHASE_ORDER.id,        PURCHASE_ORDER],
  [DELIVERY_NOTE.id,         DELIVERY_NOTE],
  [EMAIL_DRAFT.id,           EMAIL_DRAFT],
  [COVER_LETTER.id,          COVER_LETTER],
  [TECHNICAL_SUBMITTAL.id,   TECHNICAL_SUBMITTAL],
]);

// ── Public accessors ──────────────────────────────────────────────────────────

export function getTemplate(id: string): DocumentTemplate | undefined {
  return REGISTRY.get(id);
}

export function getAllTemplates(): DocumentTemplate[] {
  return Array.from(REGISTRY.values());
}

export function getTemplatesByCategory(cat: string): DocumentTemplate[] {
  return Array.from(REGISTRY.values()).filter((t) => t.category === cat);
}

// ── Auto-field resolution from STDB ──────────────────────────────────────────

function resolveAutoFields(
  template: DocumentTemplate,
  provided: Partial<DocumentContext>,
): Map<string, { value: unknown; source: string }> {
  const resolved = new Map<string, { value: unknown; source: string }>();

  // Find the party if partyId is provided
  const partyId = provided['partyId'] as bigint | number | string | undefined;
  let party: Party | undefined;
  if (partyId !== undefined) {
    const allParties = get(parties);
    party = allParties.find((p) => String(p.id) === String(partyId));
  }

  for (const field of template.fields) {
    if (field.layer !== 'auto') continue;

    switch (field.name) {
      case 'partyName':
        if (party) resolved.set(field.name, { value: party.name, source: 'STDB Party table' });
        break;

      case 'partyGrade': {
        if (party) {
          const g = party.grade.tag ?? String(party.grade);
          resolved.set(field.name, { value: g, source: 'STDB Party table' });
        }
        break;
      }

      case 'paymentTerms':
        if (party) resolved.set(field.name, { value: gradeLabel(party), source: 'STDB Party table' });
        break;

      case 'gradeTone':
        if (party) {
          const g = party.grade.tag ?? String(party.grade);
          const tones: Record<string, string> = {
            A: 'collegial — long relationship, gentle reminder',
            B: 'professional — polite but direct',
            C: 'firm — reference advance terms, request ETA',
            D: 'formal demand — cite overdue amount, escalation path',
          };
          resolved.set(field.name, { value: tones[g] ?? 'professional', source: 'grade → tone mapping' });
        }
        break;

      case 'vatFils': {
        const sub = provided['subtotalFils'] as bigint | undefined;
        if (sub !== undefined) {
          const vat = BigInt(Math.round(Number(sub) * 10 / 100));
          resolved.set(field.name, { value: vat, source: 'subtotalFils × 10%' });
        }
        break;
      }

      case 'totalFils': {
        const sub = provided['subtotalFils'] as bigint | undefined;
        if (sub !== undefined) {
          const vat = BigInt(Math.round(Number(sub) * 10 / 100));
          resolved.set(field.name, { value: sub + vat, source: 'subtotalFils + vatFils' });
        }
        break;
      }

      case 'outstandingFils':
      case 'agingBuckets':
      case 'overdueDays':
      case 'lastActivityDate':
      case 'moneyEvents': {
        if (party) {
          const allEvents = get(moneyEvents).filter((e) => String(e.partyId) === String(party!.id));
          const now = Date.now();

          const invoiceTotal = allEvents
            .filter((e) => e.kind.tag === 'CustomerInvoice')
            .reduce((s, e) => s + Number(e.totalFils), 0);
          const paymentTotal = allEvents
            .filter((e) => e.kind.tag === 'CustomerPayment')
            .reduce((s, e) => s + Number(e.totalFils), 0);
          const outstanding = BigInt(Math.max(0, invoiceTotal - paymentTotal));

          if (field.name === 'outstandingFils') {
            resolved.set(field.name, { value: outstanding, source: 'computed from MoneyEvents' });
          } else if (field.name === 'moneyEvents') {
            resolved.set(field.name, { value: allEvents, source: 'STDB MoneyEvent table' });
          } else if (field.name === 'overdueDays') {
            const unpaid = allEvents.filter(
              (e) => e.kind.tag === 'CustomerInvoice' && e.dueDate && Number(e.dueDate.toMillis()) < now,
            );
            if (unpaid.length > 0) {
              const oldest = Math.min(...unpaid.map((e) => Number(e.dueDate!.toMillis())));
              const days = Math.floor((now - oldest) / 86_400_000);
              resolved.set(field.name, { value: days, source: 'oldest overdue MoneyEvent.dueDate' });
            } else {
              resolved.set(field.name, { value: 0, source: 'no overdue invoices' });
            }
          } else if (field.name === 'lastActivityDate') {
            if (allEvents.length > 0) {
              const latest = Math.max(...allEvents.map((e) => Number(e.updatedAt.toMillis())));
              resolved.set(field.name, { value: new Date(latest).toLocaleDateString('en-GB'), source: 'max MoneyEvent.updatedAt' });
            }
          } else if (field.name === 'agingBuckets') {
            const buckets = { current: 0n, d30: 0n, d60: 0n, d90: 0n, d120plus: 0n };
            for (const e of allEvents.filter((ev) => ev.kind.tag === 'CustomerInvoice')) {
              if (!e.dueDate) continue;
              const dueMs = Number(e.dueDate.toMillis());
              const daysPast = Math.floor((now - dueMs) / 86_400_000);
              if (daysPast <= 0)       buckets.current  += e.totalFils;
              else if (daysPast <= 30) buckets.d30      += e.totalFils;
              else if (daysPast <= 60) buckets.d60      += e.totalFils;
              else if (daysPast <= 90) buckets.d90      += e.totalFils;
              else                     buckets.d120plus += e.totalFils;
            }
            resolved.set(field.name, { value: buckets, source: 'MoneyEvent.dueDate vs today' });
          }
        }
        break;
      }

      case 'quotationNumber':
        resolved.set(field.name, { value: `QT-${Date.now().toString(36).toUpperCase()}`, source: 'generated' });
        break;

      case 'poNumber':
        resolved.set(field.name, { value: `PO-${Date.now().toString(36).toUpperCase()}`, source: 'generated' });
        break;

      // letterhead and createdBy are not resolvable client-side here
      default:
        break;
    }
  }

  return resolved;
}

// ── checkContext ──────────────────────────────────────────────────────────────

export function checkContext(
  templateId: string,
  provided: Partial<DocumentContext>,
): ContextCheckResult {
  const template = REGISTRY.get(templateId);
  if (!template) {
    return { complete: false, known: [], inferred: [], needed: [], readyToGenerate: false };
  }

  const autoResolved = resolveAutoFields(template, provided);

  const known: ContextStatus[]    = [];
  const inferred: ContextStatus[] = [];
  const needed: ContextStatus[]   = [];

  for (const field of template.fields) {
    if (field.layer === 'auto') {
      if (autoResolved.has(field.name)) {
        const { value, source } = autoResolved.get(field.name)!;
        known.push({ field, status: 'known', value, source });
      }
      // auto fields that can't be resolved yet are silently skipped —
      // they depend on hard fields the user hasn't provided yet
      continue;
    }

    const inProvided = Object.prototype.hasOwnProperty.call(provided, field.name);

    if (inProvided) {
      known.push({ field, status: 'known', value: provided[field.name], source: 'user input' });
      continue;
    }

    if (field.layer === 'hard') {
      needed.push({ field, status: 'needed' });
    } else {
      // soft field — inferred if it has a default, needed otherwise
      if (field.defaultValue !== undefined) {
        inferred.push({ field, status: 'inferred', value: field.defaultValue, source: 'default' });
      } else {
        needed.push({ field, status: 'needed' });
      }
    }
  }

  const hardNeeded = needed.filter((s) => s.field.layer === 'hard');
  const readyToGenerate = hardNeeded.length === 0;
  const complete = readyToGenerate && needed.length === 0;

  return { complete, known, inferred, needed, readyToGenerate };
}

// ── buildContextPrompt ────────────────────────────────────────────────────────

export function buildContextPrompt(check: ContextCheckResult, templateName: string): string {
  const lines: string[] = [`To generate your ${templateName}, here's where we stand:`];

  if (check.known.length > 0) {
    lines.push('');
    lines.push('KNOWN (from data):');
    for (const s of check.known) {
      const display = formatValue(s.field.type, s.value);
      lines.push(`  - ${s.field.label}: ${display}${s.source ? ` (${s.source})` : ''}`);
    }
  }

  const hardNeeded = check.needed.filter((s) => s.field.layer === 'hard');
  if (hardNeeded.length > 0) {
    lines.push('');
    lines.push('STILL NEEDED:');
    for (const s of hardNeeded) {
      lines.push(`  - ${s.field.label} — ${s.field.description}`);
    }
  }

  if (check.inferred.length > 0) {
    lines.push('');
    lines.push('OPTIONAL (will use defaults if not provided):');
    for (const s of check.inferred) {
      const display = formatValue(s.field.type, s.value);
      lines.push(`  - ${s.field.label} (default: ${display})`);
    }
  }

  const softNeeded = check.needed.filter((s) => s.field.layer === 'soft');
  if (softNeeded.length > 0) {
    lines.push('');
    lines.push('ALSO OPTIONAL:');
    for (const s of softNeeded) {
      lines.push(`  - ${s.field.label} — ${s.field.description}`);
    }
  }

  if (check.readyToGenerate) {
    lines.push('');
    lines.push('Ready to generate! Say "go" to confirm, or add any optional details above.');
  } else {
    lines.push('');
    lines.push('Please provide the STILL NEEDED items above to continue.');
  }

  return lines.join('\n');
}

// ── Formatting helper ─────────────────────────────────────────────────────────

function formatValue(type: ContextField['type'], value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (type === 'bigint') {
    const fils = typeof value === 'bigint' ? value : BigInt(String(value));
    const bhd = Number(fils) / 1000;
    return `BHD ${bhd.toFixed(3)}`;
  }
  if (type === 'date' && value === 'today') return 'today';
  return String(value);
}
