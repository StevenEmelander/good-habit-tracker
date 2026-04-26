# Good Habit Tracker — maintainer notes

Reference for humans and coding agents working in this repository.

## What this is

A self-contained **single-file** web app (`app/tracker.html`) plus a small **AWS CDK** stack. Intended for **personal** hosting: obscure hostname, Lambda@Edge cookie gate, optional unlock query parameter for new devices.

## Critical constraints (read before editing)

1. **Single-file HTML only** (`app/tracker.html`). Inline CSS/JS. No external CSS, frameworks, or CDN dependencies for the app shell.

2. **Cloud is the source of truth.** No `localStorage` for tracker payload. Boot waits on `GET /api/sync`; edits debounce to `POST /api/sync`. Do not casually change the sync contract (`checkinsByDate`, `program`, `_lastModified`).

   Schema:

   - `checkinsByDate` — per-date entries with `habitValuesById`
   - `program.cycles[]` — each cycle: date range, `categories[]`, `habitDefinitions[]` (boolean or count habits with scoring)

3. **Privacy / telemetry.** No analytics, no third-party fonts or icons, no extra “phone home” beyond your own origin and `/api/sync`.

4. **Deploy secrets.** `unlock_token` is passed only at deploy/synth (`--context unlock_token=...`). Never commit it. Stack outputs must **not** embed the raw token (use deploy scripts to print `https://…/?unlock=…` locally).

## Architecture

### App (`app/tracker.html`)

Vanilla JS. Rebuilds DOM from `state` on change; `data-action` delegation on `document.body`.

Useful symbols: `render`, `renderToday`, `renderTrends`, `renderTune`, `save`, `load`, `schedulePush`, `syncFromCloud`, `getCurrentCycle`, `getUpcomingCycle`, `cycleInfo`, `stripLegacyRestFromCheckins`.

### Infrastructure (`infrastructure/`)

| Piece | Region | Role |
|--------|--------|------|
| `CertStack` | us-east-1 | ACM cert, Lambda@Edge auth (viewer request) |
| `GoodHabitTrackerStack` | us-west-2 | S3 site, CloudFront, Route53 record, sync Lambda + URL, DynamoDB |

Edge auth checks `htok` cookie (value = SHA-256 hex of deploy token) or `?unlock=` token (same hash). Sync Lambda requires `X-CF-Secret` header from CloudFront (derived from deploy token in stack code).

### Auth flow

1. `https://<host>/?unlock=<token>` → Edge validates, sets `htok` cookie, redirects to `/`
2. Valid cookie → pass request through
3. Otherwise → `403` minimal HTML

## Deploy

```bash
UNLOCK_TOKEN=your-secret-token ./deploy.sh
```

Or `deploy.ps1` on Windows. Scripts echo the bookmarkable unlock URL; they do not rely on CloudFormation outputs for the secret.

### Updating Lambda@Edge auth (cross-region export)

CloudFormation **cannot change** a cross-stack export value while `GoodHabitTracker` still imports it (the Edge Lambda version ARN). If only the auth Lambda code or hash substitution changes, use a **three-step** deploy with `--exclusively` so CDK does not try to update the cert stack before the main stack releases the import:

1. **Drop Edge on CloudFront** (site is briefly **not** gated — keep this window short):

   ```bash
   cd infrastructure
   npx cdk deploy GoodHabitTracker --exclusively --require-approval never \
     --context unlock_token="$UNLOCK_TOKEN" --context temp_drop_edge_auth=true
   ```

2. **Update the cert stack** (new `AuthFn` code / version export):

   ```bash
   npx cdk deploy GoodHabitTrackerCert --exclusively --require-approval never \
     --context unlock_token="$UNLOCK_TOKEN"
   ```

3. **Re-attach Edge** on the distribution:

   ```bash
   npx cdk deploy GoodHabitTracker --exclusively --require-approval never \
     --context unlock_token="$UNLOCK_TOKEN"
   ```

`cert-stack.ts` injects the unlock digest by replacing the single line `const UNLOCK_HASH = '__UNLOCK_HASH__';` in `lambdas/auth/index.js` — do not put `__UNLOCK_HASH__` in comments or the wrong substring may be substituted.

### Unlock links on phones

If the token contains `+` or `/`, the query string must be **percent-encoded** when pasted into a browser or Messages, or the server will see the wrong token.

## When making changes

1. App behavior → `app/tracker.html` only (unless infra must change for the same feature).
2. Keep diffs focused; avoid opportunistic refactors.
3. Schema or API changes → update app **and** sync Lambda expectations together where needed.

## What to avoid unless explicitly requested

- Streaks / achievements / social features framed as pressure
- Heavy multi-tenant auth product on top of this minimal gate
- Telemetry and third-party trackers
