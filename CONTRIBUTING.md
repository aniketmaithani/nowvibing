# Developing NowVibing

## Environment

Use Node 22.13+ (the exact local version is in `.nvmrc`) and npm. This project targets macOS/Linux single-user desktop use; credential-file protections depend on POSIX ownership and permission semantics.

```sh
nvm use
npm ci
npm run dev
```

For the production loop:

```sh
npm run build
npm start
```

Keep only one server on port 3000. Preserve the documented callback URLs when changing internals. Renaming the display name or package does not require reconnecting; changing app Client IDs or callback URLs may.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run check:secrets
npm run build
```

`npm run check` runs those five checks in order. The secret scan examines the Git index: stage intended changes before running it. `npm audit` is a separate network-backed dependency advisory check.

Tests must use temporary state directories and injected/mock provider requests. Do not use real credentials or the user's `.local` directory in tests. Never test Slack writes against a live account unless the user has expressly requested that action. Build/HTTP checks do not replace a live-account acceptance test.

## Test map

| File                             | Behavior                                                                                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/sync.test.mjs`            | Priority, expiry, playlist matching, private sessions, status deduplication, pause/resume, OAuth state/cookies/replay, refresh rotation, backoff, URL filtering, and token redaction. |
| `tests/state-store.test.mjs`     | Persistence, restrictive permissions, corruption handling, and link rejection.                                                                                                        |
| `tests/http.test.mjs`            | Production security headers, script hashes, file confinement, malformed paths, content types, and byte limits.                                                                        |
| `tests/secret-patterns.test.mjs` | Credential-pattern and private-path detection using synthetic values.                                                                                                                 |

## Atomic commits

Keep each commit focused on one independently reviewable concern. Include the tests that justify the behavior change in that same commit. Separate branding, persistence, HTTP behavior, provider integration, developer tooling, and documentation when they do not depend on each other's implementation.

Use a short imperative subject such as `fix: reject unsafe credential-file links`. Add a body that explains the concrete behavior and relevant verification. Do not append `Co-authored-by` trailers. Use the existing Git author identity; do not forge identity, authorship, or dates. Do not commit generated builds, dependency directories, credentials, or local runtime state.

This repository started with a single import of the already-working app because the workspace had no previous Git history. Subsequent commits preserve the actual sequence of rename and hardening work. No earlier history was fabricated.

Before committing:

```sh
git status --short
git diff
# Stage only the files for one concern.
git add path/to/changed-file
npm run check:secrets
git diff --cached --check
git diff --cached
git commit
```

Optional local hook setup:

```sh
git config --local core.hooksPath .githooks
```

If you already use Git hooks, call `node scripts/check-secrets.mjs` from the existing setup instead of replacing it. Do not bypass a credential finding; unstage the file, remove the secret, and revoke it if it has been exposed.

## Code ownership and changes

Keep status resolution pure in `server/engine.mjs`. Keep provider IO, refreshes, and serialized mutations in the service. Keep disk behavior in the state store and production HTTP behavior in the request handler. Update [the API contract](docs/API.md) when routes or response semantics change.

The UI primitive catalog is generated scaffold code and has separate upstream conventions. Application lint covers the app, server, tests, scripts, shared utility, and configuration rather than rewriting unused primitives to satisfy application rules. Preserve their accessibility behavior when composing controls.

Read [SECURITY.md](SECURITY.md) before touching credentials, OAuth, Host/Origin checks, static serving, CSP, or error handling. A feature that changes the trust model must update that document and add meaningful regression tests.
