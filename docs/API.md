# Local API

Base URL: `http://127.0.0.1:3000`. This is a private API for the local dashboard, not a public service.

## Request rules

Normal requests must use the exact numeric loopback Host. An Origin header, when present, must match the base URL. Cross-site browser requests are rejected except for the explicitly validated OAuth handoff/callback paths.

All POST requests require `Content-Type: application/json` and `X-CSRF-Token`, obtained from the current process's `/api/state` response. The request body is limited to 16,000 bytes, including multibyte text. Restarting the server rotates CSRF tokens; reload the page after a restart.

General errors return `{ "error": "message" }`. Common statuses are 400 for invalid input, 403 for origin/host/CSRF failures, 405 for an unsupported method, 413 for an oversized body, and 415 for an unsupported content type. Provider failures are also exposed through the state response. Saving an action successfully does **not** necessarily mean Slack has received it: consult `error`, `synced`, and `lastSynced`.

## Routes

| Method/path                         | Request                                                                                | Result/behavior                                                                                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/state`                    | No body                                                                                | Public connection flags, settings, desired/manual/synced statuses, fresh playback, history, errors, timestamps, and CSRF token. No provider tokens. |
| `POST /api/settings`                | Any of `enabled` (boolean), `format` (1–100 characters), `fallback` (0–100 characters) | Update supplied preferences. Rules use dedicated routes.                                                                                            |
| `POST /api/status`                  | `text`, `emoji`, `minutes`                                                             | Save manual override. Minutes must be 0, 30, 60, or 240. Zero means no expiry.                                                                      |
| `POST /api/status/clear`            | `{}`                                                                                   | Remove the manual override and resume normal priority.                                                                                              |
| `POST /api/rules`                   | `name`, `playlist`, `text`, `emoji`                                                    | Add a playlist rule. Name is at most 60 characters; status at most 100; up to 50 rules. Reject duplicates.                                          |
| `POST /api/rules/delete`            | `id`                                                                                   | Remove the matching rule.                                                                                                                           |
| `POST /api/connections/spotify`     | `clientId`                                                                             | Save a 32-character hexadecimal ID. Changing it removes the previous Spotify token.                                                                 |
| `GET /api/auth/spotify`             | No body                                                                                | Start Spotify PKCE after configuring its Client ID.                                                                                                 |
| `GET /api/auth/spotify/callback`    | Provider `state` and `code` or `error`                                                 | Verify state/cookie, exchange code, persist credentials, redirect to dashboard.                                                                     |
| `POST /api/connections/slack/oauth` | `clientId`                                                                             | Save Slack's numeric `number.number` ID; return `{ ok: true, redirect }` with a one-use localhost launch ticket.                                    |
| `GET /api/auth/slack`               | One-use `ticket`                                                                       | **localhost Host only.** Create cookie-bound PKCE state and redirect to Slack.                                                                      |
| `GET /api/auth/slack/callback`      | Provider `state` and `code` or `error`                                                 | **localhost Host only.** Verify/exchange/store then redirect to dashboard.                                                                          |
| `POST /api/connections/slack`       | `token`                                                                                | Verify a non-expiring `xoxp-` token with `auth.test`, then save it. Preferred UI path is PKCE.                                                      |
| `POST /api/disconnect`              | `service`: `spotify` or `slack`                                                        | Delete the local service credentials. This does not revoke provider authorization.                                                                  |

Emoji values are Slack names such as `:headphones:` or `:dart:`. Text is trimmed and limited using Unicode code points. Spotify playlist input accepts a 22-character ID, `spotify:playlist:ID`, or an `https://open.spotify.com/playlist/ID` link, including supported locale paths and share query strings. A rule matches playback context, not mere track membership.

## Public state semantics

- `spotify.connected` and `slack.connected`: locally stored credentials exist; a provider may still reject them later.
- `slack.clientId`, `spotify.clientId`: public app identifiers, not secrets.
- `playback`: normalized metadata or null when unavailable/private/stale.
- `status`: desired result from priority resolution.
- `manual`: active manual override or null.
- `synced`: last successfully published status retained locally.
- `lastChecked`, `lastSynced`: process-local millisecond timestamps; reset on restart.
- `history`: at most 50 successful status changes, newest first.
- `error`: current provider error text, or null.
- `csrf`: process-local request token; never store it in a committed file.

Automatic sync off suppresses external writes. Mutations still persist locally. Slack may delay changes because of the write interval or provider backoff. Both desired and last-published statuses are returned so the UI can avoid promising a completed update prematurely.
