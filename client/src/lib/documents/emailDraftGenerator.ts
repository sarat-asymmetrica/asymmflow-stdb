import type { Party, Pipeline } from '../stdb_generated/types';
import { formatBHD } from '../format';

// ── Types ─────────────────────────────────────────────────────────────────────

export type EmailVariant =
  | 'rfq_response'
  | 'offer_submission'
  | 'follow_up'
  | 'revision_notice'
  | 'po_acknowledgment';

export interface EmailDraftData {
  party: Party;
  contact?: string;           // contact name / Attn line
  pipeline?: Pipeline;        // linked pipeline record (optional)
  variant: EmailVariant;
  senderName?: string;        // defaults to "Abhishek Kore"
  points?: string[];          // extra bullet points to include in the body
}

export interface EmailDraftResult {
  subject: string;
  body: string;
  variant: EmailVariant;
}

// ── PH Trading constants ──────────────────────────────────────────────────────

const SENDER_DEFAULT  = 'Abhishek Kore';
const SENDER_TITLE    = 'General Manager';
const COMPANY_NAME    = 'PH Trading W.L.L.';
const COMPANY_TEL     = '+973 17 587654';
const COMPANY_EMAIL   = 'sales@phtrading.com.bh';
const COMPANY_ADDRESS = 'P.O. Box 815, Manama, Kingdom of Bahrain';

function signatureBlock(senderName: string): string {
  return [
    '',
    'Best regards,',
    senderName,
    SENDER_TITLE,
    COMPANY_NAME,
    `Tel: ${COMPANY_TEL}`,
    `Email: ${COMPANY_EMAIL}`,
    COMPANY_ADDRESS,
  ].join('\n');
}

// ── Grade-based payment terms text ───────────────────────────────────────────

function gradePaymentText(party: Party): string {
  const tag = (party.grade as any)?.tag ?? String(party.grade);
  switch (tag) {
    case 'A': return 'Net 45 days';
    case 'B': return 'Net 90 days';
    case 'C': return '50% advance, balance on delivery';
    case 'D': return '100% advance payment';
    default:  return `${Number(party.paymentTermsDays)} days`;
  }
}

// ── Extra points formatter ────────────────────────────────────────────────────

function formatPoints(points: string[]): string {
  if (points.length === 0) return '';
  return '\n' + points.map((p) => `  - ${p}`).join('\n');
}

// ── Variant builders ──────────────────────────────────────────────────────────

function buildRfqResponse(data: EmailDraftData): EmailDraftResult {
  const { party, contact, pipeline, senderName, points = [] } = data;
  const sender = senderName ?? SENDER_DEFAULT;
  const salutation = contact ? `Dear ${contact},` : `Dear Sir / Madam,`;
  const pipelineRef = pipeline ? ` (Ref: ${pipeline.title})` : '';
  const offerValue = pipeline
    ? `\n\nAs discussed, we are pleased to offer the above goods at a total value of BHD ${formatBHD(pipeline.estimatedValueFils)}, subject to your confirmation.`
    : '';

  const body = [
    salutation,
    '',
    `Thank you for your enquiry${pipelineRef}. We are pleased to provide our best offer for the items / services requested.`,
    offerValue,
    '',
    `Please find our quotation attached for your kind review and consideration. Our offer is prepared on the following basis:`,
    `  - Payment terms: ${gradePaymentText(party)}`,
    `  - Validity: 30 days from this date`,
    `  - Delivery: Subject to final confirmation of order`,
    formatPoints(points),
    '',
    `We remain at your disposal should you require any clarification or further technical details. We look forward to the opportunity to serve you.`,
    signatureBlock(sender),
  ].filter((l) => l !== null).join('\n');

  return {
    subject: `Quotation / Offer — ${party.name}${pipelineRef}`,
    body,
    variant: 'rfq_response',
  };
}

function buildOfferSubmission(data: EmailDraftData): EmailDraftResult {
  const { party, contact, pipeline, senderName, points = [] } = data;
  const sender = senderName ?? SENDER_DEFAULT;
  const salutation = contact ? `Dear ${contact},` : `Dear Sir / Madam,`;
  const pipelineRef = pipeline ? ` for "${pipeline.title}"` : '';
  const valueLine = pipeline
    ? `\n\nOur offer total is BHD ${formatBHD(pipeline.offerTotalFils || pipeline.estimatedValueFils)}, inclusive of all applicable taxes.`
    : '';

  const body = [
    salutation,
    '',
    `We are pleased to submit our formal offer${pipelineRef} as detailed in the attached proforma invoice.`,
    valueLine,
    '',
    `Key commercial terms:`,
    `  - Payment: ${gradePaymentText(party)}`,
    `  - Offer validity: 30 days`,
    `  - Incoterms: DDP Bahrain (unless otherwise stated in the offer)`,
    formatPoints(points),
    '',
    `We trust our offer meets your requirements and look forward to receiving your valued purchase order.`,
    '',
    `Please do not hesitate to contact us for any clarification.`,
    signatureBlock(sender),
  ].filter((l) => l !== null).join('\n');

  return {
    subject: `Formal Offer Submission — ${party.name}${pipelineRef ? ` / ${pipeline!.title}` : ''}`,
    body,
    variant: 'offer_submission',
  };
}

function buildFollowUp(data: EmailDraftData): EmailDraftResult {
  const { party, contact, pipeline, senderName, points = [] } = data;
  const sender = senderName ?? SENDER_DEFAULT;
  const salutation = contact ? `Dear ${contact},` : `Dear Sir / Madam,`;
  const pipelineRef = pipeline ? ` regarding our offer for "${pipeline.title}"` : '';

  const body = [
    salutation,
    '',
    `I hope this message finds you well. I am writing to follow up${pipelineRef} submitted to you earlier.`,
    '',
    `Could you kindly let us know the current status of your review? We are happy to address any questions, provide additional technical documentation, or adjust the scope if required.`,
    formatPoints(points),
    '',
    `Your feedback is important to us, and we want to ensure our offer fully meets your needs.`,
    '',
    `Please feel free to reach me directly at any time.`,
    signatureBlock(sender),
  ].filter((l) => l !== null).join('\n');

  return {
    subject: `Follow-Up — ${party.name}${pipeline ? ` / ${pipeline.title}` : ''}`,
    body,
    variant: 'follow_up',
  };
}

function buildRevisionNotice(data: EmailDraftData): EmailDraftResult {
  const { party, contact, pipeline, senderName, points = [] } = data;
  const sender = senderName ?? SENDER_DEFAULT;
  const salutation = contact ? `Dear ${contact},` : `Dear Sir / Madam,`;
  const revisionNum = pipeline ? ` (Revision ${Number(pipeline.revision) + 1})` : '';
  const pipelineRef = pipeline ? ` for "${pipeline.title}"` : '';

  const body = [
    salutation,
    '',
    `Please find attached our revised offer${pipelineRef}${revisionNum}. This supersedes all previous submissions and incorporates the following changes:`,
    formatPoints(points.length > 0 ? points : ['Revised pricing as per your feedback', 'Updated delivery schedule', 'Revised scope / specifications']),
    '',
    `All other terms and conditions remain unchanged. The revised offer validity is 30 days from this date.`,
    '',
    `Kindly confirm receipt and let us know if any further adjustments are required.`,
    signatureBlock(sender),
  ].filter((l) => l !== null).join('\n');

  return {
    subject: `Revised Offer${revisionNum} — ${party.name}${pipelineRef ? ` / ${pipeline!.title}` : ''}`,
    body,
    variant: 'revision_notice',
  };
}

function buildPoAcknowledgment(data: EmailDraftData): EmailDraftResult {
  const { party, contact, pipeline, senderName, points = [] } = data;
  const sender = senderName ?? SENDER_DEFAULT;
  const salutation = contact ? `Dear ${contact},` : `Dear Sir / Madam,`;
  const pipelineRef = pipeline ? ` for "${pipeline.title}"` : '';
  const valueConfirm = pipeline
    ? `\n\nWe confirm the order value of BHD ${formatBHD(pipeline.offerTotalFils || pipeline.estimatedValueFils)} and will proceed to fulfil your requirements within the agreed timeline.`
    : '';

  const body = [
    salutation,
    '',
    `Thank you for your Purchase Order${pipelineRef}. We are pleased to confirm receipt and acceptance of your order.`,
    valueConfirm,
    '',
    `Next steps from our side:`,
    `  - We will raise the corresponding sales order in our system`,
    `  - Delivery schedule will be confirmed within 2 working days`,
    `  - Advance invoice (if applicable per your payment terms) will follow under separate cover`,
    formatPoints(points),
    '',
    `Please let us know if you have any special delivery or documentation requirements. We look forward to a smooth execution.`,
    signatureBlock(sender),
  ].filter((l) => l !== null).join('\n');

  return {
    subject: `PO Acknowledgment — ${party.name}${pipelineRef ? ` / ${pipeline!.title}` : ''}`,
    body,
    variant: 'po_acknowledgment',
  };
}

// ── Main generator ────────────────────────────────────────────────────────────

/**
 * Generate a professional email draft for the given variant.
 * Returns subject + body text ready to paste into any email client.
 */
export function generateEmailDraft(data: EmailDraftData): EmailDraftResult {
  switch (data.variant) {
    case 'rfq_response':      return buildRfqResponse(data);
    case 'offer_submission':  return buildOfferSubmission(data);
    case 'follow_up':         return buildFollowUp(data);
    case 'revision_notice':   return buildRevisionNotice(data);
    case 'po_acknowledgment': return buildPoAcknowledgment(data);
  }
}
