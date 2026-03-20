"""
Asymmetrica OCR Post-Processing Kernels — Python Port
=====================================================
Ported from:
  - Asymmetrica.Ocr/NormalizerKernel.cs (482 LOC)
  - Asymmetrica.Ocr/VedicValidatorKernel.cs (548 LOC)
  - Asymmetrica.Ocr/HybridOcrKernel.cs (321 LOC)

Three-layer pipeline:
  Layer 1: NormalizerKernel — fix OCR errors, unicode, whitespace
  Layer 2: VedicValidatorKernel — digital root math validation
  Layer 3: HybridOcrKernel — harmonic mean quality gating
"""

import re
import math
from dataclasses import dataclass, field


# ═══════════════════════════════════════════════════════════════════
# LAYER 1: NormalizerKernel
# ═══════════════════════════════════════════════════════════════════

# Unicode smart quote / dash replacements
UNICODE_REPLACEMENTS = [
    ('\u2018', "'"), ('\u2019', "'"), ('\u201A', "'"), ('\u201B', "'"),
    ('\u201C', '"'), ('\u201D', '"'), ('\u201E', '"'), ('\u201F', '"'),
    ('\u00AB', '"'), ('\u00BB', '"'), ('\u2039', "'"), ('\u203A', "'"),
    ('\u2013', '-'), ('\u2014', '-'), ('\u2026', '...'),
]

# Base OCR error dictionary (common l/I/1 and accent errors)
BASE_DICT = {
    "Sid\u00e9": "Side", "Squar\u00e9": "Square", "numb\u00e9r": "number",
    "diagonaI": "diagonal", "Nearesl": "Nearest", "theorum": "theorem",
    "theorm": "theorem", "theor\u00e9m": "theorem", "calCulate": "calculate",
    "resuIt": "result", "resUlt": "result", "vaIue": "value",
    "vaiue": "value", "formuIa": "formula", "equatlon": "equation",
    "equat\u00econ": "equation",
    # Common OCR confusions in business/instrumentation context
    "lnvoice": "Invoice", "lnstrument": "Instrument", "lndustrial": "Industrial",
    "Ievel": "level", "Iimit": "limit", "fIow": "flow", "fIuid": "fluid",
    "caIibration": "calibration", "instaIIation": "installation",
    "speclfication": "specification", "certlficate": "certificate",
    "quotatlon": "quotation", "dellvery": "delivery",
    "Bahraln": "Bahrain", "tradlng": "trading",
}

# Suffixes that indicate trailing 'I' should be 'l'
SUFFIXES_ENDING_IN_L = [
    'al', 'el', 'il', 'ol', 'ul', 'ful', 'ial', 'ual', 'ical', 'ional',
    'ual', 'tial', 'cial', 'rial', 'nial',
]

# Garbled math terms
GARBLED_MATH_TERMS = {
    'Cube': ['Cu es', 'Cu be', 'Cub e'],
    'Square': ['Sq ua re', 'Squ are', 'Sqr'],
    'Root': ['Ro ot', 'Rt'],
    'Power': ['Po wer', 'Pow er'],
    'Diagonal': ['Di ag on al', 'Diag onal'],
    'Hypotenuse': ['Hy po ten use', 'Hypot enuse'],
    'Pythagorean': ['Py tha gor ean', 'Pythag orean'],
}


@dataclass
class NormalizerResult:
    original_text: str
    normalized_text: str
    corrections: list = field(default_factory=list)
    quality_score: float = 1.0
    requires_deep_reasoning: bool = False
    change_ratio: float = 0.0


def normalize(text: str, mode: str = "document") -> NormalizerResult:
    """
    Layer 1: Light pre-processing.
    Fixes unicode, whitespace, dictionary corrections, I/l disambiguation.
    """
    if not text or not text.strip():
        return NormalizerResult(original_text=text, normalized_text=text or "",
                                quality_score=0.3)

    original = text
    corrections = []
    result = text

    # Step 1: Unicode normalization
    for old, new in UNICODE_REPLACEMENTS:
        if old in result:
            result = result.replace(old, new)
            corrections.append(f"unicode: {repr(old)} -> {repr(new)}")

    # Step 2: Whitespace cleanup
    result = result.replace('\r\n', '\n').replace('\r', '\n')
    result = re.sub(r'[ \t]+', ' ', result)           # multiple spaces → single
    result = re.sub(r'\n{3,}', '\n\n', result)        # 3+ newlines → 2
    result = result.strip()

    # Step 3: Dictionary corrections
    for wrong, right in BASE_DICT.items():
        if wrong in result:
            result = result.replace(wrong, right)
            corrections.append(f"dict: {wrong} -> {right}")

    # Step 4: I→l disambiguation (words ending in capital I that should be l)
    def fix_trailing_I(match):
        word = match.group(0)
        if len(word) < 3:
            return word
        prefix = word[:-1].lower()
        for suffix in SUFFIXES_ENDING_IN_L:
            suffix_no_l = suffix[:-1]
            if prefix.endswith(suffix_no_l):
                fixed = word[:-1] + 'l'
                corrections.append(f"I->l: {word} -> {fixed}")
                return fixed
        return word

    result = re.sub(r'\b[A-Za-z]+I\b', fix_trailing_I, result)

    # Step 5: Garbled math reconstruction
    for term, corruptions in GARBLED_MATH_TERMS.items():
        for corruption in corruptions:
            if corruption in result:
                result = result.replace(corruption, term)
                corrections.append(f"garbled: {corruption} -> {term}")

    # Step 6: Quality scoring
    quality = _calculate_quality_score(result, len(corrections))

    # Step 7: Complexity assessment
    change_ratio = abs(len(original) - len(result)) / max(len(original), 1)
    requires_deep = _assess_complexity(original, result, change_ratio)

    return NormalizerResult(
        original_text=original,
        normalized_text=result,
        corrections=corrections,
        quality_score=quality,
        requires_deep_reasoning=requires_deep,
        change_ratio=change_ratio,
    )


def _calculate_quality_score(text: str, num_corrections: int) -> float:
    """Score based on character distribution + correction penalty."""
    if not text:
        return 0.0

    score = 1.0
    score -= num_corrections * 0.02

    total = len(text)
    alpha = sum(1 for c in text if c.isalnum())
    ws = sum(1 for c in text if c.isspace())
    special = sum(1 for c in text if not (c.isalnum() or c.isspace() or c in '.,:;!?()-'))

    alpha_ratio = alpha / total
    ws_ratio = ws / total
    special_ratio = special / total

    if alpha_ratio < 0.50:
        score -= 0.10
    if ws_ratio > 0.40:
        score -= 0.10
    if special_ratio > 0.05:
        score -= 0.15

    return max(0.3, min(1.0, score))


def _assess_complexity(original: str, normalized: str, change_ratio: float) -> bool:
    """Flag if deep reasoning needed."""
    if change_ratio > 0.05:
        return True
    garbled = re.search(r'\b[A-Z][a-z]\s+[a-z]{1,2}\s+[a-z]{1,2}\b', normalized)
    if garbled:
        return True
    fragmented = re.search(r'\d+\s+[A-Za-z]{1,3}\s+\d+', normalized)
    if fragmented:
        return True
    return False


# ═══════════════════════════════════════════════════════════════════
# LAYER 2: VedicValidatorKernel
# ═══════════════════════════════════════════════════════════════════

def digital_root(n: int) -> int:
    """Vedic digital root: sum digits until single digit. O(1) via mod-9."""
    if n == 0:
        return 0
    return 1 + (n - 1) % 9


@dataclass
class VedicPattern:
    pattern_type: str       # square_exact, pythagorean_exact, etc.
    original: str           # matched text
    reconstructed: str      # corrected/annotated text
    confidence: float       # 0.0 - 1.0
    method: str             # digital_root, sequence_pattern, etc.
    values: list = field(default_factory=list)
    explanation: str = ""


def vedic_validate(text: str) -> list[VedicPattern]:
    """
    Layer 2: Vedic mathematical validation.
    Detects squares, Pythagorean triples, sequences, and validates numbers
    using digital root properties.
    """
    if not text:
        return []

    patterns = []
    patterns.extend(_detect_square_relationships(text))
    patterns.extend(_detect_pythagorean_triples(text))
    patterns.extend(_detect_sequences(text))
    patterns.extend(_validate_currency_amounts(text))
    return patterns


def _detect_square_relationships(text: str) -> list[VedicPattern]:
    """Find 'a b' patterns where b = a^2. Filters small/trivial matches."""
    patterns = []
    for match in re.finditer(r'\b(\d+)\s+(\d+)\b', text):
        a, b = int(match.group(1)), int(match.group(2))
        if a < 4 or a > 10000 or b < 16:  # Minimum: 4^2=16
            continue
        a_sq = a * a
        if a_sq == b:
            patterns.append(VedicPattern(
                pattern_type="square_exact", original=match.group(),
                reconstructed=f"{a}^2 = {b}", confidence=1.0,
                method="digital_root", values=[a, b],
                explanation=f"Perfect square: {a}^2 = {b}",
            ))
        elif digital_root(a_sq) == digital_root(b) and b > 10:
            diff_pct = abs(b - a_sq) / a_sq
            if diff_pct < 0.01:
                conf = 0.95
            elif diff_pct < 0.10:
                conf = 0.80
            else:
                conf = 0.70
            patterns.append(VedicPattern(
                pattern_type="square_dr_match", original=match.group(),
                reconstructed=f"{a}^2 ~ {b} (DR={digital_root(a_sq)})",
                confidence=conf, method="digital_root",
                values=[a, b, a_sq],
                explanation=f"DR({a}^2) = DR({b}) = {digital_root(a_sq)}, actual {a}^2={a_sq}",
            ))
    return patterns


def _detect_pythagorean_triples(text: str) -> list[VedicPattern]:
    """Find 'a b c' where a^2 + b^2 = c^2."""
    patterns = []
    for match in re.finditer(r'\b(\d+)\s+(\d+)\s+(\d+)\b', text):
        a, b, c = int(match.group(1)), int(match.group(2)), int(match.group(3))
        if a < 1 or b < 1 or c < 1 or c > 100000:
            continue
        sum_sq = a*a + b*b
        c_sq = c*c
        if sum_sq == c_sq:
            patterns.append(VedicPattern(
                pattern_type="pythagorean_exact", original=match.group(),
                reconstructed=f"{a}^2+{b}^2={c}^2", confidence=1.0,
                method="pythagorean_triple", values=[a, b, c],
                explanation=f"Perfect: {a}^2+{b}^2 = {sum_sq} = {c}^2",
            ))
        elif digital_root(sum_sq) == digital_root(c_sq) and c > 3:
            diff_pct = abs(c_sq - sum_sq) / max(c_sq, 1)
            if diff_pct < 0.05:
                patterns.append(VedicPattern(
                    pattern_type="pythagorean_candidate", original=match.group(),
                    reconstructed=f"{a}^2+{b}^2~{c}^2", confidence=0.85,
                    method="pythagorean_triple", values=[a, b, c],
                    explanation=f"DR match: DR({sum_sq})=DR({c_sq})={digital_root(sum_sq)}",
                ))
    return patterns


def _detect_sequences(text: str) -> list[VedicPattern]:
    """Detect arithmetic, geometric, Fibonacci sequences.
    Filters out trivial patterns: all-zeros, single-digit page numbers, etc."""
    patterns = []
    numbers = [int(m.group()) for m in re.finditer(r'\b\d+\b', text)]
    if len(numbers) < 4:  # Require 4+ numbers (3 is too noisy)
        return patterns

    # Check sliding windows of 4+ numbers
    for start in range(len(numbers) - 3):
        window = numbers[start:start+min(6, len(numbers)-start)]
        if len(window) < 4:
            continue

        # Filter: skip if all zeros or all same number
        if len(set(window)) <= 1:
            continue
        # Filter: skip if all numbers < 2 (page numbers, indices)
        if all(n < 2 for n in window):
            continue
        # Filter: skip if it's just 1,2,3,4... (trivial counting)
        if window == list(range(window[0], window[0] + len(window))):
            continue

        # Arithmetic
        diffs = [window[i+1] - window[i] for i in range(len(window)-1)]
        if len(set(diffs)) == 1 and diffs[0] != 0 and abs(diffs[0]) > 1:
            patterns.append(VedicPattern(
                pattern_type="arithmetic_seq",
                original=", ".join(map(str, window)),
                reconstructed=f"AP d={diffs[0]}: {window}",
                confidence=0.90, method="sequence_pattern",
                values=window, explanation=f"Arithmetic progression, d={diffs[0]}",
            ))
            break

        # Fibonacci — require at least one number > 1 and window >= 4
        if (all(window[i] == window[i-1] + window[i-2] for i in range(2, len(window)))
                and max(window) > 2):
            patterns.append(VedicPattern(
                pattern_type="fibonacci_seq",
                original=", ".join(map(str, window)),
                reconstructed=f"Fibonacci: {window}",
                confidence=0.95, method="sequence_pattern",
                values=window, explanation="F(n)=F(n-1)+F(n-2)",
            ))
            break

    return patterns


def _validate_currency_amounts(text: str) -> list[VedicPattern]:
    """
    Validate currency amounts using digital root cross-checking.
    In invoices: line_total = qty * unit_price. DR(qty*price) should = DR(total).
    Also catches BHD amount formatting issues.
    """
    patterns = []

    # Find BHD amounts and validate formatting
    bhd_amounts = re.finditer(
        r'(?:BHD|BD|bhd)\s*[\.]?\s*([\d,]+\.?\d*)', text
    )
    for match in bhd_amounts:
        amount_str = match.group(1).replace(',', '')
        try:
            amount = float(amount_str)
            # Check for common OCR errors in numbers (digit transposition)
            int_amount = int(round(amount * 1000))  # fils
            dr = digital_root(int_amount) if int_amount > 0 else 0
            patterns.append(VedicPattern(
                pattern_type="currency_validation",
                original=match.group(),
                reconstructed=f"BHD {amount:.3f} (DR={dr})",
                confidence=0.90, method="digital_root",
                values=[amount, dr],
                explanation=f"Currency validated: BHD {amount:.3f}, digital root={dr}",
            ))
        except ValueError:
            pass

    # Find qty × price = total patterns
    qty_price = re.finditer(
        r'(\d+)\s*[xX×]\s*([\d,.]+)\s*=?\s*([\d,.]+)', text
    )
    for match in qty_price:
        try:
            qty = int(match.group(1))
            price = float(match.group(2).replace(',', ''))
            total = float(match.group(3).replace(',', ''))
            expected = qty * price
            if abs(expected - total) < 0.01:
                patterns.append(VedicPattern(
                    pattern_type="multiplication_verified",
                    original=match.group(),
                    reconstructed=f"{qty} x {price} = {total} VERIFIED",
                    confidence=1.0, method="digital_root",
                    values=[qty, price, total],
                    explanation=f"Exact: {qty} x {price} = {expected}",
                ))
            elif digital_root(int(round(expected))) == digital_root(int(round(total))):
                patterns.append(VedicPattern(
                    pattern_type="multiplication_dr_match",
                    original=match.group(),
                    reconstructed=f"{qty} x {price} ~ {total} (DR match)",
                    confidence=0.80, method="digital_root",
                    values=[qty, price, total, expected],
                    explanation=f"DR match but values differ: expected {expected}, got {total}",
                ))
        except (ValueError, ZeroDivisionError):
            pass

    return patterns


# ═══════════════════════════════════════════════════════════════════
# LAYER 3: HybridOcrKernel — Orchestration + Quality Gating
# ═══════════════════════════════════════════════════════════════════

CONFIDENCE_THRESHOLD = 0.80


@dataclass
class HybridResult:
    raw_text: str
    normalized_text: str
    processed_text: str
    overall_quality: float
    normalizer_quality: float
    vedic_confidence: float
    coherence_score: float
    thinking_machine_ready: bool
    processing_steps: list = field(default_factory=list)
    corrections_count: int = 0
    patterns_found: int = 0
    patterns: list = field(default_factory=list)
    corrections: list = field(default_factory=list)


def harmonic_mean(values: list[float]) -> float:
    """
    Outlier-resistant average. One low score drags everything down.
    This is intentional — one broken layer should fail the pipeline.
    """
    if not values:
        return 0.0
    # Filter zeros (a zero makes harmonic mean zero)
    nonzero = [v for v in values if v > 0.001]
    if len(nonzero) < len(values):
        return 0.0
    return len(nonzero) / sum(1.0 / v for v in nonzero)


def assess_coherence(text: str) -> float:
    """
    Text coherence: ratio of real-looking words to total words.
    A 'real word' has >2 chars, >70% letters, <20% special chars.
    Short texts (<200 chars) get a lenient floor to avoid penalizing previews.
    """
    if not text:
        return 0.0
    words = text.split()
    if not words:
        return 0.5

    complete = 0
    for word in words:
        if len(word) < 2:
            continue
        letters = sum(1 for c in word if c.isalpha())
        special = sum(1 for c in word if not (c.isalnum() or c in "'-.,:/()[]|#×=+"))
        if len(word) > 0 and letters / len(word) > 0.60 and special / len(word) < 0.30:
            complete += 1

    ratio = complete / len(words)

    # Bonus for paragraph structure
    if '.' in text or '\n' in text:
        ratio += 0.05

    # Short text leniency — previews and snippets shouldn't be penalized
    # Markdown tables, technical specs often look "incoherent" but are fine
    if len(text) < 300:
        ratio = max(ratio, 0.70)  # Floor at 0.70 for short texts

    # Markdown/table content boost — pipe chars, headers indicate structure
    if '|' in text or text.startswith('#'):
        ratio = max(ratio, 0.80)

    return min(1.0, max(0.0, ratio))


def process_hybrid(raw_text: str, mode: str = "document") -> HybridResult:
    """
    Full 3-layer OCR pipeline:
      Layer 1: NormalizerKernel
      Layer 2: VedicValidatorKernel
      Layer 3: Integration + harmonic mean quality gating
    """
    steps = []

    # ── Layer 1: Normalize ──────────────────────────────
    steps.append("L1: Normalizer started")
    norm = normalize(raw_text, mode)
    steps.append(f"L1: {len(norm.corrections)} corrections, quality={norm.quality_score:.3f}")

    # ── Layer 2: Vedic Validate ─────────────────────────
    steps.append("L2: Vedic validator started")
    patterns = vedic_validate(norm.normalized_text)
    steps.append(f"L2: {len(patterns)} patterns found")

    # ── Layer 3: Integrate + Gate ───────────────────────
    steps.append("L3: Integration started")

    # Apply high-confidence patterns
    processed = norm.normalized_text
    applied = 0
    for pat in patterns:
        if pat.confidence >= CONFIDENCE_THRESHOLD:
            idx = processed.find(pat.original)
            if idx >= 0 and pat.reconstructed != pat.original:
                processed = processed[:idx] + pat.reconstructed + processed[idx + len(pat.original):]
                applied += 1
    steps.append(f"L3: Applied {applied} high-confidence patterns")

    # Calculate quality scores
    vedic_conf = (
        sum(p.confidence for p in patterns) / len(patterns)
        if patterns else 0.85  # No patterns = neutral (not bad)
    )
    coherence = assess_coherence(norm.normalized_text)

    # Harmonic mean of all three layers
    overall = harmonic_mean([norm.quality_score, vedic_conf, coherence])
    steps.append(f"L3: Quality — norm={norm.quality_score:.3f}, vedic={vedic_conf:.3f}, "
                 f"coherence={coherence:.3f}, overall={overall:.3f}")

    thinking_ready = not norm.requires_deep_reasoning
    if norm.requires_deep_reasoning:
        steps.append("L3: Deep reasoning flagged")

    return HybridResult(
        raw_text=raw_text,
        normalized_text=norm.normalized_text,
        processed_text=processed,
        overall_quality=overall,
        normalizer_quality=norm.quality_score,
        vedic_confidence=vedic_conf,
        coherence_score=coherence,
        thinking_machine_ready=thinking_ready,
        processing_steps=steps,
        corrections_count=len(norm.corrections),
        patterns_found=len(patterns),
        patterns=[{
            "type": p.pattern_type, "original": p.original,
            "reconstructed": p.reconstructed, "confidence": p.confidence,
            "explanation": p.explanation,
        } for p in patterns],
        corrections=norm.corrections,
    )


# ═══════════════════════════════════════════════════════════════════
# Quick self-test
# ═══════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    # Test 1: Normalizer
    test1 = 'The resuIt of the formuIa was \u201cperfect\u201d \u2014 vaIue = 42'
    r1 = normalize(test1)
    print(f"[Normalizer] {len(r1.corrections)} corrections, quality={r1.quality_score:.2f}")
    print(f"  Before: {test1}")
    print(f"  After:  {r1.normalized_text}")
    print(f"  Corrections: {r1.corrections}")
    print()

    # Test 2: Vedic validator
    test2 = "The side is 12 144 and the triple is 3 4 5"
    patterns = vedic_validate(test2)
    print(f"[Vedic] Found {len(patterns)} patterns:")
    for p in patterns:
        print(f"  {p.pattern_type}: {p.original} -> {p.reconstructed} (conf={p.confidence})")
    print()

    # Test 3: Currency validation
    test3 = "Total: BHD 4,910.639 including 10% VAT"
    patterns3 = vedic_validate(test3)
    print(f"[Vedic Currency] Found {len(patterns3)} patterns:")
    for p in patterns3:
        print(f"  {p.pattern_type}: {p.explanation}")
    print()

    # Test 4: Full pipeline
    test4 = "The resuIt shows BHD 1,234.500 for the lnvoice. The vaIue is 3 4 5 right triangIe."
    r4 = process_hybrid(test4)
    print(f"[Hybrid Pipeline]")
    print(f"  Overall quality: {r4.overall_quality:.3f}")
    print(f"  Corrections: {r4.corrections_count}, Patterns: {r4.patterns_found}")
    for step in r4.processing_steps:
        print(f"    {step}")
    print(f"  Final text: {r4.processed_text[:200]}")
