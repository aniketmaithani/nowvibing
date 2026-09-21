// A small, dependency-free safety net, not a replacement for credential review.
const patterns = [
  [
    'Slack token',
    /(?:xox[pba]-\d{5,}-[A-Za-z0-9-]{15,}|xoxe(?:\.xox[pb])?-[A-Za-z0-9-]{25,})/,
  ],
  [
    'GitHub token',
    /\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  ],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  [
    'embedded credential',
    /["'](?:access_token|refresh_token|refreshToken|client_secret|token)["']\s*:\s*["'][A-Za-z0-9._~+/=-]{24,}["']/,
  ],
];
export function findSecretKinds(source) {
  return patterns
    .filter(([, pattern]) => pattern.test(source))
    .map(([kind]) => kind);
}
export function forbiddenPath(path) {
  return (
    /^(?:\.local|node_modules|dist|out|\.next|\.vinext|\.wrangler)\//.test(
      path,
    ) ||
    (/(?:^|\/)\.env(?:\..*)?$/.test(path) && !path.endsWith('.env.example')) ||
    /\.(?:pem|key|p12|pfx)$/i.test(path)
  );
}
