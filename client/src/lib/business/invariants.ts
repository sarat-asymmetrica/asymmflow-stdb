/**
 * PH Trading WLL — Business Invariants
 *
 * Ported from legacy business_invariants.go, costing_engine.go, predictor.go.
 * STDB reducers enforce these server-side. Client-side versions let the AI
 * validate and suggest actions before hitting the reducer.
 *
 * Currency: all monetary values in Bahraini Fils (1 BHD = 1000 Fils).
 * VAT: Bahrain standard rate = 10%.
 */

// ── Grade Definitions ────────────────────────────────────────────────────────

export interface GradePolicy {
  grade: string;
  label: string;
  paymentTermsDays: number;
  maxDiscountPct: number;
  creditPolicy: string;
  advanceRequired: number; // 0–100 percent
  chaseEscalationDays: number; // days overdue before escalating to formal notice
}

export const GRADE_POLICIES: Record<string, GradePolicy> = {
  A: {
    grade: 'A',
    label: 'Excellent Payer',
    paymentTermsDays: 45,
    maxDiscountPct: 7,
    creditPolicy: 'Full credit, net 45 days',
    advanceRequired: 0,
    chaseEscalationDays: 30,
  },
  B: {
    grade: 'B',
    label: 'Standard Payer',
    paymentTermsDays: 90,
    maxDiscountPct: 3,
    creditPolicy: 'Standard credit, net 90 days',
    advanceRequired: 0,
    chaseEscalationDays: 15,
  },
  C: {
    grade: 'C',
    label: 'Cautious — Cash Terms',
    paymentTermsDays: 0,
    maxDiscountPct: 0,
    creditPolicy: '50% advance required, balance on delivery',
    advanceRequired: 50,
    chaseEscalationDays: 7,
  },
  D: {
    grade: 'D',
    label: 'High Risk — Advance Only',
    paymentTermsDays: 0,
    maxDiscountPct: 0,
    creditPolicy: '100% advance payment required',
    advanceRequired: 100,
    chaseEscalationDays: 0,
  },
};

// ── Pricing & Costing ────────────────────────────────────────────────────────

export interface MarkupRule {
  minMarkupPct: number;
  targetMarkupPct: number;
  maxDiscountFromTarget: number;
}

export const MARKUP_RULES: Record<string, MarkupRule> = {
  'E+H Flow':        { minMarkupPct: 12, targetMarkupPct: 20, maxDiscountFromTarget: 5 },
  'E+H Level':       { minMarkupPct: 12, targetMarkupPct: 20, maxDiscountFromTarget: 5 },
  'E+H Pressure':    { minMarkupPct: 12, targetMarkupPct: 20, maxDiscountFromTarget: 5 },
  'E+H Temperature': { minMarkupPct: 12, targetMarkupPct: 20, maxDiscountFromTarget: 5 },
  'E+H Analysis':    { minMarkupPct: 15, targetMarkupPct: 25, maxDiscountFromTarget: 5 },
  'Servomex':        { minMarkupPct: 20, targetMarkupPct: 30, maxDiscountFromTarget: 5 },
  'GIC India':       { minMarkupPct: 35, targetMarkupPct: 50, maxDiscountFromTarget: 10 },
  'Iskraemeco':      { minMarkupPct: 15, targetMarkupPct: 25, maxDiscountFromTarget: 5 },
  'Landis+Gyr':      { minMarkupPct: 10, targetMarkupPct: 15, maxDiscountFromTarget: 3 },
  'Chemicals':       { minMarkupPct: 25, targetMarkupPct: 40, maxDiscountFromTarget: 10 },
  'Default':         { minMarkupPct: 15, targetMarkupPct: 25, maxDiscountFromTarget: 5 },
};

function getMarkupRule(productCategory: string): MarkupRule {
  return MARKUP_RULES[productCategory] ?? MARKUP_RULES['Default'];
}

// ── VAT ──────────────────────────────────────────────────────────────────────

/** Bahrain VAT rate: 10% expressed in basis points (1 bps = 0.01%). */
export const VAT_RATE_BPS = 1000;

export function calculateVAT(subtotalFils: bigint): { vatFils: bigint; totalFils: bigint } {
  // RC-3 fix: round-half-up to avoid systematic under-collection of VAT.
  // VAT_RATE_BPS = 1000 bps = 10%, so exact VAT = subtotalFils * 1000 / 10_000 = subtotalFils / 10.
  // Adding 5_000n (half of 10_000) before dividing gives correct rounding at the fil boundary.
  // Example: 999 fils → (999 * 1000 + 5000) / 10000 = 1_004_000 / 10000 = 100 fils. Correct!
  const vatFils = (subtotalFils * BigInt(VAT_RATE_BPS) + BigInt(10_000) / 2n) / BigInt(10_000);
  return { vatFils, totalFils: subtotalFils + vatFils };
}

// ── Discount Validation ──────────────────────────────────────────────────────

export function validateDiscount(
  gradeTag: string,
  productCategory: string,
  proposedDiscountPct: number
): { valid: boolean; reason: string; maxAllowed: number } {
  const grade = GRADE_POLICIES[gradeTag];
  const markup = getMarkupRule(productCategory);

  if (!grade) {
    return { valid: false, reason: `Unknown grade "${gradeTag}"`, maxAllowed: 0 };
  }

  // Effective ceiling: grade cap AND product cap must both be satisfied.
  const maxAllowed = Math.min(grade.maxDiscountPct, markup.maxDiscountFromTarget);

  if (proposedDiscountPct < 0) {
    return { valid: false, reason: 'Discount cannot be negative', maxAllowed };
  }

  if (proposedDiscountPct > maxAllowed) {
    return {
      valid: false,
      reason: `${proposedDiscountPct}% exceeds max ${maxAllowed}% for grade ${gradeTag} + ${productCategory}`,
      maxAllowed,
    };
  }

  return { valid: true, reason: 'Within policy', maxAllowed };
}

// ── Selling Price Calculation ────────────────────────────────────────────────

export function calculateSellingPrice(
  oemCostFils: bigint,
  productCategory: string,
  discountPct: number
): { sellingPriceFils: bigint; markupPct: number; marginPct: number; warnings: string[] } {
  const warnings: string[] = [];
  const rule = getMarkupRule(productCategory);

  if (oemCostFils <= 0n) {
    warnings.push('OEM cost is zero or negative — price may be incorrect');
  }

  // Apply target markup then subtract discount from that markup headroom.
  const targetMarkupFactor = BigInt(Math.round((1 + rule.targetMarkupPct / 100) * 10_000));
  const baseSellingFils = (oemCostFils * targetMarkupFactor) / BigInt(10_000);

  const discountFactor = BigInt(Math.round((1 - discountPct / 100) * 10_000));
  const sellingPriceFils = (baseSellingFils * discountFactor) / BigInt(10_000);

  // Derived metrics (integer arithmetic, convert to Number only for display ratios).
  const grossProfitFils = sellingPriceFils - oemCostFils;
  const markupPct =
    oemCostFils > 0n
      ? Number((grossProfitFils * 10_000n) / oemCostFils) / 100
      : 0;
  const marginPct =
    sellingPriceFils > 0n
      ? Number((grossProfitFils * 10_000n) / sellingPriceFils) / 100
      : 0;

  if (markupPct < rule.minMarkupPct) {
    warnings.push(
      `Markup ${markupPct.toFixed(1)}% is below minimum ${rule.minMarkupPct}% for ${productCategory}`
    );
  }

  return { sellingPriceFils, markupPct, marginPct, warnings };
}

// ── New Order Validation ─────────────────────────────────────────────────────

export function validateNewOrder(
  gradeTag: string,
  outstandingFils: bigint,
  creditLimitFils: bigint,
  orderValueFils: bigint
): { allowed: boolean; reason: string; requiresAdvance: boolean; advancePct: number } {
  const grade = GRADE_POLICIES[gradeTag];

  if (!grade) {
    return {
      allowed: false,
      reason: `Unknown grade "${gradeTag}" — cannot determine credit policy`,
      requiresAdvance: true,
      advancePct: 100,
    };
  }

  // D-grade: full advance, no exceptions.
  if (gradeTag === 'D') {
    return {
      allowed: true,
      reason: 'Grade D: 100% advance required before processing',
      requiresAdvance: true,
      advancePct: 100,
    };
  }

  // C-grade: 50% advance, no credit check needed (cash terms).
  if (gradeTag === 'C') {
    return {
      allowed: true,
      reason: 'Grade C: 50% advance required, balance on delivery',
      requiresAdvance: true,
      advancePct: 50,
    };
  }

  // A/B: check credit headroom.
  const projectedExposure = outstandingFils + orderValueFils;
  if (projectedExposure > creditLimitFils) {
    const overByFils = projectedExposure - creditLimitFils;
    return {
      allowed: false,
      reason: `Order would exceed credit limit by ${Number(overByFils) / 1000} BHD (outstanding ${Number(outstandingFils) / 1000} + order ${Number(orderValueFils) / 1000} > limit ${Number(creditLimitFils) / 1000})`,
      requiresAdvance: false,
      advancePct: 0,
    };
  }

  return {
    allowed: true,
    reason: `Credit headroom sufficient (${Number(creditLimitFils - projectedExposure) / 1000} BHD remaining)`,
    requiresAdvance: false,
    advancePct: 0,
  };
}

// ── Grade Suggestion (simplified M79 logic from predictor.go) ────────────────

export function suggestGrade(
  avgPaymentDays: number,
  paymentOnTimeRatio: number,
  totalTransactions: number
): { suggestedGrade: string; confidence: string; reason: string } {
  const lowDataThreshold = 3;
  const confidence = totalTransactions < lowDataThreshold ? 'low' : totalTransactions < 10 ? 'medium' : 'high';

  // Map average payment days + on-time ratio to a grade.
  // Mirrors the scoring bands from predictor.go scoreCustomer().
  if (avgPaymentDays <= 45 && paymentOnTimeRatio >= 0.9) {
    return { suggestedGrade: 'A', confidence, reason: `Pays in ${avgPaymentDays}d avg, ${Math.round(paymentOnTimeRatio * 100)}% on time` };
  }

  if (avgPaymentDays <= 90 && paymentOnTimeRatio >= 0.7) {
    return { suggestedGrade: 'B', confidence, reason: `Pays in ${avgPaymentDays}d avg, ${Math.round(paymentOnTimeRatio * 100)}% on time` };
  }

  if (avgPaymentDays <= 120 || paymentOnTimeRatio >= 0.5) {
    return { suggestedGrade: 'C', confidence, reason: `Slow payer (${avgPaymentDays}d avg) or inconsistent (${Math.round(paymentOnTimeRatio * 100)}% on time) — cash terms recommended` };
  }

  return {
    suggestedGrade: 'D',
    confidence,
    reason: `High risk: ${avgPaymentDays}d avg payment, only ${Math.round(paymentOnTimeRatio * 100)}% on time — advance only`,
  };
}

// ── AI System Prompt Summary ─────────────────────────────────────────────────

export function getInvariantsSummary(): string {
  const gradeLines = Object.values(GRADE_POLICIES)
    .map(
      (g) =>
        `  Grade ${g.grade} (${g.label}): net ${g.paymentTermsDays}d, max discount ${g.maxDiscountPct}%, advance ${g.advanceRequired}%, escalate after ${g.chaseEscalationDays}d overdue`
    )
    .join('\n');

  const markupLines = Object.entries(MARKUP_RULES)
    .map(
      ([cat, r]) =>
        `  ${cat}: min ${r.minMarkupPct}%, target ${r.targetMarkupPct}%, max discount from target ${r.maxDiscountFromTarget}%`
    )
    .join('\n');

  return `
PH TRADING WLL — BUSINESS RULES (authoritative, enforce strictly)

CURRENCY: All amounts in Bahraini Fils (BHD × 1000). VAT = 10% on all taxable sales.

CUSTOMER GRADES:
${gradeLines}

PRODUCT MARKUP FLOORS (apply tightest of grade cap AND product cap):
${markupLines}

KEY INVARIANTS:
1. Outstanding balance = SUM of all MoneyEvents for a party. Never stored directly.
2. Grade D customers: 100% advance, no exceptions, no credit exposure.
3. Grade C customers: 50% advance before shipment, no open credit.
4. Discount cap = MIN(grade.maxDiscountPct, product.maxDiscountFromTarget).
5. New orders for A/B: blocked if outstanding + order > credit limit.
6. Selling price must not fall below OEM cost × (1 + minMarkupPct/100).
7. VAT (10%) is always added on top of net selling price for customer-facing totals.
8. Chase escalation: reminders start at day 1 overdue; formal notice at chaseEscalationDays.
9. Grade suggestion uses: avgPaymentDays, onTimeRatio, transaction count (min 3 for confidence).
10. All pricing decisions require explicit human approval before commitment.
`.trim();
}
