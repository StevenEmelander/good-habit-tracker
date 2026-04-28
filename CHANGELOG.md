# Changelog

All notable changes to this project are documented here.

## [Unreleased]

## [0.3] - 2026-04-28

### Added

- **Per-item REST API** under `/api/*`: `GET/PUT/DELETE /api/cycles/:id`, `GET/PUT/DELETE /api/entries/:date`, plus `GET /api/cycles` and `GET /api/entries` for boot. All reads are partition-targeted Query / GetItem (no Scans, no date-range parameters).
- **Per-item debounced writes** in the front-end: `pushCycle(id)` and `pushEntry(date)` keyed by item, replacing the previous "send the whole world on every edit" path. Toggling a checkbox now produces exactly one `PUT /api/entries/:date` and no cycles traffic.
- **Server-side orphan-habit sweep**: when a cycle is updated or removed, the lambda strips habit ids that are no longer defined by any cycle from every entry row and returns `removedHabitIds` so the front-end mirrors the sweep locally.
- **Backup script** at `scripts/backup.ps1` (and `backup.sh`): hits the new endpoints with the `htok` cookie and writes a single timestamped JSON file to `backups/`.

### Changed

- **Naming consistency throughout.** Renamed `today` UI references to `entry`/`entries` and `tune` references to `plan`. File renames `today-ui.js` → `entry-ui.js`, `tune-ui.js` → `plan-ui.js`. Function renames `renderToday` → `renderEntry`, `renderTune` → `renderPlan`. State renames `state.checkinsByDate` → `state.entriesByDate`, `state.checkinBounds` → `state.entryBounds`, `state.tuneMode` → `state.planMode`. CSS classes `.tune-*` → `.plan-*`. Wire field `checkinBounds` → `entryBounds`. DynamoDB attributes `checkinDateMin/Max` → `entryDateMin/Max` (existing data migrated in place). Tab label `TUNE` → `PLAN`.
- **Storage layout** is unchanged at the table level (same names, same partition keys); the lambda now exposes per-item endpoints over the existing rows. Bounds are maintained incrementally on every entry put/delete instead of by scanning the entire entries table on every write.
- **Boot** is two parallel calls (`GET /api/cycles` + `GET /api/entries`) instead of a single 730-day range fetch.

### Removed

- **Legacy `/api/sync` route.** GET (`?from=&to=`) and POST (`partial: true` / `deletedCheckinDates[]`) are gone; cutover was atomic.
- **Legacy front-end paths**: `schedulePush`, `purgeOrphanHabitData` (now server-side), `_loadedRange`, `ensureDayLoadedThenRender`, `ensureTrendsRangeLoaded`, `fetchCheckinsRange`, `rangeFullyLoaded`, `stripLegacyRestFromCheckins`. The orphan-`isRestDay` cleanup is no longer needed.
- **Legacy DynamoDB attribute** `_lastModified` on the cycles row.

## [0.2.0] - 2026-04-27

### Added

- **Modular app:** Styles and scripts split into `app/styles/` and `app/scripts/` while keeping a single deployable `app/tracker.html` shell.
- **Trends:** Day, week, month, and year summaries; dual charts and a 30-day view from loaded cloud data (no local backup/export UI).
- **Tune & copy:** Tune UX polish; clearer **entries** wording where it replaces older labels.

### Changed

- **Sync & storage:** Replaced the single DynamoDB blob with **`good-habit-tracker-cycles`** (one item: `cycles` JSON + `_lastModified` + check-in date bounds) and **`good-habit-tracker-day-checkins`** (`pk = DAY`, `dateKey` sort key) for efficient **Query** by date range.
- **API:** `GET /api/sync?from=YYYY-MM-DD&to=YYYY-MM-DD` returns check-ins in range plus `checkinBounds`. `POST` supports **`partial: true`** with only changed days and **`deletedCheckinDates`**; full replace when `partial` is false (replaces all remote day rows from the payload).
- **App:** Partial cloud saves for edited days; cycle logic and rendering aligned with multi-cycle habits.
- **Infra:** CloudFront forwards query strings to the sync origin; CDK **`S3BucketOrigin.withOriginAccessIdentity`** replaces deprecated `S3Origin`. Deploy scripts and stack wiring updated for the sync path.

### Removed

- Legacy DynamoDB tables **`good-habit-tracker-state`** and **`habit-tracker-state`** (superseded single-table designs). If you upgraded from an older stack, delete any retained empty tables in **us-west-2** that match those names.

