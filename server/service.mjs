import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { createStateStore } from './state-store.mjs';
import { readJsonBody, requestUrl } from './http.mjs';
import { resolve } from 'node:path';
import {
  defaults,
  normalizePlayback,
  playlistId,
  resolveStatus,
} from './engine.mjs';

const emojiPattern = /^:[a-z0-9_+-]+:$/;
const safeText = (v, name, max = 100, empty = false) => {
  if (
    typeof v !== 'string' ||
    (!empty && !v.trim()) ||
    Array.from(v).length > max
  )
    throw new Error(`${name} must be ${empty ? '0' : '1'}–${max} characters.`);
  return v.trim();
};
const safeEmoji = (v) => {
  if (typeof v !== 'string' || !emojiPattern.test(v) || v.length > 80)
    throw new Error('Use a Slack emoji name, such as :headphones:.');
  return v;
};
const equal = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function createService({
  dataDir = resolve('.local'),
  origin = 'http://127.0.0.1:3000',
  fetcher = fetch,
  now = Date.now,
  poll = true,
} = {}) {
  const stateStore = createStateStore(dataDir);
  const store = stateStore.load(defaults());
  const save = () => stateStore.save(store);
  const csrf = randomBytes(32).toString('hex');
  const oauth = new Map();
  const slackOAuth = new Map();
  const slackOrigin = `http://localhost:${new URL(origin).port || '3000'}`;
  const slackRedirect = `${slackOrigin}/api/auth/slack/callback`;
  function pruneSlackOAuth() {
    for (const [key, pending] of slackOAuth)
      if (pending.expires < now()) slackOAuth.delete(key);
    if (slackOAuth.size >= 10) slackOAuth.clear();
  }
  async function slackExchange(body) {
    const res = await request('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });
    if (res.status === 429) {
      slackAfter =
        now() + (Number(res.headers.get('retry-after')) || 60) * 1000;
      throw new Error('Slack rate limit reached. Wait before reconnecting.');
    }
    const result = await res.json();
    if (!res.ok || !result.ok)
      throw new Error(
        `Slack authorization failed (${result.error || res.status}). Reconnect Slack.`,
      );
    return result;
  }
  async function slackToken() {
    const account = store.slack;
    if (!account) throw new Error('Connect Slack first.');
    if (!account.expiresAt || account.expiresAt > now() + 60000)
      return account.token;
    if (!account.refreshToken || !account.clientId)
      throw new Error('Slack token expired. Reconnect Slack.');
    const result = await slackExchange({
      grant_type: 'refresh_token',
      refresh_token: account.refreshToken,
      client_id: account.clientId,
    });
    const tokens = result.authed_user?.access_token
      ? result.authed_user
      : result;
    if (
      !tokens.access_token ||
      !tokens.refresh_token ||
      !tokens.expires_in ||
      tokens.token_type !== 'user'
    )
      throw new Error(
        'Slack did not return a rotating user token. Reconnect Slack.',
      );
    store.slack = {
      ...account,
      token: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: now() + tokens.expires_in * 1000,
    };
    save();
    return store.slack.token;
  }
  let playback = null,
    lastChecked = 0,
    lastSynced = 0,
    spotifyError = null,
    slackError = null;
  let spotifyAfter = 0,
    slackAfter = 0,
    slackAttempt = 0,
    ticking = false,
    closed = false;
  let queue = Promise.resolve();
  const serial = (fn) => {
    const task = queue.then(fn);
    queue = task.catch(() => {});
    return task;
  };
  const request = (url, options = {}) =>
    fetcher(url, { ...options, signal: AbortSignal.timeout(12000) });
  async function spotifyToken(force = false) {
    const tokens = store.spotify.tokens;
    if (!tokens) throw new Error('Connect Spotify to start syncing.');
    if (!force && tokens.expiresAt > now() + 60000) return tokens.access_token;
    const res = await request('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: store.spotify.clientId,
      }),
    });
    const result = await res.json();
    if (!res.ok) {
      if (res.status === 400 || res.status === 401) {
        store.spotify.tokens = null;
        save();
      }
      throw new Error(
        'Spotify authorization expired or could not refresh. Reconnect Spotify.',
      );
    }
    store.spotify.tokens = {
      access_token: result.access_token,
      refresh_token: result.refresh_token || tokens.refresh_token,
      expiresAt: now() + result.expires_in * 1000,
    };
    save();
    return result.access_token;
  }
  async function readSpotify() {
    if (!store.spotify.tokens || now() < spotifyAfter) return;
    // One request per poll, with an explicit retry only for an expired access token.
    let token = await spotifyToken();
    let res = await request('https://api.spotify.com/v1/me/player', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      token = await spotifyToken(true);
      res = await request('https://api.spotify.com/v1/me/player', {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    if (res.status === 429) {
      const body = await res.json().catch(() => ({}));
      const quota =
        body.reason === 'QUOTA_EXCEEDED' ||
        body.error?.reason === 'QUOTA_EXCEEDED';
      spotifyAfter =
        now() +
        Math.max(
          Number(res.headers.get('retry-after')) || 60,
          quota ? 3600 : 15,
        ) *
          1000;
      throw new Error(
        quota
          ? 'Spotify developer quota reached. Sync will retry later.'
          : 'Spotify rate limit reached. Waiting before retrying.',
      );
    }
    if (res.status === 403) {
      spotifyAfter = now() + 60000;
      throw new Error(
        'Spotify denied access. Check your developer app’s allowed users, Premium eligibility, and reconnect.',
      );
    }
    if (!res.ok)
      throw new Error(
        `Spotify is unavailable (${res.status}). Retrying automatically.`,
      );
    playback = res.status === 204 ? null : normalizePlayback(await res.json());
    lastChecked = now();
    spotifyError = null;
  }
  async function slackCall(method, token, body = {}) {
    const res = await request(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
    });
    if (res.status === 429) {
      slackAfter =
        now() + (Number(res.headers.get('retry-after')) || 60) * 1000;
      throw new Error('Slack rate limit reached. Waiting before retrying.');
    }
    const result = await res.json();
    if (!res.ok || !result.ok)
      throw new Error(
        `Slack: ${result.error || res.status}. Check your user token and users.profile:write scope.`,
      );
    return result;
  }
  function desired() {
    return resolveStatus(
      store,
      playback && now() - lastChecked < 60000 ? playback : null,
      now(),
    );
  }
  async function publish() {
    if (
      !store.slack ||
      !store.settings.enabled ||
      now() < slackAfter ||
      now() - slackAttempt < 6500
    )
      return;
    const status = desired();
    // Do not erase an existing Slack status merely by connecting an idle app.
    if (!status.text && !store.lastPublished) return;
    const prev = store.lastPublished;
    const unchanged =
      prev &&
      prev.text === status.text &&
      prev.emoji === status.emoji &&
      prev.source === status.source &&
      prev.expiresAt === status.expiresAt;
    if (
      unchanged &&
      (status.source === 'manual' || !status.text || now() - lastSynced < 60000)
    )
      return;
    slackAttempt = now();
    const expiration =
      status.source === 'manual'
        ? Math.floor(status.expiresAt / 1000)
        : status.text
          ? Math.floor(now() / 1000) + 120
          : 0;
    await slackCall('users.profile.set', await slackToken(), {
      profile: {
        status_text: status.text,
        status_emoji: status.emoji,
        status_expiration: expiration,
      },
    });
    lastSynced = now();
    slackError = null;
    if (!unchanged)
      store.history.unshift({
        at: now(),
        text: status.text,
        emoji: status.emoji,
        source: status.source,
      });
    store.history = store.history.slice(0, 50);
    store.lastPublished = status;
    save();
  }
  async function tick() {
    if (ticking || closed) return;
    ticking = true;
    try {
      await serial(async () => {
        if (store.manual?.expiresAt && store.manual.expiresAt <= now()) {
          store.manual = null;
          save();
        }
        if (store.settings.enabled) {
          try {
            await readSpotify();
          } catch (e) {
            spotifyError = e.message;
          }
          try {
            await publish();
          } catch (e) {
            slackError = e.message;
          }
        }
      });
    } finally {
      ticking = false;
    }
  }
  const timer = poll ? setInterval(tick, 15000) : null;
  timer?.unref();
  if (poll) void tick();
  function publicState() {
    return {
      csrf,
      settings: store.settings,
      spotify: {
        connected: Boolean(store.spotify.tokens),
        configured: Boolean(store.spotify.clientId),
        clientId: store.spotify.clientId,
      },
      slack: {
        connected: Boolean(store.slack),
        name: store.slack?.name || '',
        workspace: store.slack?.workspace || '',
        clientId: store.slackClientId || '',
        redirectUri: slackRedirect,
      },
      playback: now() - lastChecked < 60000 ? playback : null,
      status: desired(),
      manual:
        store.manual &&
        (!store.manual.expiresAt || store.manual.expiresAt > now())
          ? store.manual
          : null,
      synced: store.lastPublished,
      lastChecked,
      lastSynced,
      error: [spotifyError, slackError].filter(Boolean).join(' ') || null,
      history: store.history,
    };
  }
  const json = (res, code, value) => {
    res.writeHead(code, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify(value));
  };
  const redirect = (res, location, headers = {}) => {
    res.writeHead(302, {
      Location: location,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      ...headers,
    });
    res.end();
  };
  async function handle(
    req,
    res,
    next = () => json(res, 404, { error: 'Not found' }),
  ) {
    let url;
    try {
      url = requestUrl(req.url, origin);
    } catch {
      return json(res, 400, { error: 'Invalid request target.' });
    }
    if (!url.pathname.startsWith('/api/')) return next();
    const slackAuthRoute = [
      '/api/auth/slack',
      '/api/auth/slack/callback',
    ].includes(url.pathname);
    const onSlackHost = req.headers.host === new URL(slackOrigin).host;
    if (
      req.headers.host !== new URL(origin).host &&
      !(slackAuthRoute && onSlackHost)
    )
      return json(res, 403, {
        error: `Use ${origin} to access the local app.`,
      });
    if (req.headers.origin && req.headers.origin !== origin)
      return json(res, 403, { error: 'Cross-origin request blocked.' });
    if (
      req.headers['sec-fetch-site'] === 'cross-site' &&
      url.pathname !== '/api/auth/spotify/callback' &&
      !slackAuthRoute
    )
      return json(res, 403, { error: 'Cross-site request blocked.' });
    try {
      if (req.method === 'GET' && url.pathname === '/api/auth/slack') {
        const ticket = url.searchParams.get('ticket');
        const pending = slackOAuth.get(ticket);
        if (
          !onSlackHost ||
          !pending ||
          pending.phase !== 'ticket' ||
          pending.expires < now()
        )
          return redirect(
            res,
            `${origin}/?error=Slack+connection+expired.+Try+again.`,
          );
        slackOAuth.delete(ticket);
        const state = randomBytes(24).toString('hex');
        const verifier = randomBytes(64).toString('base64url');
        slackOAuth.set(state, {
          phase: 'authorize',
          verifier,
          clientId: pending.clientId,
          expires: now() + 600000,
        });
        const params = new URLSearchParams({
          client_id: pending.clientId,
          user_scope: 'users.profile:write',
          scope: '',
          redirect_uri: slackRedirect,
          state,
          code_challenge_method: 'S256',
          code_challenge: createHash('sha256')
            .update(verifier)
            .digest('base64url'),
        });
        return redirect(res, `https://slack.com/oauth/v2/authorize?${params}`, {
          'Set-Cookie': `slack_oauth=${state}; HttpOnly; SameSite=Lax; Path=/api/auth/slack; Max-Age=600`,
        });
      }
      if (req.method === 'GET' && url.pathname === '/api/auth/slack/callback') {
        const state = url.searchParams.get('state');
        const pending = slackOAuth.get(state);
        const cookie = req.headers.cookie
          ?.split(';')
          .map((v) => v.trim())
          .find((v) => v.startsWith('slack_oauth='))
          ?.slice(12);
        if (
          !onSlackHost ||
          !pending ||
          pending.phase !== 'authorize' ||
          pending.expires < now() ||
          !equal(state, cookie)
        )
          return redirect(
            res,
            `${origin}/?error=Slack+connection+expired.+Try+again.`,
          );
        slackOAuth.delete(state);
        const clearCookie = {
          'Set-Cookie':
            'slack_oauth=; HttpOnly; SameSite=Lax; Path=/api/auth/slack; Max-Age=0',
        };
        if (url.searchParams.has('error') || !url.searchParams.get('code'))
          return redirect(
            res,
            `${origin}/?error=Slack+connection+was+cancelled.`,
            clearCookie,
          );
        try {
          await serial(async () => {
            if (pending.clientId !== store.slackClientId)
              throw new Error('Slack client ID changed. Start again.');
            const result = await slackExchange({
              grant_type: 'authorization_code',
              client_id: pending.clientId,
              code: url.searchParams.get('code'),
              redirect_uri: slackRedirect,
              code_verifier: pending.verifier,
            });
            const tokens = result.authed_user;
            if (
              !tokens?.access_token ||
              tokens.token_type !== 'user' ||
              !tokens.scope?.split(',').includes('users.profile:write')
            )
              throw new Error(
                'Slack did not grant the users.profile:write user permission.',
              );
            if (tokens.expires_in && !tokens.refresh_token)
              throw new Error(
                'Slack did not return a refresh token. Reconnect Slack.',
              );
            const auth = await slackCall('auth.test', tokens.access_token);
            store.slack = {
              token: tokens.access_token,
              name: auth.user,
              workspace: auth.team,
              clientId: pending.clientId,
              refreshToken: tokens.refresh_token || null,
              expiresAt: tokens.expires_in
                ? now() + tokens.expires_in * 1000
                : 0,
            };
            store.lastPublished = null;
            lastSynced = 0;
            slackError = null;
            slackAfter = 0;
            save();
          });
          void tick();
          return redirect(res, `${origin}/?connected=slack`, clearCookie);
        } catch (e) {
          return redirect(
            res,
            `${origin}/?error=${encodeURIComponent(e.message)}`,
            clearCookie,
          );
        }
      }
      if (req.method === 'GET' && url.pathname === '/api/state')
        return json(res, 200, publicState());
      if (req.method === 'GET' && url.pathname === '/api/auth/spotify') {
        if (!store.spotify.clientId)
          return redirect(res, '/?error=Add+your+Spotify+Client+ID+first');
        for (const [key, value] of oauth)
          if (value.expires < now()) oauth.delete(key);
        if (oauth.size >= 10) oauth.clear();
        const state = randomBytes(24).toString('hex'),
          verifier = randomBytes(64).toString('base64url');
        oauth.set(state, {
          verifier,
          expires: now() + 600000,
          clientId: store.spotify.clientId,
        });
        const params = new URLSearchParams({
          client_id: store.spotify.clientId,
          response_type: 'code',
          redirect_uri: `${origin}/api/auth/spotify/callback`,
          scope: 'user-read-playback-state',
          state,
          code_challenge_method: 'S256',
          code_challenge: createHash('sha256')
            .update(verifier)
            .digest('base64url'),
        });
        return redirect(
          res,
          `https://accounts.spotify.com/authorize?${params}`,
          {
            'Set-Cookie': `spotify_oauth=${state}; HttpOnly; SameSite=Lax; Path=/api/auth/spotify; Max-Age=600`,
          },
        );
      }
      if (
        req.method === 'GET' &&
        url.pathname === '/api/auth/spotify/callback'
      ) {
        const state = url.searchParams.get('state'),
          pending = oauth.get(state);
        const cookie = req.headers.cookie
          ?.split(';')
          .map((s) => s.trim())
          .find((s) => s.startsWith('spotify_oauth='))
          ?.slice(14);
        if (!pending || pending.expires < now() || !equal(state, cookie))
          return redirect(
            res,
            '/?error=Spotify+connection+expired.+Please+try+again.',
          );
        oauth.delete(state);
        if (url.searchParams.has('error') || !url.searchParams.get('code'))
          return redirect(res, '/?error=Spotify+connection+was+cancelled.');
        try {
          await serial(async () => {
            if (pending.clientId !== store.spotify.clientId)
              throw new Error('Client ID changed');
            const response = await request(
              'https://accounts.spotify.com/api/token',
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                  grant_type: 'authorization_code',
                  code: url.searchParams.get('code'),
                  redirect_uri: `${origin}/api/auth/spotify/callback`,
                  client_id: pending.clientId,
                  code_verifier: pending.verifier,
                }),
              },
            );
            const result = await response.json();
            if (!response.ok || !result.access_token || !result.refresh_token)
              throw new Error('Token exchange failed');
            store.spotify.tokens = {
              access_token: result.access_token,
              refresh_token: result.refresh_token,
              expiresAt: now() + result.expires_in * 1000,
            };
            save();
            spotifyError = null;
            spotifyAfter = 0;
          });
          void tick();
          return redirect(res, '/?connected=spotify', {
            'Set-Cookie':
              'spotify_oauth=; HttpOnly; SameSite=Lax; Path=/api/auth/spotify; Max-Age=0',
          });
        } catch {
          return redirect(
            res,
            '/?error=Could+not+connect+Spotify.+Check+your+client+ID+and+redirect+URI.',
          );
        }
      }
      if (req.method !== 'POST')
        return json(res, 405, { error: 'Method not allowed' });
      if (!equal(req.headers['x-csrf-token'], csrf))
        return json(res, 403, { error: 'Refresh the page and try again.' });
      const body = await readJsonBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body))
        throw new Error('Expected an object.');
      let nextRedirect;
      await serial(async () => {
        switch (url.pathname) {
          case '/api/connections/spotify': {
            const clientId = safeText(body.clientId, 'Client ID', 32);
            if (!/^[a-f0-9]{32}$/i.test(clientId))
              throw new Error(
                'Spotify Client ID must be 32 hexadecimal characters.',
              );
            if (store.spotify.clientId !== clientId) {
              store.spotify.tokens = null;
              playback = null;
            }
            store.spotify.clientId = clientId;
            break;
          }
          case '/api/connections/slack/oauth': {
            const clientId = safeText(body.clientId, 'Slack Client ID', 80);
            if (!/^\d+\.\d+$/.test(clientId))
              throw new Error(
                'Copy the Slack Client ID from Basic Information.',
              );
            store.slackClientId = clientId;
            pruneSlackOAuth();
            const ticket = randomBytes(32).toString('hex');
            slackOAuth.set(ticket, {
              phase: 'ticket',
              clientId,
              expires: now() + 60000,
            });
            nextRedirect = `${slackOrigin}/api/auth/slack?ticket=${ticket}`;
            break;
          }
          case '/api/connections/slack': {
            if (
              typeof body.token !== 'string' ||
              !/^xoxp-[A-Za-z0-9-]+$/.test(body.token.trim())
            )
              throw new Error(
                'Use a Slack User OAuth Token starting with xoxp-.',
              );
            const token = body.token.trim();
            const auth = await slackCall('auth.test', token);
            store.slack = { token, name: auth.user, workspace: auth.team };
            store.lastPublished = null;
            lastSynced = 0;
            slackError = null;
            slackAfter = 0;
            break;
          }
          case '/api/disconnect': {
            if (body.service === 'spotify') {
              store.spotify.tokens = null;
              playback = null;
              spotifyError = null;
              oauth.clear();
            } else if (body.service === 'slack') {
              store.slack = null;
              slackOAuth.clear();
              store.lastPublished = null;
              lastSynced = 0;
              slackError = null;
            } else throw new Error('Unknown service.');
            break;
          }
          case '/api/settings': {
            const settings = { ...store.settings };
            if ('enabled' in body) {
              if (typeof body.enabled !== 'boolean')
                throw new Error('Invalid sync setting.');
              settings.enabled = body.enabled;
            }
            if ('format' in body)
              settings.format = safeText(body.format, 'Format');
            if ('fallback' in body)
              settings.fallback = safeText(
                body.fallback,
                'Fallback',
                100,
                true,
              );
            store.settings = settings;
            break;
          }
          case '/api/status': {
            const text = safeText(body.text, 'Status'),
              emoji = safeEmoji(body.emoji);
            if (![0, 30, 60, 240].includes(body.minutes))
              throw new Error('Invalid status duration.');
            store.manual = {
              text,
              emoji,
              source: 'manual',
              expiresAt: body.minutes ? now() + body.minutes * 60000 : 0,
            };
            break;
          }
          case '/api/status/clear':
            store.manual = null;
            break;
          case '/api/rules': {
            if (store.settings.rules.length >= 50)
              throw new Error('You can add up to 50 playlist rules.');
            const rule = {
              id: randomBytes(8).toString('hex'),
              playlist: playlistId(
                safeText(body.playlist, 'Playlist link', 500),
              ),
              name: safeText(body.name, 'Playlist name', 60),
              text: safeText(body.text, 'Status'),
              emoji: safeEmoji(body.emoji),
            };
            if (store.settings.rules.some((r) => r.playlist === rule.playlist))
              throw new Error(
                'This playlist already has a rule. Remove it before adding another.',
              );
            store.settings.rules.push(rule);
            break;
          }
          case '/api/rules/delete':
            store.settings.rules = store.settings.rules.filter(
              (r) => r.id !== body.id,
            );
            break;
          default:
            throw new Error('Unknown action.');
        }
        save();
        try {
          await publish();
        } catch (e) {
          slackError = e.message;
        }
      });
      json(res, 200, {
        ok: true,
        ...(nextRedirect ? { redirect: nextRedirect } : {}),
      });
    } catch (e) {
      json(res, e.status || 400, { error: e.message || 'Request failed' });
    }
  }
  return {
    handle,
    tick,
    publicState,
    close() {
      closed = true;
      if (timer) clearInterval(timer);
    },
  };
}
