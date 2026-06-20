import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..', '..');

async function readRepoFile(relativePath) {
  const fullPath = resolve(repoRoot, relativePath);
  return readFile(fullPath, 'utf8');
}

test('TTFT anomaly alert Bicep compiles without errors', () => {
  const result = execSync(
    `az bicep build --file "${resolve(repoRoot, 'infra/modules/ttft-anomaly-alert.bicep')}" --stdout`,
    { encoding: 'utf8', timeout: 30000 }
  );
  const parsed = JSON.parse(result);
  assert.ok(parsed, 'Bicep compilation produced a JSON output');
  assert.equal(typeof parsed, 'object');
});

test('TTFT anomaly alert module defines a scheduled query rule', async () => {
  const content = await readRepoFile('infra/modules/ttft-anomaly-alert.bicep');

  assert.match(content, /Microsoft\.Insights\/scheduledQueryRules@2023-12-01/);
  assert.match(content, /AppEvents/);
  assert.match(content, /TimeGenerated/);
  assert.match(content, /RagQuery\.Executed/);
  assert.match(content, /llmFirstTokenLatencyMs/);
  assert.match(content, /percentile\(llmFirstTokenLatencyMs,\s*95\)/);
  assert.match(content, /windowSize:\s*lookbackWindow/);
});

test('TTFT anomaly alert module has configurable parameters', async () => {
  const content = await readRepoFile('infra/modules/ttft-anomaly-alert.bicep');

  assert.match(content, /param\s+ttftThresholdMs\s+int\s*=\s*2000/);
  assert.match(content, /param\s+lookbackWindow\s+string\s*=\s*'PT15M'/);
  assert.match(content, /param\s+minimumSamples\s+int\s*=\s*3/);
  assert.match(content, /param\s+severity\s+int\s*=\s*2/);
  assert.match(content, /param\s+evaluationFrequency\s+string\s*=\s*'PT5M'/);
});

test('TTFT alert is resilient to no-traffic periods via minimumSamples filter', async () => {
  const content = await readRepoFile('infra/modules/ttft-anomaly-alert.bicep');

  assert.match(content, /sampleCount\s*=\s*count\(\)/);
  assert.match(content, /where\s+sampleCount\s*>=\s*\{minimumSamples\}/);
  assert.match(content, /minimumSamples.*format\('/s);
  assert.match(content, /minimumSamples\}.*format\('/s);
});

test('TTFT alert payload includes subjectId dimensions', async () => {
  const content = await readRepoFile('infra/modules/ttft-anomaly-alert.bicep');

  assert.match(content, /Properties\.subjectId/);
  assert.match(content, /by\s+subjectId/);
  assert.match(content, /name:\s+'subjectId'/);
  assert.match(content, /project\s+subjectId,\s*ttftP95Ms,\s*sampleCount/);
});

test('TTFT alert uses autoMitigate for automatic resolution', async () => {
  const content = await readRepoFile('infra/modules/ttft-anomaly-alert.bicep');

  assert.match(content, /autoMitigate:\s*true/);
});

test('main.bicep wires TTFT anomaly alert behind notification email', async () => {
  const content = await readRepoFile('infra/main.bicep');

  assert.match(content, /module\s+ttftAnomalyAlert\s+'\.\/modules\/ttft-anomaly-alert\.bicep'\s*=\s*if\s*\(!empty\(notificationEmail\)\)/);
  assert.match(content, /workspaceId:\s*appInsights\.outputs\.logAnalyticsWorkspaceId/);
  assert.match(content, /notificationEmail:\s*notificationEmail/);
  assert.match(content, /ttftThresholdMs:\s*ttftAnomalyThresholdMs/);
  assert.match(content, /severity:\s*ttftAnomalySeverity/);
  assert.match(content, /lookbackWindow:\s*'PT15M'/);
  assert.match(content, /minimumSamples:\s*3/);
});

test('main.bicep defines TTFT threshold and severity parameters', async () => {
  const content = await readRepoFile('infra/main.bicep');

  assert.match(content, /param\s+ttftAnomalyThresholdMs\s+int\s*=\s*2000/);
  assert.match(content, /param\s+ttftAnomalySeverity\s+int\s*=\s*2/);
});
