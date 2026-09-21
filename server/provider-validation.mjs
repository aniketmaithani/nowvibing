/** Reject malformed provider responses before replacing working credentials. */
export function validAccessToken(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 8192 &&
    /^[\x21-\x7e]+$/.test(value)
  );
}
export function validLifetime(value) {
  return (
    Number.isSafeInteger(value) && value > 0 && value <= 365 * 24 * 60 * 60
  );
}
export function safeProviderCode(value) {
  return typeof value === 'string' && /^[a-z0-9_]{1,80}$/.test(value)
    ? value
    : 'unexpected_response';
}
export function retryDelay(header, minimum = 15) {
  const seconds = Number(header);
  return (
    Math.max(minimum, Number.isFinite(seconds) && seconds > 0 ? seconds : 60) *
    1000
  );
}
export function spotifyLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      url.hostname === 'open.spotify.com' &&
      !url.username &&
      !url.password
      ? url.href
      : 'https://open.spotify.com';
  } catch {
    return 'https://open.spotify.com';
  }
}
export function artworkLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.href
      : '';
  } catch {
    return '';
  }
}
