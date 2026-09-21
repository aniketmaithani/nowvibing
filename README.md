# NowVibing

A local Spotify → Slack status app. Dark studio dashboard, current playback, live status preview, timed custom statuses, playlist rules, and a local activity log. Independent implementation; not affiliated with Spotify or Slack.

## Documentation

- [Architecture and module responsibilities](docs/ARCHITECTURE.md)
- [Local API contract](docs/API.md)
- [Security model, protections, and limitations](SECURITY.md)
- [Development, tests, and atomic commit workflow](CONTRIBUTING.md)

## Run

Use Node 22.13 or newer. This project includes `.nvmrc`:

```sh
cd /path/to/your/checkout
nvm use
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:3000**. Use this address, not `localhost`: the app checks its host and Spotify requires a loopback IP redirect.

After the first installation and build, `nvm use && npm start` is enough for the next run. Stop an existing instance with Ctrl+C first. Keep the server terminal open for automatic updates. Closing the browser is fine; sleeping or shutting down the computer stops sync. No cloud deployment or hosted backend is involved.

For development, use `npm run dev` instead of `npm start` (same port). Run `npm run build` again after changing the app before using production mode.

## Connect Spotify

1. Open the [Spotify developer dashboard](https://developer.spotify.com/dashboard) and create your own Web API app.
2. Add this exact redirect URI in the app settings:

   ```text
   http://127.0.0.1:3000/api/auth/spotify/callback
   ```

3. In this local app, select **Connections**, paste the Spotify **Client ID**, and select **Connect Spotify**. No client secret is required: authorization uses PKCE.
4. Authorize the app and play a track in Spotify on any of your devices.

The only requested scope is `user-read-playback-state`. The server reads playback every 15 seconds and refreshes authorization automatically. Spotify development-mode account restrictions apply; check the developer dashboard if access is denied. Spotify currently requires an active Premium subscription for the development app owner and limits eligible test users. See [Spotify's development-mode guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide) and [redirect URI requirements](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri).

## Connect Slack

**PKCE connection (for an app with PKCE enabled):**

1. Create/open your app at [Your Slack apps](https://api.slack.com/apps). Add `users.profile:write` under **OAuth & Permissions → User Token Scopes**.
2. Ensure PKCE is enabled. Slack treats enabling PKCE as a one-way app change; existing PKCE apps can use this connection directly.
3. Add this exact **Redirect URL** and click **Save URLs**:

   ```text
   http://localhost:3000/api/auth/slack/callback
   ```

4. Copy the **Client ID** from **Basic Information → App Credentials**. No client secret is required.
5. In the local app, select **Connections → Slack**, paste the Client ID, and click **Connect with Slack**.
6. Review and approve Slack's authorization screen. The browser returns to the local dashboard and the server stores the token privately. No copying of OAuth tokens is needed.

Keep using `http://127.0.0.1:3000` for the dashboard. Only the Slack OAuth launch/callback uses `localhost`, which Slack supports as a desktop redirect for PKCE apps. The server accepts this hostname only on those two authorization routes. Spotify's redirect is unchanged.

Slack issues rotating tokens for desktop PKCE redirects even if its token-rotation toggle is off. The app refreshes access tokens automatically and saves each replacement refresh token. Slack PKCE refresh tokens expire after 30 days; reconnect if authorization expires after extended inactivity. See [Slack's PKCE documentation](https://docs.slack.dev/authentication/using-pkce/).

**Manual-token alternative:** If you already have a non-expiring User OAuth Token (`xoxp-`), paste it in the alternate token field. Create/install the app with the `users.profile:write` user scope. The included `slack-manifest.json` configures that scope. Some app configurations do not show a copyable user token in Slack's dashboard; use the PKCE flow above for a PKCE-enabled app.

Your workspace may require administrator approval. The app verifies your account with `auth.test` and updates only your profile status through `users.profile.set`; no messages are sent. See [Slack's status API documentation](https://docs.slack.dev/reference/methods/users.profile.set/).

Do not paste tokens into source files, chat, or screenshots. The app never returns access or refresh tokens to the browser.

## Status behavior

Priority, highest first:

1. **Custom status:** choose text, emoji, and 30 minutes, one hour, four hours, or no expiry.
2. **Playlist rule:** paste a Spotify playlist link and choose its status. A rule matches the active playback context, so start playback from that playlist. Playing the same song from an album or search does not match the playlist rule.
3. **Current track:** defaults to `{track} — {artist}`. Preferences also supports `{album}`.
4. **Idle fallback:** a custom message or an empty status when playback is paused, private, unavailable, or stopped.

Custom statuses expire while the browser is closed, as long as the server is running. **Auto-sync off** pauses all external status writes, including custom ones; a custom status can still be prepared locally. Resume to apply the current desired status. Changes normally reach Slack within 15 seconds; retries and rate limits can increase this.

Music, playlist, and idle messages expire on Slack after two minutes if the server stops. The server renews active messages once per minute. Manual statuses use their selected expiration (or no expiration). Disconnecting stops future updates; a currently published manual status stays until its chosen expiry or until you clear it in Slack. The app does not preserve or restore a preexisting Slack status, and it owns status updates while auto-sync is enabled. Connecting an idle app with no fallback does not erase an existing Slack status.

A **PREVIEW** badge is a desired local status, not a claim that Slack has received it. **SYNCED** appears only after a successful matching write. Recent signals records successful Slack changes, not unsent drafts. Private sessions are never displayed; stale playback is discarded after a minute during connection failures.

## Local data

Settings, recent status changes, Spotify tokens, and the Slack token are stored in `.local/state.json`. That directory is gitignored, restricted to the owner (`0700`), and the file is owner-readable/writable (`0600`). Storage rejects unsafe file links and uses exclusive temporary files for atomic replacement. Tokens are stored in plaintext on your disk, not in browser storage. Treat backups of this folder as sensitive. Disconnect from the app to remove its stored token; revoke the integration in Spotify/Slack to revoke access at the provider.

The server binds only to `127.0.0.1`, validates the Host and Origin, and uses CSRF tokens for mutations. OAuth state is single-use, expires after ten minutes, and is bound to an HttpOnly browser cookie. Slack PKCE uses a one-time, one-minute launch ticket to establish the localhost cookie before authorization. This is a single-user local application, not a server for a shared network or public deployment. Local processes can still operate the HTTP API; read [the security model](SECURITY.md) for the exact boundary.

## Verification

```sh
npm run check
npm audit
```

Tests use temporary directories and mocked Spotify/Slack responses: priority, playlist links, Unicode limits, private playback, expiration, deduplication, token refresh, quota backoff, pause/resume, persistence, credential redaction, CSRF/Host/Origin checks, and OAuth PKCE/cookie/state handling. They do not contact or change real accounts. Live Spotify-to-Slack sync requires connecting your own accounts and is not verified by these tests.

## Troubleshooting

- **Port 3000 in use:** stop the existing instance or the other process on that port before starting. The fixed port keeps the OAuth redirect consistent.
- **Spotify access denied:** check the Spotify app's allowed users, account eligibility, and exact redirect URI, then reconnect.
- **Slack `missing_scope` or `not_allowed_token_type`:** use a user token (`xoxp-`) with `users.profile:write`, then reinstall the Slack app if you added the scope later.
- **Playlist rule doesn't match:** start the track from the target playlist. Some playback contexts (including certain queues or radio playback) do not report a playlist.
- **Status isn't changing:** check the error banner, Auto-sync, and whether a manual status is still active. The application respects provider `Retry-After` limits.
