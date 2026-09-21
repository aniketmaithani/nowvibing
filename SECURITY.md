# Security model

NowVibing is designed for a trusted, single-user computer. It is not a multi-user service, a public server, or a security boundary against software already running on your machine. This document describes implemented protections and remaining limits; it is not a claim that the app is vulnerability-free.

## Threats addressed

| Threat                                                     | Protection                                                                                                     | Regression coverage                          |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| A website tries to change local status                     | Exact Host/Origin checks, cross-site fetch checks, JSON-only POST bodies, per-process CSRF token               | `tests/sync.test.mjs`, `tests/http.test.mjs` |
| OAuth callback injection or replay                         | Random state, PKCE/S256, expiry, single-use entries, HttpOnly/SameSite cookie binding, Client ID binding       | `tests/sync.test.mjs`                        |
| Callback host confusion                                    | Narrow localhost exception for Slack authorization; normal API uses numeric loopback host                      | `tests/sync.test.mjs`                        |
| Credentials exposed by the API                             | Explicit public-state projection; no access/refresh token fields in responses                                  | `tests/sync.test.mjs`                        |
| Credential file follows an unsafe link                     | Reject data-directory symlinks and credential-file symlinks/hard links; verify ownership and regular-file type | `tests/state-store.test.mjs`                 |
| Partial state writes or unsafe predictable temporary files | Exclusive random temporary file, file fsync, atomic rename, size limit, owner-only permissions                 | `tests/state-store.test.mjs`                 |
| Static server exposes private files                        | Serve only the built public directory; reject dot paths and paths resolving outside it, including symlinks     | `tests/http.test.mjs`                        |
| Malformed/oversized input crashes the server               | Validated URL parsing, byte-bounded JSON, generic errors, production request timeouts                          | `tests/http.test.mjs`                        |
| Page embedding or injected inline scripts                  | Production anti-framing headers and CSP with hashes of the actual built bootstrap scripts                      | `tests/http.test.mjs`                        |
| Invalid tokens overwrite a good connection                 | Validate token shape and expiry before replacement; save rotating refresh tokens before use                    | `tests/sync.test.mjs`                        |
| Provider limits trigger excessive retries                  | Respect Retry-After, quota backoff, serialized refreshes, and deduplicated status writes                       | `tests/sync.test.mjs`                        |
| Unsafe links in playback metadata                          | Spotify-only HTTPS track links and HTTPS-only artwork URLs without embedded credentials                        | `tests/sync.test.mjs`                        |
| Accidental credentials/private files committed             | Git ignore rules plus an indexed-file scanner and optional repository-local pre-commit hook                    | `tests/secret-patterns.test.mjs`             |

## Credentials and local trust

Credentials are stored **in plaintext** in `.local/state.json`. The directory uses `0700`; the file uses `0600`. The app has no Keychain/keyring integration or separate encryption key. It does not store provider tokens in browser localStorage, cookies, HTML, or the public state API.

Permissions reduce exposure to other OS accounts reading the file. They do not protect against root, malware, browser extensions, backups containing the file, or programs running as your user. Atomic rename does not guarantee survival of every hardware/power-loss scenario; the directory entry is not explicitly fsynced. Corrupt state fails closed and may require restoring a trusted backup or reconnecting.

The HTTP server binds only to `127.0.0.1`, but **any local process able to connect to that port can access the local app**. There is no login or OS-user authentication at the HTTP layer. Local processes can obtain a CSRF token and operate the app. Do not use this on an untrusted shared machine or expose it using a reverse proxy, port forward, tunnel, or public listener.

Loopback HTTP is unencrypted. HTTPS is used for all Spotify and Slack API traffic. The localhost exception is restricted to Slack's documented desktop PKCE flow. OAuth state and codes briefly appear in browser navigation URLs; redirects use `Referrer-Policy: no-referrer`, and the frontend removes the final success/error query string. The app does not log credential values or callback URLs.

Production CSP permits inline CSS because React/Base UI uses dynamic styles. It permits HTTPS artwork from Spotify's supplied image URLs, which may contact a provider/CDN. Scripts are limited to same-origin files and hashes of the built bootstrap scripts; object embedding, page framing, inline event-handler scripts, and base-tag overrides are disallowed. CSP hashes trust the local build artifact; compromised local source/build files are outside this defense.

Development mode exposes Vite's tooling and does not use the production static-server CSP or timeouts. Use `npm start` for ordinary usage and never expose the development server outside loopback.

## OAuth and scopes

Spotify requests only `user-read-playback-state`. Slack requests only the user scope `users.profile:write`. The latter permits profile edits beyond status, but this app calls `users.profile.set` only with status text, emoji, and expiration. No Slack message API is used.

Disconnecting removes local credentials but does not revoke them at the provider. Existing manual Slack statuses may remain until expiry. To terminate authorization completely, revoke access in Spotify or remove/revoke the Slack app through the provider's settings.

Slack PKCE refresh tokens can expire after prolonged inactivity. The app reports reconnection errors instead of obtaining broader permissions. Spotify eligibility and workspace admin policies remain enforced by the providers.

## Safe repository workflow

Run `npm run check:secrets` after staging changes. The scanner examines Git's index, never `.local/state.json`, and reports only filenames and matched categories. It rejects private/generated paths, common Slack/GitHub token shapes, private keys, and long literal credential fields.

The scan is heuristic. It can miss unknown formats or obfuscated secrets and can flag realistic examples. Use constructed fake values in tests. Review the staged diff as well. `.gitignore` does not protect a file that was already committed or added with force.

The included hook can be enabled with `git config --local core.hooksPath .githooks`. Existing hook configuration should be integrated, not silently replaced. Hooks are local and do not propagate automatically to clones. No network calls are made by the hook, and it does not edit commit messages or add author trailers.

If a real credential enters Git history, revoke/rotate it with the provider first. Deleting the latest file is insufficient. Coordinate any history rewrite with repository users, then scan the rewritten history. Do not paste a live credential into an issue or report.

## Reporting and review

No remote security contact or issue tracker is configured in this local checkout. Report problems privately to the repository owner with redacted steps and synthetic data. Never include the state file, tokens, or unredacted OAuth callback URLs.

Run `npm audit` when updating dependencies, inspect the reported paths, and test fixes before accepting them. A clean audit reflects known advisories at that moment, not a complete application security review. Automated tests mock providers; they do not prove a live Spotify/Slack authorization works or that every browser/OS is supported.
