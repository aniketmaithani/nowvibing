'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUpRight,
  AudioLines,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Command,
  Headphones,
  Link2,
  ListMusic,
  LoaderCircle,
  Monitor,
  Music2,
  Plus,
  Radio,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Rule = {
  id: string;
  playlist: string;
  name: string;
  text: string;
  emoji: string;
};
type Status = {
  text: string;
  emoji: string;
  source: string;
  expiresAt: number;
};
type State = {
  csrf: string;
  settings: {
    enabled: boolean;
    format: string;
    fallback: string;
    rules: Rule[];
  };
  spotify: { connected: boolean; configured: boolean; clientId: string };
  slack: {
    connected: boolean;
    name: string;
    workspace: string;
    clientId: string;
    redirectUri: string;
  };
  playback: null | {
    title: string;
    artist: string;
    album: string;
    image: string;
    url: string;
    playing: boolean;
    progress: number;
    duration: number;
    playlist: string | null;
  };
  status: Status;
  manual: Status | null;
  synced: Status | null;
  lastChecked: number;
  lastSynced: number;
  error: string | null;
  history: { at: number; text: string; source: string; emoji: string }[];
};
const emojiMap: Record<string, string> = {
  ':headphones:': '🎧',
  ':dart:': '🎯',
  ':coffee:': '☕',
  ':spiral_calendar_pad:': '🗓️',
  ':palm_tree:': '🌴',
  ':musical_note:': '🎵',
  ':speech_balloon:': '💬',
  ':rocket:': '🚀',
};
const em = (v: string) => emojiMap[v] || '💬';
const time = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
function Choice({
  value,
  onChange,
  items,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  items: Record<string, string>;
  label: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => v !== null && onChange(v)}>
      <SelectTrigger className="choice" aria-label={label}>
        <SelectValue>{items[value]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {Object.entries(items).map(([v, title]) => (
          <SelectItem key={v} value={v}>
            {title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function Home() {
  const [data, setData] = useState<State | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<
    'connections' | 'rule' | 'settings' | 'help' | null
  >(null);
  const [text, setText] = useState('');
  const [emoji, setEmoji] = useState(':dart:');
  const [duration, setDuration] = useState('60');
  const [clientId, setClientId] = useState('');
  const [token, setToken] = useState('');
  const [slackClientId, setSlackClientId] = useState('');
  const [rule, setRule] = useState({
    playlist: '',
    name: '',
    text: '',
    emoji: ':headphones:',
  });
  const [format, setFormat] = useState('{track} — {artist}');
  const [fallback, setFallback] = useState('');
  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/state');
      if (!res.ok)
        throw new Error('Local server is unavailable. Keep npm start running.');
      setData(await res.json());
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    const initialize = async () => {
      await refresh();
      const p = new URLSearchParams(location.search);
      if (p.has('connected')) {
        setNotice(
          p.get('connected') === 'slack'
            ? 'Slack connected. Your status is ready to sync.'
            : 'Spotify connected. Start playing something.',
        );
        history.replaceState(null, '', '/');
      }
      if (p.has('error')) {
        setNotice(p.get('error') || 'Connection failed');
        history.replaceState(null, '', '/');
      }
    };
    void initialize();
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, [refresh]);
  useEffect(() => {
    if (notice) {
      const id = setTimeout(() => setNotice(''), 7000);
      return () => clearTimeout(id);
    }
  }, [notice]);
  async function action(path: string, body: unknown = {}, message = 'Saved') {
    if (!data || busy) return false;
    setBusy(true);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': data.csrf,
        },
        body: JSON.stringify(body),
      });
      const result = (await res.json()) as {
        error?: string;
        redirect?: string;
      };
      if (!res.ok) throw new Error(result.error || 'Something went wrong');
      await refresh();
      setNotice(message);
      if (result.redirect) location.href = result.redirect;
      return true;
    } catch (e) {
      setNotice((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function openConnections() {
    setClientId(data?.spotify.clientId || '');
    setSlackClientId(data?.slack.clientId || '');
    setDialog('connections');
  }
  const playback = data?.playback;
  const current = data?.status;
  const connected = data?.spotify.connected && data?.slack.connected;
  const running = data?.settings.enabled;
  const live = Boolean(
    data?.lastSynced &&
    running &&
    !data.error &&
    data.synced?.text === current?.text &&
    data.synced?.emoji === current?.emoji,
  );
  const progress = playback
    ? Math.min(100, (playback.progress / playback.duration) * 100)
    : 0;

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Spot my status home">
          <span className="brand-icon">
            <AudioLines size={23} />
          </span>
          <span>
            spot<span className="brand-muted">my</span>status
            <span className="brand-dot">.</span>
          </span>
        </Link>
        <nav aria-label="Main">
          <a href="#dashboard" className="nav-active">
            Overview
          </a>
          <a href="#rules">Playlist rules</a>
          <button onClick={openConnections}>
            Connections{!connected && <span className="nav-dot" />}
          </button>
        </nav>
        <div className="local-pill">
          <span className="dot" /> LOCAL EDITION <Monitor size={13} />
        </div>
      </header>
      <main id="dashboard">
        <div className="page-heading">
          <div>
            <div className="eyebrow">
              <span className="dash" /> YOUR PERSONAL STATUS STUDIO
            </div>
            <h1>
              In tune. In sync<span>.</span>
            </h1>
            <p>A little more you, in every status.</p>
          </div>
          <button
            className="button secondary"
            onClick={() => {
              setFormat(data?.settings.format || '{track} — {artist}');
              setFallback(data?.settings.fallback || '');
              setDialog('settings');
            }}
          >
            <SlidersHorizontal size={16} /> Preferences
          </button>
        </div>
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button onClick={refresh}>Retry</button>
          </div>
        )}
        {data?.error && (
          <div className="error-banner" role="alert">
            {data.error}
          </div>
        )}
        <div className="sync-strip">
          <div className="strip-icon">
            <Radio size={20} />
          </div>
          <div>
            <strong>
              {!data
                ? 'Connecting to your local server'
                : !running
                  ? 'Your sync is paused'
                  : connected
                    ? 'You’re on air'
                    : 'Your next great status starts here'}
            </strong>
            <p>
              {!running
                ? 'Resume to update your Slack status automatically.'
                : connected
                  ? 'Spotify → your rules → your Slack status. All on your machine.'
                  : 'Connect Spotify and Slack to bring your listening to your workspace.'}
            </p>
          </div>
          <div className="strip-end">
            <span>{running ? 'Auto-sync on' : 'Auto-sync off'}</span>
            <Switch
              aria-label="Enable automatic status sync"
              checked={Boolean(running)}
              disabled={!data || busy}
              onCheckedChange={(enabled) =>
                action(
                  '/api/settings',
                  { enabled },
                  enabled ? 'Sync resumed' : 'Sync paused',
                )
              }
            />
          </div>
        </div>
        <div className="primary-grid">
          <section className="music-panel panel">
            <div className="panel-top">
              <div className="eyebrow">
                <span className="dot" /> SPOTIFY SIGNAL
              </div>
              <span className="small-pill">
                {playback?.playing
                  ? 'NOW PLAYING'
                  : data?.spotify.connected
                    ? 'STANDING BY'
                    : 'NOT CONNECTED'}
              </span>
            </div>
            <div className="record-body">
              <div
                className={`album-art ${playback?.image ? 'has-cover' : ''}`}
              >
                {playback?.image ? (
                  <Image
                    src={playback.image}
                    alt={`${playback.album} album artwork`}
                    width={185}
                    height={185}
                    unoptimized
                  />
                ) : (
                  <AudioLines size={68} strokeWidth={1.3} />
                )}
                <span className="art-corner">
                  <Music2 size={17} />
                </span>
              </div>
              <div className="track-info">
                <span className="track-overline">
                  {playback
                    ? playback.playing
                      ? 'YOUR CURRENT ROTATION'
                      : 'PLAYBACK PAUSED'
                    : 'THE SOUND OF YOUR DAY'}
                </span>
                <h2>{playback?.title || 'Find your frequency.'}</h2>
                <p>{playback?.artist || 'Your music belongs here.'}</p>
                {playback ? (
                  <a
                    className="text-link"
                    href={playback.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in Spotify <ArrowUpRight size={14} />
                  </a>
                ) : (
                  <button className="button lime" onClick={openConnections}>
                    Connect Spotify <ArrowUpRight size={16} />
                  </button>
                )}
              </div>
            </div>
            <div className="player-bottom">
              <Progress
                className="progress-line"
                value={progress}
                aria-label="Track progress"
              />
              <div className="player-meta">
                <span>{playback ? time(playback.progress) : '0:00'}</span>
                <span className="playback-note">
                  {playback?.playing ? (
                    <>
                      <AudioLines size={14} /> Listening on Spotify
                    </>
                  ) : (
                    <>
                      <Headphones size={14} />{' '}
                      {data?.spotify.connected
                        ? 'Press play in Spotify'
                        : 'Waiting for your first track'}
                    </>
                  )}
                </span>
                <span>{playback ? time(playback.duration) : '—:—'}</span>
              </div>
            </div>
          </section>
          <section className="preview-panel panel">
            <div className="panel-top">
              <div className="eyebrow">YOUR SLACK STATUS</div>
              <span className={`small-pill ${live ? 'green' : ''}`}>
                {live ? 'SYNCED' : 'PREVIEW'}
              </span>
            </div>
            <div className="slack-preview">
              <div className="avatar">
                {(data?.slack.name || 'You').slice(0, 1).toUpperCase()}
                <span />
              </div>
              <div className="slack-profile">
                <h3>
                  {data?.slack.name || 'Your name'} <span>you</span>
                </h3>
                <span className="profile-active">
                  {data?.slack.workspace || 'Slack preview'}
                </span>
              </div>
              <div className="status-bubble">
                <span>{current?.text ? em(current.emoji) : '🎧'}</span>
                <p>
                  {current?.text ||
                    (data?.slack.connected
                      ? 'No status set'
                      : 'Your vibe goes here')}
                </p>
              </div>
              <div className="preview-source">
                {current?.source === 'manual' ? (
                  <>
                    <Clock3 size={14} /> Custom status takes priority
                  </>
                ) : current?.source === 'playlist' ? (
                  <>
                    <ListMusic size={14} /> Matched a playlist rule
                  </>
                ) : (
                  <>
                    <RefreshCw size={14} />{' '}
                    {data?.slack.connected
                      ? 'Updates automatically with your music'
                      : 'Connect Slack to go live'}
                  </>
                )}
              </div>
            </div>
            <div className="preview-footer">
              <span>
                <span
                  className={`dot ${data?.slack.connected ? '' : 'muted-dot'}`}
                />
                {data?.slack.workspace || 'No workspace connected'}
              </span>
              <button
                aria-label="Manage Slack connection"
                onClick={openConnections}
              >
                <ArrowUpRight size={17} />
              </button>
            </div>
          </section>
        </div>
        <div className="secondary-grid">
          <section className="composer panel" id="custom">
            <div className="section-heading">
              <div>
                <h2>
                  Your status, your call
                  <span className="orange-dot" />{' '}
                </h2>
                <p>Step out of the playlist. Say what’s on your mind.</p>
              </div>
              <Command size={21} className="muted" />
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await action(
                    '/api/status',
                    { text, emoji, minutes: Number(duration) },
                    'Custom status saved. It takes priority over Spotify.',
                  )
                )
                  setText('');
              }}
            >
              <div className="composer-input">
                <Choice
                  value={emoji}
                  onChange={setEmoji}
                  items={Object.fromEntries(
                    Object.entries(emojiMap).map(([k, v]) => [k, v]),
                  )}
                  label="Status emoji"
                />
                <input
                  aria-label="Custom status"
                  placeholder="What’s your status?"
                  maxLength={100}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  required
                />
                <span>{text.length}/100</span>
              </div>
              <div className="presets">
                {[
                  { t: 'Deep focus', e: ':dart:', i: '🎯' },
                  { t: 'Coffee break', e: ':coffee:', i: '☕' },
                  { t: 'In a meeting', e: ':spiral_calendar_pad:', i: '🗓️' },
                ].map((p) => (
                  <button
                    type="button"
                    key={p.t}
                    onClick={() => {
                      setText(p.t);
                      setEmoji(p.e);
                    }}
                  >
                    {p.i} {p.t}
                  </button>
                ))}
              </div>
              <div className="composer-actions">
                <div className="expires">
                  <Clock3 size={15} />
                  <span>Clear after</span>
                  <Choice
                    value={duration}
                    onChange={setDuration}
                    items={{
                      '30': '30 minutes',
                      '60': '1 hour',
                      '240': '4 hours',
                      '0': 'Don’t clear',
                    }}
                    label="Status duration"
                  />
                </div>
                <button
                  className="button lime"
                  disabled={!data || busy || !text.trim()}
                  type="submit"
                >
                  Set status <ArrowUpRight size={16} />
                </button>
              </div>
            </form>
            {data?.manual ? (
              <div className="override">
                <span>
                  {em(data.manual.emoji)} {data.manual.text} ·{' '}
                  {data.manual.expiresAt
                    ? `until ${new Date(data.manual.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                    : 'until you clear it'}
                </span>
                <button
                  onClick={() =>
                    action(
                      '/api/status/clear',
                      {},
                      'Custom status cleared. Spotify rules resumed.',
                    )
                  }
                  disabled={busy}
                >
                  Clear <X size={13} />
                </button>
              </div>
            ) : (
              <div className="composer-note">
                <ShieldCheck size={14} /> Custom status first. Music resumes
                when it clears.
              </div>
            )}
          </section>
          <section className="rules-panel panel" id="rules">
            <div className="section-heading">
              <div>
                <h2>Playlist → personality</h2>
                <p>Give your favorite playlists a status of their own.</p>
              </div>
              <ListMusic size={21} className="muted" />
            </div>
            {data?.settings.rules.length ? (
              <div className="rule-list">
                {data.settings.rules.map((r) => (
                  <div className="rule-row" key={r.id}>
                    <span className="rule-emoji">{em(r.emoji)}</span>
                    <div>
                      <strong>{r.name}</strong>
                      <p>{r.text}</p>
                    </div>
                    <button
                      aria-label={`Delete ${r.name} rule`}
                      onClick={() =>
                        action(
                          '/api/rules/delete',
                          { id: r.id },
                          'Playlist rule removed',
                        )
                      }
                      disabled={busy}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rule-example">
                <div>
                  <span className="rule-icon">
                    <ListMusic size={17} />
                  </span>
                  <span>Your focus playlist</span>
                </div>
                <ArrowDown size={17} />
                <div>
                  <span>🎯</span>
                  <span>In the zone. Back soon.</span>
                  <small>EXAMPLE</small>
                </div>
              </div>
            )}
            <button className="add-rule" onClick={() => setDialog('rule')}>
              <Plus size={17} /> Add playlist rule
            </button>
          </section>
        </div>
        <section className="activity">
          <div className="activity-title">
            <h2>Recent signals</h2>
            <span>ON THIS DEVICE</span>
          </div>
          {data?.history.length ? (
            <div className="activity-list">
              {data.history.slice(0, 5).map((h, i) => (
                <div className="activity-row" key={`${h.at}-${i}`}>
                  <span>{em(h.emoji)}</span>
                  <p>{h.text || 'Status cleared'}</p>
                  <span className="activity-source">{h.source}</span>
                  <time>
                    {new Date(h.at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                </div>
              ))}
            </div>
          ) : (
            <div className="activity-empty">
              <span>
                <Radio size={18} /> A quiet start. Your status updates will show
                up here.
              </span>
              <button onClick={openConnections}>
                Connect your apps <ChevronRight size={14} />
              </button>
            </div>
          )}
        </section>
        <footer>
          <span>
            <ShieldCheck size={14} /> Your machine. Your music. Your status.
          </span>
          <button onClick={() => setDialog('help')}>
            <CircleHelp size={14} /> How it works
          </button>
          <span className="footer-right">
            SPOTMYSTATUS <span> / </span> LOCAL
          </span>
        </footer>
      </main>
      {notice && (
        <output className="notification" aria-live="polite">
          <Sparkles size={17} />
          <span>{notice}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice('')}
          >
            <X size={16} />
          </button>
        </output>
      )}
      <Dialog
        open={dialog !== null}
        onOpenChange={(v) => !v && setDialog(null)}
      >
        <DialogContent className="app-dialog">
          <DialogTitle>
            {dialog === 'connections'
              ? 'Make the connection.'
              : dialog === 'rule'
                ? 'A playlist. A whole mood.'
                : dialog === 'settings'
                  ? 'Fine-tune your signal.'
                  : 'A status that follows your day.'}
          </DialogTitle>
          <DialogDescription>
            {dialog === 'connections'
              ? 'Connect once. Your local server takes it from here.'
              : dialog === 'rule'
                ? 'This status takes over while you play this playlist.'
                : dialog === 'settings'
                  ? 'Choose how your music shows up in Slack.'
                  : 'Spotify and your custom statuses, working together.'}
          </DialogDescription>
          {dialog === 'connections' && (
            <div className="dialog-stack">
              <section className="connection-block">
                <div className="connection-heading">
                  <span className="service-icon spotify">
                    <Music2 size={20} />
                  </span>
                  <h3>Spotify</h3>
                  <span className="connection-tag">
                    {data?.spotify.connected ? 'Connected' : 'Not connected'}
                  </span>
                </div>
                <p>
                  Create an app in the{' '}
                  <a
                    href="https://developer.spotify.com/dashboard"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Spotify developer dashboard <ArrowUpRight size={12} />
                  </a>
                  . Add this redirect URI:
                </p>
                <code>http://127.0.0.1:3000/api/auth/spotify/callback</code>
                <label htmlFor="client-id">Spotify Client ID</label>
                <input
                  id="client-id"
                  placeholder="Paste your client ID"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  autoComplete="off"
                />
                <p className="tiny">
                  Use your own developer app. Spotify may require Premium and an
                  allowed test user.
                </p>
                <div className="connection-actions">
                  <button
                    disabled={busy || !clientId.trim()}
                    className="button lime"
                    onClick={async () => {
                      if (
                        await action(
                          '/api/connections/spotify',
                          { clientId },
                          'Opening Spotify…',
                        )
                      )
                        location.href = '/api/auth/spotify';
                    }}
                  >
                    {data?.spotify.connected ? 'Reconnect' : 'Connect Spotify'}{' '}
                    <ArrowUpRight size={15} />
                  </button>
                  {data?.spotify.connected && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        action(
                          '/api/disconnect',
                          { service: 'spotify' },
                          'Spotify disconnected',
                        )
                      }
                    >
                      Disconnect
                    </button>
                  )}
                </div>
              </section>
              <section className="connection-block">
                <div className="connection-heading">
                  <span className="service-icon slack">
                    <Link2 size={20} />
                  </span>
                  <h3>Slack</h3>
                  <span className="connection-tag">
                    {data?.slack.connected
                      ? data.slack.workspace
                      : 'Not connected'}
                  </span>
                </div>
                <p>
                  For a Slack app with PKCE enabled, add this URL under{' '}
                  <b>OAuth &amp; Permissions → Redirect URLs</b>, then click{' '}
                  <b>Save URLs</b>:
                </p>
                <code>
                  {data?.slack.redirectUri ||
                    'http://localhost:3000/api/auth/slack/callback'}
                </code>
                <label htmlFor="slack-client-id">Slack Client ID</label>
                <input
                  id="slack-client-id"
                  value={slackClientId}
                  onChange={(e) => setSlackClientId(e.target.value)}
                  placeholder="123456789.123456789"
                  autoComplete="off"
                />
                <p className="tiny">
                  Find the Client ID under Basic Information → App Credentials.
                  Keep users.profile:write under User Token Scopes. No client
                  secret is needed.
                </p>
                <button
                  className="button lime"
                  disabled={busy || !slackClientId.trim()}
                  onClick={() =>
                    action(
                      '/api/connections/slack/oauth',
                      { clientId: slackClientId },
                      'Opening Slack…',
                    )
                  }
                >
                  Connect with Slack <ArrowUpRight size={15} />
                </button>
                <p className="tiny">
                  Already have a non-expiring user token? You can paste it below
                  instead.
                </p>
                <label htmlFor="slack-token">Slack user token</label>
                <input
                  id="slack-token"
                  type="password"
                  placeholder="xoxp-…"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  autoComplete="off"
                />
                <div className="connection-actions">
                  <button
                    className="button secondary"
                    disabled={busy || !token.trim()}
                    onClick={async () => {
                      if (
                        await action(
                          '/api/connections/slack',
                          { token },
                          'Slack connected',
                        )
                      )
                        setToken('');
                    }}
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <Link2 size={15} />
                    )}{' '}
                    Connect Slack
                  </button>
                  {data?.slack.connected && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        action(
                          '/api/disconnect',
                          { service: 'slack' },
                          'Slack disconnected',
                        )
                      }
                    >
                      Disconnect
                    </button>
                  )}
                </div>
              </section>
              <p className="dialog-footnote">
                <ShieldCheck size={14} /> Credentials stay in a private file on
                this computer.
              </p>
            </div>
          )}
          {dialog === 'rule' && (
            <form
              className="dialog-stack"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await action('/api/rules', rule, 'Playlist rule added')) {
                  setRule({
                    playlist: '',
                    name: '',
                    text: '',
                    emoji: ':headphones:',
                  });
                  setDialog(null);
                }
              }}
            >
              <label>
                Playlist name
                <input
                  required
                  value={rule.name}
                  onChange={(e) => setRule({ ...rule, name: e.target.value })}
                  placeholder="e.g. Deep work"
                  maxLength={60}
                />
              </label>
              <label>
                Spotify playlist link
                <input
                  required
                  value={rule.playlist}
                  onChange={(e) =>
                    setRule({ ...rule, playlist: e.target.value })
                  }
                  placeholder="https://open.spotify.com/playlist/…"
                />
              </label>
              <p className="tiny">
                In Spotify, open the playlist → Share → Copy link. Play from
                that playlist for the rule to match.
              </p>
              <label>
                Status text
                <input
                  required
                  maxLength={100}
                  value={rule.text}
                  onChange={(e) => setRule({ ...rule, text: e.target.value })}
                  placeholder="In the zone. Back soon."
                />
              </label>
              <div className="emoji-field">
                <span>Status emoji</span>
                <Choice
                  value={rule.emoji}
                  onChange={(v) => setRule({ ...rule, emoji: v })}
                  items={emojiMap}
                  label="Playlist status emoji"
                />
              </div>
              <button className="button lime" disabled={busy} type="submit">
                Add rule <Plus size={16} />
              </button>
            </form>
          )}
          {dialog === 'settings' && (
            <form
              className="dialog-stack"
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await action(
                    '/api/settings',
                    { format, fallback },
                    'Preferences saved',
                  )
                )
                  setDialog(null);
              }}
            >
              <label>
                Music status format
                <input
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                  maxLength={100}
                  required
                />
              </label>
              <p className="tiny">
                Use {'{track}'}, {'{artist}'}, or {'{album}'}. Slack statuses
                are limited to 100 characters.
              </p>
              <label>
                When nothing is playing
                <input
                  value={fallback}
                  onChange={(e) => setFallback(e.target.value)}
                  maxLength={100}
                  placeholder="Leave blank to clear the music status"
                />
              </label>
              <p className="tiny">
                Private sessions and paused playback use this fallback. Custom
                statuses still take priority.
              </p>
              <div className="setting-note">
                <Clock3 size={17} />
                <p>
                  Checks Spotify every 15 seconds. Keep the server running; your
                  browser can be closed.
                </p>
              </div>
              <button type="submit" disabled={busy} className="button lime">
                Save preferences <Check size={16} />
              </button>
            </form>
          )}
          {dialog === 'help' && (
            <div className="dialog-stack help-content">
              <p>
                <b>01 · Connect your apps</b>
                <br />
                Authorize your Spotify and Slack apps. No hosted account needed.
              </p>
              <p>
                <b>02 · Press play</b>
                <br />
                Your current track becomes your Slack status. Playlist rules
                replace it with your chosen message.
              </p>
              <p>
                <b>03 · Make it personal</b>
                <br />A custom status always wins. When it clears, your playlist
                rule or track takes over.
              </p>
              <p>
                <b>Priority</b>
                <br />
                Custom status → playlist rule → current track → idle fallback.
              </p>
              <p className="tiny">
                Auto-sync pauses all Slack updates when off. Music statuses
                expire after two minutes if the server stops. Manually set
                statuses use the duration you choose. This is an independent
                local app.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
