"""
Build a richer STDB seed artifact for AsymmFlow.

This combines:
  1. The legacy transaction-ready seed extract (`client/public/seed_data.json`)
  2. The canonical PH business-reference dataset (`docs/reference_data/canonical_seed.json`)

Output:
  - client/public/stdb_seed.json

The generated file preserves the legacy transactional arrays used by the
browser-side importer while layering in canonical party metadata and a second
pipeline stream (`referencePipelines`) built from the 2025/2026 business
reference workbooks.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
LEGACY_SEED_PATH = ROOT / "client" / "public" / "seed_data.json"
CANONICAL_SEED_PATH = ROOT / "docs" / "reference_data" / "canonical_seed.json"
OUTPUT_PATH = ROOT / "client" / "public" / "stdb_seed.json"
CANONICAL_BUILDER_PATH = ROOT / "tools" / "build_canonical_db.py"


def load_normalizer():
    spec = importlib.util.spec_from_file_location("canonical_builder", CANONICAL_BUILDER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load canonical builder from {CANONICAL_BUILDER_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.normalize_customer


normalize_customer = load_normalizer()


def normalize_name(name: str | None) -> str:
    if not name:
        return ""
    return normalize_customer(str(name)).strip().lower()


def bhd_to_fils(value: Any) -> int:
    if value in (None, ""):
        return 0
    return int(round(float(value) * 1000))


def derive_terms_days(grade: str) -> int:
    if grade == "A":
        return 45
    if grade == "B":
        return 90
    return 0


def coerce_grade(canonical_party: dict[str, Any]) -> str:
    grade = (
        str(canonical_party.get("payment_grade") or "").strip().upper()
        or str(canonical_party.get("grade") or "").strip().upper()
    )
    return grade if grade in {"A", "B", "C", "D"} else "C"


def map_reference_status(raw_status: Any) -> str:
    status = str(raw_status or "").strip().lower()
    if not status:
        return "Draft"
    if any(token in status for token in ["lost", "cancel", "reject"]):
        return "Cancelled"
    if any(token in status for token in ["won", "po received", "order received", "converted"]):
        return "Terminal"
    if any(token in status for token in ["ongoing", "follow-up", "follow up", "evaluation", "negotiation", "revision"]):
        return "InProgress"
    if any(token in status for token in ["quoted", "submitted", "proposal", "budgetary", "offer"]):
        return "Active"
    return "Draft"


def canonical_party_overlay(canonical_party: dict[str, Any]) -> dict[str, Any]:
    return {
        "code": str(canonical_party.get("code") or "").strip(),
        "category": str(canonical_party.get("category") or "").strip(),
        "city": str(canonical_party.get("city") or "").strip(),
        "country": str(canonical_party.get("country") or "Bahrain").strip(),
        "phone": str(canonical_party.get("phone") or "").strip(),
        "email": str(canonical_party.get("email") or "").strip(),
        "source": str(canonical_party.get("source") or "").strip(),
        "active2024": bool(canonical_party.get("active_2024")),
        "active2025": bool(canonical_party.get("active_2025")),
        "active2026": bool(canonical_party.get("active_2026")),
    }


def build_reference_pipeline_entry(
    pipeline_row: dict[str, Any],
    party_idx: int,
) -> dict[str, Any]:
    opp_no = pipeline_row.get("opp_no")
    opp_label = str(opp_no).strip() if opp_no not in (None, "") else ""
    title = (
        str(pipeline_row.get("sfdc_title") or "").strip()
        or str(pipeline_row.get("folder_name") or "").strip()
        or (f"Opportunity {opp_label}" if opp_label else "Imported Opportunity")
    )
    value_fils = bhd_to_fils(pipeline_row.get("value_bhd"))
    status = map_reference_status(pipeline_row.get("status"))
    win_probability_bps = 10_000 if status == "Terminal" else 6_500 if status in {"Active", "InProgress"} else 3_000
    return {
        "partyIdx": party_idx,
        "title": title,
        "status": status,
        "estimatedValueFils": value_fils,
        "winProbabilityBps": win_probability_bps,
        "competitorPresent": False,
        "oemPriceFils": value_fils,
        "markupBps": 0,
        "additionalCostsFils": 0,
        "offerTotalFils": value_fils,
        "revision": 1,
        "lossReason": pipeline_row.get("loss_reason") or None,
        "createdAt": pipeline_row.get("quote_date") or pipeline_row.get("order_date") or None,
        "legacyYear": pipeline_row.get("year"),
        "opportunityNumber": opp_label,
        "folderNumber": str(pipeline_row.get("folder_no") or "").strip(),
        "folderName": str(pipeline_row.get("folder_name") or "").strip(),
        "sfdcTitle": str(pipeline_row.get("sfdc_title") or "").strip(),
        "comment": str(pipeline_row.get("comment") or "").strip(),
        "ehReference": str(pipeline_row.get("eh_ref") or "").strip(),
        "paymentTerms": str(pipeline_row.get("payment_terms") or "").strip(),
        "ownerName": str(pipeline_row.get("owner") or "").strip(),
        "source": str(pipeline_row.get("source") or "canonical").strip(),
        "sourceNotes": str(pipeline_row.get("notes") or "").strip(),
        "deliverySummary": str(pipeline_row.get("delivery") or "").strip(),
    }


def enrich_legacy_pipeline(
    pipeline_row: dict[str, Any],
    canonical_match: dict[str, Any] | None,
) -> dict[str, Any]:
    enriched = dict(pipeline_row)
    enriched.setdefault("legacyYear", None)
    enriched.setdefault("opportunityNumber", "")
    enriched.setdefault("folderNumber", "")
    enriched.setdefault("folderName", "")
    enriched.setdefault("sfdcTitle", "")
    enriched.setdefault("comment", "")
    enriched.setdefault("ehReference", "")
    enriched.setdefault("paymentTerms", "")
    enriched.setdefault("ownerName", "")
    enriched.setdefault("source", "legacy_extract")
    enriched.setdefault("sourceNotes", "")
    enriched.setdefault("deliverySummary", "")

    if not canonical_match:
        return enriched

    opp_no = canonical_match.get("opp_no")
    enriched["legacyYear"] = canonical_match.get("year")
    enriched["opportunityNumber"] = str(opp_no).strip() if opp_no not in (None, "") else ""
    enriched["folderNumber"] = str(canonical_match.get("folder_no") or "").strip()
    enriched["folderName"] = str(canonical_match.get("folder_name") or "").strip()
    enriched["sfdcTitle"] = str(canonical_match.get("sfdc_title") or "").strip()
    enriched["comment"] = str(canonical_match.get("comment") or "").strip()
    enriched["ehReference"] = str(canonical_match.get("eh_ref") or "").strip()
    enriched["paymentTerms"] = str(canonical_match.get("payment_terms") or "").strip()
    enriched["ownerName"] = str(canonical_match.get("owner") or "").strip()
    enriched["source"] = str(canonical_match.get("source") or "legacy+canonical").strip()
    enriched["sourceNotes"] = str(canonical_match.get("notes") or "").strip()
    enriched["deliverySummary"] = str(canonical_match.get("delivery") or "").strip()
    if canonical_match.get("loss_reason"):
        enriched["lossReason"] = canonical_match["loss_reason"]
    return enriched


def main() -> None:
    legacy_seed = json.loads(LEGACY_SEED_PATH.read_text(encoding="utf-8"))
    canonical_seed = json.loads(CANONICAL_SEED_PATH.read_text(encoding="utf-8"))

    canonical_party_by_name = {
        normalize_name(party.get("name")): party
        for party in canonical_seed.get("parties", [])
        if normalize_name(party.get("name"))
    }

    enriched_parties: list[dict[str, Any]] = []
    legacy_name_to_idx: dict[str, int] = {}

    for legacy_party in legacy_seed.get("parties", []):
        party = dict(legacy_party)
        canonical_party = canonical_party_by_name.get(normalize_name(legacy_party.get("name")))
        if canonical_party:
            party.update(canonical_party_overlay(canonical_party))
            if canonical_party.get("code"):
                note_prefix = f"Code: {canonical_party['code']}"
                party["notes"] = note_prefix if not party.get("notes") else f"{note_prefix} | {party['notes']}"
        else:
            party.update({
                "code": "",
                "category": "",
                "city": "",
                "country": "Bahrain",
                "phone": "",
                "email": "",
                "source": "legacy_extract",
                "active2024": False,
                "active2025": False,
                "active2026": False,
            })
        legacy_name_to_idx[normalize_name(party.get("name"))] = len(enriched_parties)
        enriched_parties.append(party)

    for canonical_party in canonical_seed.get("parties", []):
        normalized = normalize_name(canonical_party.get("name"))
        if not normalized or normalized in legacy_name_to_idx:
            continue
        grade = coerce_grade(canonical_party)
        enriched_parties.append({
            "legacyId": f"canonical::{canonical_party.get('name', '').strip()}",
            "name": str(canonical_party.get("name") or "").strip(),
            "code": str(canonical_party.get("code") or "").strip(),
            "category": str(canonical_party.get("category") or "").strip(),
            "isCustomer": True,
            "isSupplier": False,
            "grade": grade,
            "creditLimitFils": bhd_to_fils(canonical_party.get("credit_limit_bhd")),
            "isCreditBlocked": False,
            "paymentTermsDays": int(canonical_party.get("payment_terms_days") or derive_terms_days(grade)),
            "productTypes": "",
            "annualGoalFils": 0,
            "city": str(canonical_party.get("city") or "").strip(),
            "country": str(canonical_party.get("country") or "Bahrain").strip(),
            "phone": str(canonical_party.get("phone") or "").strip(),
            "email": str(canonical_party.get("email") or "").strip(),
            "source": str(canonical_party.get("source") or "canonical").strip(),
            "active2024": bool(canonical_party.get("active_2024")),
            "active2025": bool(canonical_party.get("active_2025")),
            "active2026": bool(canonical_party.get("active_2026")),
            "notes": f"Canonical import | Category: {canonical_party.get('category') or ''}".strip(),
        })
        legacy_name_to_idx[normalized] = len(enriched_parties) - 1

    canonical_by_opp_number: dict[int, dict[str, Any]] = {}
    for pipeline_row in canonical_seed.get("pipeline", []):
        opp_no = pipeline_row.get("opp_no")
        if opp_no in (None, ""):
            continue
        try:
            canonical_by_opp_number[int(opp_no)] = pipeline_row
        except (TypeError, ValueError):
            continue

    matched_opp_numbers: set[int] = set()
    enriched_legacy_pipelines: list[dict[str, Any]] = []
    for pipeline_row in legacy_seed.get("pipelines", []):
        title = str(pipeline_row.get("title") or "")
        opp_no = None
        for chunk in title.replace("/", " ").replace("-", " ").split():
            if chunk.isdigit():
                opp_no = int(chunk)
                break
        canonical_match = canonical_by_opp_number.get(opp_no) if opp_no is not None else None
        if canonical_match is not None:
            matched_opp_numbers.add(opp_no)
        enriched_legacy_pipelines.append(enrich_legacy_pipeline(pipeline_row, canonical_match))

    reference_pipelines: list[dict[str, Any]] = []
    for pipeline_row in canonical_seed.get("pipeline", []):
        opp_no = pipeline_row.get("opp_no")
        try:
            if opp_no not in (None, "") and int(opp_no) in matched_opp_numbers:
                continue
        except (TypeError, ValueError):
            pass
        party_idx = legacy_name_to_idx.get(normalize_name(pipeline_row.get("client")))
        if party_idx is None:
            continue
        reference_pipelines.append(build_reference_pipeline_entry(pipeline_row, party_idx))

    combined = {
        "generatedAt": canonical_seed.get("generated"),
        "sources": {
            "legacySeed": str(LEGACY_SEED_PATH.relative_to(ROOT)),
            "canonicalSeed": str(CANONICAL_SEED_PATH.relative_to(ROOT)),
        },
        "parties": enriched_parties,
        "contacts": legacy_seed.get("contacts", []),
        "pipelines": enriched_legacy_pipelines,
        "referencePipelines": reference_pipelines,
        "orders": legacy_seed.get("orders", []),
        "purchaseOrders": legacy_seed.get("purchaseOrders", []),
        "moneyEvents": legacy_seed.get("moneyEvents", []),
        "stats": {
            "legacyParties": len(legacy_seed.get("parties", [])),
            "canonicalParties": len(canonical_seed.get("parties", [])),
            "outputParties": len(enriched_parties),
            "legacyPipelines": len(legacy_seed.get("pipelines", [])),
            "referencePipelines": len(reference_pipelines),
            "orders": len(legacy_seed.get("orders", [])),
            "purchaseOrders": len(legacy_seed.get("purchaseOrders", [])),
            "moneyEvents": len(legacy_seed.get("moneyEvents", [])),
            "canonicalPartyOnlyAdditions": len(enriched_parties) - len(legacy_seed.get("parties", [])),
        },
    }

    OUTPUT_PATH.write_text(json.dumps(combined, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Wrote {OUTPUT_PATH}")
    print(json.dumps(combined["stats"], indent=2))


if __name__ == "__main__":
    main()
