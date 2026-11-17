# Changelog

All notable changes to Agent Title Sync are recorded here.

## [Unreleased]

### Fixed

- Read OpenCode 2 session titles from the `session_v2` table, falling back to
  the 1.x `session` table. Before, OpenCode 2 panes only got the truncated
  terminal title.
- Request JSON from `herdr plugin list`, so the watcher can detect that the
  plugin was disabled and no longer counts the check as a failed pass.

## [0.2.0] - 2026-08-08

### Added

- A single-instance runtime watcher for live session-title changes.
- Dedicated adapters for Claude Code, Codex, Kimi Code, and OpenCode.
- A terminal-title fallback for additional coding agents.
- TypeScript type checking and an end-to-end watcher test.

### Changed

- Renamed the plugin from `herdr-better-renaming` to
  `herdr-agent-title-sync`.
- Split agent adapters into independent modules under `src/adapter/`.

### Fixed

- Resolved Codex resume titles from the exact process session ID when the pane
  cwd differs from the thread's originally stored cwd.

## [0.1.0] - 2026-08-08

### Added

- Initial Herdr pane-title synchronization and manual-label preservation.
