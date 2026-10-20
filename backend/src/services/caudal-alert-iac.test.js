import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repoRoot = resolve(process.cwd(), '..');

async function readRepoFile(relativePath) {
    const fullPath = resolve(repoRoot, relativePath);
    return readFile(fullPath, 'utf8');
}

test('caudal alert module mails the operator when the service crosses the reserved threshold', async () => {
    const content = await readRepoFile('infra/modules/caudal-alert.bicep');

    assert.match(content, /Microsoft\.Insights\/scheduledQueryRules@2023-12-01/);
    assert.match(content, /AppEvents/);
    assert.match(content, /Properties\.kind\) == "threshold"/);
    assert.match(content, /CaudalEvent/);
    assert.match(content, /evaluationFrequency:\s*'PT5M'/);
    assert.match(content, /windowSize:\s*'PT5M'/);
    assert.match(content, /emailReceivers/);
});

test('caudal alert module also watches sustained denials, not just the crossing', async () => {
    const content = await readRepoFile('infra/modules/caudal-alert.bicep');

    assert.match(content, /param\s+denialSurgeThreshold\s+int\s*=\s*50/);
    assert.match(content, /Properties\.kind\) == "denial"/);
    assert.match(content, /\$\{scheduledQueryRuleName\}-denegaciones/);
    assert.match(content, /summarize\s+denials\s*=\s*count\(\)\s+by\s+caudalClass,\s*reason/);
    assert.match(content, /where\s+denials\s*>=\s*\{threshold\}/);
});

test('main.bicep wires the caudal alert behind the operator notification email', async () => {
    const content = await readRepoFile('infra/main.bicep');

    assert.match(content, /module\s+caudalAlert\s+'\.\/modules\/caudal-alert\.bicep'\s*=\s*if\s*\(!empty\(notificationEmail\)\)/);
    assert.match(content, /var caudalAlertName = 'alert-caudal-servicio-\$\{take\(resourceToken, 8\)\}'/);
    assert.match(content, /workspaceId:\s*appInsights\.outputs\.logAnalyticsWorkspaceId/);
    assert.match(content, /notificationEmail:\s*notificationEmail/);
    assert.match(content, /denialSurgeThreshold:\s*50/);
});
