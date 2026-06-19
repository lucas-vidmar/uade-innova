import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repoRoot = resolve(process.cwd(), '..');

async function readRepoFile(relativePath) {
  const fullPath = resolve(repoRoot, relativePath);
  return readFile(fullPath, 'utf8');
}

test('anomalous usage alert module defines 1M tokens/24h KQL rule', async () => {
  const content = await readRepoFile('infra/modules/anomalous-usage-alert.bicep');

  assert.match(content, /Microsoft\.Insights\/scheduledQueryRules@2023-12-01/);
  assert.match(content, /customEvents/);
  assert.match(content, /AppEvents/);
  assert.match(content, /union\s+isfuzzy=true/);
  assert.match(content, /sum\(coalesce\(totalTokens,\s*0\.0\)\)/);
  assert.match(content, /where\s+tokens24h\s*>\s*1000000/);
  assert.match(content, /windowSize:\s*'PT24H'/);
});

test('main.bicep wires anomalous usage alert behind notification email', async () => {
  const content = await readRepoFile('infra/main.bicep');

  assert.match(content, /module\s+anomalousUsageAlert\s+'\.\/modules\/anomalous-usage-alert\.bicep'\s*=\s*if\s*\(!empty\(notificationEmail\)\)/);
  assert.match(content, /workspaceId:\s*appInsights\.outputs\.logAnalyticsWorkspaceId/);
  assert.match(content, /notificationEmail:\s*notificationEmail/);
  assert.match(content, /subjectTokenThreshold:\s*500000/);
});

test('per-subject anomalous usage alert rule is defined with lower threshold and subjectId grouping', async () => {
  const content = await readRepoFile('infra/modules/anomalous-usage-alert.bicep');

  assert.match(content, /param\s+subjectTokenThreshold\s+int\s*=\s*500000/);
  assert.match(content, /perSubjectUsageRule/);
  assert.match(content, /'\$\{scheduledQueryRuleName\}-per-subject'/);
  assert.match(content, /customDimensions\.subjectId/);
  assert.match(content, /summarize\s+tokens24h\s*=\s*sum\(coalesce\(totalTokens,\s*0\.0\)\)\s+by\s+userId,\s*subjectId/);
  assert.match(content, /where\s+tokens24h\s*>\s*\$\{subjectTokenThreshold\}/);
  assert.match(content, /name:\s+'subjectId'/);
});
