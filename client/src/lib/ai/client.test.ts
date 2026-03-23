import assert from 'node:assert/strict';

import { extractSkillBlock } from './client';

const cases: Array<{ name: string; fn: () => void }> = [];

function test(name: string, fn: () => void): void {
  cases.push({ name, fn });
}

test('extractSkillBlock parses tagged asymmflow skill payloads', () => {
  const response = `I'll prepare that invoice now.\n<asymmflow-skill>{"skill":"create_invoice","params":{"customerId":42,"orderId":7}}</asymmflow-skill>`;
  const { cleanContent, skillBlock } = extractSkillBlock(response);

  assert.equal(cleanContent, `I'll prepare that invoice now.`);
  assert.deepEqual(skillBlock, {
    skill: 'create_invoice',
    params: { customerId: 42, orderId: 7 },
  });
});

test('extractSkillBlock parses fenced asymmflow skill payloads', () => {
  const response = `Need approval first.\n\n\`\`\`asymmflow-skill\n{"skill":"remember","params":{"category":"workflow_note","subject":"Seed audit","content":"Use canonical seed before client UAT."}}\n\`\`\``;
  const { cleanContent, skillBlock } = extractSkillBlock(response);

  assert.equal(cleanContent, 'Need approval first.');
  assert.deepEqual(skillBlock, {
    skill: 'remember',
    params: {
      category: 'workflow_note',
      subject: 'Seed audit',
      content: 'Use canonical seed before client UAT.',
    },
  });
});

test('extractSkillBlock preserves legacy trailing JSON compatibility', () => {
  const response = `I can update that pipeline.\n{"skill":"update_pipeline_status","params":{"pipelineId":5,"newStatus":"Won"}}`;
  const { cleanContent, skillBlock } = extractSkillBlock(response);

  assert.equal(cleanContent, 'I can update that pipeline.');
  assert.deepEqual(skillBlock, {
    skill: 'update_pipeline_status',
    params: { pipelineId: 5, newStatus: 'Won' },
  });
});

test('extractSkillBlock leaves normal prose untouched when no valid payload exists', () => {
  const response = `I need the pipeline ID before I can update anything.\n<asymmflow-skill>{"skill":"update_pipeline_status","params":invalid}</asymmflow-skill>`;
  const { cleanContent, skillBlock } = extractSkillBlock(response);

  assert.equal(cleanContent, response);
  assert.equal(skillBlock, null);
});

let failures = 0;
for (const testCase of cases) {
  try {
    console.log(`RUN | ${testCase.name}`);
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
