/**
 * Endress+Hauser XML Basket Parser
 *
 * Parses E+H portal XML pricing/basket files into typed structures with
 * EUR→BHD conversion and product-type-based markup application.
 *
 * All monetary values stored as bigint fils (1 BHD = 1000 fils).
 */

import { MARKUP_RULES } from './invariants';
import type { MarkupRule } from './invariants';

// ── Constants ────────────────────────────────────────────────────────────────

/** Fixed EUR→BHD conversion rate used by PH Trading. */
export const EUR_TO_BHD_RATE = 0.41;

// ── Types ────────────────────────────────────────────────────────────────────

export interface EHCurrencyValue {
  value: number;
  currency: string;
}

export interface ParsedEHItem {
  orderCode: string;
  orderCodeLong: string;
  shortDescription: string;
  quantity: number;
  quantityUnit: string;
  listPriceEUR: number;
  discountEUR: number;
  unitSalesPriceEUR: number;
  itemSalesPriceEUR: number;
  productionTime: string;
  productType: string;
  unitCostBHDFils: bigint;
  itemCostBHDFils: bigint;
  targetMarkupPct: number;
  minMarkupPct: number;
  unitSellBHDFils: bigint;
  itemSellBHDFils: bigint;
  unitProfitBHDFils: bigint;
  itemProfitBHDFils: bigint;
}

export interface ParsedEHBasket {
  customerNumber: string;
  customerName: string;
  positionsCount: number;
  netValueEUR: number;
  freightEUR: number;
  grossValueEUR: number;
  totalCostBHDFils: bigint;
  totalSellBHDFils: bigint;
  totalProfitBHDFils: bigint;
  overallMarginPct: number;
  items: ParsedEHItem[];
  warnings: string[];
}

export interface ProductTypeStats {
  productType: string;
  itemCount: number;
  totalCostBHDFils: bigint;
  totalSellBHDFils: bigint;
  totalProfitBHDFils: bigint;
  averageMarginPct: number;
}

// ── Product Type Classification ──────────────────────────────────────────────

const FLOW_ORDER_PREFIXES = ['CM442', '10W', '50W', '80F', '83F', 'PROMAG', 'PROLINE'];
const FLOW_DESC_PATTERNS = ['LIQUILINE', 'PROMAG', 'PROLINE', 'FLOWMETER', 'PROMASS', 'PROWIRL'];

const LEVEL_ORDER_PREFIXES = ['FMR', 'FMP', 'FHX'];
const LEVEL_DESC_PATTERNS = ['MICROPILOT', 'LEVELFLEX', 'LIQUICAP'];

const PRESSURE_ORDER_PREFIXES = ['PMC', 'PMP', 'PMD', '53P', 'CERABAR'];
const PRESSURE_DESC_PATTERNS = ['CERABAR', 'DELTABAR', 'DELTAPILOT'];

const TEMP_ORDER_PREFIXES = ['TMT', 'TM4', 'TR', 'ITHERM'];
const TEMP_DESC_PATTERNS = ['ITHERM', 'OMNIGRAD', 'EASYTEMP'];

const ANALYSIS_ORDER_PATTERNS = ['MEMOSENS', 'CAS', 'CAM', 'CCS', 'CYA'];
const ANALYSIS_DESC_PATTERNS = ['MEMOSENS', 'STAMOSENS'];

/**
 * Classify an E+H product into a category for markup rule selection.
 *
 * FMU prefix: only classified as Level if NOT FMU9x (Prosonic).
 */
export function classifyProductType(orderCode: string, description: string): string {
  const oc = orderCode.toUpperCase();
  const desc = description.toUpperCase();

  // Flow
  if (
    FLOW_ORDER_PREFIXES.some((p) => oc.startsWith(p)) ||
    FLOW_DESC_PATTERNS.some((p) => desc.includes(p))
  ) {
    return 'E+H Flow';
  }

  // Level — includes FMU but NOT FMU9x (Prosonic)
  if (
    LEVEL_ORDER_PREFIXES.some((p) => oc.startsWith(p)) ||
    LEVEL_DESC_PATTERNS.some((p) => desc.includes(p)) ||
    (oc.startsWith('FMU') && !oc.startsWith('FMU9'))
  ) {
    return 'E+H Level';
  }

  // Pressure
  if (
    PRESSURE_ORDER_PREFIXES.some((p) => oc.startsWith(p)) ||
    PRESSURE_DESC_PATTERNS.some((p) => desc.includes(p))
  ) {
    return 'E+H Pressure';
  }

  // Temperature
  if (
    TEMP_ORDER_PREFIXES.some((p) => oc.startsWith(p)) ||
    TEMP_DESC_PATTERNS.some((p) => desc.includes(p))
  ) {
    return 'E+H Temperature';
  }

  // Analysis — check order code contains (not just starts with) the pattern
  if (
    ANALYSIS_ORDER_PATTERNS.some((p) => oc.includes(p)) ||
    ANALYSIS_DESC_PATTERNS.some((p) => desc.includes(p))
  ) {
    return 'E+H Analysis';
  }

  return 'E+H General';
}

// ── Currency Conversion ──────────────────────────────────────────────────────

/** Convert EUR amount to BHD fils (bigint). Rounds to nearest fil. */
export function eurToBhdFils(eurValue: number): bigint {
  return BigInt(Math.round(eurValue * EUR_TO_BHD_RATE * 1000));
}

// ── Item Costing ─────────────────────────────────────────────────────────────

interface ItemCostingInput {
  unitSalesPriceEUR: number;
  itemSalesPriceEUR: number;
  quantity: number;
  productType: string;
}

interface ItemCostingResult {
  unitCostBHDFils: bigint;
  itemCostBHDFils: bigint;
  targetMarkupPct: number;
  minMarkupPct: number;
  unitSellBHDFils: bigint;
  itemSellBHDFils: bigint;
  unitProfitBHDFils: bigint;
  itemProfitBHDFils: bigint;
}

/**
 * Compute BHD cost, sell, and profit for a single line item.
 */
export function computeItemCosting(input: ItemCostingInput): ItemCostingResult {
  const rule: MarkupRule = MARKUP_RULES[input.productType] ?? MARKUP_RULES['Default'];

  const unitCostBHDFils = eurToBhdFils(input.unitSalesPriceEUR);
  const itemCostBHDFils = eurToBhdFils(input.itemSalesPriceEUR);

  const unitSellBHDFils = BigInt(
    Math.round(Number(unitCostBHDFils) * (1 + rule.targetMarkupPct / 100))
  );
  const itemSellBHDFils = unitSellBHDFils * BigInt(input.quantity);

  const unitProfitBHDFils = unitSellBHDFils - unitCostBHDFils;
  const itemProfitBHDFils = unitProfitBHDFils * BigInt(input.quantity);

  return {
    unitCostBHDFils,
    itemCostBHDFils,
    targetMarkupPct: rule.targetMarkupPct,
    minMarkupPct: rule.minMarkupPct,
    unitSellBHDFils,
    itemSellBHDFils,
    unitProfitBHDFils,
    itemProfitBHDFils,
  };
}

// ── XML Helpers ──────────────────────────────────────────────────────────────

function textContent(parent: Element, tagName: string): string {
  const el = parent.getElementsByTagName(tagName)[0];
  return el?.textContent?.trim() ?? '';
}

function floatContent(parent: Element, tagName: string): number {
  const raw = textContent(parent, tagName);
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

// ── Main Parser ──────────────────────────────────────────────────────────────

/**
 * Parse an E+H basket XML string into a fully costed ParsedEHBasket.
 * Throws on malformed XML. Non-fatal issues are collected in `warnings`.
 */
export function parseEHBasketXML(xmlString: string): ParsedEHBasket {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'text/xml');

  // Check for XML parser errors
  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new Error(`XML parse error: ${parserError.textContent}`);
  }

  return parseEHBasketFromDocument(doc);
}

/**
 * Parse from an already-parsed Document. Exported for testability.
 */
export function parseEHBasketFromDocument(doc: Document): ParsedEHBasket {
  const warnings: string[] = [];

  // Basket root
  const basketEl = doc.getElementsByTagName('Basket')[0];
  if (!basketEl) {
    throw new Error('Missing <Basket> root element');
  }

  const positionsCount = parseInt(basketEl.getAttribute('positionsCount') ?? '0', 10);

  // Header → Customer
  const customerNumber = textContent(doc.documentElement, 'CustomerNumber');
  const customerName = textContent(doc.documentElement, 'CustomerName');

  // Header → Pricing → TotalsSales
  const netValueEUR = floatContent(doc.documentElement, 'NetValue');
  const freightEUR = floatContent(doc.documentElement, 'Freight');
  const grossValueEUR = floatContent(doc.documentElement, 'GrossValue');

  // Items
  const itemElements = doc.getElementsByTagName('Item');
  const items: ParsedEHItem[] = [];

  for (let i = 0; i < itemElements.length; i++) {
    const itemEl = itemElements[i];

    const orderCode = textContent(itemEl, 'OrderCode');
    const orderCodeLong = textContent(itemEl, 'OrderCodeLong');
    const shortDescription = textContent(itemEl, 'ShortDescription');

    const quantityEl = itemEl.getElementsByTagName('Quantity')[0];
    const quantityRaw = quantityEl?.textContent?.trim() ?? '1';
    const quantity = parseInt(quantityRaw, 10) || 1;
    const quantityUnit = quantityEl?.getAttribute('unit') ?? 'Piece';

    const listPriceEUR = floatContent(itemEl, 'ItemListPrice');
    const discountEUR = floatContent(itemEl, 'ItemDiscount');
    const unitSalesPriceEUR = floatContent(itemEl, 'UnitSalesPrice');
    const itemSalesPriceEUR = floatContent(itemEl, 'ItemSalesPrice');
    const productionTime = textContent(itemEl, 'ProductionTime');

    if (!orderCode) {
      warnings.push(`Item ${i + 1}: missing OrderCode, skipping`);
      continue;
    }

    const productType = classifyProductType(orderCode, shortDescription);

    const costing = computeItemCosting({
      unitSalesPriceEUR,
      itemSalesPriceEUR,
      quantity,
      productType,
    });

    items.push({
      orderCode,
      orderCodeLong,
      shortDescription,
      quantity,
      quantityUnit,
      listPriceEUR,
      discountEUR,
      unitSalesPriceEUR,
      itemSalesPriceEUR,
      productionTime,
      productType,
      ...costing,
    });
  }

  if (items.length !== positionsCount) {
    warnings.push(
      `positionsCount=${positionsCount} but parsed ${items.length} items`
    );
  }

  // Totals
  const totalCostBHDFils = items.reduce((sum, it) => sum + it.itemCostBHDFils, 0n);
  const totalSellBHDFils = items.reduce((sum, it) => sum + it.itemSellBHDFils, 0n);
  const totalProfitBHDFils = totalSellBHDFils - totalCostBHDFils;
  const overallMarginPct =
    totalSellBHDFils > 0n
      ? Number((totalProfitBHDFils * 10000n) / totalSellBHDFils) / 100
      : 0;

  return {
    customerNumber,
    customerName,
    positionsCount,
    netValueEUR,
    freightEUR,
    grossValueEUR,
    totalCostBHDFils,
    totalSellBHDFils,
    totalProfitBHDFils,
    overallMarginPct,
    items,
    warnings,
  };
}

// ── Product Type Stats ───────────────────────────────────────────────────────

/**
 * Aggregate basket items by product type for summary reporting.
 */
export function getProductTypeStats(basket: ParsedEHBasket): ProductTypeStats[] {
  const map = new Map<
    string,
    { itemCount: number; totalCostBHDFils: bigint; totalSellBHDFils: bigint; totalProfitBHDFils: bigint }
  >();

  for (const item of basket.items) {
    const existing = map.get(item.productType);
    if (existing) {
      existing.itemCount += 1;
      existing.totalCostBHDFils += item.itemCostBHDFils;
      existing.totalSellBHDFils += item.itemSellBHDFils;
      existing.totalProfitBHDFils += item.itemProfitBHDFils;
    } else {
      map.set(item.productType, {
        itemCount: 1,
        totalCostBHDFils: item.itemCostBHDFils,
        totalSellBHDFils: item.itemSellBHDFils,
        totalProfitBHDFils: item.itemProfitBHDFils,
      });
    }
  }

  const result: ProductTypeStats[] = [];
  for (const [productType, stats] of map) {
    const averageMarginPct =
      stats.totalSellBHDFils > 0n
        ? Number((stats.totalProfitBHDFils * 10000n) / stats.totalSellBHDFils) / 100
        : 0;

    result.push({ productType, averageMarginPct, ...stats });
  }

  return result;
}
