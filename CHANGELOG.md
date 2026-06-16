# Changelog

All notable changes to the monorepo are documented here.

## [0.4.0] — 2026-XX-XX

### Changed
- **Monorepo consolidated to a single package**: `pi-soly` now bundles all
  features (project management + multi-question picker + agent switcher)
  as built-in sub-features.
- `pi-ask` files merged into `packages/pi-soly/ask/` (multi-question picker
  is now a built-in feature of `pi-soly`).
- `pi-switch` files merged into `packages/pi-soly/switch/` (agent switcher
  is now a built-in feature of `pi-soly`).
- `pi-todo` package removed entirely.

### Removed
- `pi-todo` — live task list (feature not wanted).

### Deprecated on npmjs.com
- `pi-asked`, `pi-agented`, `pi-todo-list` — superseded by `pi-soly` v0.4.0.
  Install with `pi install npm:pi-soly` instead.

## [0.3.0] — earlier

Initial multi-package release (pi-soly, pi-asked, pi-todo-list, pi-agented).
See git history for full commit details.
