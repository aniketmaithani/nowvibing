import test from 'node:test';
import assert from 'node:assert/strict';
import { findSecretKinds, forbiddenPath } from '../scripts/secret-patterns.mjs';

test('secret scanner detects credential shapes without returning credential values', () => {
  const slack = 'xoxp-' + '123456789-' + '987654321-' + 'a'.repeat(32);
  const github = 'ghp_' + 'b'.repeat(40);
  assert.deepEqual(findSecretKinds(slack), ['Slack token']);
  assert.deepEqual(findSecretKinds(github), ['GitHub token']);
  assert.deepEqual(
    findSecretKinds(JSON.stringify({ access_token: 'c'.repeat(40) })),
    ['embedded credential'],
  );
  assert.deepEqual(findSecretKinds('xoxp-fake-test'), []);
  assert.deepEqual(findSecretKinds('const token = process.env.TOKEN;'), []);
});
test('secret scanner rejects private and generated paths but accepts empty env templates', () => {
  for (const path of [
    '.local/state.json',
    '.local/snapshot.json',
    '.env',
    '.env.production',
    'node_modules/pkg/index.js',
    'server/private.key',
  ])
    assert.equal(forbiddenPath(path), true);
  for (const path of ['.env.example', 'README.md', 'app/page.tsx'])
    assert.equal(forbiddenPath(path), false);
});
