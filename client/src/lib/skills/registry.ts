/**
 * AsymmFlow Skills — Registry
 *
 * Single source of truth for every skill the AI agent can invoke.
 * The 15 skills here are divided into four categories:
 *   data          — STDB read/write operations
 *   file          — Filesystem + document operations via Neutralino
 *   intelligence  — Analytical / predictive computations
 *   communication — Message drafting and translation
 *
 * Rules enforced here:
 *   - `approval: 'auto'`       → AI executes immediately, no user click needed.
 *   - `approval: 'explicit'`   → User must approve in chat before execution.
 *   - `approval: 'admin_only'` → Only role === 'Admin' may unblock.
 */

import type {
  ApprovalLevel,
  SkillCategory,
  SkillDefinition,
  UserRole,
} from './types';

// Re-export types so callers can import everything from a single path.
export type { ApprovalLevel, SkillCategory, SkillDefinition, UserRole };
export type { SkillParameter, SkillPlan, SkillStep, SkillResult } from './types';

// ── Registry ─────────────────────────────────────────────────────────────────

const SKILLS: SkillDefinition[] = [

  // ── DATA SKILLS ─────────────────────────────────────────────────────────────

  {
    name: 'query_dashboard',
    displayName: 'Dashboard Query',
    description:
      'Aggregate KPIs: revenue MTD, total pipeline value, overdue amount, and estimated cash position.',
    category: 'data',
    approval: 'auto',
    requiredRoles: ['Admin', 'Manager', 'Sales', 'Operations', 'Accountant'],
    parameters: [],
  },

  {
    name: 'query_customer_360',
    displayName: 'Customer 360 View',
    description:
      'Complete customer history including all orders, invoices, payments, and open pipeline items.',
    category: 'data',
    approval: 'auto',
    requiredRoles: ['Admin', 'Manager', 'Sales'],
    parameters: [
      {
        name: 'customerName',
        type: 'string',
        required: true,
        description: 'Customer name to look up (partial match supported).',
      },
    ],
  },

  {
    name: 'query_ar_aging',
    displayName: 'AR Aging',
    description:
      'Return customer aging buckets and total outstanding balances grouped into 0-15, 16-30, 31-60, 61-90, and 90+ days.',
    category: 'data',
    approval: 'auto',
    requiredRoles: ['Admin', 'Manager', 'Sales', 'Accountant'],
    parameters: [],
  },

  {
    name: 'query_order_status',
    displayName: 'Order Status',
    description:
      'Show an order lifecycle snapshot including linked delivery notes, linked invoices, and payment status.',
    category: 'data',
    approval: 'auto',
    requiredRoles: ['Admin', 'Manager', 'Sales', 'Operations', 'Accountant'],
    parameters: [
      {
        name: 'orderId',
        type: 'number',
        required: true,
        description: 'Numeric ID of the order to inspect.',
      },
    ],
  },

  {
    name: 'generate_purchase_order',
    displayName: 'Generate Purchase Order',
    description:
      'Create a purchase order for a supplier with delivery terms and line items persisted to the live database.',
    category: 'data',
    approval: 'explicit',
    requiredRoles: ['Admin', 'Manager', 'Operations'],
    parameters: [
      {
        name: 'supplierId',
        type: 'number',
        required: true,
        description: 'Numeric ID of the supplier party.',
      },
      {
        name: 'items',
        type: 'string',
        required: true,
        description: 'JSON array of PO lines: [{ description, quantity, unitPriceFils }].',
      },
      {
        name: 'deliveryTerms',
        type: 'string',
        required: true,
        description: 'Delivery terms to persist on the purchase order, e.g. CIF Bahrain.',
      },
      {
        name: 'orderId',
        type: 'number',
        required: false,
        description: 'Optional linked customer order ID.',
      },
    ],
  },

  {
    name: 'generate_delivery_note',
    displayName: 'Generate Delivery Note',
    description:
      'Create a delivery note for an order and attach a chosen subset of order line items with delivered quantities.',
    category: 'data',
    approval: 'explicit',
    requiredRoles: ['Admin', 'Manager', 'Operations'],
    parameters: [
      {
        name: 'orderId',
        type: 'number',
        required: true,
        description: 'Numeric ID of the order to deliver against.',
      },
      {
        name: 'deliveryAddress',
        type: 'string',
        required: true,
        description: 'Delivery address to print onto the delivery note.',
      },
      {
        name: 'items',
        type: 'string',
        required: true,
        description: 'JSON array of delivery lines: [{ lineItemId, quantityDelivered, notes? }].',
      },
      {
        name: 'driverName',
        type: 'string',
        required: false,
        description: 'Optional driver name if known at generation time.',
      },
      {
        name: 'vehicleNumber',
        type: 'string',
        required: false,
        description: 'Optional vehicle plate/reference if known at generation time.',
      },
    ],
  },

  {
    name: 'create_invoice',
    displayName: 'Create Invoice',
    description:
      'Create a new customer invoice from an existing order, applying the correct VAT rate (10% Bahrain).',
    category: 'data',
    approval: 'explicit',
    requiredRoles: ['Admin', 'Manager', 'Accountant'],
    parameters: [
      {
        name: 'customerId',
        type: 'number',
        required: true,
        description: 'Numeric ID of the customer party.',
      },
      {
        name: 'orderId',
        type: 'number',
        required: true,
        description: 'Numeric ID of the order to invoice.',
      },
    ],
  },

  {
    name: 'record_payment',
    displayName: 'Record Payment',
    description:
      'Record a customer payment against an outstanding invoice and update the party outstanding balance.',
    category: 'data',
    approval: 'explicit',
    requiredRoles: ['Admin', 'Manager', 'Accountant'],
    parameters: [
      {
        name: 'invoiceId',
        type: 'number',
        required: true,
        description: 'Numeric ID of the money_event (invoice).',
      },
      {
        name: 'amountFils',
        type: 'number',
        required: true,
        description: 'Payment amount in Bahraini fils (1 BHD = 1000 fils).',
      },
      {
        name: 'reference',
        type: 'string',
        required: true,
        description: 'Bank transfer or cheque reference number.',
      },
    ],
  },

  {
    name: 'chase_payment',
    displayName: 'Chase Overdue Payments',
    description:
      'Generate WhatsApp message drafts for all overdue invoices, tone-adjusted by customer grade (A gentle, D firm).',
    category: 'data',
    approval: 'explicit',
    requiredRoles: ['Admin', 'Manager', 'Sales', 'Accountant'],
    parameters: [],
  },

  {
    name: 'query_top_debtors',
    displayName: 'Top Debtors',
    description:
      'Show all customers ranked by outstanding balance (highest first). Use this for "who owes us the most?", "show outstanding balances", or "top debtors" queries.',
    category: 'data',
    approval: 'auto',
    requiredRoles: ['Admin', 'Manager', 'Sales', 'Accountant'],
    parameters: [
      {
        name: 'limit',
        type: 'number',
        required: false,
        description: 'Maximum number of results to return. Omit to return all customers with outstanding balances.',
      },
    ],
  },

  {
    name: 'generate_quotation',
    displayName: 'Generate Quotation',
    description:
      'Generate a quotation PDF for a customer and automatically set a 7-day follow-up reminder on the pipeline deal.',
    category: 'data',
    approval: 'explicit',
    requiredRoles: ['Admin', 'Manager', 'Sales'],
    parameters: [
      {
        name: 'partyId',
        type: 'number',
        required: true,
        description: 'Numeric ID of the customer party.',
      },
      {
        name: 'items',
        type: 'string',
        required: true,
        description: 'JSON-encoded array of line items: [{ description, quantity, unitPriceFils }].',
      },
      {
        name: 'validityDays',
        type: 'number',
        required: false,
        description: 'Quotation validity in days (default: 30).',
      },
      {
        name: 'notes',
        type: 'string',
        required: false,
        description: 'Optional notes to append in the Terms & Conditions section.',
      },
    ],
  },

  {
    name: 'update_customer_grade',
    displayName: 'Update Customer Grade',
    description:
      'Change a customer payment grade (A/B/C/D). Impacts credit limit, payment terms, and chase-message tone. Admin only.',
    category: 'data',
    approval: 'admin_only',
    requiredRoles: ['Admin'],
    parameters: [
      {
        name: 'customerId',
        type: 'number',
        required: true,
        description: 'Numeric ID of the customer party.',
      },
      {
        name: 'newGrade',
        type: 'string',
        required: true,
        description: 'New grade string: one of A, B, C, or D.',
      },
    ],
  },

  // ── FILE SKILLS ──────────────────────────────────────────────────────────────

  {
    name: 'scan_folder',
    displayName: 'Scan Folder',
    description:
      'List and categorize files in a local folder using Neutralino filesystem API.',
    category: 'file',
    approval: 'explicit',
    requiredRoles: ['Admin', 'Manager', 'Sales', 'Operations', 'Accountant'],
    parameters: [
      {
        name: 'path',
        type: 'file_path',
        required: true,
        description: 'Absolute path of the folder to scan.',
      },
    ],
  },

  {
    name: 'ocr_document',
    displayName: 'OCR Document',
    description:
      'Extract text from a PDF or image file using Sarvam Vision (Mayura model).',
    category: 'file',
    approval: 'auto',
    requiredRoles: ['Admin', 'Manager', 'Sales', 'Operations', 'Accountant'],
    parameters: [
      {
        name: 'filePath',
        type: 'file_path',
        required: true,
        description: 'Absolute path to the PDF or image document.',
      },
    ],
  },

  {
    name: 'generate_pptx',
    displayName: 'Generate PowerPoint',
    description:
      'Create a business presentation (PPTX) from current pipeline or sales data.',
    category: 'file',
    approval: 'explicit',
    requiredRoles: ['Admin', 'Manager', 'Sales'],
    parameters: [
      {
        name: 'title',
        type: 'string',
        required: true,
        description: 'Slide deck title, e.g. "Q1 2025 Sales Review".',
      },
    ],
  },

  {
    name: 'export_to_excel',
    displayName: 'Export to Excel',
    description:
      'Export query results to an .xlsx spreadsheet and save to the downloads folder.',
    category: 'file',
    approval: 'explicit',
    requiredRoles: ['Admin', 'Manager', 'Sales', 'Operations', 'Accountant'],
    parameters: [
      {
        name: 'dataSource',
        type: 'string',
        required: true,
        description:
          'What to export, e.g. "overdue invoices", "pipeline", "customer list".',
      },
    ],
  },

  // ── INTELLIGENCE SKILLS ───────────────────────────────────────────────────────

  {
    name: 'pricing_advisor',
    displayName: 'Pricing Advisor',
    description:
      'Calculate optimal discount percentage based on customer grade, competitive pressure, and product margins.',
    category: 'intelligence',
    approval: 'auto',
    requiredRoles: ['Admin', 'Manager', 'Sales'],
    parameters: [
      {
        name: 'customerId',
        type: 'number',
        required: true,
        description: 'Numeric ID of the customer party.',
      },
      {
        name: 'productType',
        type: 'string',
        required: true,
        description:
          'Product category, e.g. "lubricants", "industrial chemicals".',
      },
      {
        name: 'competitorPresent',
        type: 'string',
        required: false,
        description: 'Competitor name if known, e.g. "Shell", "Total".',
      },
    ],
  },

  {
    name: 'cashflow_forecast',
    displayName: 'Cashflow Forecast',
    description:
      'Project cash position 30/60/90 days ahead using an Euler ODE model over expected inflows and outflows.',
    category: 'intelligence',
    approval: 'auto',
    requiredRoles: ['Admin', 'Manager', 'Accountant'],
    parameters: [],
  },

  {
    name: 'predict_payment_date',
    displayName: 'Predict Payment Date',
    description:
      'Estimate how many days a customer will take to pay, using historical invoice/payment behaviour with a payment-terms fallback.',
    category: 'intelligence',
    approval: 'auto',
    requiredRoles: ['Admin', 'Manager', 'Sales', 'Accountant'],
    parameters: [
      {
        name: 'customerId',
        type: 'number',
        required: true,
        description: 'Numeric ID of the customer party whose payment behaviour to estimate.',
      },
      {
        name: 'invoiceId',
        type: 'number',
        required: false,
        description: 'Optional customer invoice ID to project onto a specific invoice date.',
      },
    ],
  },

  {
    name: 'win_probability',
    displayName: 'Win Probability',
    description:
      'Estimate the probability of winning a pipeline item using logistic regression over historical deal features.',
    category: 'intelligence',
    approval: 'auto',
    requiredRoles: ['Admin', 'Manager', 'Sales'],
    parameters: [
      {
        name: 'pipelineId',
        type: 'number',
        required: true,
        description: 'Numeric ID of the pipeline row to score.',
      },
    ],
  },

  // ── COMMUNICATION SKILLS ──────────────────────────────────────────────────────

  {
    name: 'draft_whatsapp',
    displayName: 'Draft WhatsApp Message',
    description:
      'Generate a ready-to-send WhatsApp message for a customer communication (follow-up, confirmation, overdue reminder).',
    category: 'communication',
    approval: 'explicit',
    requiredRoles: ['Admin', 'Manager', 'Sales'],
    parameters: [
      {
        name: 'customerId',
        type: 'number',
        required: true,
        description: 'Numeric ID of the customer party.',
      },
      {
        name: 'purpose',
        type: 'string',
        required: true,
        description:
          'Message purpose, e.g. "payment reminder", "delivery confirmation", "new quote follow-up".',
      },
    ],
  },

  {
    name: 'translate_document',
    displayName: 'Translate Document',
    description:
      'Translate text or a document between English, Arabic, and Hindi using Sarvam Mayura.',
    category: 'communication',
    approval: 'auto',
    requiredRoles: ['Admin', 'Manager', 'Sales', 'Operations', 'Accountant'],
    parameters: [
      {
        name: 'text',
        type: 'string',
        required: true,
        description: 'Text content to translate.',
      },
      {
        name: 'targetLanguage',
        type: 'string',
        required: true,
        description:
          'Target language code: "en" for English, "ar" for Arabic, "hi" for Hindi.',
      },
    ],
  },

  // === NEW: Document generation skills ===
  {
    name: 'generate_email_draft',
    displayName: 'Draft Email',
    description:
      'Generate a professional email draft for customer communication. Supports RFQ response, offer submission, follow-up, revision notice, and PO acknowledgment variants.',
    category: 'communication',
    approval: 'explicit',
    requiredRoles: ['Admin', 'Manager', 'Sales', 'Operations', 'Accountant'],
    parameters: [
      {
        name: 'partyId',
        type: 'string',
        required: true,
        description: 'Recipient party ID',
      },
      {
        name: 'pipelineId',
        type: 'string',
        required: false,
        description: 'Related pipeline (for offer emails)',
      },
      {
        name: 'variant',
        type: 'string',
        required: true,
        description:
          'Email type: rfq_response | offer_submission | follow_up | revision_notice | po_acknowledgment',
      },
      {
        name: 'points',
        type: 'string',
        required: false,
        description: 'Specific points to mention in the email',
      },
    ],
  },
  {
    name: 'generate_cover_letter',
    displayName: 'Offer Cover Letter',
    description:
      'Generate a formal cover letter PDF with PH Trading letterhead to accompany a techno-commercial offer.',
    category: 'communication',
    approval: 'explicit',
    requiredRoles: ['Admin', 'Manager', 'Sales'],
    parameters: [
      {
        name: 'partyId',
        type: 'string',
        required: true,
        description: 'Customer party ID',
      },
      {
        name: 'pipelineId',
        type: 'string',
        required: true,
        description: 'Pipeline/offer this covers',
      },
      {
        name: 'notes',
        type: 'string',
        required: false,
        description: 'Additional notes or delivery promises',
      },
    ],
  },
  {
    name: 'generate_technical_submittal',
    displayName: 'Technical Submittal',
    description:
      'Generate a PDF index of technical documents (specs, drawings, TI sheets) included with an offer.',
    category: 'data',
    approval: 'explicit',
    requiredRoles: ['Admin', 'Manager', 'Sales', 'Operations'],
    parameters: [
      {
        name: 'pipelineId',
        type: 'string',
        required: true,
        description: 'Pipeline/offer this indexes',
      },
      {
        name: 'documents',
        type: 'string',
        required: true,
        description: 'JSON array of {name, type, pages}',
      },
    ],
  },

  // === NEW: Status transition skill ===
  {
    name: 'update_pipeline_status',
    displayName: 'Update Pipeline Status',
    description:
      'Transition a pipeline to a new status. Shows a Tier 2 confirmation card with identity signing.',
    category: 'data',
    approval: 'explicit',
    requiredRoles: ['Admin', 'Manager', 'Sales', 'Operations', 'Accountant'],
    parameters: [
      {
        name: 'pipelineId',
        type: 'string',
        required: true,
        description: 'Pipeline to update',
      },
      {
        name: 'newStatus',
        type: 'string',
        required: true,
        description:
          'Target status (e.g. QuotationSent, Negotiation, ClosedWon)',
      },
      {
        name: 'notes',
        type: 'string',
        required: false,
        description: 'Optional notes for the transition',
      },
    ],
  },

  // === NEW: Memory skills ===
  {
    name: 'remember',
    displayName: 'Remember This',
    description:
      'Save an observation about a customer, user preference, or business pattern for future reference. Shared across the team.',
    category: 'data',
    approval: 'explicit',
    requiredRoles: ['Admin', 'Manager', 'Sales', 'Operations', 'Accountant'],
    parameters: [
      {
        name: 'category',
        type: 'string',
        required: true,
        description:
          'user_preference | party_pattern | business_insight | workflow_note',
      },
      {
        name: 'subject',
        type: 'string',
        required: true,
        description: 'What/who this is about',
      },
      {
        name: 'content',
        type: 'string',
        required: true,
        description: 'The observation to remember',
      },
    ],
  },
  {
    name: 'forget',
    displayName: 'Forget This',
    description:
      'Remove a saved AI observation. Only Admin and Manager roles can delete memories.',
    category: 'data',
    approval: 'explicit',
    requiredRoles: ['Admin', 'Manager'],
    parameters: [
      {
        name: 'memoryId',
        type: 'string',
        required: true,
        description: 'ID of the memory to remove',
      },
    ],
  },
];

// ── Helper functions ──────────────────────────────────────────────────────────

/**
 * Look up a skill by its stable machine name.
 * Returns `undefined` when no match is found (safe for optional-chaining).
 */
export function getSkillByName(name: string): SkillDefinition | undefined {
  return SKILLS.find((s) => s.name === name);
}

/**
 * Return all skills belonging to a particular category.
 * Useful for building category-scoped suggestion chips in the chat UI.
 */
export function getSkillsByCategory(
  category: SkillCategory
): SkillDefinition[] {
  return SKILLS.filter((s) => s.category === category);
}

/**
 * Return all skills that the given role is allowed to trigger.
 * Includes skills where `requiredRoles` contains the role.
 */
export function getSkillsForRole(role: UserRole): SkillDefinition[] {
  return SKILLS.filter((s) => s.requiredRoles.includes(role));
}

/**
 * Returns true when `userRole` satisfies the role requirement AND
 * the approval level is not `admin_only` for non-Admin users.
 *
 * Note: `admin_only` skills are always visible in the registry
 * (so the AI can mention them) but only Admin users can approve execution.
 */
export function canExecuteSkill(
  skill: SkillDefinition,
  userRole: UserRole
): boolean {
  if (!skill.requiredRoles.includes(userRole)) return false;
  if (skill.approval === 'admin_only' && userRole !== 'Admin') return false;
  return true;
}

export { SKILLS };
