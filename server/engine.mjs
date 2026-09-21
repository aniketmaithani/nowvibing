import { spotifyLink, artworkLink } from './provider-validation.mjs';
export const defaults = () => ({
  settings: {
    enabled: true,
    format: '{track} — {artist}',
    fallback: '',
    rules: [],
  },
  spotify: { clientId: '', tokens: null },
  slack: null,
  slackClientId: '',
  manual: null,
  lastPublished: null,
  history: [],
});
export const truncate = (text) => [...text].slice(0, 100).join('');
export function playlistId(value) {
  const match = value
    .trim()
    .match(
      /^(?:https:\/\/open\.spotify\.com\/(?:intl-[^/]+\/)?playlist\/|spotify:playlist:)?([A-Za-z0-9]{22})(?:\?[^\s]*)?$/,
    );
  if (!match) throw new Error('Paste a valid Spotify playlist link or URI.');
  return match[1];
}
export function resolveStatus(store, playback, now = Date.now()) {
  if (store.manual && (!store.manual.expiresAt || store.manual.expiresAt > now))
    return { ...store.manual, source: 'manual' };
  if (playback?.playing) {
    const rule = store.settings.rules.find(
      (r) => r.playlist === playback.playlist,
    );
    if (rule)
      return {
        text: rule.text,
        emoji: rule.emoji,
        source: 'playlist',
        expiresAt: 0,
      };
    const text = truncate(
      store.settings.format.replace(
        /\{(track|artist|album)\}/g,
        (_, key) =>
          ({
            track: playback.title,
            artist: playback.artist,
            album: playback.album,
          })[key],
      ),
    );
    return { text, emoji: ':headphones:', source: 'spotify', expiresAt: 0 };
  }
  return {
    text: store.settings.fallback,
    emoji: store.settings.fallback ? ':speech_balloon:' : '',
    source: 'idle',
    expiresAt: 0,
  };
}
export function normalizePlayback(raw) {
  if (
    !raw?.item ||
    raw.device?.is_private_session ||
    raw.currently_playing_type === 'ad'
  )
    return null;
  const item = raw.item;
  return {
    title: item.name || 'Unknown track',
    artist:
      item.artists?.map((a) => a.name).join(', ') ||
      item.show?.name ||
      'Spotify',
    album: item.album?.name || item.show?.name || '',
    image: artworkLink((item.album?.images || item.images)?.[0]?.url),
    url: spotifyLink(item.external_urls?.spotify),
    playing: Boolean(raw.is_playing),
    progress: raw.progress_ms || 0,
    duration: item.duration_ms || 1,
    playlist:
      raw.context?.type === 'playlist'
        ? raw.context.uri.split(':').at(-1)
        : null,
  };
}
