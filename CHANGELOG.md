# Changelog

All notable changes to the **pi-soly.framework** monorepo are documented here.
Per-package changes are also documented in each `packages/*/CHANGELOG.md`.

## [0.2.0] — 2026-XX-XX

### Added
- **soly**: agent switcher moved to separate `pi-switch` extension
- **soly**: integration with `pi-todo` (auto-seeds todos from `<task>` blocks)
- **soly**: integration with `pi-ask` (prefers `ask_pro` over `soly_ask_user`)
- **soly**: 5 new soly-augmented agents shipped (soly-debugger, soly-tester,
  soly-refactor, soly-reviewer, soly-documenter)
- **pi-switch**: header bar above chat, Ctrl+Shift+S cycle, `/agent` slash
- **pi-switch**: task→agent recommendation engine (English + Russian)
- **pi-switch**: `/agent create <name>` scaffolds new user agents
- **pi-switch**: `/agent doctor` diagnostics
- **pi-switch**: `/agent recommend <task>` suggests the right agent
- **pi-ask**: Space=toggle, Enter=confirm in multi-select (Claude Code-style)
- **pi-todo**: persistent footer status line for todo progress

### Changed
- **soly**: `soly agent` subcommand removed (use `/agent` from pi-switch)
- **soly**: `soly-` agents no longer in the cycle by default (opt-in via
  `useSolyWorkerSubagents: true`)

### Fixed
- **pi-switch**: `/agent <name>` now correctly sets agent (was: fell through
  to "show list" because the parser only checked the second token)

## [0.1.0] — initial

- First monorepo structure. Each extension lives in its own package.
