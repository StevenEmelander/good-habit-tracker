# Good Habit Tracker — maintainer notes

Reference for humans and coding agents working in this repository.

## What this is

A self-contained **single-file** web app (`app/tracker.html`) plus a small **AWS CDK** stack. Intended for **personal** hosting: obscure hostname, Lambda@Edge cookie gate, optional unlock query parameter for new devices.

## Critical constraints (read before editing)

1. **Single-file HTML only** (`app/tracker.html`). Inline CSS/JS. No external CSS, frameworks, or CDN dependencies for the app shell.

2. **Cloud is the source of truth.** No `localStorage` for tracker payload. Boot uses `GET /api/sync?from=…&to=…` (defaults to ~730d if omitted); edits debounce to `POST /api/sync`. Wire JSON: `checkinsByDate`, `cycles`, `_lastModified`; GET may also return `checkinBounds` `{ min, max }`. **POST** accepts `partial: true` with only changed days in `checkinsByDate` plus `deletedCheckinDates[]`; omit `partial` or set `partial: false` to replace all check-in rows from the payload (advanced / tooling). DynamoDB: **`good-habit-tracker-cycles`** (one item: `cycles` JSON + `_lastModified` + optional `checkinDateMin`/`checkinDateMax`) and **`good-habit-tracker-day-checkins`** (`pk = DAY`, `dateKey` sort key for **Query** by date range).

   Schema:

   - `checkinsByDate` — per-date entries with `habitValuesById` (removing a habit purges its id from all dates once that id no longer appears in **any** cycle’s `habitDefinitions`, so cloned cycles keep the same id until the last copy is removed)
   - `cycles[]` — each cycle: `startDate` / `endDate`, `lengthDays`, `categories[]`, `habitDefinitions[]` (boolean or count habits with `scoring` / point rules)

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
| `GoodHabitTrackerStack` | us-west-2 | S3 site, CloudFront, Route53 record, sync Lambda + URL, DynamoDB (`good-habit-tracker-cycles`, `good-habit-tracker-day-checkins`) |

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

**Legacy DynamoDB:** Older stacks used `good-habit-tracker-state` (and possibly `habit-tracker-state`). After migrating to `good-habit-tracker-cycles` + `good-habit-tracker-day-checkins`, remove any **retained** old tables in **us-west-2** from the AWS console if CloudFormation left them behind.

### Lambda@Edge auth updates (export deadlock)

If changing the Edge auth Lambda while the main stack imports the cert stack’s export, deploy **in order** with `--exclusively`: (1) `GoodHabitTracker` with `--context temp_drop_edge_auth=true` (briefly ungated), (2) `GoodHabitTrackerCert`, (3) `GoodHabitTracker` again without `temp_drop_edge_auth`. `cert-stack.ts` replaces only the line `const UNLOCK_HASH = '__UNLOCK_HASH__';` in `lambdas/auth/index.js` — keep that placeholder out of comments.

### Unlock on phones

Bookmark the **encoded** URL from deploy output (or build it with `encodeURIComponent`). Auth uses raw query decode, not `URLSearchParams` (`+` → space). Cookie **`SameSite=Lax`** for iOS.

## When making changes

1. App behavior → `app/tracker.html` only (unless infra must change for the same feature).
2. Keep diffs focused; avoid opportunistic refactors.
3. Schema or API changes → update app **and** sync Lambda expectations together where needed.

## What to avoid unless explicitly requested

- Streaks / achievements / social features framed as pressure
- Heavy multi-tenant auth product on top of this minimal gate
- Telemetry and third-party trackers
