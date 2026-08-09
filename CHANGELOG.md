# Changelog

All notable changes to Agent Title Sync are recorded here.

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
