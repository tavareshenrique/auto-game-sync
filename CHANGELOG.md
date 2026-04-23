# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog,
and this project follows Semantic Versioning.

## [2.0.0] - 2026-04-23

### Added

- Unit test suite with 49 tests covering domain logic (`domain.ts`) and PS-Timetracker parsing (`ps-timetracker.ts`), using Playwright Test as test runner.
- ESLint (flat config) with `@typescript-eslint` rules and Prettier integration via `eslint-config-prettier`.
- Prettier formatting with single quotes, semicolons, trailing commas (ES5), and 100-char print width.
- CI workflow (`.github/workflows/ci.yml`) that runs on pull request open/update: lint, format check, type check, and tests.
- New scripts: `pnpm lint`, `pnpm format`, `pnpm format:check`.

### Changed

- Exported `parseSessionRow` and `RawRowCells` from `ps-timetracker.ts` to enable unit testing.
- Applied Prettier formatting across all source files.

## [1.0.0] - 2026-04-22

### Added

- End-to-end automation with Playwright to sync playtime from PS-Timetracker to Backloggd journal entries.
- Session scraping and aggregation by reference date, including duration parsing and title normalization.
- Support for explicit reference date (`SYNC_REFERENCE_DATE`) or day offset (`SYNC_REFERENCE_DAYS_OFFSET`).
- Backloggd login/session handling with optional Playwright `storageState` reuse (`BACKLOGGD_STORAGE_STATE_PATH`).
- JSON sync report output in `storage/sync-summary.json` (configurable via `SYNC_SUMMARY_PATH`).
- Daily GitHub Actions workflow plus manual trigger (`workflow_dispatch`) for headless sync execution.
- Success email notification in CI with per-game summary (title, played time, registered day).
- Local execution scripts: `pnpm sync`, `pnpm sync:headless`, and `pnpm typecheck`.

### Changed

- Sync behavior is fail-fast per game: the process exits with non-zero status when any game fails to sync.

### Notes

- Current implementation targets a fixed Backloggd Playing URL (`/u/henriquetavares/playing/`).
- PS-Timetracker scraping currently reads up to 5 pages per run.
