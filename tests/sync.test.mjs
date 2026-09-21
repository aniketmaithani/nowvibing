import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  statSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request as httpRequest } from 'node:http';
import {
  defaults,
  normalizePlayback,
  playlistId,
  resolveStatus,
} from '../server/engine.mjs';
import { createService } from '../server/service.mjs';
const id = '37i9dQZF1DX4sWSpwq3LiO';
const playing = {
  is_playing: true,
  currently_playing_type: 'track',
  device: { is_private_session: false },
  item: {
    name: 'Test track',
    artists: [{ name: 'Test artist' }],
    album: { name: 'Test album', images: [] },
    duration_ms: 200000,
  },
  context: { type: 'playlist', uri: `spotify:playlist:${id}` },
  progress_ms: 12000,
};

test('status priority, expiration, truncation, playlist parsing, and private sessions', () => {
  const store = defaults(),
    p = normalizePlayback(playing);
  assert.equal(resolveStatus(store, p).text, 'Test track — Test artist');
  store.settings.rules.push({ playlist: id, text: 'Focus', emoji: ':dart:' });
  assert.equal(resolveStatus(store, p).source, 'playlist');
  store.manual = { text: 'Meeting', emoji: ':coffee:', expiresAt: 2000 };
  assert.equal(resolveStatus(store, p, 1000).source, 'manual');
  assert.equal(resolveStatus(store, p, 2000).text, 'Focus');
  assert.equal(resolveStatus(store, { ...p, playing: false }, 3000).text, '');
  assert.equal(
    normalizePlayback({ ...playing, device: { is_private_session: true } }),
    null,
  );
  assert.equal(
    playlistId(`https://open.spotify.com/playlist/${id}?si=abc`),
    id,
  );
  assert.throws(() => playlistId('https://evil.test/playlist/no'));
  store.settings.rules = [];
  store.settings.format = '{track}';
  assert.equal(
    [...resolveStatus(store, { ...p, title: '🎧'.repeat(120) }, 3000).text]
      .length,
    100,
  );
});

async function fixture(t, { connected = true, expires = false } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'nowvibing-test-'));
  let clock = 1_800_000_000_000,
    mode = 'playing',
    spotifyCalls = 0,
    refreshes = 0;
  const posts = [];
  const exchanges = [];
  const store = defaults();
  if (connected) {
    store.spotify = {
      clientId: 'a'.repeat(32),
      tokens: {
        access_token: 'fake-access',
        refresh_token: 'fake-refresh',
        expiresAt: expires ? 0 : clock + 999999,
      },
    };
    store.slack = {
      token: 'xoxp-fake-test',
      name: 'Tester',
      workspace: 'Test',
    };
  }
  writeFileSync(join(dataDir, 'state.json'), JSON.stringify(store));
  const fetcher = async (url, options) => {
    if (url.includes('/api/token')) {
      refreshes++;
      return Response.json({
        access_token: 'fresh-access',
        refresh_token: 'fresh-refresh',
        expires_in: 3600,
      });
    }
    if (url.includes('api.spotify.com')) {
      spotifyCalls++;
      if (mode === 'limited')
        return Response.json(
          { reason: 'QUOTA_EXCEEDED' },
          { status: 429, headers: { 'retry-after': '90' } },
        );
      if (mode === 'idle') return new Response(null, { status: 204 });
      if (mode === 'private')
        return Response.json({
          ...playing,
          device: { is_private_session: true },
        });
      return Response.json(playing);
    }
    if (url.endsWith('oauth.v2.access')) {
      const params = Object.fromEntries(options.body);
      exchanges.push(params);
      if (params.grant_type === 'refresh_token')
        return Response.json({
          ok: true,
          token_type: 'user',
          access_token: 'xoxe.xoxp-refreshed',
          refresh_token: 'xoxe-new-refresh',
          expires_in: 43200,
        });
      return Response.json({
        ok: true,
        authed_user: {
          token_type: 'user',
          scope: 'users.profile:write',
          access_token: 'xoxe.xoxp-initial',
          refresh_token: 'xoxe-initial-refresh',
          expires_in: 43200,
        },
      });
    }
    if (url.endsWith('auth.test'))
      return Response.json({ ok: true, user: 'Tester', team: 'Test' });
    if (url.endsWith('users.profile.set')) {
      posts.push(JSON.parse(options.body).profile);
      return Response.json({ ok: true });
    }
    throw new Error(`Unexpected external call: ${url}`);
  };
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const service = createService({
    dataDir,
    origin,
    fetcher,
    now: () => clock,
    poll: false,
  });
  server.on('request', (req, res) => void service.handle(req, res));
  t.after(async () => {
    service.close();
    await new Promise((r) => server.close(r));
    rmSync(dataDir, { recursive: true, force: true });
  });
  const post = (path, body) =>
    fetch(origin + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': service.publicState().csrf,
        Origin: origin,
      },
      body: JSON.stringify(body),
    });
  return {
    service,
    origin,
    post,
    posts,
    exchanges,
    dataDir,
    advance: (ms) => (clock += ms),
    mode: (v) => (mode = v),
    calls: () => spotifyCalls,
    refreshes: () => refreshes,
  };
}

test('syncs, deduplicates, renews expiry, restores music after manual override, clears on pause', async (t) => {
  const f = await fixture(t);
  await f.service.tick();
  assert.equal(f.posts.at(-1).status_text, 'Test track — Test artist');
  f.advance(15000);
  await f.service.tick();
  assert.equal(f.posts.length, 1);
  f.advance(60000);
  await f.service.tick();
  assert.equal(f.posts.length, 2);
  f.advance(15000);
  assert.equal(
    (
      await f.post('/api/status', {
        text: 'Deep work',
        emoji: ':dart:',
        minutes: 30,
      })
    ).status,
    200,
  );
  assert.equal(f.posts.at(-1).status_text, 'Deep work');
  f.advance(30 * 60000);
  await f.service.tick();
  assert.equal(f.posts.at(-1).status_text, 'Test track — Test artist');
  f.advance(15000);
  f.mode('idle');
  await f.service.tick();
  assert.equal(f.posts.at(-1).status_text, '');
  assert.equal(f.posts.at(-1).status_emoji, '');
});

test('playlist rules, pause switch, persisted credentials and secret redaction', async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await f.post('/api/rules', {
        playlist: `spotify:playlist:${id}`,
        name: 'Focus',
        text: 'In the zone',
        emoji: ':dart:',
      })
    ).status,
    200,
  );
  await f.service.tick();
  assert.equal(f.posts.at(-1).status_text, 'In the zone');
  assert.equal(
    (
      await f.post('/api/rules', {
        playlist: id,
        name: 'Duplicate',
        text: 'No',
        emoji: ':dart:',
      })
    ).status,
    400,
  );
  const before = f.posts.length;
  await f.post('/api/settings', { enabled: false });
  f.advance(15000);
  await f.post('/api/status', {
    text: 'Paused draft',
    emoji: ':coffee:',
    minutes: 0,
  });
  await f.service.tick();
  assert.equal(f.posts.length, before);
  const state = await (await fetch(f.origin + '/api/state')).text();
  assert.ok(
    !state.includes('fake-access') &&
      !state.includes('fake-refresh') &&
      !state.includes('xoxp-fake'),
  );
  assert.equal(statSync(join(f.dataDir, 'state.json')).mode & 0o777, 0o600);
  assert.equal(
    JSON.parse(readFileSync(join(f.dataDir, 'state.json'))).manual.text,
    'Paused draft',
  );
  await f.post('/api/settings', { enabled: true });
  assert.equal(f.posts.at(-1).status_text, 'Paused draft');
});

test('rate limits back off and stale playback clears; refreshes expired tokens', async (t) => {
  const f = await fixture(t, { expires: true });
  await f.service.tick();
  assert.equal(f.refreshes(), 1);
  f.advance(15000);
  f.mode('limited');
  await f.service.tick();
  assert.match(f.service.publicState().error, /quota/);
  const count = f.calls();
  f.advance(65000);
  await f.service.tick();
  assert.equal(f.calls(), count);
  assert.equal(f.posts.at(-1).status_text, '');
});

test('rejects CSRF, cross-origin and host spoofing, malformed statuses, and bad OAuth state', async (t) => {
  const f = await fixture(t, { connected: false });
  assert.equal(
    (await fetch(f.origin + '/api/status', { method: 'POST', body: '{}' }))
      .status,
    403,
  );
  assert.equal(
    (
      await fetch(f.origin + '/api/state', {
        headers: { Origin: 'https://evil.test' },
      })
    ).status,
    403,
  );
  const spoofed = await new Promise((resolve, reject) => {
    const req = httpRequest(
      f.origin + '/api/state',
      { headers: { Host: 'evil.test' } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on('error', reject);
    req.end();
  });
  assert.equal(spoofed, 403);
  assert.equal(
    (
      await f.post('/api/status', {
        text: 'x'.repeat(101),
        emoji: ':dart:',
        minutes: 60,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.post('/api/status', {
        text: 'test',
        emoji: 'broken',
        minutes: 60,
      })
    ).status,
    400,
  );
  const callback = await fetch(
    f.origin + '/api/auth/spotify/callback?state=wrong&code=test',
    { redirect: 'manual' },
  );
  assert.equal(callback.status, 302);
  assert.match(callback.headers.get('location'), /error/);
  assert.equal(f.service.publicState().spotify.connected, false);
});

test('PKCE authorization binds state to a browser cookie and completes token exchange', async (t) => {
  const f = await fixture(t, { connected: false });
  await f.post('/api/connections/spotify', { clientId: 'b'.repeat(32) });
  const auth = await fetch(f.origin + '/api/auth/spotify', {
    redirect: 'manual',
  });
  const target = new URL(auth.headers.get('location'));
  assert.equal(target.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(target.searchParams.get('scope'), 'user-read-playback-state');
  const callback = `/api/auth/spotify/callback?state=${target.searchParams.get('state')}&code=test-code`;
  const missingCookie = await fetch(f.origin + callback, {
    redirect: 'manual',
  });
  assert.match(missingCookie.headers.get('location'), /error/);
  const good = await fetch(f.origin + callback, {
    redirect: 'manual',
    headers: { Cookie: auth.headers.get('set-cookie').split(';')[0] },
  });
  assert.equal(good.headers.get('location'), '/?connected=spotify');
  assert.equal(f.service.publicState().spotify.connected, true);
  const replay = await fetch(f.origin + callback, {
    redirect: 'manual',
    headers: { Cookie: auth.headers.get('set-cookie').split(';')[0] },
  });
  assert.match(replay.headers.get('location'), /error/);
});

async function localSlackRequest(f, path, cookie) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      f.origin + path,
      {
        headers: {
          Host: `localhost:${new URL(f.origin).port}`,
          ...(cookie ? { Cookie: cookie } : {}),
        },
      },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode, headers: res.headers });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('Slack PKCE issues a browser-bound one-use flow, exchanges the user token, and rotates it', async (t) => {
  const f = await fixture(t, { connected: false });
  const initiation = await (
    await f.post('/api/connections/slack/oauth', { clientId: '123.456' })
  ).json();
  const landing = new URL(initiation.redirect);
  const auth = await localSlackRequest(f, landing.pathname + landing.search);
  assert.equal(auth.status, 302);
  const target = new URL(auth.headers.location);
  assert.equal(target.origin, 'https://slack.com');
  assert.equal(target.searchParams.get('user_scope'), 'users.profile:write');
  assert.equal(target.searchParams.get('code_challenge_method'), 'S256');
  const cookie = auth.headers['set-cookie'][0].split(';')[0];
  const callback = `/api/auth/slack/callback?state=${target.searchParams.get('state')}&code=test`;
  assert.match(
    (await localSlackRequest(f, callback)).headers.location,
    /error=/,
  );
  assert.equal(f.exchanges.length, 0);
  const completed = await localSlackRequest(f, callback, cookie);
  assert.equal(completed.headers.location, f.origin + '/?connected=slack');
  assert.equal(f.service.publicState().slack.connected, true);
  assert.equal(
    createHash('sha256')
      .update(f.exchanges[0].code_verifier)
      .digest('base64url'),
    target.searchParams.get('code_challenge'),
  );
  assert.equal(
    f.exchanges[0].redirect_uri,
    target.searchParams.get('redirect_uri'),
  );
  assert.equal(f.exchanges[0].client_secret, undefined);
  assert.match(
    (await localSlackRequest(f, callback, cookie)).headers.location,
    /error=/,
  );
  assert.equal(f.exchanges.length, 1);
  assert.ok(!JSON.stringify(f.service.publicState()).includes('xoxe'));
  await f.post('/api/status', { text: 'Hello', emoji: ':dart:', minutes: 0 });
  f.advance(43200 * 1000);
  await f.post('/api/status', {
    text: 'Hello again',
    emoji: ':dart:',
    minutes: 0,
  });
  assert.equal(f.exchanges.at(-1).grant_type, 'refresh_token');
  assert.equal(f.exchanges.at(-1).refresh_token, 'xoxe-initial-refresh');
  assert.equal(
    JSON.parse(readFileSync(join(f.dataDir, 'state.json'))).slack.refreshToken,
    'xoxe-new-refresh',
  );
  assert.equal(f.posts.at(-1).status_text, 'Hello again');
});

test('Slack launch expires, is single-use, and localhost cannot read app state', async (t) => {
  const f = await fixture(t, { connected: false });
  assert.equal((await localSlackRequest(f, '/api/state')).status, 403);
  const result = await (
    await f.post('/api/connections/slack/oauth', { clientId: '123.456' })
  ).json();
  const landing = new URL(result.redirect);
  f.advance(60001);
  assert.match(
    (await localSlackRequest(f, landing.pathname + landing.search)).headers
      .location,
    /error=/,
  );
  const fresh = new URL(
    (
      await (
        await f.post('/api/connections/slack/oauth', { clientId: '123.456' })
      ).json()
    ).redirect,
  );
  assert.match(
    (await localSlackRequest(f, fresh.pathname + fresh.search)).headers
      .location,
    /^https:\/\/slack.com/,
  );
  assert.match(
    (await localSlackRequest(f, fresh.pathname + fresh.search)).headers
      .location,
    /error=/,
  );
});
