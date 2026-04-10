import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repoRoot = resolve(process.cwd(), '..');

async function readRepoFile(relativePath) {
  const fullPath = resolve(repoRoot, relativePath);
  return readFile(fullPath, 'utf8');
}

test('frontdoor module defines API rate limiting at 10 requests per minute', async () => {
  const content = await readRepoFile('infra/modules/frontdoor.bicep');

  assert.match(content, /ruleType:\s*'RateLimitRule'/);
  assert.match(content, /name:\s*'rate-limit-api-10rpm'/);
  assert.match(content, /rateLimitThreshold:\s*10/);
  assert.match(content, /rateLimitDurationInMinutes:\s*1/);
  assert.match(content, /action:\s*'Block'/);
  assert.match(content, /matchVariable:\s*'RequestUri'/);
  assert.match(content, /matchValue:\s*\[\s*'\/api\/'\s*\]/);
});

test('main.bicep enables Front Door module and stores profile id secret in Key Vault', async () => {
  const content = await readRepoFile('infra/main.bicep');

  assert.match(content, /module\s+frontDoor\s+'\.\/modules\/frontdoor\.bicep'\s*=\s*\{/);
  assert.match(content, /resource\s+fdSecret\s+'Microsoft\.KeyVault\/vaults\/secrets@2023-07-01'\s*=\s*\{/);
  assert.match(content, /value:\s*frontDoor\.outputs\.frontDoorId/);
  assert.match(content, /output\s+AZURE_FRONT_DOOR_URI\s+string\s*=\s*frontDoor\.outputs\.frontDoorUri/);
});
