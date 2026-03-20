/** Context requirement layers for document generation */
export type ContextLayer = 'hard' | 'soft' | 'auto';

/** A single context field requirement */
export interface ContextField {
  name: string;           // machine name: 'customerName', 'unitPrice', etc.
  label: string;          // human label: 'Customer Name', 'Unit Price (BHD)'
  layer: ContextLayer;    // hard = must have, soft = nice to have, auto = filled automatically
  type: 'string' | 'number' | 'bigint' | 'date' | 'party' | 'enum';
  source?: string;        // for auto fields: 'Party.grade', 'Party.paymentTermsDays', etc.
  defaultValue?: unknown; // for soft fields with defaults
  description: string;    // shown to user when AI asks for this field
}

/** Resolved context — all fields filled, ready for document generation */
export type DocumentContext = Record<string, unknown>;

/** The confidence status of a context field */
export interface ContextStatus {
  field: ContextField;
  status: 'known' | 'inferred' | 'needed';
  value?: unknown;
  source?: string;  // 'STDB Party table', 'user input', 'default', etc.
}

/** Document template definition */
export interface DocumentTemplate {
  id: string;
  name: string;
  description: string;    // for AI to understand when to use
  category: 'finance' | 'sales' | 'operations' | 'communication';
  outputFormat: 'pdf' | 'xlsx' | 'pptx' | 'docx' | 'text';
  fields: ContextField[];
  // generate function is registered separately in the registry
}

/** Result of checking context completeness */
export interface ContextCheckResult {
  complete: boolean;
  known: ContextStatus[];     // green - have data
  inferred: ContextStatus[];  // yellow - guessing, need confirmation
  needed: ContextStatus[];    // red - must ask user
  readyToGenerate: boolean;   // true only if all hard requirements met
}
