# Changelog

All notable changes to the monorepo are documented here.

## [1.9.1] — 2026-06-XX

### Changed
- **Removed spammy post-turn "Rules check" chat notification** — tracking of
  edited files / applicable rules is preserved internally for `/why`.

## [1.9.0] — 2026-06-XX

### Added
- **`/docs stats`** command — Claude-memory-style breakdown for intent docs
  (inline vs preview-only vs phase-specific). Pure helpers in `intent.ts`:
  `buildIntentStats()`, `formatIntentStats()`.

## [1.8.0] — 2026-06-XX

### Added
- **`/rules stats`** command — Claude-memory-style breakdown for rules
  (always-on vs glob-matched vs disabled). Pure helpers in `core.ts`:
  `buildRulesContextStats()`, `formatRulesContextStats()`.

## [1.7.0] — 2026-06-XX

### Added
- **Post-turn rules check** at `turn_end` — surfaces applicable rules for
  files edited in the turn. (Removed in 1.9.1; tracking preserved for `/why`.)
- **`rulesApplicableToFiles()`** pure helper in `core.ts`.

## [1.6.0] — 2026-06-XX

### Added
- **MANDATORY rules header** in `buildRulesSection()` — every turn the
  system prompt opens with:
  `## ⚠️ MANDATORY: soly project rules` + NON-NEGOTIABLE directive.
- **`tool_call` hook** for edit/write — tracks edited files for post-check.

## [1.5.0] — 2026-06-XX

### Added
- **`/soly` interactive picker** — emoji icons (📍📄📋💡🔬🗺️📊📁✅⭐🎯🔄⚙️),
  defaults to picker when called with no args (was: defaulted to `position`
  silently).
- **E2E tests** (`tests/e2e-commands.test.ts`) — mock pi + invoke handlers,
  14 tests for `/soly`, `/rules`, `/why`, `/soly-migrate`, `/soly-init`.
- **`soly_read` cache** (`tools.ts`) — 30s TTL + mtime check.
- **Graceful STATE.md fallback** — `readDecisions` skips empty/corrupt.

## [1.4.2] — 2026-06-XX

### Added
- **Smoke test** (`tests/smoke.test.ts`) — catches broken imports/function
  calls at load time (Proxy-based mock pi).
- Fixed orphaned `piSwitchExtension(pi)` call left after 1.4.0.

## [1.4.0] — 2026-06-XX

### Removed
- **Rotors entirely** — was: 4 cycle agents (worker/oracle/scout/reviewer)
  wrapped in cycle UI. Removed because pi doesn't support mode cycling well;
  over-engineering.
- **`switch/` directory** — Ctrl+Tab footer pill removed (was: unreliable
  Ctrl+Shift+S → Ctrl+Tab → removed).

## [1.3.0] — 2026-06-XX

### Removed
- **soly-manager subagent** — was: 1 agent with 8 modes. pi doesn't
  support Claude-style plan agents; the LLM executes plans directly via
  slash commands + `soly-framework` skill reference.

## [1.2.0] — 2026-05-XX

### Added
- **`/soly-init`** command — scaffolds `.soly/` with 4 templates
  (minimal|web-app|library|cli).
- **`/soly-migrate`** command — atomic `.soly/` → `.agents/` rename
  (vendor-neutral, AGENTS.md standard).
- **`.agents/` convention** — rules/skills/docs/agents, parallel to `.soly/`.

## [1.1.0] — 2026-05-XX

### Added
- **Notification widget** — `notification.ts` with Box widget using
  `theme.bg("customMessageBg")`.
- **`/soly-log`** command — view recent notifications.
- **`/soly-status`** command — comprehensive one-screen report.
- **Notification history log** (`notifications-log.ts`) — JSONL append
  to `.agents/.soly/notifications.log`.

## [1.0.0] — 2026-05-XX

### Added
- **Migrated CI from Forgejo to GitHub Actions** — self-hosted runner
  on `forgejo.runner-001` (renamed to GitHub Actions runner). Tag-based
  publish via GitHub Environment `npm-publish`.
- **Renamed agents → rotors** — user preference at the time. (Reverted
  to no agents/rotors in 1.4.0.)
- **Cycle agents reduced 8→4** — worker/oracle/scout/reviewer.

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