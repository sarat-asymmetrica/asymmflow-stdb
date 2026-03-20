"""
Extract PH Holdings data from SQLite → seed JSON for SpacetimeDB.

Usage:
    python scripts/extract_ph_data.py

Output:
    scripts/seed_data.json

Maps legacy 95-table schema → unified 10-table AsymmFlow schema:
  customers + suppliers → Party (unified, isCustomer/isSupplier flags)
  customer_contacts     → Contact
  opportunities + offers → Pipeline
  orders                → Order
  invoices              → MoneyEvent (kind=CustomerInvoice)
  payments              → MoneyEvent (kind=CustomerPayment)
  supplier_invoices     → MoneyEvent (kind=SupplierInvoice)
  supplier_payments     → MoneyEvent (kind=SupplierPayment)
  purchase_orders       → PurchaseOrder
"""

import sqlite3
import json
import sys
from pathlib import Path
from datetime import datetime

DB_PATH = r"C:\Projects\ph-final\ph_holdings\ph_holdings.db"
OUT_PATH = Path(__file__).parent / "seed_data.json"


def bhd_to_fils(bhd_value) -> int:
    """Convert BHD float to fils integer (1 BHD = 1000 fils)."""
    if bhd_value is None:
        return 0
    return round(float(bhd_value) * 1000)


def parse_date(dt_str) -> str | None:
    """Normalize datetime string to ISO 8601."""
    if not dt_str:
        return None
    # Strip timezone info for simplicity — all dates are Bahrain local
    try:
        if "+" in dt_str:
            dt_str = dt_str.split("+")[0].strip()
        elif "Z" in dt_str:
            dt_str = dt_str.replace("Z", "").strip()
        # Parse common formats
        for fmt in ["%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"]:
            try:
                dt = datetime.strptime(dt_str, fmt)
                return dt.isoformat() + "Z"
            except ValueError:
                continue
        return dt_str
    except Exception:
        return None


def grade_map(grade_str) -> str:
    """Map legacy grade to STDB CustomerGrade enum tag."""
    if grade_str in ("A", "B", "C", "D"):
        return grade_str
    return "C"  # Default ungraded customers to C (safe default: no discount, 50% advance)


def status_map_invoice(status_str) -> dict:
    """Map legacy invoice status → STDB EntityStatus + paidAt flag."""
    s = (status_str or "").lower()
    if s == "paid":
        return {"status": "Terminal", "isPaid": True}
    if s == "overdue":
        return {"status": "Active", "isPaid": False}
    if s in ("draft", ""):
        return {"status": "Draft", "isPaid": False}
    if s == "cancelled":
        return {"status": "Cancelled", "isPaid": False}
    return {"status": "Active", "isPaid": False}


def status_map_order(status_str) -> str:
    """Map legacy order status → STDB EntityStatus."""
    s = (status_str or "").lower()
    if s == "confirmed":
        return "Active"
    if s in ("processing", "shipped", "ready for shipment"):
        return "InProgress"
    if s == "delivered":
        return "Terminal"
    if s == "cancelled":
        return "Cancelled"
    return "Draft"


def stage_map_pipeline(stage_str) -> str:
    """Map legacy offer/opportunity stage → STDB EntityStatus."""
    s = (stage_str or "").lower()
    if s == "rfq":
        return "Draft"
    if s == "quoted":
        return "Active"
    if s == "won":
        return "Terminal"
    if s in ("lost", "cancelled"):
        return "Cancelled"
    return "Draft"


def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    seed = {
        "parties": [],
        "contacts": [],
        "pipelines": [],
        "orders": [],
        "purchaseOrders": [],
        "moneyEvents": [],
    }

    # ── Track legacy ID → seed index for FK resolution ────────────
    customer_id_to_party_idx = {}
    supplier_id_to_party_idx = {}
    party_idx = 0

    # ── 1. CUSTOMERS → Party ──────────────────────────────────────
    cur.execute("""
        SELECT id, business_name, customer_grade, payment_grade,
               credit_limit_bhd, payment_terms_days, phone, email,
               city, country, is_credit_blocked
        FROM customers
        WHERE deleted_at IS NULL
        ORDER BY business_name
    """)
    for row in cur.fetchall():
        grade = grade_map(row["payment_grade"])
        seed["parties"].append({
            "legacyId": row["id"],
            "name": row["business_name"] or "Unknown",
            "isCustomer": True,
            "isSupplier": False,
            "grade": grade,
            "creditLimitFils": bhd_to_fils(row["credit_limit_bhd"]),
            "isCreditBlocked": bool(row["is_credit_blocked"]),
            "paymentTermsDays": row["payment_terms_days"] or (45 if grade == "A" else 90 if grade == "B" else 0),
            "productTypes": "",
            "notes": ", ".join(filter(None, [row["city"], row["country"], row["phone"], row["email"]])),
        })
        customer_id_to_party_idx[row["id"]] = party_idx
        party_idx += 1

    # ── 2. SUPPLIERS → Party ──────────────────────────────────────
    # Check for dual-role (already added as customer)
    cur.execute("""
        SELECT s.id, s.supplier_name, s.country, s.email, s.phone,
               s.product_types, s.payment_terms, s.notes,
               c.id as customer_match_id
        FROM suppliers s
        LEFT JOIN customers c ON LOWER(s.supplier_name) = LOWER(c.business_name)
            AND c.deleted_at IS NULL
        WHERE s.deleted_at IS NULL
        ORDER BY s.supplier_name
    """)
    for row in cur.fetchall():
        if row["customer_match_id"]:
            # Dual-role: mark existing party as also-supplier
            idx = customer_id_to_party_idx.get(row["customer_match_id"])
            if idx is not None:
                seed["parties"][idx]["isSupplier"] = True
                supplier_id_to_party_idx[row["id"]] = idx
                continue

        seed["parties"].append({
            "legacyId": row["id"],
            "name": row["supplier_name"] or "Unknown Supplier",
            "isCustomer": False,
            "isSupplier": True,
            "grade": "C",  # suppliers default to C
            "creditLimitFils": 0,
            "isCreditBlocked": False,
            "paymentTermsDays": 0,
            "productTypes": row["product_types"] or "",
            "notes": ", ".join(filter(None, [row["country"], row["phone"], row["email"], row["notes"]])),
        })
        supplier_id_to_party_idx[row["id"]] = party_idx
        party_idx += 1

    # ── 3. CUSTOMER CONTACTS → Contact ────────────────────────────
    cur.execute("""
        SELECT customer_id, contact_name, contact_role, contact_email,
               contact_phone, job_title
        FROM customer_contacts
        WHERE deleted_at IS NULL AND contact_name IS NOT NULL
        ORDER BY customer_id, contact_name
    """)
    for row in cur.fetchall():
        party_idx_ref = customer_id_to_party_idx.get(row["customer_id"])
        if party_idx_ref is None:
            continue
        seed["contacts"].append({
            "partyIdx": party_idx_ref,
            "name": row["contact_name"],
            "designation": row["job_title"] or row["contact_role"] or "",
            "phone": row["contact_phone"] or "",
            "email": row["contact_email"] or "",
        })

    # ── 4. OFFERS → Pipeline ─────────────────────────────────────
    # We use offers (67) rather than opportunities (29) since offers have
    # richer data (value, margin, validity dates)
    legacy_offer_to_pipeline_idx = {}
    pipeline_idx = 0
    cur.execute("""
        SELECT o.id, o.offer_number, o.customer_id, o.customer_name,
               o.total_value_bhd, o.estimated_margin, o.stage,
               o.quotation_date, o.validity_date, o.has_abb_competition,
               o.revision_number, o.lost_reason
        FROM offers o
        WHERE o.deleted_at IS NULL
        ORDER BY o.created_at
    """)
    for row in cur.fetchall():
        party_idx_ref = customer_id_to_party_idx.get(row["customer_id"])
        if party_idx_ref is None:
            # Try matching by name
            for i, p in enumerate(seed["parties"]):
                if p["name"].lower() == (row["customer_name"] or "").lower():
                    party_idx_ref = i
                    break
        if party_idx_ref is None:
            continue  # Skip orphaned offers

        value_fils = bhd_to_fils(row["total_value_bhd"])
        margin_bps = round(float(row["estimated_margin"] or 0) * 100)  # margin% → basis points

        seed["pipelines"].append({
            "partyIdx": party_idx_ref,
            "title": "Offer " + (row["offer_number"] or "?"),
            "status": stage_map_pipeline(row["stage"]),
            "estimatedValueFils": value_fils,
            "winProbabilityBps": 5000 if row["stage"] == "Quoted" else (10000 if row["stage"] == "Won" else 2000),
            "competitorPresent": bool(row["has_abb_competition"]),
            "oemPriceFils": max(0, value_fils - round(value_fils * margin_bps / 10000)) if margin_bps > 0 else value_fils,
            "markupBps": margin_bps,
            "additionalCostsFils": 0,
            "offerTotalFils": value_fils,
            "revision": row["revision_number"] or 1,
            "lossReason": row["lost_reason"],
            "createdAt": parse_date(row["quotation_date"]),
        })
        legacy_offer_to_pipeline_idx[row["id"]] = pipeline_idx
        pipeline_idx += 1

    # ── 5. ORDERS → Order ─────────────────────────────────────────
    legacy_order_id_to_idx = {}
    order_idx = 0
    cur.execute("""
        SELECT id, order_number, customer_id, customer_name,
               customer_po_number, grand_total_bhd, status,
               order_date, required_date, offer_id
        FROM orders
        WHERE deleted_at IS NULL
        ORDER BY created_at
    """)
    for row in cur.fetchall():
        party_idx_ref = customer_id_to_party_idx.get(row["customer_id"])
        if party_idx_ref is None:
            for i, p in enumerate(seed["parties"]):
                if p["name"].lower() == (row["customer_name"] or "").lower():
                    party_idx_ref = i
                    break
        if party_idx_ref is None:
            continue

        pipeline_idx_ref = legacy_offer_to_pipeline_idx.get(row["offer_id"])

        seed["orders"].append({
            "partyIdx": party_idx_ref,
            "pipelineIdx": pipeline_idx_ref,
            "status": status_map_order(row["status"]),
            "totalFils": bhd_to_fils(row["grand_total_bhd"]),
            "poReference": row["customer_po_number"] or row["order_number"] or "",
            "expectedDelivery": parse_date(row["required_date"]),
            "createdAt": parse_date(row["order_date"]),
        })
        legacy_order_id_to_idx[row["id"]] = order_idx
        order_idx += 1

    # ── 6. PURCHASE ORDERS → PurchaseOrder ────────────────────────
    cur.execute("""
        SELECT id, po_number, supplier_id, order_id, total_bhd, status
        FROM purchase_orders
        WHERE deleted_at IS NULL
        ORDER BY created_at
    """)
    for row in cur.fetchall():
        party_idx_ref = supplier_id_to_party_idx.get(row["supplier_id"])
        if party_idx_ref is None:
            continue
        order_idx_ref = legacy_order_id_to_idx.get(row["order_id"]) if row["order_id"] else None

        po_status = "Terminal" if (row["status"] or "").lower() == "completed" else "Active"

        seed["purchaseOrders"].append({
            "partyIdx": party_idx_ref,
            "orderIdx": order_idx_ref,
            "status": po_status,
            "totalFils": bhd_to_fils(row["total_bhd"]),
        })

    # ── 7. INVOICES → MoneyEvent (CustomerInvoice) ────────────────
    legacy_invoice_id_map = {}
    cur.execute("""
        SELECT i.id, i.invoice_number, i.customer_id, i.customer_name,
               i.subtotal_bhd, i.vatbhd, i.grand_total_bhd, i.status,
               i.due_date, i.invoice_date, i.order_id
        FROM invoices i
        WHERE i.deleted_at IS NULL
        ORDER BY i.created_at
    """)
    for row in cur.fetchall():
        party_idx_ref = customer_id_to_party_idx.get(row["customer_id"])
        if party_idx_ref is None:
            for i, p in enumerate(seed["parties"]):
                if p["name"].lower() == (row["customer_name"] or "").lower():
                    party_idx_ref = i
                    break
        if party_idx_ref is None:
            continue

        order_idx_ref = legacy_order_id_to_idx.get(row["order_id"]) if row["order_id"] else None
        inv_status = status_map_invoice(row["status"])

        subtotal = bhd_to_fils(row["subtotal_bhd"])
        vat = bhd_to_fils(row["vatbhd"])
        total = bhd_to_fils(row["grand_total_bhd"])
        # Ensure total = subtotal + vat (fix rounding)
        if total == 0 and subtotal > 0:
            total = subtotal + vat

        seed["moneyEvents"].append({
            "partyIdx": party_idx_ref,
            "orderIdx": order_idx_ref,
            "kind": "CustomerInvoice",
            "status": inv_status["status"],
            "subtotalFils": subtotal,
            "vatFils": vat,
            "totalFils": total,
            "reference": row["invoice_number"] or "",
            "dueDate": parse_date(row["due_date"]),
            "paidAt": parse_date(row["invoice_date"]) if inv_status["isPaid"] else None,
            "createdAt": parse_date(row["invoice_date"]),
        })
        legacy_invoice_id_map[row["id"]] = len(seed["moneyEvents"]) - 1

    # ── 8. PAYMENTS → MoneyEvent (CustomerPayment) ────────────────
    cur.execute("""
        SELECT p.id, p.invoice_id, p.invoice_number, p.amount_bhd,
               p.payment_date, p.payment_method, p.reference,
               i.customer_id, i.customer_name
        FROM payments p
        LEFT JOIN invoices i ON p.invoice_id = i.id
        WHERE p.deleted_at IS NULL
        ORDER BY p.created_at
    """)
    for row in cur.fetchall():
        party_idx_ref = customer_id_to_party_idx.get(row["customer_id"])
        if party_idx_ref is None:
            for i, p in enumerate(seed["parties"]):
                if p["name"].lower() == (row["customer_name"] or "").lower():
                    party_idx_ref = i
                    break
        if party_idx_ref is None:
            continue

        amount = bhd_to_fils(row["amount_bhd"])

        seed["moneyEvents"].append({
            "partyIdx": party_idx_ref,
            "orderIdx": None,
            "kind": "CustomerPayment",
            "status": "Terminal",
            "subtotalFils": amount,
            "vatFils": 0,
            "totalFils": amount,
            "reference": row["reference"] or row["invoice_number"] or row["payment_method"] or "",
            "dueDate": None,
            "paidAt": parse_date(row["payment_date"]),
            "createdAt": parse_date(row["payment_date"]),
        })

    # ── 9. SUPPLIER INVOICES → MoneyEvent (SupplierInvoice) ───────
    cur.execute("""
        SELECT si.id, si.invoice_number, si.supplier_id, si.total_bhd,
               si.status, si.invoice_date, si.due_date
        FROM supplier_invoices si
        WHERE si.deleted_at IS NULL
        ORDER BY si.created_at
    """)
    for row in cur.fetchall():
        party_idx_ref = supplier_id_to_party_idx.get(row["supplier_id"])
        if party_idx_ref is None:
            continue

        total = bhd_to_fils(row["total_bhd"])
        is_paid = (row["status"] or "").lower() == "paid"

        seed["moneyEvents"].append({
            "partyIdx": party_idx_ref,
            "orderIdx": None,
            "kind": "SupplierInvoice",
            "status": "Terminal" if is_paid else "Active",
            "subtotalFils": total,
            "vatFils": 0,
            "totalFils": total,
            "reference": row["invoice_number"] or "",
            "dueDate": parse_date(row["due_date"]),
            "paidAt": parse_date(row["invoice_date"]) if is_paid else None,
            "createdAt": parse_date(row["invoice_date"]),
        })

    # ── 10. SUPPLIER PAYMENTS → MoneyEvent (SupplierPayment) ──────
    cur.execute("""
        SELECT sp.id, sp.supplier_id, sp.amount_bhd, sp.payment_date,
               sp.payment_method, sp.reference
        FROM supplier_payments sp
        WHERE sp.deleted_at IS NULL
        ORDER BY sp.created_at
    """)
    for row in cur.fetchall():
        party_idx_ref = supplier_id_to_party_idx.get(row["supplier_id"])
        if party_idx_ref is None:
            continue

        amount = bhd_to_fils(row["amount_bhd"])

        seed["moneyEvents"].append({
            "partyIdx": party_idx_ref,
            "orderIdx": None,
            "kind": "SupplierPayment",
            "status": "Terminal",
            "subtotalFils": amount,
            "vatFils": 0,
            "totalFils": amount,
            "reference": row["reference"] or row["payment_method"] or "",
            "dueDate": None,
            "paidAt": parse_date(row["payment_date"]),
            "createdAt": parse_date(row["payment_date"]),
        })

    conn.close()

    # ── Summary ───────────────────────────────────────────────────
    print(f"Extracted:")
    print(f"  Parties:         {len(seed['parties'])} ({sum(1 for p in seed['parties'] if p['isCustomer'])} customers, {sum(1 for p in seed['parties'] if p['isSupplier'])} suppliers, {sum(1 for p in seed['parties'] if p['isCustomer'] and p['isSupplier'])} dual-role)")
    print(f"  Contacts:        {len(seed['contacts'])}")
    print(f"  Pipelines:       {len(seed['pipelines'])}")
    print(f"  Orders:          {len(seed['orders'])}")
    print(f"  Purchase Orders: {len(seed['purchaseOrders'])}")
    print(f"  Money Events:    {len(seed['moneyEvents'])}")

    me_kinds = {}
    for me in seed["moneyEvents"]:
        k = me["kind"]
        me_kinds[k] = me_kinds.get(k, 0) + 1
    for k, v in sorted(me_kinds.items()):
        print(f"    {k}: {v}")

    # Write
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(seed, f, ensure_ascii=False, indent=2)

    print(f"\nWritten to {OUT_PATH} ({OUT_PATH.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
