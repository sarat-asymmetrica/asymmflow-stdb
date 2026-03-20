import assert from 'node:assert/strict';

import {
  EUR_TO_BHD_RATE,
  classifyProductType,
  eurToBhdFils,
  computeItemCosting,
  getProductTypeStats,
  parseEHBasketXML,
  type ParsedEHBasket,
  type ParsedEHItem,
} from './ehBasketParser';

// ── Minimal DOMParser shim for Node ──────────────────────────────────────────
// The production code uses the browser-native DOMParser. For Node test
// environments we provide a lightweight shim that delegates to the built-in
// XMLParser available via `node:` modules (not available), so instead we use
// a regex-based extraction that satisfies the subset of DOM API used by the
// parser: getElementsByTagName, getAttribute, textContent, querySelector.

if (typeof globalThis.DOMParser === 'undefined') {
  // Minimal shim: uses a recursive-descent regex approach to build a
  // tree of elements. Good enough for the well-formed XML the parser expects.
  class MiniElement {
    tagName: string;
    attributes: Map<string, string>;
    children: MiniElement[];
    _textContent: string;
    parentElement: MiniElement | null;

    constructor(tagName: string) {
      this.tagName = tagName;
      this.attributes = new Map();
      this.children = [];
      this._textContent = '';
      this.parentElement = null;
    }

    getAttribute(name: string): string | null {
      return this.attributes.get(name) ?? null;
    }

    get textContent(): string {
      if (this.children.length === 0) return this._textContent;
      return this.children.map((c) => c.textContent).join('');
    }

    getElementsByTagName(name: string): MiniElement[] {
      const result: MiniElement[] = [];
      for (const child of this.children) {
        if (child.tagName === name) result.push(child);
        result.push(...child.getElementsByTagName(name));
      }
      return result;
    }

    querySelector(selector: string): MiniElement | null {
      // Only supports tagname selectors — sufficient for parsererror check
      return this.getElementsByTagName(selector)[0] ?? null;
    }
  }

  class MiniDocument {
    documentElement: MiniElement;

    constructor(root: MiniElement) {
      this.documentElement = root;
    }

    getElementsByTagName(name: string): MiniElement[] {
      if (this.documentElement.tagName === name) return [this.documentElement];
      return this.documentElement.getElementsByTagName(name);
    }

    querySelector(selector: string): MiniElement | null {
      if (this.documentElement.tagName === selector) return this.documentElement;
      return this.documentElement.querySelector(selector);
    }
  }

  function parseXmlString(xml: string): MiniElement {
    let pos = 0;

    function skipWhitespace(): void {
      while (pos < xml.length && /\s/.test(xml[pos])) pos++;
    }

    function parseElement(): MiniElement {
      skipWhitespace();
      if (xml[pos] !== '<' || xml[pos + 1] === '/') {
        throw new Error(`Expected opening tag at position ${pos}`);
      }
      pos++; // skip <

      // Read tag name
      let tagName = '';
      while (pos < xml.length && !/[\s/>]/.test(xml[pos])) {
        tagName += xml[pos++];
      }

      const el = new MiniElement(tagName);

      // Read attributes
      while (pos < xml.length) {
        skipWhitespace();
        if (xml[pos] === '/' && xml[pos + 1] === '>') {
          pos += 2; // self-closing
          return el;
        }
        if (xml[pos] === '>') {
          pos++;
          break;
        }
        // attribute name
        let attrName = '';
        while (pos < xml.length && !/[\s=/>]/.test(xml[pos])) {
          attrName += xml[pos++];
        }
        skipWhitespace();
        if (xml[pos] === '=') {
          pos++;
          skipWhitespace();
          const quote = xml[pos++];
          let attrVal = '';
          while (pos < xml.length && xml[pos] !== quote) {
            attrVal += xml[pos++];
          }
          pos++; // skip closing quote
          el.attributes.set(attrName, attrVal);
        }
      }

      // Read children and text content
      while (pos < xml.length) {
        skipWhitespace();
        if (pos >= xml.length) break;

        if (xml[pos] === '<') {
          if (xml[pos + 1] === '/') {
            // Closing tag — consume it
            const closeIdx = xml.indexOf('>', pos);
            pos = closeIdx + 1;
            return el;
          }
          // Child element
          const child = parseElement();
          child.parentElement = el;
          el.children.push(child);
        } else {
          // Text content
          let text = '';
          while (pos < xml.length && xml[pos] !== '<') {
            text += xml[pos++];
          }
          el._textContent += text.trim();
        }
      }

      return el;
    }

    // Skip XML declaration if present
    if (xml.trimStart().startsWith('<?')) {
      const declEnd = xml.indexOf('?>');
      if (declEnd !== -1) pos = declEnd + 2;
    }

    return parseElement();
  }

  (globalThis as Record<string, unknown>).DOMParser = class {
    parseFromString(str: string, _type: string): Document {
      try {
        const root = parseXmlString(str);
        return new MiniDocument(root) as unknown as Document;
      } catch {
        const errRoot = new MiniElement('root');
        const errEl = new MiniElement('parsererror');
        errEl._textContent = 'Malformed XML';
        errRoot.children.push(errEl);
        return new MiniDocument(errRoot) as unknown as Document;
      }
    }
  };
}

// ── Test infrastructure (matches project pattern) ────────────────────────────

const failures: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}

// ── classifyProductType tests ────────────────────────────────────────────────

test('classifyProductType: Flow — CM442 order code', () => {
  assert.equal(classifyProductType('CM442-3RT0/0', 'Liquiline CM442'), 'E+H Flow');
});

test('classifyProductType: Flow — Promag description', () => {
  assert.equal(classifyProductType('XYZ-123', 'Promag 10W flowmeter'), 'E+H Flow');
});

test('classifyProductType: Flow — 80F prefix', () => {
  assert.equal(classifyProductType('80F40-ABCD', 'Promass F'), 'E+H Flow');
});

test('classifyProductType: Flow — PROWIRL description', () => {
  assert.equal(classifyProductType('OTHER-001', 'Prowirl 200'), 'E+H Flow');
});

test('classifyProductType: Level — FMR prefix (Micropilot)', () => {
  assert.equal(classifyProductType('FMR60-ABC', 'Micropilot FMR60'), 'E+H Level');
});

test('classifyProductType: Level — FMP prefix (Levelflex)', () => {
  assert.equal(classifyProductType('FMP51-ABCD', 'Levelflex FMP51'), 'E+H Level');
});

test('classifyProductType: Level — FMU prefix (not FMU9x)', () => {
  assert.equal(classifyProductType('FMU30-ABC', 'Prosonic S'), 'E+H Level');
});

test('classifyProductType: Level — FMU9x is NOT Level (Prosonic)', () => {
  // FMU9x falls through; it should NOT match Level
  assert.notEqual(classifyProductType('FMU90-ABC', 'Some sensor'), 'E+H Level');
});

test('classifyProductType: Level — FHX prefix', () => {
  assert.equal(classifyProductType('FHX40-ABC', 'Level switch'), 'E+H Level');
});

test('classifyProductType: Pressure — PMC prefix (Cerabar)', () => {
  assert.equal(classifyProductType('PMC71-ABCD', 'Cerabar PMC71'), 'E+H Pressure');
});

test('classifyProductType: Pressure — DELTABAR description', () => {
  assert.equal(classifyProductType('PMD75-ABCD', 'Deltabar PMD75'), 'E+H Pressure');
});

test('classifyProductType: Pressure — 53P prefix', () => {
  assert.equal(classifyProductType('53P-SOMETHING', 'Some pressure'), 'E+H Pressure');
});

test('classifyProductType: Temperature — TMT prefix', () => {
  assert.equal(classifyProductType('TMT162-ABCD', 'iTHERM TM411'), 'E+H Temperature');
});

test('classifyProductType: Temperature — iTHERM description only', () => {
  assert.equal(classifyProductType('XYZ-999', 'iTherm TM411'), 'E+H Temperature');
});

test('classifyProductType: Temperature — TR prefix', () => {
  assert.equal(classifyProductType('TR10-ABC', 'Omnigrad S'), 'E+H Temperature');
});

test('classifyProductType: Analysis — MEMOSENS in order code', () => {
  assert.equal(classifyProductType('MEMOSENS-CYA', 'Digital sensor'), 'E+H Analysis');
});

test('classifyProductType: Analysis — CAS prefix', () => {
  assert.equal(classifyProductType('CAS40D-ABC', 'Some sensor'), 'E+H Analysis');
});

test('classifyProductType: Analysis — STAMOSENS description', () => {
  assert.equal(classifyProductType('XYZ-001', 'Stamosens CCS120'), 'E+H Analysis');
});

test('classifyProductType: General — unrecognized product', () => {
  assert.equal(classifyProductType('WIDGET-42', 'Unknown widget'), 'E+H General');
});

test('classifyProductType: case insensitive matching', () => {
  assert.equal(classifyProductType('fmr60-abc', 'micropilot'), 'E+H Level');
});

// ── EUR to BHD conversion tests ─────────────────────────────────────────────

test('eurToBhdFils: EUR_TO_BHD_RATE is 0.41', () => {
  assert.equal(EUR_TO_BHD_RATE, 0.41);
});

test('eurToBhdFils: converts 1000 EUR correctly', () => {
  // 1000 * 0.41 * 1000 = 410_000 fils = 410 BHD
  assert.equal(eurToBhdFils(1000), 410000n);
});

test('eurToBhdFils: converts 2250 EUR correctly', () => {
  // 2250 * 0.41 * 1000 = 922_500 fils
  assert.equal(eurToBhdFils(2250), 922500n);
});

test('eurToBhdFils: zero EUR gives zero fils', () => {
  assert.equal(eurToBhdFils(0), 0n);
});

test('eurToBhdFils: fractional EUR rounds correctly', () => {
  // 1.50 EUR * 0.41 * 1000 = 615 fils
  assert.equal(eurToBhdFils(1.50), 615n);
});

test('eurToBhdFils: very large EUR value', () => {
  // 1_000_000 * 0.41 * 1000 = 410_000_000 fils
  assert.equal(eurToBhdFils(1_000_000), 410000000n);
});

// ── computeItemCosting tests ─────────────────────────────────────────────────

test('computeItemCosting: E+H Flow applies 20% target markup', () => {
  const result = computeItemCosting({
    unitSalesPriceEUR: 1000,
    itemSalesPriceEUR: 1000,
    quantity: 1,
    productType: 'E+H Flow',
  });

  // Unit cost: 1000 * 0.41 * 1000 = 410_000 fils
  assert.equal(result.unitCostBHDFils, 410000n);
  // Unit sell: 410_000 * 1.20 = 492_000 fils
  assert.equal(result.unitSellBHDFils, 492000n);
  // Unit profit: 492_000 - 410_000 = 82_000 fils
  assert.equal(result.unitProfitBHDFils, 82000n);
  assert.equal(result.targetMarkupPct, 20);
  assert.equal(result.minMarkupPct, 12);
});

test('computeItemCosting: quantity multiplies sell and profit', () => {
  const result = computeItemCosting({
    unitSalesPriceEUR: 500,
    itemSalesPriceEUR: 1500,
    quantity: 3,
    productType: 'E+H Pressure',
  });

  // Unit cost: 500 * 0.41 * 1000 = 205_000 fils
  assert.equal(result.unitCostBHDFils, 205000n);
  // Unit sell: 205_000 * 1.20 = 246_000 fils
  assert.equal(result.unitSellBHDFils, 246000n);
  // Item sell: 246_000 * 3 = 738_000 fils
  assert.equal(result.itemSellBHDFils, 738000n);
  // Item profit: (246_000 - 205_000) * 3 = 123_000 fils
  assert.equal(result.itemProfitBHDFils, 123000n);
});

test('computeItemCosting: E+H Analysis applies 25% target markup', () => {
  const result = computeItemCosting({
    unitSalesPriceEUR: 1000,
    itemSalesPriceEUR: 1000,
    quantity: 1,
    productType: 'E+H Analysis',
  });

  // Unit cost: 410_000 fils
  // Unit sell: 410_000 * 1.25 = 512_500 fils
  assert.equal(result.unitSellBHDFils, 512500n);
  assert.equal(result.targetMarkupPct, 25);
  assert.equal(result.minMarkupPct, 15);
});

test('computeItemCosting: unknown product type falls back to Default markup', () => {
  const result = computeItemCosting({
    unitSalesPriceEUR: 100,
    itemSalesPriceEUR: 100,
    quantity: 1,
    productType: 'E+H General',
  });

  // Default: target 25%
  // Unit cost: 100 * 0.41 * 1000 = 41_000 fils
  // Unit sell: 41_000 * 1.25 = 51_250 fils
  assert.equal(result.unitCostBHDFils, 41000n);
  assert.equal(result.unitSellBHDFils, 51250n);
  assert.equal(result.targetMarkupPct, 25);
  assert.equal(result.minMarkupPct, 15);
});

test('computeItemCosting: zero price produces zero values', () => {
  const result = computeItemCosting({
    unitSalesPriceEUR: 0,
    itemSalesPriceEUR: 0,
    quantity: 1,
    productType: 'E+H Flow',
  });

  assert.equal(result.unitCostBHDFils, 0n);
  assert.equal(result.unitSellBHDFils, 0n);
  assert.equal(result.unitProfitBHDFils, 0n);
});

// ── parseEHBasketXML integration tests ───────────────────────────────────────

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Basket positionsCount="2">
  <Header>
    <Customer>
      <CustomerNumber>8012210</CustomerNumber>
      <CustomerName>PH TRADING WLL</CustomerName>
    </Customer>
    <Pricing>
      <TotalsSales>
        <NetValue currency="EUR">5995.50</NetValue>
        <Freight currency="EUR">599.56</Freight>
        <GrossValue currency="EUR">6595.06</GrossValue>
      </TotalsSales>
    </Pricing>
  </Header>
  <Item>
    <Product>
      <OrderCode>CM442-3RT0/0</OrderCode>
      <OrderCodeLong>CM442-AAM2A1F210+AK</OrderCodeLong>
      <Quantity unit="Piece">1</Quantity>
      <Texts>
        <ShortDescription>Liquiline CM442</ShortDescription>
      </Texts>
    </Product>
    <ItemPricing>
      <ItemListPrice currency="EUR">2500.00</ItemListPrice>
      <ItemDiscount currency="EUR">250.00</ItemDiscount>
      <UnitSalesPrice currency="EUR">2250.00</UnitSalesPrice>
      <ItemSalesPrice currency="EUR">2250.00</ItemSalesPrice>
    </ItemPricing>
    <Delivery>
      <ProductionTime>3-4 weeks</ProductionTime>
    </Delivery>
  </Item>
  <Item>
    <Product>
      <OrderCode>FMR60-ABC</OrderCode>
      <OrderCodeLong>FMR60-XXYYZZAA</OrderCodeLong>
      <Quantity unit="Piece">2</Quantity>
      <Texts>
        <ShortDescription>Micropilot FMR60</ShortDescription>
      </Texts>
    </Product>
    <ItemPricing>
      <ItemListPrice currency="EUR">1800.00</ItemListPrice>
      <ItemDiscount currency="EUR">180.00</ItemDiscount>
      <UnitSalesPrice currency="EUR">1620.00</UnitSalesPrice>
      <ItemSalesPrice currency="EUR">3240.00</ItemSalesPrice>
    </ItemPricing>
    <Delivery>
      <ProductionTime>5-6 weeks</ProductionTime>
    </Delivery>
  </Item>
</Basket>`;

test('parseEHBasketXML: parses header fields correctly', () => {
  const basket = parseEHBasketXML(SAMPLE_XML);
  assert.equal(basket.customerNumber, '8012210');
  assert.equal(basket.customerName, 'PH TRADING WLL');
  assert.equal(basket.positionsCount, 2);
  assert.equal(basket.netValueEUR, 5995.50);
  assert.equal(basket.freightEUR, 599.56);
  assert.equal(basket.grossValueEUR, 6595.06);
});

test('parseEHBasketXML: parses correct number of items', () => {
  const basket = parseEHBasketXML(SAMPLE_XML);
  assert.equal(basket.items.length, 2);
});

test('parseEHBasketXML: first item fields are correct', () => {
  const basket = parseEHBasketXML(SAMPLE_XML);
  const item = basket.items[0];
  assert.equal(item.orderCode, 'CM442-3RT0/0');
  assert.equal(item.orderCodeLong, 'CM442-AAM2A1F210+AK');
  assert.equal(item.shortDescription, 'Liquiline CM442');
  assert.equal(item.quantity, 1);
  assert.equal(item.quantityUnit, 'Piece');
  assert.equal(item.listPriceEUR, 2500.00);
  assert.equal(item.discountEUR, 250.00);
  assert.equal(item.unitSalesPriceEUR, 2250.00);
  assert.equal(item.productionTime, '3-4 weeks');
  assert.equal(item.productType, 'E+H Flow');
});

test('parseEHBasketXML: second item has correct quantity and type', () => {
  const basket = parseEHBasketXML(SAMPLE_XML);
  const item = basket.items[1];
  assert.equal(item.orderCode, 'FMR60-ABC');
  assert.equal(item.quantity, 2);
  assert.equal(item.productType, 'E+H Level');
});

test('parseEHBasketXML: BHD cost calculations are correct', () => {
  const basket = parseEHBasketXML(SAMPLE_XML);

  // Item 1: CM442 — unitSalesPrice 2250 EUR
  // unitCost = 2250 * 0.41 * 1000 = 922_500 fils
  assert.equal(basket.items[0].unitCostBHDFils, 922500n);
  // unitSell = 922_500 * 1.20 = 1_107_000 fils (Flow → 20% markup)
  assert.equal(basket.items[0].unitSellBHDFils, 1107000n);

  // Item 2: FMR60 — unitSalesPrice 1620 EUR, qty 2
  // unitCost = 1620 * 0.41 * 1000 = 664_200 fils
  assert.equal(basket.items[1].unitCostBHDFils, 664200n);
  // unitSell = 664_200 * 1.20 = 797_040 fils (Level → 20% markup)
  assert.equal(basket.items[1].unitSellBHDFils, 797040n);
  // itemSell = 797_040 * 2 = 1_594_080 fils
  assert.equal(basket.items[1].itemSellBHDFils, 1594080n);
});

test('parseEHBasketXML: basket totals are sums of items', () => {
  const basket = parseEHBasketXML(SAMPLE_XML);

  // Item 1 itemCost: 2250 * 0.41 * 1000 = 922_500
  // Item 2 itemCost: 3240 * 0.41 * 1000 = 1_328_400
  // totalCost = 922_500 + 1_328_400 = 2_250_900
  assert.equal(basket.totalCostBHDFils, 2250900n);

  // Item 1 itemSell: 1_107_000
  // Item 2 itemSell: 1_594_080
  // totalSell = 1_107_000 + 1_594_080 = 2_701_080
  assert.equal(basket.totalSellBHDFils, 2701080n);

  // totalProfit = 2_701_080 - 2_250_900 = 450_180
  assert.equal(basket.totalProfitBHDFils, 450180n);
});

test('parseEHBasketXML: overall margin percentage is correct', () => {
  const basket = parseEHBasketXML(SAMPLE_XML);
  // margin = (450_180 * 10000) / 2_701_080 = 1666 → 16.66
  assert.equal(basket.overallMarginPct, 16.66);
});

test('parseEHBasketXML: no warnings for well-formed XML', () => {
  const basket = parseEHBasketXML(SAMPLE_XML);
  assert.equal(basket.warnings.length, 0);
});

test('parseEHBasketXML: warns on positionsCount mismatch', () => {
  const xml = SAMPLE_XML.replace('positionsCount="2"', 'positionsCount="5"');
  const basket = parseEHBasketXML(xml);
  assert.equal(basket.warnings.length, 1);
  assert.ok(basket.warnings[0].includes('positionsCount=5'));
});

test('parseEHBasketXML: throws on malformed XML', () => {
  assert.throws(() => parseEHBasketXML('<not closed'), /XML parse error|Missing <Basket>/);
});

test('parseEHBasketXML: throws on missing Basket element', () => {
  assert.throws(
    () => parseEHBasketXML('<?xml version="1.0"?><Root></Root>'),
    /Missing <Basket> root element/
  );
});

test('parseEHBasketXML: handles empty basket (no items)', () => {
  const xml = `<Basket positionsCount="0">
    <Header>
      <Customer>
        <CustomerNumber>1234</CustomerNumber>
        <CustomerName>Test Co</CustomerName>
      </Customer>
      <Pricing>
        <TotalsSales>
          <NetValue currency="EUR">0</NetValue>
          <Freight currency="EUR">0</Freight>
          <GrossValue currency="EUR">0</GrossValue>
        </TotalsSales>
      </Pricing>
    </Header>
  </Basket>`;
  const basket = parseEHBasketXML(xml);
  assert.equal(basket.items.length, 0);
  assert.equal(basket.totalCostBHDFils, 0n);
  assert.equal(basket.totalSellBHDFils, 0n);
  assert.equal(basket.overallMarginPct, 0);
});

test('parseEHBasketXML: skips items with missing OrderCode and warns', () => {
  const xml = `<Basket positionsCount="1">
    <Header>
      <Customer>
        <CustomerNumber>999</CustomerNumber>
        <CustomerName>Test</CustomerName>
      </Customer>
      <Pricing>
        <TotalsSales>
          <NetValue currency="EUR">0</NetValue>
          <Freight currency="EUR">0</Freight>
          <GrossValue currency="EUR">0</GrossValue>
        </TotalsSales>
      </Pricing>
    </Header>
    <Item>
      <Product>
        <OrderCodeLong>MISSING-SHORT</OrderCodeLong>
        <Quantity unit="Piece">1</Quantity>
        <Texts>
          <ShortDescription>No order code</ShortDescription>
        </Texts>
      </Product>
      <ItemPricing>
        <ItemListPrice currency="EUR">100</ItemListPrice>
        <ItemDiscount currency="EUR">0</ItemDiscount>
        <UnitSalesPrice currency="EUR">100</UnitSalesPrice>
        <ItemSalesPrice currency="EUR">100</ItemSalesPrice>
      </ItemPricing>
      <Delivery>
        <ProductionTime>1 week</ProductionTime>
      </Delivery>
    </Item>
  </Basket>`;
  const basket = parseEHBasketXML(xml);
  assert.equal(basket.items.length, 0);
  assert.ok(basket.warnings.some((w) => w.includes('missing OrderCode')));
});

// ── getProductTypeStats tests ────────────────────────────────────────────────

function makeBasket(items: ParsedEHItem[]): ParsedEHBasket {
  const totalCostBHDFils = items.reduce((s, it) => s + it.itemCostBHDFils, 0n);
  const totalSellBHDFils = items.reduce((s, it) => s + it.itemSellBHDFils, 0n);
  const totalProfitBHDFils = totalSellBHDFils - totalCostBHDFils;
  return {
    customerNumber: 'TEST',
    customerName: 'Test Co',
    positionsCount: items.length,
    netValueEUR: 0,
    freightEUR: 0,
    grossValueEUR: 0,
    totalCostBHDFils,
    totalSellBHDFils,
    totalProfitBHDFils,
    overallMarginPct: 0,
    items,
    warnings: [],
  };
}

function makeItem(overrides: Partial<ParsedEHItem>): ParsedEHItem {
  return {
    orderCode: 'TEST-001',
    orderCodeLong: 'TEST-001-LONG',
    shortDescription: 'Test item',
    quantity: 1,
    quantityUnit: 'Piece',
    listPriceEUR: 0,
    discountEUR: 0,
    unitSalesPriceEUR: 0,
    itemSalesPriceEUR: 0,
    productionTime: '',
    productType: 'E+H Flow',
    unitCostBHDFils: 100000n,
    itemCostBHDFils: 100000n,
    targetMarkupPct: 20,
    minMarkupPct: 12,
    unitSellBHDFils: 120000n,
    itemSellBHDFils: 120000n,
    unitProfitBHDFils: 20000n,
    itemProfitBHDFils: 20000n,
    ...overrides,
  };
}

test('getProductTypeStats: groups items by product type', () => {
  const basket = makeBasket([
    makeItem({ productType: 'E+H Flow' }),
    makeItem({ productType: 'E+H Flow' }),
    makeItem({ productType: 'E+H Level' }),
  ]);

  const stats = getProductTypeStats(basket);
  assert.equal(stats.length, 2);

  const flowStat = stats.find((s) => s.productType === 'E+H Flow');
  assert.ok(flowStat);
  assert.equal(flowStat.itemCount, 2);
  assert.equal(flowStat.totalCostBHDFils, 200000n);
  assert.equal(flowStat.totalSellBHDFils, 240000n);
  assert.equal(flowStat.totalProfitBHDFils, 40000n);

  const levelStat = stats.find((s) => s.productType === 'E+H Level');
  assert.ok(levelStat);
  assert.equal(levelStat.itemCount, 1);
});

test('getProductTypeStats: empty basket returns empty stats', () => {
  const basket = makeBasket([]);
  const stats = getProductTypeStats(basket);
  assert.equal(stats.length, 0);
});

test('getProductTypeStats: single item basket', () => {
  const basket = makeBasket([
    makeItem({
      productType: 'E+H Analysis',
      unitCostBHDFils: 410000n,
      itemCostBHDFils: 410000n,
      unitSellBHDFils: 512500n,
      itemSellBHDFils: 512500n,
      unitProfitBHDFils: 102500n,
      itemProfitBHDFils: 102500n,
    }),
  ]);

  const stats = getProductTypeStats(basket);
  assert.equal(stats.length, 1);
  assert.equal(stats[0].productType, 'E+H Analysis');
  assert.equal(stats[0].totalProfitBHDFils, 102500n);
  // margin = (102500 * 10000) / 512500 = 2000 → 20.00%
  assert.equal(stats[0].averageMarginPct, 20);
});

test('getProductTypeStats: computes correct average margin per type', () => {
  const basket = makeBasket([
    makeItem({
      productType: 'E+H Flow',
      itemCostBHDFils: 1000n,
      itemSellBHDFils: 2000n,
      itemProfitBHDFils: 1000n,
    }),
  ]);

  const stats = getProductTypeStats(basket);
  const flow = stats.find((s) => s.productType === 'E+H Flow');
  assert.ok(flow);
  // margin = (1000 * 10000) / 2000 = 5000 → 50%
  assert.equal(flow.averageMarginPct, 50);
});

// ── Full integration test ────────────────────────────────────────────────────

test('full integration: parseEHBasketXML → getProductTypeStats round-trip', () => {
  const basket = parseEHBasketXML(SAMPLE_XML);
  const stats = getProductTypeStats(basket);

  // Should have 2 product types: E+H Flow and E+H Level
  assert.equal(stats.length, 2);

  const types = stats.map((s) => s.productType).sort();
  assert.deepEqual(types, ['E+H Flow', 'E+H Level']);

  // Flow: 1 item, Level: 1 item (even though Level has qty 2, it's 1 line item)
  const flow = stats.find((s) => s.productType === 'E+H Flow');
  const level = stats.find((s) => s.productType === 'E+H Level');
  assert.ok(flow);
  assert.ok(level);
  assert.equal(flow.itemCount, 1);
  assert.equal(level.itemCount, 1);
});

// ── Report ───────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error(`\n${failures.length} test(s) failed:`);
  for (const name of failures) {
    console.error(`  - ${name}`);
  }
  process.exit(1);
} else {
  console.log(`\nAll tests passed.`);
}
