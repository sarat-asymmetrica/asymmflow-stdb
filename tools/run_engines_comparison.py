"""
Asymmetrica Engine Comparison — Run engines on baseline Mistral results.
Loads pipeline_full.json, runs the 3-layer Asymmetrica OCR engines on all
extracted text, and produces a comparison report.
"""
import json
import time
import sys

sys.path.insert(0, ".")
from asymm_ocr_kernels import process_hybrid, normalize, vedic_validate

BASELINE_PATH = "pipeline_full.json"
OUTPUT_PATH = "pipeline_with_engines.json"


def main():
    print("=" * 70)
    print("  ASYMMETRICA ENGINE COMPARISON RUN")
    print("  Loading Mistral baseline + applying 3-layer OCR engines")
    print("=" * 70)

    # Load baseline
    with open(BASELINE_PATH, "r", encoding="utf-8") as f:
        baseline = json.load(f)

    total_files = len(baseline["files"])
    print(f"\n  Baseline: {total_files} files, {baseline['total_chars_extracted']:,} chars")

    # Run engines on all files with extracted text
    # Prefer full_text (2KB), fall back to preview (150 chars)
    files_with_text = [
        fi for fi in baseline["files"]
        if (fi.get("full_text") and len(fi["full_text"]) > 10)
        or (fi.get("preview") and len(fi["preview"]) > 10)
    ]
    print(f"  Files with text to process: {len(files_with_text)}")
    has_full = sum(1 for fi in files_with_text if fi.get("full_text") and len(fi["full_text"]) > 10)
    print(f"  Files with full_text (2KB): {has_full}")
    print(f"  Files with preview only:    {len(files_with_text) - has_full}")

    t0 = time.time()
    total_corrections = 0
    total_patterns = 0
    quality_before = []
    quality_after = []
    interesting = []
    all_corrections = []
    all_patterns = []

    for i, fi in enumerate(files_with_text):
        text = fi.get("full_text") or fi.get("preview", "")
        try:
            result = process_hybrid(text)

            old_conf = fi["confidence"]
            new_conf = result.overall_quality
            quality_before.append(old_conf)
            quality_after.append(new_conf)

            fi["engine_quality"] = round(new_conf, 3)
            fi["engine_corrections"] = result.corrections_count
            fi["engine_patterns"] = result.patterns_found
            fi["engine_normalizer"] = round(result.normalizer_quality, 3)
            fi["engine_vedic"] = round(result.vedic_confidence, 3)
            fi["engine_coherence"] = round(result.coherence_score, 3)

            total_corrections += result.corrections_count
            total_patterns += result.patterns_found
            all_corrections.extend(result.corrections)
            all_patterns.extend(result.patterns)

            if result.corrections_count > 0 or result.patterns_found > 0:
                interesting.append({
                    "filename": fi["filename"],
                    "lane": fi["lane"],
                    "corrections": result.corrections_count,
                    "patterns": result.patterns_found,
                    "quality_before": round(old_conf, 3),
                    "quality_after": round(new_conf, 3),
                    "correction_list": result.corrections[:5],
                    "pattern_list": [{
                        "type": p["type"],
                        "original": p["original"][:60],
                        "reconstructed": p["reconstructed"][:60],
                        "confidence": p["confidence"],
                    } for p in result.patterns[:5]],
                })

        except Exception as e:
            fi["engine_error"] = str(e)

        if (i + 1) % 200 == 0:
            print(f"    {i+1}/{len(files_with_text)} processed...")

    elapsed = time.time() - t0

    # ── Compute statistics ──────────────────────────────────
    avg_before = sum(quality_before) / max(len(quality_before), 1)
    avg_after = sum(quality_after) / max(len(quality_after), 1)
    improved = sum(1 for b, a in zip(quality_before, quality_after) if a > b + 0.001)
    degraded = sum(1 for b, a in zip(quality_before, quality_after) if a < b - 0.001)
    same = len(quality_before) - improved - degraded

    # Correction frequency analysis
    from collections import Counter
    correction_types = Counter()
    for c in all_corrections:
        ctype = c.split(":")[0].strip() if ":" in c else "other"
        correction_types[ctype] += 1

    pattern_types = Counter()
    for p in all_patterns:
        pattern_types[p["type"]] += 1

    # ── Print report ────────────────────────────────────────
    print(f"\n{'='*70}")
    print(f"  COMPARISON RESULTS")
    print(f"{'='*70}")
    print(f"\n  Processing time:       {elapsed:.1f}s ({len(files_with_text)/max(elapsed,0.001):.0f} files/sec)")
    print(f"  Files processed:       {len(files_with_text)}")

    print(f"\n  --- CORRECTIONS (NormalizerKernel) ---")
    print(f"  Total corrections:     {total_corrections}")
    for ctype, count in correction_types.most_common(10):
        print(f"    {ctype:<20}: {count:>4}")

    print(f"\n  --- PATTERNS (VedicValidatorKernel) ---")
    print(f"  Total patterns:        {total_patterns}")
    for ptype, count in pattern_types.most_common(10):
        print(f"    {ptype:<25}: {count:>4}")

    print(f"\n  --- QUALITY (HybridOcrKernel) ---")
    print(f"  Avg quality BEFORE:    {avg_before:.4f}")
    print(f"  Avg quality AFTER:     {avg_after:.4f}")
    print(f"  Delta:                 {avg_after - avg_before:+.4f}")
    print(f"  Files improved:        {improved:>5} ({improved/max(len(quality_before),1)*100:.1f}%)")
    print(f"  Files same:            {same:>5} ({same/max(len(quality_before),1)*100:.1f}%)")
    print(f"  Files degraded:        {degraded:>5} ({degraded/max(len(quality_before),1)*100:.1f}%)")

    print(f"\n  --- TOP INTERESTING FINDINGS ---")
    sorted_interesting = sorted(interesting, key=lambda x: -(x["corrections"] + x["patterns"]))
    for item in sorted_interesting[:15]:
        c = item["corrections"]
        p = item["patterns"]
        delta = item["quality_after"] - item["quality_before"]
        print(f"  {item['filename'][:50]:<50} C={c:>2} P={p:>2} dQ={delta:+.3f}")
        for corr in item["correction_list"][:2]:
            print(f"      fix: {corr}")
        for pat in item["pattern_list"][:2]:
            print(f"      pat: {pat['type']} — {pat['original'][:40]} -> {pat['reconstructed'][:40]}")

    print(f"\n{'='*70}")

    # ── Save enriched output ────────────────────────────────
    baseline["asymm_engines"] = {
        "total_corrections": total_corrections,
        "total_patterns": total_patterns,
        "avg_quality_before": round(avg_before, 4),
        "avg_quality_after": round(avg_after, 4),
        "files_improved": improved,
        "files_same": same,
        "files_degraded": degraded,
        "correction_types": dict(correction_types.most_common()),
        "pattern_types": dict(pattern_types.most_common()),
        "processing_time_sec": round(elapsed, 2),
        "interesting_findings": sorted_interesting[:30],
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(baseline, f, indent=2, ensure_ascii=False, default=str)

    print(f"\n  Enriched report saved to: {OUTPUT_PATH}")
    print(f"{'='*70}\n")


if __name__ == "__main__":
    main()
