/**
 * AsymmFlow — Seed Database
 *
 * Populates the `asymm-flow` SpacetimeDB module with realistic PH Trading WLL
 * (Bahrain) reference data derived from the canonical_seed.xlsx source of truth.
 *
 * Call from the browser console after connecting:
 *
 *   import { seedDatabase } from './lib/seed';
 *   await seedDatabase();
 *
 * Or wire up to the dev button in SettingsPage.
 *
 * Design constraints:
 *   - All monetary values in fils (1 BHD = 1000 fils, so 1 BHD = 1000n).
 *   - Fixed IDs on every call — upsert semantics — fully idempotent.
 *   - Sequential reducer calls with a small delay to respect server ordering.
 *   - Pipelines are seeded via advancePipeline before orders that reference them.
 *
 * RC-5 Money semantics:
 *   CustomerInvoice / SupplierInvoice → subtotalFils = pre-VAT net amount.
 *     Server computes vatFils = round(subtotalFils * 10%) and totalFils = subtotal + vat.
 *   CustomerPayment / SupplierPayment → subtotalFils = actual VAT-inclusive cash amount.
 *     Server does NOT add VAT again.
 *
 * Bahrain VAT = 10% (NBR). Rounding: round-half-up at fil boundary.
 *
 * SpacetimeDB SDK 2.x note:
 *   Each reducer on conn.reducers takes ONE object argument, not positional args.
 */

import { Timestamp } from 'spacetimedb';
import { getConnection } from './db';

// ── Utility ───────────────────────────────────────────────────────────────────

/** Returns a SpacetimeDB Timestamp for an absolute calendar date (UTC). */
function ts(year: number, month: number, day: number): Timestamp {
  return new Timestamp(BigInt(Date.UTC(year, month - 1, day)) * 1000n);
}

/** Returns a SpacetimeDB Timestamp N days relative to today. */
function daysFromNow(n: number): Timestamp {
  const ms = Date.now() + n * 24 * 60 * 60 * 1000;
  return new Timestamp(BigInt(ms) * 1000n);
}

/** Small async pause — prevents flooding the WebSocket send buffer. */
function pause(ms = 80): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Convert BHD (as a float) to fils (u64 BigInt). Rounds to nearest fil. */
function bhd(amount: number): bigint {
  return BigInt(Math.round(amount * 1000));
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function seedDatabase(): Promise<void> {
  const conn = getConnection();
  if (!conn) throw new Error('[seed] Not connected to SpacetimeDB');

  console.log('[seed] Starting AsymmFlow comprehensive seed — PH Trading WLL, Bahrain');
  console.log('[seed] Source: canonical_seed.xlsx (2026-03-16 snapshot)');

  // ── 1. Parties ────────────────────────────────────────────────────────────
  //
  // Reducer: upsert_party
  // Params:  id, name, isCustomer, isSupplier, grade, creditLimitFils,
  //          paymentTermsDays, productTypes, annualGoalFils, notes
  //
  // Party IDs:
  //   1–20  Customers (top by revenue + active 2026)
  //   21–25 Suppliers
  //
  console.log('[seed] 1/7 — Creating 30 parties...');

  // ── Customers ──────────────────────────────────────────────────────────────

  // EWA — Electricity & Water Authority. Largest historical revenue customer.
  await conn.reducers.upsertParty({
    id: 1n,
    name: 'Electricity & Water Authority (EWA)',
    isCustomer: true,
    isSupplier: false,
    grade: { tag: 'B' },
    creditLimitFils: bhd(200_000),
    paymentTermsDays: 30n,
    productTypes: 'Flow Meters, Pressure Transmitters, RTDs, SCADA Instruments',
    annualGoalFils: bhd(300_000),
    notes: 'Single largest customer by revenue. Bahrain\'s state utility. Framework contract for instrumentation supply. Pay terms 30 days but historically 60-90 days in practice. Several overdue invoices outstanding.',
  });
  await pause();

  // Bapco Refining
  await conn.reducers.upsertParty({
    id: 2n,
    name: 'Bapco Refining',
    isCustomer: true,
    isSupplier: false,
    grade: { tag: 'B' },
    creditLimitFils: bhd(100_000),
    paymentTermsDays: 30n,
    productTypes: 'Process Analyzers, Coriolis Flow Meters, Pressure Transmitters',
    annualGoalFils: bhd(200_000),
    notes: 'Bahrain Petroleum Company refinery. Primary refinery customer. Large 2026 pipeline with Opp 307 (197K BHD) and Opp 15 (103K BHD) both under evaluation. Sundar is account owner.',
  });
  await pause();

  // Al Ezzel Engie O&M
  await conn.reducers.upsertParty({
    id: 3n,
    name: 'Al Ezzel Engie O&M',
    isCustomer: true,
    isSupplier: false,
    grade: { tag: 'B' },
    creditLimitFils: bhd(60_000),
    paymentTermsDays: 30n,
    productTypes: 'Flow Meters, Temperature Instruments, Service & Calibration',
    annualGoalFils: bhd(80_000),
    notes: 'O&M contractor for Al Ezzel power plant. Regular repeat business for instrumentation spares and service. PH25/130 overdue 48K BHD since Dec 2025.',
  });
  await pause();

  // ALBA — Aluminium Bahrain
  await conn.reducers.upsertParty({
    id: 4n,
    name: 'Aluminium Bahrain (ALBA)',
    isCustomer: true,
    isSupplier: false,
    grade: { tag: 'B' },
    creditLimitFils: bhd(50_000),
    paymentTermsDays: 30n,
    productTypes: 'Flow Meters, Temperature Sensors, Level Instruments',
    annualGoalFils: bhd(100_000),
    notes: 'World-class aluminium smelter. Line 6 expansion driving new instrumentation demand. Active 2026 PO on ORD-2026-017.',
  });
  await pause();

  // SULB Bahrain — Steel plant
  await conn.reducers.upsertParty({
    id: 5n,
    name: 'SULB Bahrain',
    isCustomer: true,
    isSupplier: false,
    grade: { tag: 'B' },
    creditLimitFils: bhd(40_000),
    paymentTermsDays: 30n,
    productTypes: 'Flow Meters, Pressure Transmitters, Gas Analyzers',
    annualGoalFils: bhd(60_000),
    notes: 'Saudi-UK joint venture steel plant, Hidd. Good payment history. 2026 Opp 303 worth 49K BHD under evaluation.',
  });
  await pause();

  // Arla Foods Bahrain
  await conn.reducers.upsertParty({
    id: 6n,
    name: 'Arla Foods Bahrain S.P.C',
    isCustomer: true,
    isSupplier: false,
    grade: { tag: 'B' },
    creditLimitFils: bhd(30_000),
    paymentTermsDays: 30n,
    productTypes: 'Flow Meters, Hygenic Instruments, CIP Monitoring',
    annualGoalFils: bhd(40_000),
    notes: 'Dairy manufacturing plant, Bahrain. Regular orders for hygienic E+H instruments. Multiple overdue invoices (PH25/144, 145, 146, 157) totaling ~28K BHD.',
  });
  await pause();

  // GPIC — Gulf Petrochemicals
  await conn.reducers.upsertParty({
    id: 7n,
    name: 'Gulf Petrochemical Industries Co (GPIC)',
    isCustomer: true,
    isSupplier: false,
    grade: { tag: 'B' },
    creditLimitFils: bhd(60_000),
    paymentTermsDays: 30n,
    productTypes: 'Pressure Transmitters, Analyzers, Flow Meters',
    annualGoalFils: bhd(80_000),
    notes: 'Joint venture SABIC/BAPCO/Petrogas. Steady instrumentation replacement and upgrade business. 2026 ORD-2026-016 active.',
  });
  await pause();

  // TTSJV — Tatweer-Total JV
  await conn.reducers.upsertParty({
    id: 8n,
    name: 'TTSJV',
    isCustomer: true,
    isSupplier: false,
    grade: { tag: 'B' },
    creditLimitFils: bhd(40_000),
    paymentTermsDays: 30n,
    productTypes: 'Level Instruments, Flow Meters, Analyzers',
    annualGoalFils: bhd(50_000),
    notes: 'Tatweer-Total Slab Joint Venture. Regular instrumentation buyer. 2026 Opp 27 (12K) and Opp 18 (12K) both under evaluation.',
  });
  await pause();

  // Tabreed — National Central Cooling
  await conn.reducers.upsertParty({
    id: 9n,
    name: 'Tabreed (National Central Cooling)',
    isCustomer: true,
    isSupplier: false,
    grade: { tag: 'B' },
    creditLimitFils: bhd(30_000),
    paymentTermsDays: 30n,
    productTypes: 'Flow Meters, Cooling Water Instruments',
    annualGoalFils: bhd(35_000),
    notes: 'National central cooling company. 2025 Opp 113 (26K BHD) PO/LOI received. 2026 ORD-2026-001 confirmed.',
  });
  await pause();

  // Ministry of Works
  await conn.reducers.upsertParty({
    id: 10n,
    name: 'Ministry of Works',
    isCustomer: true,
    isSupplier: false,
    grade: { tag: 'B' },
    creditLimitFils: bhd(50_000),
    paymentTermsDays: 30n,
    productTypes: 'Flow Meters, Water Monitoring, SCADA Sensors',
    annualGoalFils: bhd(100_000),
    notes: 'Bahrain Ministry of Works. Large 2025 pipeline: Opp 239 (175K BHD) under evaluation. Lost Opp 234 (163K) to competitor. Key Ebin account.',
  });
  await pause();

  // NOMAC — National Operations & Maintenance
  await conn.reducers.upsertParty({
    id: 11n,
    name: 'NOMAC',
    isCustomer: true,
    isSupplier: false,
    grade: { tag: 'B' },
    creditLimitFils: bhd(25_000),
    paymentTermsDays: 30n,
    productTypes: 'Power Plant Instruments, Flow Meters, Pressure',
    annualGoalFils: bhd(30_000),
    notes: 'National O&M company. 2026 ORD-2026-015 confirmed. PH25/153 overdue 622 BHD since Jan 2026.',
  });
  await pause();

  // Seapeak (Bahrain LNG)
  await conn.reducers.upsertParty({
    id: 12n,
    name: 'Bahrain LNG / Seapeak',
    isCustomer: true,
    isSupplier: false,
    grade: { tag: 'B' },
    creditLimitFils: bhd(20_000),
    paymentTermsDays: 30n,
    productTypes: 'Cryogenic Instruments, Flow Meters, Level',
    annualGoalFils: bhd(25_000),
    notes: 'LNG terminal operator. Two 2025 orders delivered. PH25/102 overdue since Sep 2025 (10.6K BHD).',
  });
  await pause();

  // BAHRAIN STEEL BSC (EC) — includes SULB context
  await conn.reducers.upsertParty({
    id: 13n,
    name: 'BAHRAIN STEEL BSC C (EC)',
    isCustomer: true,
    isSupplier: false,
    grade: { tag: 'B' },
    creditLimitFils: bhd(25_000),
    paymentTermsDays: 30n,
    productTypes: 'Flow Meters, Temperature Sensors, Pressure',
    annualGoalFils: bhd(30_000),
    notes: 'Bahrain Steel. ORD-PH25/079 delivered (20K BHD). PH25/079 paid. Ebin account.',
  });
  await pause();

  // Yateem Group
  await conn.reducers.upsertParty({
    id: 14n,
    name: 'Yateem Group',
    isCustomer: true,
    isSupplier: false,
    grade: { tag: 'B' },
    creditLimitFils: bhd(250_000),
    paymentTermsDays: 30n,
    productTypes: 'Full Range — EPC contractor',
    annualGoalFils: bhd(300_000),
    notes: 'Major Bahrain EPC and trading group. Largest single confirmed 2026 order: ORD-2026-011 (194K BHD). Watch credit limit carefully.',
  });
  await pause();

  // AHS Trading
  await conn.reducers.upsertParty({
    id: 15n,
    name: 'AHS Trading W.L.L',
    isCustomer: true,
    isSupplier: false,
    grade: { tag: 'B' },
    creditLimitFils: bhd(30_000),
    paymentTermsDays: 30n,
    productTypes: 'Flow Meters, Control Valves',
    annualGoalFils: bhd(30_000),
    notes: 'Trading company. PH25/116 overdue (24.7K BHD since Oct 2025). Chase via Abhie directly.',
  });
  await pause();

  // Muharraq Wastewater Services
  await conn.reducers.upsertParty({
    id: 16n,
    name: 'Muharraq Wastewater Services Co',
    isCustomer: true,
    isSupplier: false,
    grade: { tag: 'B' },
    creditLimitFils: bhd(20_000),
    paymentTermsDays: 30n,
    productTypes: 'Flow Meters, Level, Water Quality Analyzers',
    annualGoalFils: bhd(20_000),
    notes: 'Wastewater utility. Lost big Opp 53 (112K BHD) in 2024 on budget. Smaller active orders in 2025.',
  });
  await pause();

  // BANAGAS
  await conn.reducers.upsertParty({
    id: 17n,
    name: 'BANAGAS',
    isCustomer: true,
    isSupplier: false,
    grade: { tag: 'A' },
    creditLimitFils: bhd(30_000),
    paymentTermsDays: 0n,
    productTypes: 'Gas Analyzers, Flow Meters, Pressure',
    annualGoalFils: bhd(40_000),
    notes: 'Bahrain National Gas Company. Grade A customer with advance payment terms. Opp 201 (2024) won and paid.',
  });
  await pause();

  // NOGA — National Oil & Gas Authority
  await conn.reducers.upsertParty({
    id: 18n,
    name: 'NOGA',
    isCustomer: true,
    isSupplier: false,
    grade: { tag: 'A' },
    creditLimitFils: bhd(150_000),
    paymentTermsDays: 0n,
    productTypes: 'Full Range — Regulatory framework contracts',
    annualGoalFils: bhd(200_000),
    notes: 'National Oil and Gas Authority. Largest strategic account. Advance payment terms. Framework contract potential.',
  });
  await pause();

  // Veolia Water Technologies
  await conn.reducers.upsertParty({
    id: 19n,
    name: 'Veolia Water Technologies',
    isCustomer: true,
    isSupplier: false,
    grade: { tag: 'B' },
    creditLimitFils: bhd(25_000),
    paymentTermsDays: 30n,
    productTypes: 'Flow Meters, Water Quality, Dosing',
    annualGoalFils: bhd(25_000),
    notes: 'Water treatment company. 2026 orders ORD-2026-005 and ORD-2026-019 confirmed. Lost one deal to competitor in 2025.',
  });
  await pause();

  // JAHECON W.L.L
  await conn.reducers.upsertParty({
    id: 20n,
    name: 'JAHECON W.L.L',
    isCustomer: true,
    isSupplier: false,
    grade: { tag: 'B' },
    creditLimitFils: bhd(10_000),
    paymentTermsDays: 30n,
    productTypes: 'Flow Meters, Pressure',
    annualGoalFils: bhd(10_000),
    notes: 'Construction company. PH25/119 overdue (4.7K BHD since Oct 2025).',
  });
  await pause();

  // ── Suppliers ──────────────────────────────────────────────────────────────

  // Endress+Hauser AG — primary principal
  await conn.reducers.upsertParty({
    id: 21n,
    name: 'Endress+Hauser AG',
    isCustomer: false,
    isSupplier: true,
    grade: { tag: 'A' },
    creditLimitFils: 0n,
    paymentTermsDays: 60n,
    productTypes: 'Flow, Level, Pressure, Temperature, Analytics — Complete E+H Range',
    annualGoalFils: 0n,
    notes: 'Swiss principal. PH Trading is authorised E+H distributor for Bahrain. Gold rebate tier. Primary strategic supplier — ~85% of PH revenue goes through E+H.',
  });
  await pause();

  // Servomex Ltd
  await conn.reducers.upsertParty({
    id: 22n,
    name: 'Servomex Ltd',
    isCustomer: false,
    isSupplier: true,
    grade: { tag: 'A' },
    creditLimitFils: 0n,
    paymentTermsDays: 45n,
    productTypes: 'Gas Analyzers, Oxygen Sensors, Combustion Analyzers',
    annualGoalFils: 0n,
    notes: 'UK principal. High-margin gas analysis brand. Ideal for BAPCO refinery gas lines. Payment to Servomex net 45 days from shipment.',
  });
  await pause();

  // Landis+Gyr AG
  await conn.reducers.upsertParty({
    id: 23n,
    name: 'Landis+Gyr AG',
    isCustomer: false,
    isSupplier: true,
    grade: { tag: 'B' },
    creditLimitFils: 0n,
    paymentTermsDays: 60n,
    productTypes: 'Energy Metering, Smart Meters, Grid Sensors',
    annualGoalFils: 0n,
    notes: 'Swiss energy metering supplier. ORD-PH25/058 was a 61K BHD pass-through order. Occasional large orders for EWA smart metering projects.',
  });
  await pause();

  // GIC India
  await conn.reducers.upsertParty({
    id: 24n,
    name: 'GIC India',
    isCustomer: false,
    isSupplier: true,
    grade: { tag: 'B' },
    creditLimitFils: 0n,
    paymentTermsDays: 30n,
    productTypes: 'Industrial Instruments, Pressure Gauges, Thermowells',
    annualGoalFils: 0n,
    notes: 'Indian instrument supplier for lower-margin commodity items. Used when E+H price not competitive. 100% advance payment required.',
  });
  await pause();

  // Yokogawa Electric
  await conn.reducers.upsertParty({
    id: 25n,
    name: 'Yokogawa Electric Corporation',
    isCustomer: false,
    isSupplier: true,
    grade: { tag: 'B' },
    creditLimitFils: 0n,
    paymentTermsDays: 60n,
    productTypes: 'DCS, Recorders, Pressure Transmitters, Flowmeters',
    annualGoalFils: 0n,
    notes: 'Japanese principal. Installed base at ALBA and TTSJV. Opp 177 (2025) worth 50K BHD under evaluation for YOKOGAWA supply. Sundar managing.',
  });
  await pause();

  console.log('[seed] Parties done (25)');

  // ── 2. Contacts ───────────────────────────────────────────────────────────
  //
  // Reducer: upsert_contact
  // Params:  id, partyId, name, designation, phone, email, isWhatsApp
  //
  console.log('[seed] 2/7 — Creating 15 contacts...');

  // EWA contacts (partyId=1)
  await conn.reducers.upsertContact({
    id: 1n,
    partyId: 1n,
    name: 'Hassan Al-Khayat',
    designation: 'Senior Procurement Engineer',
    phone: '+973-1752-3300',
    email: 'h.alkhayat@ewa.bh',
    isWhatsApp: true,
  });
  await pause();

  await conn.reducers.upsertContact({
    id: 2n,
    partyId: 1n,
    name: 'Noora Al-Shehabi',
    designation: 'Instrumentation Contracts Manager',
    phone: '+973-1752-3301',
    email: 'n.alshehabi@ewa.bh',
    isWhatsApp: false,
  });
  await pause();

  // Bapco contacts (partyId=2)
  await conn.reducers.upsertContact({
    id: 3n,
    partyId: 2n,
    name: 'Ahmed Al-Khalifa',
    designation: 'Procurement Manager',
    phone: '+973-1774-5500',
    email: 'ahmed.alkhalifa@bapco.net',
    isWhatsApp: true,
  });
  await pause();

  await conn.reducers.upsertContact({
    id: 4n,
    partyId: 2n,
    name: 'Fatima Hassan',
    designation: 'Senior Instrument Engineer',
    phone: '+973-1774-5501',
    email: 'f.hassan@bapco.net',
    isWhatsApp: false,
  });
  await pause();

  // Al Ezzel contacts (partyId=3)
  await conn.reducers.upsertContact({
    id: 5n,
    partyId: 3n,
    name: 'Suresh Nair',
    designation: 'O&M Supervisor — Instrumentation',
    phone: '+973-3946-1122',
    email: 's.nair@alezzel.com',
    isWhatsApp: true,
  });
  await pause();

  // ALBA contacts (partyId=4)
  await conn.reducers.upsertContact({
    id: 6n,
    partyId: 4n,
    name: 'Rashid Malik',
    designation: 'Purchase Head',
    phone: '+973-1783-0001',
    email: 'r.malik@alba.com.bh',
    isWhatsApp: true,
  });
  await pause();

  // GPIC contacts (partyId=7)
  await conn.reducers.upsertContact({
    id: 7n,
    partyId: 7n,
    name: 'Yusuf Al-Doseri',
    designation: 'Engineering Manager',
    phone: '+973-1773-1234',
    email: 'yusuf@gpic.com',
    isWhatsApp: true,
  });
  await pause();

  // Tabreed contacts (partyId=9)
  await conn.reducers.upsertContact({
    id: 8n,
    partyId: 9n,
    name: 'Pradeep Kumar',
    designation: 'Instrument Technician Lead',
    phone: '+973-3956-7788',
    email: 'p.kumar@tabreed.ae',
    isWhatsApp: true,
  });
  await pause();

  // Ministry of Works contacts (partyId=10)
  await conn.reducers.upsertContact({
    id: 9n,
    partyId: 10n,
    name: 'Khalid Al-Mannai',
    designation: 'Senior Projects Engineer',
    phone: '+973-1754-9900',
    email: 'k.almannai@works.gov.bh',
    isWhatsApp: false,
  });
  await pause();

  // NOGA contacts (partyId=18)
  await conn.reducers.upsertContact({
    id: 10n,
    partyId: 18n,
    name: 'Sara Al-Sayed',
    designation: 'Projects Director',
    phone: '+973-1756-7890',
    email: 'sara.alsayed@noga.gov.bh',
    isWhatsApp: true,
  });
  await pause();

  // Endress+Hauser contacts (partyId=21)
  await conn.reducers.upsertContact({
    id: 11n,
    partyId: 21n,
    name: 'Thomas Mueller',
    designation: 'Regional Sales Manager — MENA',
    phone: '+41-61-715-1111',
    email: 'thomas.mueller@endress.com',
    isWhatsApp: false,
  });
  await pause();

  await conn.reducers.upsertContact({
    id: 12n,
    partyId: 21n,
    name: 'Ravi Shankar',
    designation: 'Application Specialist — Flow, Gulf',
    phone: '+971-4-887-1200',
    email: 'ravi.shankar@endress.com',
    isWhatsApp: true,
  });
  await pause();

  // Servomex contacts (partyId=22)
  await conn.reducers.upsertContact({
    id: 13n,
    partyId: 22n,
    name: 'Sarah Williams',
    designation: 'MENA Sales Director',
    phone: '+44-1444-370-000',
    email: 'sarah.williams@servomex.com',
    isWhatsApp: false,
  });
  await pause();

  // Yateem Group contacts (partyId=14)
  await conn.reducers.upsertContact({
    id: 14n,
    partyId: 14n,
    name: 'Zaid Yateem',
    designation: 'Procurement Manager',
    phone: '+973-1721-5588',
    email: 'z.yateem@yateemgroup.com',
    isWhatsApp: true,
  });
  await pause();

  // AHS Trading contacts (partyId=15)
  await conn.reducers.upsertContact({
    id: 15n,
    partyId: 15n,
    name: 'Vijay Anand',
    designation: 'Commercial Manager',
    phone: '+973-3989-4433',
    email: 'vijay@ahstrading.com',
    isWhatsApp: true,
  });
  await pause();

  console.log('[seed] Contacts done (15)');

  // ── 3. Pipelines ──────────────────────────────────────────────────────────
  //
  // Reducer: advance_pipeline
  // Params:  id, partyId, title, newStatus, estimatedValueFils,
  //          winProbabilityBps, competitorPresent, oemPriceFils,
  //          markupBps, additionalCostsFils, costingApproved,
  //          offerSentAt, lossReason, nextFollowUp
  //
  // winProbabilityBps: basis points out of 10000 (7500 = 75%)
  // markupBps:         markup on OEM price in basis points (1666 = 16.66%)
  //
  // Pipeline ID map (for order references):
  //  1  = Bapco 2026 large analyser (Opp 307, 197K)
  //  2  = Bapco 2025 in-process (Opp 90, 97K)
  //  3  = Ministry of Works large 2025 (Opp 239, 175K)
  //  4  = Yateem 2026 ORD-011 (won — link to order)
  //  5  = Al Ezzel 2025 won (link to ORD-PH25/076)
  //  6  = GPIC 2024 won (Opp 200, 92K)
  //  7  = ALBA 2026 ORD-017 won
  //  8  = SULB 2025 shipped (Opp-PH25/036)
  //  9  = Arla Foods 2026 ORD-008 active
  //  10 = GPIC 2026 ORD-016 active
  //  11 = Tabreed 2025 PO/LOI received (Opp 113)
  //  12 = EWA 2026 ORD-003 active
  //  13 = Ministry of Works — lost (Opp 234, 163K)
  //  14 = Muharraq — lost big (Opp 53, 112K)
  //  15 = Bapco 2025 lost (15K, product not suitable)
  //  16 = Bapco 2026 Opp 15 (103K, evaluation)
  //  17 = TTSJV 2026 Opp 27 (12K, evaluation)
  //  18 = Bapco 2026 Opp 18 (active ORD-2026-018)
  //  19 = Seapeak 2025 ORD-PH25/061 won
  //  20 = Bahrain Steel 2025 won (Opp 84, ORD-PH25/079)
  //  21 = NOMAC 2026 ORD-015 active
  //  22 = Tabreed 2026 ORD-001
  //  23 = Veolia 2026 ORD-005
  //  24 = ALBA lost 2025 (15K)
  //  25 = Bapco Prudent Valve 2026 Opp 310 (181K)
  //
  console.log('[seed] 3/7 — Creating 25 pipelines...');

  // Pipeline 1: Bapco 2026 large analyser package (Opp 307, Follow-up)
  await conn.reducers.advancePipeline({
    id: 1n,
    partyId: 2n,
    title: 'Bapco Refining — Process Analyser Package 2026 (Opp 307)',
    newStatus: { tag: 'Active' },
    estimatedValueFils: bhd(197_527),
    winProbabilityBps: 5500n,
    competitorPresent: true,
    oemPriceFils: bhd(148_000),
    markupBps: 3333n,
    additionalCostsFils: bhd(2_500),
    costingApproved: false,
    offerSentAt: ts(2026, 1, 20),
    lossReason: undefined,
    nextFollowUp: daysFromNow(14),
  });
  await pause();

  // Pipeline 2: Bapco 2025 large in-process (Opp 90, 96K BHD)
  await conn.reducers.advancePipeline({
    id: 2n,
    partyId: 2n,
    title: 'Bapco Refining — Train 4 Instrument Replacement (Opp 90)',
    newStatus: { tag: 'InProgress' },
    estimatedValueFils: bhd(96_968),
    winProbabilityBps: 8000n,
    competitorPresent: false,
    oemPriceFils: bhd(74_000),
    markupBps: 3107n,
    additionalCostsFils: bhd(1_200),
    costingApproved: true,
    offerSentAt: ts(2025, 8, 15),
    lossReason: undefined,
    nextFollowUp: daysFromNow(7),
  });
  await pause();

  // Pipeline 3: Ministry of Works — large 2025 evaluation (Opp 239, 175K)
  await conn.reducers.advancePipeline({
    id: 3n,
    partyId: 10n,
    title: 'Ministry of Works — Network Flow Meters Phase 3 (Opp 239)',
    newStatus: { tag: 'Active' },
    estimatedValueFils: bhd(175_968),
    winProbabilityBps: 4500n,
    competitorPresent: true,
    oemPriceFils: bhd(132_000),
    markupBps: 3333n,
    additionalCostsFils: bhd(3_000),
    costingApproved: false,
    offerSentAt: ts(2025, 11, 5),
    lossReason: undefined,
    nextFollowUp: daysFromNow(21),
  });
  await pause();

  // Pipeline 4: Yateem 2026 — won, linked to ORD-2026-011
  await conn.reducers.advancePipeline({
    id: 4n,
    partyId: 14n,
    title: 'Yateem Group — Industrial Instrumentation Supply 2026 (ORD-2026-011)',
    newStatus: { tag: 'Terminal' },
    estimatedValueFils: bhd(194_878.20),
    winProbabilityBps: 10000n,
    competitorPresent: false,
    oemPriceFils: bhd(150_000),
    markupBps: 2991n,
    additionalCostsFils: bhd(2_000),
    costingApproved: true,
    offerSentAt: ts(2026, 1, 15),
    lossReason: undefined,
    nextFollowUp: undefined,
  });
  await pause();

  // Pipeline 5: Al Ezzel 2025 won (Opp 5, 14K BHD) — linked to ORD-PH25/076
  await conn.reducers.advancePipeline({
    id: 5n,
    partyId: 3n,
    title: 'Al Ezzel O&M — Annual Instrument Supply Contract 2025 (Opp 5)',
    newStatus: { tag: 'Terminal' },
    estimatedValueFils: bhd(111_355.20),
    winProbabilityBps: 10000n,
    competitorPresent: false,
    oemPriceFils: bhd(86_000),
    markupBps: 2947n,
    additionalCostsFils: bhd(1_500),
    costingApproved: true,
    offerSentAt: ts(2025, 3, 10),
    lossReason: undefined,
    nextFollowUp: undefined,
  });
  await pause();

  // Pipeline 6: GPIC 2024 won — Opp 200 (92K BHD)
  await conn.reducers.advancePipeline({
    id: 6n,
    partyId: 7n,
    title: 'GPIC — Pressure Transmitter Replacement Programme 2024 (Opp 200)',
    newStatus: { tag: 'Terminal' },
    estimatedValueFils: bhd(92_536),
    winProbabilityBps: 10000n,
    competitorPresent: false,
    oemPriceFils: bhd(72_000),
    markupBps: 2850n,
    additionalCostsFils: bhd(1_000),
    costingApproved: true,
    offerSentAt: ts(2024, 6, 1),
    lossReason: undefined,
    nextFollowUp: undefined,
  });
  await pause();

  // Pipeline 7: ALBA 2026 won — ORD-2026-017
  await conn.reducers.advancePipeline({
    id: 7n,
    partyId: 4n,
    title: 'ALBA — RTD & Flow Instrument Spares FY26 (ORD-2026-017)',
    newStatus: { tag: 'Terminal' },
    estimatedValueFils: bhd(28_900.25),
    winProbabilityBps: 10000n,
    competitorPresent: false,
    oemPriceFils: bhd(22_000),
    markupBps: 3136n,
    additionalCostsFils: bhd(350),
    costingApproved: true,
    offerSentAt: ts(2026, 1, 25),
    lossReason: undefined,
    nextFollowUp: undefined,
  });
  await pause();

  // Pipeline 8: SULB 2025 shipped — ORD-PH25/036
  await conn.reducers.advancePipeline({
    id: 8n,
    partyId: 5n,
    title: 'SULB Bahrain — Coriolis Flow Meter Upgrade 2025 (ORD-PH25/036)',
    newStatus: { tag: 'InProgress' },
    estimatedValueFils: bhd(28_291.21),
    winProbabilityBps: 9800n,
    competitorPresent: false,
    oemPriceFils: bhd(22_500),
    markupBps: 2574n,
    additionalCostsFils: bhd(400),
    costingApproved: true,
    offerSentAt: ts(2025, 2, 20),
    lossReason: undefined,
    nextFollowUp: daysFromNow(5),
  });
  await pause();

  // Pipeline 9: Arla Foods 2026 active — ORD-2026-008
  await conn.reducers.advancePipeline({
    id: 9n,
    partyId: 6n,
    title: 'Arla Foods — Hygienic Flow & Level Instruments 2026 (ORD-2026-008)',
    newStatus: { tag: 'Active' },
    estimatedValueFils: bhd(16_604.50),
    winProbabilityBps: 9000n,
    competitorPresent: false,
    oemPriceFils: bhd(12_800),
    markupBps: 2972n,
    additionalCostsFils: bhd(200),
    costingApproved: true,
    offerSentAt: ts(2026, 1, 28),
    lossReason: undefined,
    nextFollowUp: daysFromNow(10),
  });
  await pause();

  // Pipeline 10: GPIC 2026 active — ORD-2026-016
  await conn.reducers.advancePipeline({
    id: 10n,
    partyId: 7n,
    title: 'GPIC — Gas Analyser & Transmitter Supply 2026 (ORD-2026-016)',
    newStatus: { tag: 'Active' },
    estimatedValueFils: bhd(15_750.50),
    winProbabilityBps: 8500n,
    competitorPresent: false,
    oemPriceFils: bhd(12_000),
    markupBps: 3125n,
    additionalCostsFils: bhd(200),
    costingApproved: true,
    offerSentAt: ts(2026, 1, 30),
    lossReason: undefined,
    nextFollowUp: daysFromNow(7),
  });
  await pause();

  // Pipeline 11: Tabreed 2025 PO/LOI received (Opp 113, 26K BHD)
  await conn.reducers.advancePipeline({
    id: 11n,
    partyId: 9n,
    title: 'Tabreed — Cooling Water Flow Meters Phase 2 (Opp 113)',
    newStatus: { tag: 'InProgress' },
    estimatedValueFils: bhd(26_000),
    winProbabilityBps: 9500n,
    competitorPresent: false,
    oemPriceFils: bhd(20_000),
    markupBps: 3000n,
    additionalCostsFils: bhd(300),
    costingApproved: true,
    offerSentAt: ts(2025, 9, 10),
    lossReason: undefined,
    nextFollowUp: daysFromNow(14),
  });
  await pause();

  // Pipeline 12: EWA 2026 ORD-003
  await conn.reducers.advancePipeline({
    id: 12n,
    partyId: 1n,
    title: 'EWA — Electromagnetic Flow Meter Supply 2026 (ORD-2026-003)',
    newStatus: { tag: 'Terminal' },
    estimatedValueFils: bhd(19_855),
    winProbabilityBps: 10000n,
    competitorPresent: false,
    oemPriceFils: bhd(15_200),
    markupBps: 3059n,
    additionalCostsFils: bhd(300),
    costingApproved: true,
    offerSentAt: ts(2025, 12, 15),
    lossReason: undefined,
    nextFollowUp: undefined,
  });
  await pause();

  // Pipeline 13: Ministry of Works — LOST 2025 (Opp 234, 163K BHD)
  await conn.reducers.advancePipeline({
    id: 13n,
    partyId: 10n,
    title: 'Ministry of Works — Network Flow Meters Phase 2 LOST (Opp 234)',
    newStatus: { tag: 'Cancelled' },
    estimatedValueFils: bhd(163_262),
    winProbabilityBps: 0n,
    competitorPresent: true,
    oemPriceFils: bhd(124_000),
    markupBps: 3166n,
    additionalCostsFils: bhd(2_500),
    costingApproved: false,
    offerSentAt: ts(2025, 7, 15),
    lossReason: 'Competitor Offered Better Price',
    nextFollowUp: undefined,
  });
  await pause();

  // Pipeline 14: Muharraq — LOST large 2024 (Opp 53, 112K BHD)
  await conn.reducers.advancePipeline({
    id: 14n,
    partyId: 16n,
    title: 'Muharraq Wastewater — WWTP Instrument Package LOST (Opp 53)',
    newStatus: { tag: 'Cancelled' },
    estimatedValueFils: bhd(111_949.90),
    winProbabilityBps: 0n,
    competitorPresent: true,
    oemPriceFils: bhd(86_000),
    markupBps: 3012n,
    additionalCostsFils: bhd(1_800),
    costingApproved: false,
    offerSentAt: ts(2024, 9, 1),
    lossReason: "Customer's Budget Constraints",
    nextFollowUp: undefined,
  });
  await pause();

  // Pipeline 15: Bapco 2025 LOST — product not suitable
  await conn.reducers.advancePipeline({
    id: 15n,
    partyId: 2n,
    title: 'Bapco Refining — H2S Detector Replacement LOST 2025',
    newStatus: { tag: 'Cancelled' },
    estimatedValueFils: bhd(15_276.80),
    winProbabilityBps: 0n,
    competitorPresent: true,
    oemPriceFils: bhd(11_500),
    markupBps: 3283n,
    additionalCostsFils: bhd(200),
    costingApproved: false,
    offerSentAt: ts(2025, 4, 5),
    lossReason: 'Product Not Suitable',
    nextFollowUp: undefined,
  });
  await pause();

  // Pipeline 16: Bapco 2026 Opp 15 (103K BHD, evaluation)
  await conn.reducers.advancePipeline({
    id: 16n,
    partyId: 2n,
    title: 'Bapco Refining — CDU Instrument Upgrade Package (Opp 15)',
    newStatus: { tag: 'Active' },
    estimatedValueFils: bhd(103_915.90),
    winProbabilityBps: 5000n,
    competitorPresent: true,
    oemPriceFils: bhd(80_000),
    markupBps: 2989n,
    additionalCostsFils: bhd(1_500),
    costingApproved: false,
    offerSentAt: ts(2026, 2, 10),
    lossReason: undefined,
    nextFollowUp: daysFromNow(21),
  });
  await pause();

  // Pipeline 17: TTSJV 2026 Opp 27 (12K BHD, evaluation)
  await conn.reducers.advancePipeline({
    id: 17n,
    partyId: 8n,
    title: 'TTSJV — Level Transmitter Replacement 2026 (Opp 27)',
    newStatus: { tag: 'Active' },
    estimatedValueFils: bhd(12_272.70),
    winProbabilityBps: 7000n,
    competitorPresent: false,
    oemPriceFils: bhd(9_500),
    markupBps: 2918n,
    additionalCostsFils: bhd(150),
    costingApproved: false,
    offerSentAt: ts(2026, 1, 22),
    lossReason: undefined,
    nextFollowUp: daysFromNow(10),
  });
  await pause();

  // Pipeline 18: Bapco 2026 ORD-018 active (42.5K BHD)
  await conn.reducers.advancePipeline({
    id: 18n,
    partyId: 2n,
    title: 'Bapco Refining — Pressure Transmitter Blanket 2026 (ORD-2026-018)',
    newStatus: { tag: 'Terminal' },
    estimatedValueFils: bhd(42_500),
    winProbabilityBps: 10000n,
    competitorPresent: false,
    oemPriceFils: bhd(33_000),
    markupBps: 2878n,
    additionalCostsFils: bhd(500),
    costingApproved: true,
    offerSentAt: ts(2026, 2, 1),
    lossReason: undefined,
    nextFollowUp: undefined,
  });
  await pause();

  // Pipeline 19: Seapeak 2025 ORD-PH25/061 won (14.8K BHD)
  await conn.reducers.advancePipeline({
    id: 19n,
    partyId: 12n,
    title: 'Bahrain LNG — Cryogenic Level Instruments Supply (ORD-PH25/061)',
    newStatus: { tag: 'Terminal' },
    estimatedValueFils: bhd(14_876.40),
    winProbabilityBps: 10000n,
    competitorPresent: false,
    oemPriceFils: bhd(11_500),
    markupBps: 2936n,
    additionalCostsFils: bhd(200),
    costingApproved: true,
    offerSentAt: ts(2025, 3, 15),
    lossReason: undefined,
    nextFollowUp: undefined,
  });
  await pause();

  // Pipeline 20: Bahrain Steel 2025 won (ORD-PH25/079, 20.2K BHD)
  await conn.reducers.advancePipeline({
    id: 20n,
    partyId: 13n,
    title: 'Bahrain Steel BSCC — Flow Meter Supply Package (ORD-PH25/079)',
    newStatus: { tag: 'Terminal' },
    estimatedValueFils: bhd(20_240),
    winProbabilityBps: 10000n,
    competitorPresent: false,
    oemPriceFils: bhd(15_500),
    markupBps: 3058n,
    additionalCostsFils: bhd(250),
    costingApproved: true,
    offerSentAt: ts(2025, 5, 20),
    lossReason: undefined,
    nextFollowUp: undefined,
  });
  await pause();

  // Pipeline 21: NOMAC 2026 ORD-015 active
  await conn.reducers.advancePipeline({
    id: 21n,
    partyId: 11n,
    title: 'NOMAC — Power Plant Instrument Spares 2026 (ORD-2026-015)',
    newStatus: { tag: 'Active' },
    estimatedValueFils: bhd(9_603),
    winProbabilityBps: 9000n,
    competitorPresent: false,
    oemPriceFils: bhd(7_400),
    markupBps: 2973n,
    additionalCostsFils: bhd(120),
    costingApproved: true,
    offerSentAt: ts(2026, 1, 18),
    lossReason: undefined,
    nextFollowUp: daysFromNow(14),
  });
  await pause();

  // Pipeline 22: Tabreed 2026 ORD-001 active
  await conn.reducers.advancePipeline({
    id: 22n,
    partyId: 9n,
    title: 'Tabreed — Cooling Sensor Replacement 2026 (ORD-2026-001)',
    newStatus: { tag: 'Terminal' },
    estimatedValueFils: bhd(5_351.50),
    winProbabilityBps: 10000n,
    competitorPresent: false,
    oemPriceFils: bhd(4_100),
    markupBps: 3052n,
    additionalCostsFils: bhd(80),
    costingApproved: true,
    offerSentAt: ts(2026, 1, 10),
    lossReason: undefined,
    nextFollowUp: undefined,
  });
  await pause();

  // Pipeline 23: Veolia Water 2026 ORD-005 active
  await conn.reducers.advancePipeline({
    id: 23n,
    partyId: 19n,
    title: 'Veolia Water Technologies — Water Treatment Instruments 2026 (ORD-2026-005)',
    newStatus: { tag: 'Terminal' },
    estimatedValueFils: bhd(15_588.10),
    winProbabilityBps: 10000n,
    competitorPresent: false,
    oemPriceFils: bhd(12_000),
    markupBps: 2990n,
    additionalCostsFils: bhd(200),
    costingApproved: true,
    offerSentAt: ts(2025, 11, 25),
    lossReason: undefined,
    nextFollowUp: undefined,
  });
  await pause();

  // Pipeline 24: ALBA 2025 LOST (Opp, 15K BHD, customer delays)
  await conn.reducers.advancePipeline({
    id: 24n,
    partyId: 4n,
    title: 'ALBA — Temperature Transmitter Upgrade LOST 2025',
    newStatus: { tag: 'Cancelled' },
    estimatedValueFils: bhd(15_048),
    winProbabilityBps: 0n,
    competitorPresent: true,
    oemPriceFils: bhd(11_500),
    markupBps: 3085n,
    additionalCostsFils: bhd(200),
    costingApproved: false,
    offerSentAt: ts(2025, 6, 1),
    lossReason: 'Customer Decision-Making Delays',
    nextFollowUp: undefined,
  });
  await pause();

  // Pipeline 25: Bapco 2026 Opp 310 via Prudent Valve (181K BHD)
  await conn.reducers.advancePipeline({
    id: 25n,
    partyId: 2n,
    title: 'Bapco — Control Valve Package via Prudent Valve 2026 (Opp 310)',
    newStatus: { tag: 'Active' },
    estimatedValueFils: bhd(181_663.90),
    winProbabilityBps: 4500n,
    competitorPresent: true,
    oemPriceFils: bhd(138_000),
    markupBps: 3163n,
    additionalCostsFils: bhd(3_000),
    costingApproved: false,
    offerSentAt: ts(2026, 2, 15),
    lossReason: undefined,
    nextFollowUp: daysFromNow(28),
  });
  await pause();

  console.log('[seed] Pipelines done (25)');

  // ── 4. Orders ─────────────────────────────────────────────────────────────
  //
  // Reducer: manage_order
  // Params:  id, partyId, pipelineId, newStatus, totalFils,
  //          poReference, expectedDelivery
  //
  // Order statuses map to EntityStatus:
  //   Delivered / Paid   → Terminal
  //   Processing/Shipped → InProgress
  //   Confirmed/Active   → Active
  //
  console.log('[seed] 4/7 — Creating 10 orders...');

  // ORD-2026-011 — Yateem Group, largest 2026 order (Confirmed → Active)
  await conn.reducers.manageOrder({
    id: 1n,
    partyId: 14n,
    pipelineId: 4n,
    newStatus: { tag: 'Active' },
    totalFils: bhd(194_878.20),
    poReference: '50-25',
    expectedDelivery: daysFromNow(60),
  });
  await pause();

  // ORD-PH25/076 — Al Ezzel large delivered order
  await conn.reducers.manageOrder({
    id: 2n,
    partyId: 3n,
    pipelineId: 5n,
    newStatus: { tag: 'Terminal' },
    totalFils: bhd(111_355.20),
    poReference: 'PH25/076',
    expectedDelivery: ts(2025, 7, 15),
  });
  await pause();

  // ORD-2026-018 — Bapco Refining pressure transmitter blanket
  await conn.reducers.manageOrder({
    id: 3n,
    partyId: 2n,
    pipelineId: 18n,
    newStatus: { tag: 'Active' },
    totalFils: bhd(42_500),
    poReference: 'PO-BAPCO-2026',
    expectedDelivery: daysFromNow(45),
  });
  await pause();

  // ORD-PH25/036 — SULB Bahrain shipped (InProgress)
  await conn.reducers.manageOrder({
    id: 4n,
    partyId: 5n,
    pipelineId: 8n,
    newStatus: { tag: 'InProgress' },
    totalFils: bhd(28_291.21),
    poReference: 'PH25/036',
    expectedDelivery: daysFromNow(14),
  });
  await pause();

  // ORD-2026-017 — ALBA spares (Confirmed → Active)
  await conn.reducers.manageOrder({
    id: 5n,
    partyId: 4n,
    pipelineId: 7n,
    newStatus: { tag: 'Active' },
    totalFils: bhd(28_900.25),
    poReference: 'PO-ALBA-2026',
    expectedDelivery: daysFromNow(50),
  });
  await pause();

  // ORD-PH25/130 — Al Ezzel (delivered, invoice overdue)
  await conn.reducers.manageOrder({
    id: 6n,
    partyId: 3n,
    pipelineId: 5n,
    newStatus: { tag: 'Terminal' },
    totalFils: bhd(44_066),
    poReference: 'PH25/130',
    expectedDelivery: ts(2025, 9, 20),
  });
  await pause();

  // ORD-2026-003 — EWA flow meters (Confirmed → Active)
  await conn.reducers.manageOrder({
    id: 7n,
    partyId: 1n,
    pipelineId: 12n,
    newStatus: { tag: 'Active' },
    totalFils: bhd(19_855),
    poReference: '1-25',
    expectedDelivery: daysFromNow(55),
  });
  await pause();

  // ORD-PH25/079 — Bahrain Steel (delivered, paid)
  await conn.reducers.manageOrder({
    id: 8n,
    partyId: 13n,
    pipelineId: 20n,
    newStatus: { tag: 'Terminal' },
    totalFils: bhd(20_240),
    poReference: 'PH25/079',
    expectedDelivery: ts(2025, 8, 10),
  });
  await pause();

  // ORD-2026-008 — Arla Foods 2026 (Confirmed → Active)
  await conn.reducers.manageOrder({
    id: 9n,
    partyId: 6n,
    pipelineId: 9n,
    newStatus: { tag: 'Active' },
    totalFils: bhd(16_604.50),
    poReference: '24-25',
    expectedDelivery: daysFromNow(40),
  });
  await pause();

  // ORD-PH25/061 — Seapeak (delivered, invoice overdue)
  await conn.reducers.manageOrder({
    id: 10n,
    partyId: 12n,
    pipelineId: 19n,
    newStatus: { tag: 'Terminal' },
    totalFils: bhd(14_876.40),
    poReference: 'PH25/061',
    expectedDelivery: ts(2025, 6, 30),
  });
  await pause();

  console.log('[seed] Orders done (10)');

  // ── 5. Money Events ───────────────────────────────────────────────────────
  //
  // Reducer: record_money_event
  // Params:  partyId, orderId (option), deliveryNoteId (option), kind,
  //          subtotalFils, reference, dueDate
  //
  // RC-5 semantics — see file header for VAT rules.
  //
  console.log('[seed] 5/7 — Recording 30 money events...');

  // ── Customer Invoices (15) ─────────────────────────────────────────────────

  // PH25/130 — Al Ezzel Engie O&M: OVERDUE since Dec 2025 (48,472.60 BHD)
  // subtotal = 48472.60 / 1.10 = 44,066 BHD
  await conn.reducers.recordMoneyEvent({
    partyId: 3n,
    orderId: 6n,
    deliveryNoteId: undefined,
    kind: { tag: 'CustomerInvoice' },
    subtotalFils: bhd(44_066),
    reference: 'PH25/130',
    dueDate: ts(2025, 12, 2),
  });
  await pause();

  // PH25/151 — Bapco Refining: OVERDUE no due date set (24,992.55 BHD)
  // subtotal = 24992.55 / 1.10 = 22,720.50 BHD
  await conn.reducers.recordMoneyEvent({
    partyId: 2n,
    orderId: 3n,
    deliveryNoteId: undefined,
    kind: { tag: 'CustomerInvoice' },
    subtotalFils: bhd(22_720.50),
    reference: 'PH25/151',
    dueDate: ts(2026, 1, 15),
  });
  await pause();

  // PH25/116 — AHS Trading: OVERDUE since Oct 2025 (24,722.72 BHD)
  await conn.reducers.recordMoneyEvent({
    partyId: 15n,
    orderId: undefined,
    deliveryNoteId: undefined,
    kind: { tag: 'CustomerInvoice' },
    subtotalFils: bhd(22_475.20),
    reference: 'PH25/116',
    dueDate: ts(2025, 10, 23),
  });
  await pause();

  // PH25/102 — Seapeak: OVERDUE since Sep 2025 (10,626.22 BHD)
  await conn.reducers.recordMoneyEvent({
    partyId: 12n,
    orderId: 10n,
    deliveryNoteId: undefined,
    kind: { tag: 'CustomerInvoice' },
    subtotalFils: bhd(9_660.20),
    reference: 'PH25/102',
    dueDate: ts(2025, 9, 30),
  });
  await pause();

  // PH25/144 — Arla Foods: OVERDUE since Jan 2026 (9,517.86 BHD)
  await conn.reducers.recordMoneyEvent({
    partyId: 6n,
    orderId: 9n,
    deliveryNoteId: undefined,
    kind: { tag: 'CustomerInvoice' },
    subtotalFils: bhd(8_652.60),
    reference: 'PH25/144',
    dueDate: ts(2026, 1, 8),
  });
  await pause();

  // PH25/157 — Arla Foods: OVERDUE since Jan 2026 (6,367.02 BHD)
  await conn.reducers.recordMoneyEvent({
    partyId: 6n,
    orderId: 9n,
    deliveryNoteId: undefined,
    kind: { tag: 'CustomerInvoice' },
    subtotalFils: bhd(5_788.20),
    reference: 'PH25/157',
    dueDate: ts(2026, 1, 30),
  });
  await pause();

  // PH25/119 — JAHECON: OVERDUE since Oct 2025 (4,719 BHD)
  await conn.reducers.recordMoneyEvent({
    partyId: 20n,
    orderId: undefined,
    deliveryNoteId: undefined,
    kind: { tag: 'CustomerInvoice' },
    subtotalFils: bhd(4_290),
    reference: 'PH25/119',
    dueDate: ts(2025, 10, 31),
  });
  await pause();

  // PH25/155 — Bapco Refining: OVERDUE (2,359.50 BHD)
  await conn.reducers.recordMoneyEvent({
    partyId: 2n,
    orderId: undefined,
    deliveryNoteId: undefined,
    kind: { tag: 'CustomerInvoice' },
    subtotalFils: bhd(2_145),
    reference: 'PH25/155',
    dueDate: ts(2025, 12, 31),
  });
  await pause();

  // PH25/153 — NOMAC: OVERDUE since Jan 2026 (622.90 BHD)
  await conn.reducers.recordMoneyEvent({
    partyId: 11n,
    orderId: undefined,
    deliveryNoteId: undefined,
    kind: { tag: 'CustomerInvoice' },
    subtotalFils: bhd(566.27),
    reference: 'PH25/153',
    dueDate: ts(2026, 1, 30),
  });
  await pause();

  // PH25/036 — SULB Bahrain: PAID (31,120.33 BHD)
  await conn.reducers.recordMoneyEvent({
    partyId: 5n,
    orderId: 4n,
    deliveryNoteId: undefined,
    kind: { tag: 'CustomerInvoice' },
    subtotalFils: bhd(28_291.21),
    reference: 'PH25/036',
    dueDate: ts(2025, 5, 15),
  });
  await pause();

  // PH25/079 — Bahrain Steel: PAID (22,264 BHD)
  await conn.reducers.recordMoneyEvent({
    partyId: 13n,
    orderId: 8n,
    deliveryNoteId: undefined,
    kind: { tag: 'CustomerInvoice' },
    subtotalFils: bhd(20_240),
    reference: 'PH25/079',
    dueDate: ts(2025, 9, 10),
  });
  await pause();

  // INV-2026-001 — Yateem Group: advance invoice 50% for ORD-2026-011
  await conn.reducers.recordMoneyEvent({
    partyId: 14n,
    orderId: 1n,
    deliveryNoteId: undefined,
    kind: { tag: 'CustomerInvoice' },
    subtotalFils: bhd(88_580),
    reference: 'INV-2026-001',
    dueDate: daysFromNow(30),
  });
  await pause();

  // INV-2026-003 — Bapco Refining: advance for ORD-2026-018
  await conn.reducers.recordMoneyEvent({
    partyId: 2n,
    orderId: 3n,
    deliveryNoteId: undefined,
    kind: { tag: 'CustomerInvoice' },
    subtotalFils: bhd(21_250),
    reference: 'INV-2026-003',
    dueDate: daysFromNow(15),
  });
  await pause();

  // INV-2026-004 — EWA: ORD-2026-003 invoice
  await conn.reducers.recordMoneyEvent({
    partyId: 1n,
    orderId: 7n,
    deliveryNoteId: undefined,
    kind: { tag: 'CustomerInvoice' },
    subtotalFils: bhd(19_855),
    reference: 'INV-2026-004',
    dueDate: daysFromNow(30),
  });
  await pause();

  // INV-2026-005 — ALBA: ORD-2026-017 advance
  await conn.reducers.recordMoneyEvent({
    partyId: 4n,
    orderId: 5n,
    deliveryNoteId: undefined,
    kind: { tag: 'CustomerInvoice' },
    subtotalFils: bhd(28_900.25),
    reference: 'INV-2026-005',
    dueDate: daysFromNow(45),
  });
  await pause();

  // ── Customer Payments (10) ────────────────────────────────────────────────

  // SULB paid PH25/036 in full
  await conn.reducers.recordMoneyEvent({
    partyId: 5n,
    orderId: 4n,
    deliveryNoteId: undefined,
    kind: { tag: 'CustomerPayment' },
    subtotalFils: bhd(31_120.33),
    reference: 'SULB-TT-20250520',
    dueDate: undefined,
  });
  await pause();

  // Bahrain Steel paid PH25/079 in full
  await conn.reducers.recordMoneyEvent({
    partyId: 13n,
    orderId: 8n,
    deliveryNoteId: undefined,
    kind: { tag: 'CustomerPayment' },
    subtotalFils: bhd(22_264),
    reference: 'BSTEEL-CHQ-20250915',
    dueDate: undefined,
  });
  await pause();

  // Bapco partial payment against PH25/151 (10K BHD paid)
  await conn.reducers.recordMoneyEvent({
    partyId: 2n,
    orderId: 3n,
    deliveryNoteId: undefined,
    kind: { tag: 'CustomerPayment' },
    subtotalFils: bhd(10_000),
    reference: 'BAPCO-TT-20260115',
    dueDate: undefined,
  });
  await pause();

  // Seapeak partial against PH25/102 (5K paid, still outstanding 5.6K)
  await conn.reducers.recordMoneyEvent({
    partyId: 12n,
    orderId: 10n,
    deliveryNoteId: undefined,
    kind: { tag: 'CustomerPayment' },
    subtotalFils: bhd(5_000),
    reference: 'SEAPEAK-TT-20251020',
    dueDate: undefined,
  });
  await pause();

  // GPIC payment for 2024 won deal (full payment, 92.5K BHD)
  await conn.reducers.recordMoneyEvent({
    partyId: 7n,
    orderId: undefined,
    deliveryNoteId: undefined,
    kind: { tag: 'CustomerPayment' },
    subtotalFils: bhd(92_536),
    reference: 'GPIC-TT-20241215',
    dueDate: undefined,
  });
  await pause();

  // Yateem advance payment received (50% = 107K BHD)
  await conn.reducers.recordMoneyEvent({
    partyId: 14n,
    orderId: 1n,
    deliveryNoteId: undefined,
    kind: { tag: 'CustomerPayment' },
    subtotalFils: bhd(97_439.10),
    reference: 'YATEEM-TT-20260210',
    dueDate: undefined,
  });
  await pause();

  // AHS partial payment (10K BHD against overdue PH25/116)
  await conn.reducers.recordMoneyEvent({
    partyId: 15n,
    orderId: undefined,
    deliveryNoteId: undefined,
    kind: { tag: 'CustomerPayment' },
    subtotalFils: bhd(10_000),
    reference: 'AHS-CHQ-20251115',
    dueDate: undefined,
  });
  await pause();

  // Al Ezzel partial against PH25/130 (20K BHD, balance 28.4K still due)
  await conn.reducers.recordMoneyEvent({
    partyId: 3n,
    orderId: 6n,
    deliveryNoteId: undefined,
    kind: { tag: 'CustomerPayment' },
    subtotalFils: bhd(20_000),
    reference: 'ALEZZEL-TT-20260110',
    dueDate: undefined,
  });
  await pause();

  // EWA advance payment against INV-2026-004
  await conn.reducers.recordMoneyEvent({
    partyId: 1n,
    orderId: 7n,
    deliveryNoteId: undefined,
    kind: { tag: 'CustomerPayment' },
    subtotalFils: bhd(10_920.50),
    reference: 'EWA-TT-20260225',
    dueDate: undefined,
  });
  await pause();

  // Tabreed paid 2025 PO/LOI advance (13K BHD)
  await conn.reducers.recordMoneyEvent({
    partyId: 9n,
    orderId: undefined,
    deliveryNoteId: undefined,
    kind: { tag: 'CustomerPayment' },
    subtotalFils: bhd(13_000),
    reference: 'TABREED-TT-20251010',
    dueDate: undefined,
  });
  await pause();

  // ── Supplier Invoices (3) ─────────────────────────────────────────────────

  // E+H invoice for Al Ezzel supply (ORD-PH25/076 OEM cost)
  await conn.reducers.recordMoneyEvent({
    partyId: 21n,
    orderId: 2n,
    deliveryNoteId: undefined,
    kind: { tag: 'SupplierInvoice' },
    subtotalFils: bhd(86_000),
    reference: 'EH-INV-2025-3341',
    dueDate: ts(2025, 9, 15),
  });
  await pause();

  // E+H invoice for SULB Coriolis supply
  await conn.reducers.recordMoneyEvent({
    partyId: 21n,
    orderId: 4n,
    deliveryNoteId: undefined,
    kind: { tag: 'SupplierInvoice' },
    subtotalFils: bhd(22_500),
    reference: 'EH-INV-2025-1872',
    dueDate: ts(2025, 4, 20),
  });
  await pause();

  // Landis+Gyr invoice for ORD-PH25/058 pass-through
  await conn.reducers.recordMoneyEvent({
    partyId: 23n,
    orderId: undefined,
    deliveryNoteId: undefined,
    kind: { tag: 'SupplierInvoice' },
    subtotalFils: bhd(55_542),
    reference: 'LG-INV-2025-0088',
    dueDate: ts(2025, 6, 30),
  });
  await pause();

  // ── Supplier Payments (2) ─────────────────────────────────────────────────

  // E+H paid for Al Ezzel supply (full payment)
  await conn.reducers.recordMoneyEvent({
    partyId: 21n,
    orderId: 2n,
    deliveryNoteId: undefined,
    kind: { tag: 'SupplierPayment' },
    subtotalFils: bhd(86_000),
    reference: 'PH-TT-20250920-EH3341',
    dueDate: undefined,
  });
  await pause();

  // Landis+Gyr paid in full
  await conn.reducers.recordMoneyEvent({
    partyId: 23n,
    orderId: undefined,
    deliveryNoteId: undefined,
    kind: { tag: 'SupplierPayment' },
    subtotalFils: bhd(55_542),
    reference: 'PH-TT-20250710-LG0088',
    dueDate: undefined,
  });
  await pause();

  console.log('[seed] Money events done (30)');

  // ── 6. Activity Logs ──────────────────────────────────────────────────────
  //
  // Reducer: log_activity
  // Params:  entityType, entityId, action, detail, followUpDue
  //
  console.log('[seed] 6/7 — Logging 20 activities...');

  // EWA — payment chase
  await conn.reducers.logActivity({
    entityType: 'party',
    entityId: 1n,
    action: 'Payment Follow-up',
    detail: 'Called Hassan re multiple overdue EWA invoices (PH25/109, 110, 120, 129, 138, 149, 150 — total ~38K BHD). He confirmed budget committee meets 15th. Will advise.',
    followUpDue: daysFromNow(14),
  });
  await pause();

  // Bapco — site visit re big 2026 opps
  await conn.reducers.logActivity({
    entityType: 'party',
    entityId: 2n,
    action: 'Site Visit',
    detail: 'Sundar site visit to Bapco Refinery. Presented E+H process analyser package for Opp 307 (197K BHD). Ahmed interested, pushing for TBA decision by end March. Competitor is Emerson.',
    followUpDue: daysFromNow(14),
  });
  await pause();

  // Bapco — payment chase on overdue invoices
  await conn.reducers.logActivity({
    entityType: 'party',
    entityId: 2n,
    action: 'Payment Follow-up',
    detail: 'Called Fatima re PH25/151 (24.9K BHD overdue) and PH25/155 (2.3K BHD). Confirmed 10K TT sent 15 Jan. Balance expected in Q1 payment run. Ref: BAPCO-TT-20260115.',
    followUpDue: daysFromNow(21),
  });
  await pause();

  // Al Ezzel — overdue chase
  await conn.reducers.logActivity({
    entityType: 'party',
    entityId: 3n,
    action: 'Payment Follow-up',
    detail: 'Ramya chased Suresh re PH25/130 (48.4K BHD, Dec due). He confirmed 20K TT processed. Balance 28.4K pending his MD approval. Escalating to Abhie.',
    followUpDue: daysFromNow(7),
  });
  await pause();

  // ALBA — order confirmation
  await conn.reducers.logActivity({
    entityType: 'party',
    entityId: 4n,
    action: 'Order Confirmation',
    detail: 'ORD-2026-017 PO received from Rashid. Forwarded to E+H Dubai for 50 RTD transmitters and 12 vortex flowmeters. Expected lead time 8 weeks. Ebin managing delivery.',
    followUpDue: daysFromNow(7),
  });
  await pause();

  // SULB — delivery follow-up
  await conn.reducers.logActivity({
    entityType: 'party',
    entityId: 5n,
    action: 'Delivery Follow-up',
    detail: 'ORD-PH25/036 Coriolis meters shipped from E+H Germany. ETA Bahrain port 3 weeks. Customer notified. Customs clearance docs sent to SULB logistics.',
    followUpDue: daysFromNow(21),
  });
  await pause();

  // Arla Foods — multiple overdue invoices
  await conn.reducers.logActivity({
    entityType: 'party',
    entityId: 6n,
    action: 'Payment Follow-up',
    detail: 'Called Arla Foods accounts team re PH25/144 (9.5K), PH25/145 (6.3K), PH25/146 (6.5K), PH25/157 (6.3K) — total 28.6K BHD overdue. Payment run confirmed for next Tuesday.',
    followUpDue: daysFromNow(7),
  });
  await pause();

  // GPIC — 2026 pipeline opportunity
  await conn.reducers.logActivity({
    entityType: 'party',
    entityId: 7n,
    action: 'Quote Sent',
    detail: 'Submitted E+H Promag W electromagnetic flowmeter quote for ORD-2026-016. 15 units for cooling water monitoring. Yusuf confirmed no competitor this round. Expect PO within 2 weeks.',
    followUpDue: daysFromNow(14),
  });
  await pause();

  // TTSJV — pipeline evaluation
  await conn.reducers.logActivity({
    entityType: 'party',
    entityId: 8n,
    action: 'Quotation Submitted',
    detail: 'Submitted quote for TTSJV Opp 27 (12.2K BHD) — 8 x E+H Deltapilot FMB70 level transmitters. Follow up with procurement coordinator on 25 March.',
    followUpDue: daysFromNow(8),
  });
  await pause();

  // Tabreed — PO/LOI received
  await conn.reducers.logActivity({
    entityType: 'party',
    entityId: 9n,
    action: 'PO Received',
    detail: 'Tabreed Opp 113 PO/LOI received for 26K BHD cooling water flow meters. Pradeep confirmed delivery to Isa Town district cooling plant required by June 30. Processing with E+H.',
    followUpDue: daysFromNow(10),
  });
  await pause();

  // Ministry of Works — large pipeline update
  await conn.reducers.logActivity({
    entityType: 'party',
    entityId: 10n,
    action: 'Technical Meeting',
    detail: 'Ebin met Khalid at Ministry HQ re Opp 239 (175K BHD). Spec clarification session — 87 electromagnetic flowmeters for water distribution network. Resubmit revised quote by 28 March.',
    followUpDue: daysFromNow(11),
  });
  await pause();

  // Ministry of Works — lost deal debrief
  await conn.reducers.logActivity({
    entityType: 'party',
    entityId: 10n,
    action: 'Lost Deal Debrief',
    detail: 'Opp 234 (163K BHD) lost to Krohne. Ministry went with Krohne OPTIFLUX at 8% lower price. Ebin: \"Our E+H Promag price was within spec but Krohne offered extended warranty.\" Noted for next RFQ.',
    followUpDue: undefined,
  });
  await pause();

  // Seapeak — overdue chase
  await conn.reducers.logActivity({
    entityType: 'party',
    entityId: 12n,
    action: 'Payment Follow-up',
    detail: 'Ebin called Seapeak re PH25/102 (10.6K BHD overdue since Sep 25). They paid 5K TT Oct 20. Balance 5.6K still outstanding — accounts team \"in process\". Escalating to terminal manager.',
    followUpDue: daysFromNow(7),
  });
  await pause();

  // Yateem Group — large order onboarding
  await conn.reducers.logActivity({
    entityType: 'party',
    entityId: 14n,
    action: 'Order Kick-off',
    detail: 'ORD-2026-011 kick-off call with Zaid Yateem. Largest 2026 order 194K BHD. 50% advance received (97K BHD). E+H order placed for delivery in 60 days. Daily tracking required.',
    followUpDue: daysFromNow(7),
  });
  await pause();

  // AHS Trading — overdue escalation
  await conn.reducers.logActivity({
    entityType: 'party',
    entityId: 15n,
    action: 'Payment Follow-up',
    detail: 'PH25/116 (24.7K BHD) overdue 5 months. Vijay Anand WhatsApp: \"Funds releasing this week.\" 10K received CHQ. Balance 14.7K — Abhie to call Vijay\'s MD directly.',
    followUpDue: daysFromNow(5),
  });
  await pause();

  // NOGA — strategic pipeline discussion
  await conn.reducers.logActivity({
    entityType: 'party',
    entityId: 18n,
    action: 'Strategic Meeting',
    detail: 'Abhie met Sara Al-Sayed at NOGA HQ. Discussed gas analyser framework opportunity. Estimated 40K+ BHD annually. Sara wants E+H application note for H2S analysers in gas gathering. Sending within 48h.',
    followUpDue: daysFromNow(2),
  });
  await pause();

  // Endress+Hauser — rebate review
  await conn.reducers.logActivity({
    entityType: 'party',
    entityId: 21n,
    action: 'Principal Meeting',
    detail: 'Thomas Mueller (E+H MENA) quarterly review call. Q1 2026 purchase target BHD 180K. Current pace BHD 95K (53%). Need to accelerate Bapco Opp 307 and Ministry Opp 239 to hit Gold tier.',
    followUpDue: daysFromNow(30),
  });
  await pause();

  // Bapco — Opp 310 Prudent Valve coordination
  await conn.reducers.logActivity({
    entityType: 'pipeline',
    entityId: 25n,
    action: 'Technical Clarification',
    detail: 'Bapco Opp 310 (181K BHD control valve package) — Sundar coordinating with Prudent Valve as sub-vendor for valve bodies. E+H positioners and actuators from our side. Joint presentation scheduled for 25 March.',
    followUpDue: daysFromNow(8),
  });
  await pause();

  // JAHECON — small overdue
  await conn.reducers.logActivity({
    entityType: 'party',
    entityId: 20n,
    action: 'Payment Follow-up',
    detail: 'PH25/119 (4.7K BHD overdue since Oct 25). JAHECON project manager says end-client has not released retention. Sent formal demand letter. If no payment by 31 March, escalate to legal.',
    followUpDue: daysFromNow(14),
  });
  await pause();

  // Arla — new 2026 order delivery tracking
  await conn.reducers.logActivity({
    entityType: 'order',
    entityId: 9n,
    action: 'Delivery Update',
    detail: 'ORD-2026-008 Arla hygienic instruments: E+H confirmed order accepted, lead time 6 weeks. DAP Bahrain delivery. Arla QA requires material certificates — requested from E+H documentation team.',
    followUpDue: daysFromNow(14),
  });
  await pause();

  console.log('[seed] Activities done (20)');

  // ── 7. Line Items ─────────────────────────────────────────────────────────
  //
  // Reducer: add_line_item  (camelCase: addLineItem)
  // Params:  parentType, parentId, description, quantity, unitPriceFils,
  //          fobCostFils?, freightCostFils?, customsCostFils?,
  //          insuranceCostFils?, handlingCostFils?, financeCostFils?,
  //          marginBps?, costPerUnitFils?
  //
  // Note: id and totalPriceFils are computed server-side (autoInc + qty*unit).
  // parentType: 'order'
  // parentId: corresponds to order.id
  // marginBps: gross margin in basis points (2000 = 20.00%)
  //
  console.log('[seed] 7/7 — Creating 15 line items...');

  // Order 2 (ORD-PH25/076 — Al Ezzel large delivered order)
  await conn.reducers.addLineItem({
    parentType: 'order',
    parentId: 2n,
    description: 'E+H Promass F 300 — Coriolis Flow Meter DN50 SS 316L, 4-20mA HART (EH-83F50-BBPBAAAA)',
    quantity: 12n,
    unitPriceFils: bhd(5_750),
    fobCostFils: bhd(4_583),
    freightCostFils: bhd(150),
    customsCostFils: bhd(80),
    insuranceCostFils: bhd(30),
    handlingCostFils: bhd(50),
    financeCostFils: 0n,
    marginBps: 1984,
    costPerUnitFils: bhd(4_893),
  });
  await pause();

  await conn.reducers.addLineItem({
    parentType: 'order',
    parentId: 2n,
    description: 'E+H Promag W 400 — Electromagnetic Flow Meter DN100 PVDF, Flanged, 4-20mA HART (EH-5W4B0-ABCAA1AA)',
    quantity: 8n,
    unitPriceFils: bhd(4_300),
    fobCostFils: bhd(3_420),
    freightCostFils: bhd(100),
    customsCostFils: bhd(50),
    insuranceCostFils: bhd(15),
    handlingCostFils: bhd(30),
    financeCostFils: 0n,
    marginBps: 2278,
    costPerUnitFils: bhd(3_615),
  });
  await pause();

  // Order 3 (ORD-2026-018 — Bapco pressure transmitter blanket)
  await conn.reducers.addLineItem({
    parentType: 'order',
    parentId: 3n,
    description: 'E+H Cerabar S PMP71 — Pressure Transmitter 0-400 bar, Hastelloy C, HART (EH-PMP71-ABB7E21RA)',
    quantity: 25n,
    unitPriceFils: bhd(1_020),
    fobCostFils: bhd(790),
    freightCostFils: bhd(40),
    customsCostFils: bhd(20),
    insuranceCostFils: bhd(8),
    handlingCostFils: bhd(15),
    financeCostFils: 0n,
    marginBps: 2291,
    costPerUnitFils: bhd(873),
  });
  await pause();

  await conn.reducers.addLineItem({
    parentType: 'order',
    parentId: 3n,
    description: 'E+H Deltapilot FMB70 — Hydrostatic Level Transmitter 0-5m H2O, 4-20mA HART (EH-FMB70-AAA2GA4AA)',
    quantity: 10n,
    unitPriceFils: bhd(690),
    fobCostFils: bhd(530),
    freightCostFils: bhd(25),
    customsCostFils: bhd(12),
    insuranceCostFils: bhd(5),
    handlingCostFils: bhd(10),
    financeCostFils: 0n,
    marginBps: 2330,
    costPerUnitFils: bhd(582),
  });
  await pause();

  // Order 4 (ORD-PH25/036 — SULB Coriolis)
  await conn.reducers.addLineItem({
    parentType: 'order',
    parentId: 4n,
    description: 'E+H Promass E 300 — Coriolis Mass Flow Meter DN80, High-Pressure SS 316L, Modbus (EH-83E80-ADPBAAAA)',
    quantity: 6n,
    unitPriceFils: bhd(3_982),
    fobCostFils: bhd(3_120),
    freightCostFils: bhd(120),
    customsCostFils: bhd(60),
    insuranceCostFils: bhd(20),
    handlingCostFils: bhd(40),
    financeCostFils: 0n,
    marginBps: 2144,
    costPerUnitFils: bhd(3_360),
  });
  await pause();

  // Order 5 (ORD-2026-017 — ALBA RTD & flow spares)
  await conn.reducers.addLineItem({
    parentType: 'order',
    parentId: 5n,
    description: 'E+H iTEMP TMT82 — Temperature Transmitter Head-Mount, -40..+85°C, HART/PROFIBUS PA (EH-TMT82-A1B11AA)',
    quantity: 50n,
    unitPriceFils: bhd(328),
    fobCostFils: bhd(248),
    freightCostFils: bhd(8),
    customsCostFils: bhd(4),
    insuranceCostFils: bhd(1),
    handlingCostFils: bhd(3),
    financeCostFils: 0n,
    marginBps: 2419,
    costPerUnitFils: bhd(264),
  });
  await pause();

  await conn.reducers.addLineItem({
    parentType: 'order',
    parentId: 5n,
    description: 'E+H Prowirl F 200 — Vortex Flow Meter DN50, Steam/Gas, 4-20mA HART (EH-7F2B10-AAGAA1A)',
    quantity: 12n,
    unitPriceFils: bhd(1_042),
    fobCostFils: bhd(780),
    freightCostFils: bhd(35),
    customsCostFils: bhd(18),
    insuranceCostFils: bhd(6),
    handlingCostFils: bhd(15),
    financeCostFils: 0n,
    marginBps: 2548,
    costPerUnitFils: bhd(854),
  });
  await pause();

  // Order 8 (ORD-PH25/079 — Bahrain Steel)
  await conn.reducers.addLineItem({
    parentType: 'order',
    parentId: 8n,
    description: 'E+H Promag P 300 — Electromagnetic Flow Meter DN150, Linacryl Lining, 4-20mA HART (EH-5P3B0-ABCAA1AA)',
    quantity: 8n,
    unitPriceFils: bhd(1_530),
    fobCostFils: bhd(1_180),
    freightCostFils: bhd(45),
    customsCostFils: bhd(22),
    insuranceCostFils: bhd(8),
    handlingCostFils: bhd(20),
    financeCostFils: 0n,
    marginBps: 2388,
    costPerUnitFils: bhd(1_275),
  });
  await pause();

  await conn.reducers.addLineItem({
    parentType: 'order',
    parentId: 8n,
    description: 'E+H Ceraphire CPS171D — Digital pH/ORP Sensor, PG13.5, 0..14pH (EH-CPS171D-7EA21)',
    quantity: 8n,
    unitPriceFils: bhd(1_000),
    fobCostFils: bhd(760),
    freightCostFils: bhd(30),
    customsCostFils: bhd(15),
    insuranceCostFils: bhd(5),
    handlingCostFils: bhd(12),
    financeCostFils: 0n,
    marginBps: 2338,
    costPerUnitFils: bhd(822),
  });
  await pause();

  // Order 9 (ORD-2026-008 — Arla hygienic)
  await conn.reducers.addLineItem({
    parentType: 'order',
    parentId: 9n,
    description: 'E+H Promag H 100 — Hygienic Electromagnetic Flow Meter DN25, EHEDG, 4-20mA HART (EH-5H1B0-AABAA1A)',
    quantity: 6n,
    unitPriceFils: bhd(1_451),
    fobCostFils: bhd(1_120),
    freightCostFils: bhd(40),
    customsCostFils: bhd(20),
    insuranceCostFils: bhd(7),
    handlingCostFils: bhd(15),
    financeCostFils: 0n,
    marginBps: 2244,
    costPerUnitFils: bhd(1_202),
  });
  await pause();

  await conn.reducers.addLineItem({
    parentType: 'order',
    parentId: 9n,
    description: 'E+H Levelflex FMP51 — Guided Radar Level Transmitter, 0-5m, 316L SS, HART (EH-FMP51-ABCF2G4AA)',
    quantity: 4n,
    unitPriceFils: bhd(1_975),
    fobCostFils: bhd(1_510),
    freightCostFils: bhd(55),
    customsCostFils: bhd(28),
    insuranceCostFils: bhd(10),
    handlingCostFils: bhd(20),
    financeCostFils: 0n,
    marginBps: 2317,
    costPerUnitFils: bhd(1_623),
  });
  await pause();

  // Order 1 (ORD-2026-011 — Yateem Group EPC)
  await conn.reducers.addLineItem({
    parentType: 'order',
    parentId: 1n,
    description: 'E+H Liquiline CM442 — Multi-Parameter Liquid Analyser Transmitter, 4-channel, HART (EH-CM442-NNH1E1A)',
    quantity: 20n,
    unitPriceFils: bhd(4_850),
    fobCostFils: bhd(3_720),
    freightCostFils: bhd(120),
    customsCostFils: bhd(60),
    insuranceCostFils: bhd(22),
    handlingCostFils: bhd(50),
    financeCostFils: 0n,
    marginBps: 2365,
    costPerUnitFils: bhd(3_972),
  });
  await pause();

  await conn.reducers.addLineItem({
    parentType: 'order',
    parentId: 1n,
    description: 'E+H Flowphant T DTT31 — Plug-In Temperature Sensor 0..150°C, G1/2 (EH-DTT31-A2BB1AA)',
    quantity: 50n,
    unitPriceFils: bhd(680),
    fobCostFils: bhd(510),
    freightCostFils: bhd(15),
    customsCostFils: bhd(7),
    insuranceCostFils: bhd(3),
    handlingCostFils: bhd(8),
    financeCostFils: 0n,
    marginBps: 2549,
    costPerUnitFils: bhd(543),
  });
  await pause();

  // Order 10 (ORD-PH25/061 — Seapeak cryogenic)
  await conn.reducers.addLineItem({
    parentType: 'order',
    parentId: 10n,
    description: 'E+H Liquiphant FTL51 — Vibrating Fork Level Switch, Cryogenic -196°C, Ex-rated (EH-FTL51-ACG4BJBA)',
    quantity: 8n,
    unitPriceFils: bhd(1_127),
    fobCostFils: bhd(858),
    freightCostFils: bhd(30),
    customsCostFils: bhd(15),
    insuranceCostFils: bhd(5),
    handlingCostFils: bhd(12),
    financeCostFils: 0n,
    marginBps: 2342,
    costPerUnitFils: bhd(920),
  });
  await pause();

  await conn.reducers.addLineItem({
    parentType: 'order',
    parentId: 10n,
    description: 'E+H Micropilot FMR51 — Free-Space Radar Level Transmitter, 0..30m, LNG service (EH-FMR51-ABR2DA4AA)',
    quantity: 4n,
    unitPriceFils: bhd(1_465),
    fobCostFils: bhd(1_130),
    freightCostFils: bhd(40),
    customsCostFils: bhd(20),
    insuranceCostFils: bhd(7),
    handlingCostFils: bhd(15),
    financeCostFils: 0n,
    marginBps: 2246,
    costPerUnitFils: bhd(1_212),
  });
  await pause();

  console.log('[seed] Line items done (15)');

  console.log('[seed] ==============================');
  console.log('[seed] AsymmFlow comprehensive seed complete!');
  console.log('[seed] PH Trading WLL, Bahrain — canonical_seed.xlsx data:');
  console.log('[seed]   25 parties  (20 customers, 5 suppliers)');
  console.log('[seed]   15 contacts');
  console.log('[seed]   25 pipelines (5 won, 5 in-progress, 4 lost, 11 active/evaluation)');
  console.log('[seed]   10 orders   (4 active, 2 in-progress, 4 delivered/terminal)');
  console.log('[seed]   30 money events (15 invoices, 10 payments, 3 supplier invoices, 2 supplier payments)');
  console.log('[seed]   20 activity logs');
  console.log('[seed]   15 line items (E+H instruments: Coriolis, EM flowmeters, pressure, level, analyzers)');
  console.log('[seed] ==============================');
  console.log('[seed] Key overdue invoices to chase:');
  console.log('[seed]   PH25/130 Al Ezzel Engie — 48,472.60 BHD overdue since Dec 2025');
  console.log('[seed]   PH25/116 AHS Trading   — 24,722.72 BHD overdue since Oct 2025');
  console.log('[seed]   PH25/151 Bapco Refining — 24,992.55 BHD (10K partial paid)');
  console.log('[seed]   PH25/144/145/146/157 Arla Foods — ~28,600 BHD total overdue');
  console.log('[seed]   PH25/102 Seapeak        — 10,626.22 BHD (5K partial paid)');
  console.log('[seed] ==============================');
}
