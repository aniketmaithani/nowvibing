import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  statSync,
  symlinkSync,
  linkSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStateStore } from '../server/state-store.mjs';
import { defaults } from '../server/engine.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'nowvibing-storage-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
test('private storage preserves state across restart and leaves no temporary file', (t) => {
  const dir = fixture(t),
    storage = createStateStore(join(dir, 'data'));
  const initial = storage.load(defaults());
  initial.settings.fallback = 'Away';
  storage.save(initial);
  const restarted = createStateStore(join(dir, 'data'));
  assert.equal(restarted.load(defaults()).settings.fallback, 'Away');
  assert.equal(statSync(join(dir, 'data')).mode & 0o777, 0o700);
  assert.equal(statSync(join(dir, 'data/state.json')).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(join(dir, 'data')), ['state.json']);
});
test('refuses a symlinked data directory without changing the destination', (t) => {
  const dir = fixture(t);
  symlinkSync(dir, join(dir, 'alias'));
  assert.throws(() => createStateStore(join(dir, 'alias')), /real directory/);
});
test('refuses symlink and hard-link credential files without overwriting their targets', (t) => {
  const dir = fixture(t),
    target = join(dir, 'target');
  writeFileSync(target, 'leave this alone', { mode: 0o640 });
  const linked = createStateStore(join(dir, 'linked'));
  symlinkSync(target, join(dir, 'linked/state.json'));
  assert.throws(() => linked.load(defaults()), /Cannot safely read/);
  assert.throws(() => linked.save(defaults()), /regular file/);
  const hard = createStateStore(join(dir, 'hard'));
  linkSync(target, join(dir, 'hard/state.json'));
  assert.throws(() => hard.load(defaults()), /Cannot safely read/);
  assert.throws(() => hard.save(defaults()), /regular file/);
  assert.equal(readFileSync(target, 'utf8'), 'leave this alone');
  assert.equal(statSync(target).mode & 0o777, 0o640);
});
test('fails closed on corruption and oversize input without quoting sensitive data', (t) => {
  const dir = fixture(t),
    storage = createStateStore(dir);
  writeFileSync(join(dir, 'state.json'), '{"secret":"DO-NOT-REPORT');
  assert.throws(
    () => storage.load(defaults()),
    (e) =>
      !e.message.includes('DO-NOT-REPORT') &&
      /Cannot safely read/.test(e.message),
  );
  writeFileSync(join(dir, 'state.json'), '{}');
  assert.throws(() => storage.load(defaults()), /Cannot safely read/);
  writeFileSync(join(dir, 'state.json'), 'x'.repeat(1024 * 1024 + 1));
  assert.throws(() => storage.load(defaults()), /Cannot safely read/);
});
