# Changelog

All notable changes to this project are documented here.

## [Unreleased]

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

