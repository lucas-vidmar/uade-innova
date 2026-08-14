import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..', '..');

async function readRepoFile(relativePath) {
  const fullPath = resolve(repoRoot, relativePath);
  return readFile(fullPath, 'utf8');
}

test('openai.bicep defines a RAI content-safety policy (jailbreak shield) (#221)', async () => {
  const content = await readRepoFile('infra/modules/openai.bicep');

  assert.match(content, /raiPolicies@/);
  assert.match(content, /jailbreak-shield/);
  assert.match(content, /Microsoft\.Default/);
  assert.match(content, /Jailbreak/);
  assert.match(content, /Indirect Attack/);
  assert.match(content, /enabled:\s*true/);
  assert.match(content, /blocking:\s*true/);
});

test('openai.bicep binds the RAI policy to the chat deployment (#221)', async () => {
  const content = await readRepoFile('infra/modules/openai.bicep');

  // The gpt chat deployment must reference the jailbreak-shield RAI policy.
  assert.match(content, /raiPolicyName:\s*raiPolicy\.name/);
  assert.match(content, /gptDeploymentName/);
});
