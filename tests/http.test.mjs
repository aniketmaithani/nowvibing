import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createRequestHandler, readJsonBody } from '../server/http.mjs';

async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'nowvibing-http-'));
  const root = join(dir, 'public');
  mkdirSync(root);
  writeFileSync(
    join(root, 'index.html'),
    '<!doctype html><script>window.ready=true</script>',
  );
  writeFileSync(join(dir, 'secret.txt'), 'private');
  symlinkSync(join(dir, 'secret.txt'), join(root, 'linked.txt'));
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const service = {
    async handle(req, res) {
      try {
        await readJsonBody(req);
        res.end('ok');
      } catch (error) {
        res.writeHead(error.status);
        res.end(error.message);
      }
    },
  };
  server.on('request', createRequestHandler({ service, root, origin }));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  });
  const send = (path, { method = 'GET', headers = {}, body = '' } = {}) =>
    new Promise((resolve, reject) => {
      const req = request(origin + path, { method, headers }, (res) => {
        let text = '';
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, text }),
        );
      });
      req.on('error', reject);
      req.end(body);
    });
  return { send, origin };
}
test('production responses prevent embedding and allow only hashed bootstrap scripts', async (t) => {
  const f = await fixture(t),
    response = await f.send('/');
  assert.equal(response.status, 200);
  assert.equal(response.headers['x-frame-options'], 'DENY');
  assert.equal(response.headers['referrer-policy'], 'no-referrer');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.ok(
    response.headers['content-security-policy'].includes(
      `'sha256-${createHash('sha256').update('window.ready=true').digest('base64')}'`,
    ),
  );
  assert.ok(
    !response.headers['content-security-policy']
      .split(';')[1]
      .includes('unsafe-inline'),
  );
  assert.equal((await f.send('/', { method: 'HEAD' })).text, '');
});
test('blocks malformed paths, file escapes, symlinks, and host spoofing without crashing', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.send('/%zz')).status, 400);
  for (const path of [
    '/..%2fsecret.txt',
    '/linked.txt',
    '/.local/state.json',
    '/%00',
  ])
    assert.equal((await f.send(path)).status, 404);
  assert.equal(
    (await f.send('/', { headers: { Host: 'evil.test' } })).status,
    403,
  );
  assert.equal((await f.send('/', { method: 'POST' })).status, 405);
  assert.equal((await f.send('/')).status, 200);
});
test('requires JSON, counts request bytes, and survives oversized multibyte bodies', async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.send('/api/test', { method: 'POST', body: '{}' })).status,
    415,
  );
  const options = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  };
  assert.equal(
    (await f.send('/api/test', { ...options, body: '{' })).status,
    400,
  );
  assert.equal(
    (
      await f.send('/api/test', {
        ...options,
        body: JSON.stringify({ text: '🎧'.repeat(5000) }),
      })
    ).status,
    413,
  );
  assert.equal(
    (await f.send('/api/test', { ...options, body: '{}' })).status,
    200,
  );
});
