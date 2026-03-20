// ── Contract Generator ───────────────────────────────────────────────────────
// Grade-based contract generation with clause selection for PH Trading WLL.
// All monetary amounts are in Bahraini fils (bigint). No floating-point money.
// ─────────────────────────────────────────────────────────────────────────────

// ── Types ────────────────────────────────────────────────────────────────────

export interface ContractParty {
  name: string;
  grade: string;
  paymentTermsDays: number;
  creditLimitFils: bigint;
}

export interface ContractLineItem {
  description: string;
  quantity: number;
  unitPriceFils: bigint;
}

export interface ContractInput {
  party: ContractParty;
  items: ContractLineItem[];
  contractNumber: string;
  issueDate: string;       // ISO date
  validityDays: number;    // how long the contract is valid
  deliveryTerms: string;   // e.g. "CIF Bahrain"
  specialConditions?: string;
  preparedBy?: string;
}

export interface ContractClause {
  id: string;
  title: string;
  body: string;
  applicableGrades: string[];  // which grades this clause applies to
  mandatory: boolean;          // always included regardless of grade
}

export interface GeneratedContract {
  contractNumber: string;
  partyName: string;
  grade: string;
  issueDate: string;
  expiryDate: string;
  clauses: ContractClause[];
  items: ContractLineItem[];
  subtotalFils: bigint;
  vatFils: bigint;
  totalFils: bigint;
  paymentTerms: string;
  deliveryTerms: string;
}

// ── Clause Library ───────────────────────────────────────────────────────────

export const CLAUSE_LIBRARY: ContractClause[] = [
  // Mandatory clauses (all grades)
  { id: 'scope', title: 'Scope of Supply', body: 'The Supplier shall supply the goods and/or services as detailed in the attached schedule, in accordance with the specifications agreed upon.', applicableGrades: ['A','B','C','D'], mandatory: true },
  { id: 'vat', title: 'Value Added Tax', body: 'All prices are exclusive of VAT. Value Added Tax at the prevailing rate (currently 10%) shall be added to all invoices in accordance with Bahrain VAT regulations.', applicableGrades: ['A','B','C','D'], mandatory: true },
  { id: 'warranty', title: 'Warranty', body: 'All goods supplied shall carry a minimum warranty period of twelve (12) months from the date of delivery, unless otherwise specified in the product schedule.', applicableGrades: ['A','B','C','D'], mandatory: true },
  { id: 'force_majeure', title: 'Force Majeure', body: 'Neither party shall be liable for delays or failure in performance resulting from acts beyond the reasonable control of such party, including but not limited to acts of God, government actions, war, or natural disasters.', applicableGrades: ['A','B','C','D'], mandatory: true },
  { id: 'governing_law', title: 'Governing Law', body: 'This contract shall be governed by and construed in accordance with the laws of the Kingdom of Bahrain. Any disputes shall be referred to the competent courts of Bahrain.', applicableGrades: ['A','B','C','D'], mandatory: true },

  // Grade A/B: credit terms
  { id: 'payment_credit', title: 'Payment Terms', body: 'Payment shall be made within {paymentTermsDays} days from the date of invoice. Late payments shall attract interest at 1% per month on the outstanding balance.', applicableGrades: ['A','B'], mandatory: false },
  { id: 'credit_limit', title: 'Credit Facility', body: 'A credit facility of up to BHD {creditLimit} is extended to the Buyer, subject to periodic review. The Supplier reserves the right to suspend deliveries if the outstanding balance exceeds the agreed credit limit.', applicableGrades: ['A','B'], mandatory: false },

  // Grade C: advance + COD
  { id: 'payment_advance_50', title: 'Payment Terms \u2014 Advance Required', body: 'Fifty percent (50%) of the total contract value shall be paid as advance payment prior to commencement of supply. The remaining balance shall be paid upon delivery.', applicableGrades: ['C'], mandatory: false },

  // Grade D: full advance
  { id: 'payment_advance_100', title: 'Payment Terms \u2014 Full Advance', body: 'One hundred percent (100%) of the total contract value shall be paid in advance prior to any supply or delivery. No goods shall be dispatched until full payment is confirmed in the Supplier bank account.', applicableGrades: ['D'], mandatory: false },

  // Grade C/D: no credit
  { id: 'no_credit', title: 'Credit Policy', body: 'No credit facility is available under this contract. All transactions are on a cash/advance basis as specified in the payment terms.', applicableGrades: ['C','D'], mandatory: false },

  // A/B: discount clause
  { id: 'discount', title: 'Volume Discount', body: 'For orders exceeding BHD 10,000 in aggregate value within a calendar quarter, a volume discount as per the current pricing schedule may be applied, subject to the maximum discount rate for the Buyer grade classification.', applicableGrades: ['A','B'], mandatory: false },

  // Delivery
  { id: 'delivery', title: 'Delivery', body: 'Delivery shall be made {deliveryTerms} within the lead time specified in the product schedule. The Supplier shall notify the Buyer at least 48 hours prior to dispatch.', applicableGrades: ['A','B','C','D'], mandatory: true },

  // Termination
  { id: 'termination', title: 'Termination', body: 'Either party may terminate this contract by giving thirty (30) days written notice. In the event of termination, the Buyer shall pay for all goods delivered and services rendered up to the termination date.', applicableGrades: ['A','B','C','D'], mandatory: true },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Format fils as BHD string with 3-decimal places and thousands separators. */
function formatBHD(fils: bigint): string {
  const negative = fils < 0n;
  const abs = negative ? -fils : fils;
  const dinars = abs / 1000n;
  const remainder = abs % 1000n;
  const dinarStr = dinars.toLocaleString('en-US');
  const filsStr = remainder.toString().padStart(3, '0');
  return `${negative ? '-' : ''}${dinarStr}.${filsStr}`;
}

/** Calculate VAT at 10% using round-half-up fils arithmetic. */
function calculateContractVAT(subtotalFils: bigint): { vatFils: bigint; totalFils: bigint } {
  // VAT = subtotal * 10 / 100, with round-half-up
  // To round-half-up: (subtotal * 10 + 50) / 100  (integer division)
  const vatFils = (subtotalFils * 10n + 50n) / 100n;
  return { vatFils, totalFils: subtotalFils + vatFils };
}

/** Add days to an ISO date string, returning a new ISO date string. */
function addDays(isoDate: string, days: number): string {
  const date = new Date(isoDate + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Format ISO date to display format like "20 March 2026". */
function formatDisplayDate(isoDate: string): string {
  const date = new Date(isoDate + 'T00:00:00Z');
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

// ── Core Functions ───────────────────────────────────────────────────────────

/** Select applicable clauses for a given grade. */
export function selectClauses(grade: string): ContractClause[] {
  return CLAUSE_LIBRARY.filter(
    (clause) => clause.mandatory || clause.applicableGrades.includes(grade),
  );
}

/** Generate a contract by selecting clauses and computing totals. */
export function generateContract(input: ContractInput): GeneratedContract {
  const { party, items, contractNumber, issueDate, validityDays, deliveryTerms } = input;

  // Compute subtotal
  let subtotalFils = 0n;
  for (const item of items) {
    subtotalFils += item.unitPriceFils * BigInt(item.quantity);
  }

  // VAT
  const { vatFils, totalFils } = calculateContractVAT(subtotalFils);

  // Select and hydrate clauses
  const rawClauses = selectClauses(party.grade);

  // Format credit limit for substitution
  const creditLimitDisplay = formatBHD(party.creditLimitFils);

  const clauses = rawClauses.map((clause) => ({
    ...clause,
    body: clause.body
      .replace('{paymentTermsDays}', String(party.paymentTermsDays))
      .replace('{creditLimit}', creditLimitDisplay)
      .replace('{deliveryTerms}', deliveryTerms),
  }));

  // Expiry date
  const expiryDate = addDays(issueDate, validityDays);

  // Determine payment terms summary
  let paymentTerms: string;
  if (party.grade === 'A' || party.grade === 'B') {
    paymentTerms = `Net ${party.paymentTermsDays} days`;
  } else if (party.grade === 'C') {
    paymentTerms = '50% advance, balance on delivery';
  } else {
    paymentTerms = '100% advance';
  }

  return {
    contractNumber,
    partyName: party.name,
    grade: party.grade,
    issueDate,
    expiryDate,
    clauses,
    items,
    subtotalFils,
    vatFils,
    totalFils,
    paymentTerms,
    deliveryTerms,
  };
}

/** Format contract as plain text for display/review before PDF. */
export function formatContractText(contract: GeneratedContract): string {
  const lines: string[] = [];

  // Header
  lines.push('PH TRADING WLL');
  lines.push('COMMERCIAL CONTRACT');
  lines.push('');
  lines.push(`Contract No: ${contract.contractNumber}`);
  lines.push(`Date: ${formatDisplayDate(contract.issueDate)}`);
  lines.push(`Valid Until: ${formatDisplayDate(contract.expiryDate)}`);
  lines.push('');
  lines.push('BETWEEN');
  lines.push('PH Trading WLL ("Supplier")');
  lines.push('AND');
  lines.push(`${contract.partyName} ("Buyer")`);
  lines.push(`Customer Grade: ${contract.grade}`);
  lines.push('');
  lines.push('\u2550'.repeat(43));
  lines.push('');

  // Schedule of supply
  lines.push('SCHEDULE OF SUPPLY');
  lines.push('');

  for (let i = 0; i < contract.items.length; i++) {
    const item = contract.items[i];
    const lineTotal = item.unitPriceFils * BigInt(item.quantity);
    const num = String(i + 1).padStart(2, ' ');
    lines.push(
      `  ${num}. ${item.description}    Qty: ${item.quantity}    Unit: BHD ${formatBHD(item.unitPriceFils)}    Total: BHD ${formatBHD(lineTotal)}`,
    );
  }

  lines.push('');
  lines.push(`  Subtotal:  BHD ${formatBHD(contract.subtotalFils)}`);
  lines.push(`  VAT (10%): BHD ${formatBHD(contract.vatFils)}`);
  lines.push(`  TOTAL:     BHD ${formatBHD(contract.totalFils)}`);
  lines.push('');
  lines.push('\u2550'.repeat(43));
  lines.push('');

  // Terms and conditions
  lines.push('TERMS AND CONDITIONS');
  lines.push('');

  for (let i = 0; i < contract.clauses.length; i++) {
    const clause = contract.clauses[i];
    lines.push(`${i + 1}. ${clause.title.toUpperCase()}`);
    lines.push(`   ${clause.body}`);
    lines.push('');
  }

  return lines.join('\n');
}
