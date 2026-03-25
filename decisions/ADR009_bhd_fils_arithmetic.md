# ADR009 — BHD in Integer Fils (No Floating Point Money)

**Status:** Decided
**Date:** 2026-03-08
**Deciders:** Commander (Sarat) + Claude

---

## Context

Bahrain Dinar (BHD) has 3 decimal places: 1 BHD = 1000 fils. PH Trading invoices go up to 7+ million BHD (EWA, a major utility company). At this scale, floating point arithmetic produces observable errors.

The legacy system stored all amounts as `float64` in Go and in SQLite as `REAL`. The financial audit (`audit_finance.md`) found this bug fixed in production:
```go
// payment_service.go:137-140
// Phase 18 hotfix: floating point produced -0.001 BHD outstanding
outstanding = math.Max(0, outstanding)
```

The `math.Max(0, outstanding)` floor was a fix for `outstanding = -0.001` — a number that should have been exactly 0.000 but wasn't because of float64 arithmetic.

---

## Decision

**All BHD amounts stored as `u64` (unsigned 64-bit integer) in fils. 1 BHD = 1000 fils. All arithmetic is integer arithmetic. Conversion to display format (X.XXX BHD) happens at the presentation boundary only.**

---

## Rationale

### The Float64 Problem

```
Example: Invoice total = 7,300,450.750 BHD = 7,300,450,750 fils

In float64: 7300450.750 has only 15-16 significant decimal digits.
At this magnitude, the fils digit (3rd decimal place) is within the precision window,
but arithmetic operations accumulate error.

sum(7300450.750, 50.250) = 7300501.000 in exact arithmetic
sum(7300450.750, 50.250) = 7300500.999999... in float64

Multiply by 0.1 (10% VAT):
7300450.750 * 0.1 = 730045.075 in exact arithmetic
7300450.750 * 0.1 = 730045.07499999... in float64
Round to 3 decimal places: 730045.075 vs 730045.074 → 1 fil error per invoice

With hundreds of invoices, these errors accumulate.
```

### Why integer fils is correct

```typescript
// WRONG (float64):
const total = 7300450.750;
const vat = total * 0.1;  // 730045.074999... — wrong at this precision

// CORRECT (integer fils):
const totalFils = 7300450750n;  // BigInt
const vatFils = totalFils / 10n;  // 730045075n — exact integer division
```

Integer arithmetic on `u64` / BigInt is exact. No floating point rounding. No accumulation errors. No `math.Max(0, ...)` hotfixes needed.

### Conversion boundary discipline

```typescript
// Display layer only:
function filsToDisplay(fils: bigint): string {
  const bhd = fils / 1000n;
  const fractional = fils % 1000n;
  return `${bhd}.${String(fractional).padStart(3, '0')} BHD`;
}

// Input layer only:
function displayToFils(display: string): bigint {
  // "7,300.500" → 7300500n
  const cleaned = display.replace(/,/g, '').replace(/\s*BHD\s*/, '');
  const [whole, frac = '000'] = cleaned.split('.');
  return BigInt(whole) * 1000n + BigInt(frac.padEnd(3, '0').slice(0, 3));
}

// EVERYWHERE ELSE: operate on fils (bigint), never on display string
```

### VAT calculation

10% VAT in BHD:
```typescript
// Correct: integer truncation (round down to nearest fil)
const vatFils = (subtotalFils * 10n) / 100n;  // or subtotalFils / 10n
// No floating point involved. Result is exact fils.
```

### Bahrain Dinar specific

The `u64` range is 0 to 18,446,744,073,709,551,615. In fils, this is
18,446,744,073,709,551 BHD. PH Trading's largest customer (EWA) owes ~7.3M BHD.
`u64` fils has 2.5 quadrillion BHD of headroom. We will never overflow.

---

## Consequences

- **F001 (STDB Schema):** All monetary fields use `t.u64()`. No `t.f64()` for money.
- **F009 (Create Invoice):** Input validates user-entered BHD string → fils BigInt before reducer call.
- **F009 (Record Payment):** Same conversion at input boundary.
- **F010 (PDF Invoice):** `filsToDisplay()` called only at PDF rendering time.
- **F034 (Statement of Account):** Aging bucket sums are BigInt arithmetic throughout.
- **All reducers:** Accept and return `u64` for monetary amounts. No float parameters.
- **INV-02 (Financial Invariant):** "All BHD amounts in integer fils" is enforced by TypeScript types (no float64 can be passed where u64 is expected).

---

## The BHD-to-Words Function

PDF invoices require the total in English words ("Seven Million Three Hundred Thousand Bahraini Dinar and Five Hundred Fils"). This function operates on the integer fils value:

```typescript
function filsToWords(fils: bigint): string {
  const bhd = fils / 1000n;
  const remainderFils = fils % 1000n;

  let result = numberToWords(bhd) + ' Bahraini Dinar';
  if (remainderFils > 0n) {
    result += ' and ' + numberToWords(remainderFils) + ' Fils';
  }
  return result;
}
// This function was proven correct in F010 for all test cases up to 9,999,999 BHD.
```

---

## References

- `audit_finance.md` §2 — INV-01, INV-02, INV-03 (currency invariants)
- `audit_finance.go` — `payment_service.go:137-140` (the float bug that prompted this)
- `features/F010_pdf_invoice.md` — PDF generator where `filsToDisplay` and `filsToWords` were proven
- Rythu Mitra ADR (paise pattern) — same pattern applied in the farmer platform context
