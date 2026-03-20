import assert from 'node:assert/strict';
import { buildGrnDocDefinition, type GRNPdfInput } from './grnGenerator';

type PlainObject = Record<string, unknown>;

function extractText(node: unknown, output: string[] = []): string[] {
  if (typeof node === 'string') {
    output.push(node);
    return output;
  }
  if (Array.isArray(node)) {
    for (const child of node) extractText(child, output);
    return output;
  }
  if (!node || typeof node !== 'object') {
    return output;
  }

  const record = node as PlainObject;
  if (typeof record.image === 'string') {
    return output;
  }
  if (typeof record.text === 'string') {
    output.push(record.text);
  }
  for (const [key, value] of Object.entries(record)) {
    if (key !== 'image' && key !== 'text') {
      extractText(value, output);
    }
  }
  return output;
}

function createGrnInput(): GRNPdfInput {
  return {
    grnNumber: 'GRN-2026-001',
    purchaseOrderNumber: 'PO-2026-042',
    supplierName: 'Emerson Process Management',
    receivedDate: '2026-03-15',
    receivedBy: 'Ahmed Al-Khalifa',
    inspectionNotes: 'All items inspected — no visible damage.',
    status: 'Accepted',
    items: [
      {
        description: 'Rosemount 3051S Pressure Transmitter',
        quantityOrdered: 10,
        quantityReceived: 10,
        quantityAccepted: 10,
        notes: 'Serial numbers logged',
      },
      {
        description: 'Fisher DVC6200 Valve Positioner',
        quantityOrdered: 5,
        quantityReceived: 4,
        quantityAccepted: 4,
        notes: '1 unit back-ordered',
      },
    ],
  };
}

const cases: Array<{ name: string; fn: () => void }> = [];

function test(name: string, fn: () => void) {
  cases.push({ name, fn });
}

test('doc definition is a valid object with expected structure', () => {
  const docDef = buildGrnDocDefinition(createGrnInput()) as PlainObject;

  assert.equal(docDef.pageSize, 'A4');
  assert.ok(Array.isArray(docDef.content), 'content should be an array');
  assert.ok(docDef.styles && typeof docDef.styles === 'object', 'styles should be an object');
  assert.ok(docDef.defaultStyle && typeof docDef.defaultStyle === 'object', 'defaultStyle should be an object');
});

test('header fields are populated', () => {
  const docDef = buildGrnDocDefinition(createGrnInput());
  const allText = extractText(docDef).join(' | ');

  assert.match(allText, /GOODS RECEIVED NOTE/);
  assert.match(allText, /GRN Number/);
  assert.match(allText, /GRN-2026-001/);
  assert.match(allText, /PO Number/);
  assert.match(allText, /PO-2026-042/);
  assert.match(allText, /Emerson Process Management/);
  assert.match(allText, /Received By/);
  assert.match(allText, /Ahmed Al-Khalifa/);
});

test('items table has correct row count', () => {
  const docDef = buildGrnDocDefinition(createGrnInput()) as PlainObject;
  const content = docDef.content as PlainObject[];

  // Find the table node with headerRows (the items table)
  const tableNode = content.find(
    (n) => n.table && (n.table as PlainObject).headerRows === 1,
  ) as PlainObject | undefined;
  assert.ok(tableNode, 'items table should exist');

  const table = tableNode.table as PlainObject;
  const body = table.body as unknown[][];
  // 1 header row + 2 item rows + 1 totals row = 4
  assert.equal(body.length, 4, 'table should have header + 2 items + totals row');

  // Check totals row content
  const allText = extractText(docDef).join(' | ');
  assert.match(allText, /Rosemount 3051S Pressure Transmitter/);
  assert.match(allText, /Fisher DVC6200 Valve Positioner/);
  assert.match(allText, /Totals/);
});

test('status is included with correct value', () => {
  const docDef = buildGrnDocDefinition(createGrnInput());
  const allText = extractText(docDef).join(' | ');

  assert.match(allText, /Status/);
  assert.match(allText, /Accepted/);
});

test('handles empty items array', () => {
  const input = createGrnInput();
  input.items = [];

  const docDef = buildGrnDocDefinition(input) as PlainObject;
  const content = docDef.content as PlainObject[];

  const tableNode = content.find(
    (n) => n.table && (n.table as PlainObject).headerRows === 1,
  ) as PlainObject | undefined;
  assert.ok(tableNode, 'items table should exist even with no items');

  const table = tableNode.table as PlainObject;
  const body = table.body as unknown[][];
  // 1 header row + 0 items + 1 totals row = 2
  assert.equal(body.length, 2, 'table should have header + totals row only');

  // Totals should be 0
  const allText = extractText(docDef).join(' | ');
  assert.match(allText, /Totals/);
});

test('handles rejected status', () => {
  const input = createGrnInput();
  input.status = 'Rejected';
  input.inspectionNotes = 'Multiple items damaged in transit.';

  const docDef = buildGrnDocDefinition(input);
  const allText = extractText(docDef).join(' | ');

  assert.match(allText, /Rejected/);
  assert.match(allText, /Multiple items damaged in transit/);
});

test('footer text is present', () => {
  const docDef = buildGrnDocDefinition(createGrnInput());
  const allText = extractText(docDef).join(' | ');

  assert.match(allText, /This document confirms receipt of goods as listed above/);
});

test('inspection notes section is rendered', () => {
  const docDef = buildGrnDocDefinition(createGrnInput());
  const allText = extractText(docDef).join(' | ');

  assert.match(allText, /Inspection Notes/);
  assert.match(allText, /All items inspected/);
});

let failures = 0;
for (const testCase of cases) {
  try {
    testCase.fn();
    console.log(`PASS | ${testCase.name}`);
  } catch (error) {
    failures += 1;
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(`FAIL | ${testCase.name}`);
    console.error(message);
  }
}

process.exit(failures);
