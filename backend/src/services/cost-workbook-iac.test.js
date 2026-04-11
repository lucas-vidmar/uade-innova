import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repoRoot = resolve(process.cwd(), '..');

async function readRepoFile(relativePath) {
  return readFile(resolve(repoRoot, relativePath), 'utf8');
}

test('workbook defines required cost-per-interaction pricing formulas', async () => {
  const workbookContent = await readRepoFile('infra/modules/workbook.bicep');

  assert.match(workbookContent, /\$0\.15 \/ 1M/);
  assert.match(workbookContent, /\$0\.60 \/ 1M/);
  assert.match(workbookContent, /0\.00000015/);
  assert.match(workbookContent, /0\.0000006/);
  assert.match(workbookContent, /AvgCostPerInteraction/);
});

test('main.bicep wires workbook to Application Insights component id', async () => {
  const mainContent = await readRepoFile('infra/main.bicep');
  const appInsightsModuleContent = await readRepoFile('infra/modules/appinsights.bicep');

  assert.match(appInsightsModuleContent, /output\s+appInsightsId\s+string\s*=\s*appInsights\.id/);
  assert.match(mainContent, /appInsightsId:\s*appInsights\.outputs\.appInsightsId/);
});
