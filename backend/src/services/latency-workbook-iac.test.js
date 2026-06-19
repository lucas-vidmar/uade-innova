import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repoRoot = resolve(process.cwd(), '..');

async function readRepoFile(relativePath) {
  return readFile(resolve(repoRoot, relativePath), 'utf8');
}

test('latency workbook defines vector search and RAG latency percentiles', async () => {
  const workbookContent = await readRepoFile('infra/modules/latency-workbook.bicep');

  assert.match(workbookContent, /vector\.search/);
  assert.match(workbookContent, /RAGInteraction/);
  assert.match(workbookContent, /percentile.*duration.*5[09]/);
  assert.match(workbookContent, /P50/);
  assert.match(workbookContent, /P95/);
  assert.match(workbookContent, /P99/);
});

test('latency workbook includes subjectId and promptVersion filters', async () => {
  const workbookContent = await readRepoFile('infra/modules/latency-workbook.bicep');

  assert.match(workbookContent, /SubjectId/);
  assert.match(workbookContent, /PromptVersion/);
});

test('latency workbook supports time range selector (24h, 7d, 30d)', async () => {
  const workbookContent = await readRepoFile('infra/modules/latency-workbook.bicep');

  assert.match(workbookContent, /3600000/);
  assert.match(workbookContent, /86400000/);
  assert.match(workbookContent, /604800000/);
  assert.match(workbookContent, /2592000000/);
});

test('latency workbook documents KQL queries in markdown', async () => {
  const workbookContent = await readRepoFile('infra/modules/latency-workbook.bicep');

  assert.match(workbookContent, /KQL.*Reference|kqlReference/);
});

test('main.bicep wires latency workbook module', async () => {
  const mainContent = await readRepoFile('infra/main.bicep');

  assert.match(mainContent, /latency-workbook\.bicep/);
  assert.match(mainContent, /latencyWorkbook/);
  assert.match(mainContent, /appInsights\.outputs\.appInsightsId/);
});
