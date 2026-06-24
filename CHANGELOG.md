# Changelog

All notable changes to the monorepo are documented here.

## [Unreleased]

## [1.13.0] — 2026-06-24

### Added
- **Pre-action rule reminder** — for every `edit`/`write` tool call, soly
  now appends a compact list of rules applicable to the file just
  changed to the tool's result. The LLM is asked to confirm in its
  next message which rules were applied (or why not). Closes the gap
  where MANDATORY rules loaded at the start of a turn are forgotten
  by the time the agent actually edits something.
  - Behaviour: top 3 rules by `priority` (high → medium → low →
    unspecified), sorted by `relPath`. Capped to avoid flooding
    per-edit context.
  - Skips when no rules match, when the tool errored, or when
    `agent.preActionRuleReminder` is `false`.
  - Helpers in `core.ts`: `getApplicableRulesForFile(path, rules)`
    and `formatRuleReminder(rules, filePath, cap=3)`.
- **`agent.preActionRuleReminder` config flag** (default `true`) —
  opt-out for projects with very large rule sets that would
  otherwise flood per-edit context.

## [1.12.2] — 2026-06-24

### Changed
- **Added global/local + counterweight vocabulary** to `decision_deck`
  and `ask_pro` descriptions and the per-turn `toolHints` rule. The
  prior 1.12.1 wording ("code + pros/cons per option") was concrete
  but missed the higher-level distinction the user cares about:
  - `decision_deck` = **global** architectural fork with real
    **counterweight** between options (trade-offs that genuinely
    pull in different directions — e.g. consistency vs availability,
    sync vs async).
  - `ask_pro` = **local** sub-question inside an already-decided
    theme, simple label-vs-label «или/или», or 2+ related questions
    in one batch.
- Hint now reads **"Default to `ask_pro` unless the stakes are
  global"** and explicitly mentions `global` / `counterweight` as
  the contrast words.

No API change, no new fields — only the LLM-facing contract strings.

## [1.12.1] — 2026-06-24

### Changed
- **Clarified `decision_deck` vs `ask_pro` tool descriptions** so the LLM
  reaches for the right picker. Hard rules now live in **both** tool
  descriptions and the per-turn `toolHints` rule:
  - `decision_deck` = strictly **ONE question** per call, options need
    code + pros/cons, "for 2+ related questions, use `ask_pro` instead".
  - `ask_pro` = **default** for simple label-vs-label choices and any
    flow with 2+ related questions; names `decision_deck` as the
    contrast for the architectural-fork case.
  - Hint steers with **"default to `ask_pro` unless you have explicit
    code or trade-offs per option"** and **"never use `decision_deck`
    for 2+ questions"**.
- **`tests/tool-hints.test.ts` rewritten** to lock in the new contract
  (deck branch must name `ask_pro` as the contrast even when
  `ask=false`; ask branch must name `decision_deck` as the wrong tool).
  The old test had codified the gap that hid the deck-vs-ask_pro
  distinction from the LLM.

No API change, no new fields, no runtime dependencies — only the
LLM-facing contract strings.

## [1.12.0] — 2026-06-24

### Added
- **Visual chrome** — native, dependency-free status layer: custom footer, top
  bar, equalizer working spinner with live telemetry (elapsed · ↑↓ tokens ·
  tok/s), and a gradient welcome banner. Config under `chrome`.
- **`soly verify`** — self-review loop (re-review until "No issues found." or a
  cap; `fresh`-context mode), built on a new single-owner `context` channel.
- **`/rules` / `/docs` modal** — overlay list panel (fuzzy search, live preview,
  in-place enable/disable/reload) instead of chat dumps.
- **`decision_deck`** — native full-screen TUI deck for design/architecture
  forks: one framed card per option with a syntax-highlighted code snippet and
  pros/cons; flip with ←/→ or 1-N, choose with Enter.
- **`html_artifact`** — render LLM-supplied HTML (full doc or body fragment,
  themed light/dark) and serve it from a per-project **gallery SPA** (sidebar +
  iframe viewer + filter + theme toggle + live SSE updates) on one stable
  localhost URL — soly's local "artifacts". `id` updates an artifact in place;
  `assets` writes sibling files (images/css/json) the HTML can reference; the
  theme is overridable via `.soly/artifact-theme.css`. Falls back to opening the
  file directly when the server is off. Config under `artifacts` (`open`, `dir`,
  `server`, `theme`, `retentionDays`). **`/artifacts`** browses the gallery from
  the terminal (modal: Enter opens, `g` gallery, `x` delete, `clear` all); a
  `▦ N` footer indicator shows the live count. Artifacts persist **per project**
  (stable temp dir keyed by cwd + an `index.json` manifest), so the gallery
  survives `/reload` and pi restarts; `/artifacts` (or the next artifact) restores it.
- **`/soly`** now opens the ListPanel modal (like `/rules`) with a live preview
  per subcommand and Enter-to-open — replacing the plain picker (and its
  duplicated entries).
- **Tool affordance hints** — when a prompt mentions examples/tables or
  options/compare, the LLM is prompted to **ask first** whether to render the
  result in the browser (`html_artifact` / `decision_deck`) or just as text in
  chat, then proceed; clarifying-question wording points at `ask_pro`. Injected
  for that turn only. Bilingual RU/EN triggers; toggle `agent.toolHints` (default on).
- **Confirm before coding** — for non-trivial tasks the behavioral nudge now
  tells the LLM to state its approach + open questions and ask the user via an
  `ask_pro` picker ("Go — implement" / "Discuss / refine" / "Adjust scope")
  before editing files, instead of diving straight into code. Toggle
  `agent.confirmBeforeCode` (default on).
- **`ask_pro`** gained per-option `preview` (side panel, with fenced code
  syntax-highlighted), per-question `allowOther` (free-text "Other…"),
  `freeText` questions (no options — typed answer), multi-select `minSelect`/
  `maxSelect` bounds, `s` to skip a question, and a cursor that starts on the
  ⭐ recommended option.
- **Top bar** lights up for the active workflow verb (execute/plan/discuss/
  resume/verify).

### Fixed
- soly-framework skill now ships via the `pi.skills` manifest (it never loaded
  by default before).
- execute/plan run inline (with a `soly doctor` check) when the `subagent` tool
  isn't installed, instead of asking for a tool that doesn't exist.
- Phase CONTEXT was emitted twice in plan/exec iteration bundles.

### Changed
- Repositioned: the LLM drives execution and delegates to a `worker` subagent
  when available (dropped the "no subagent layer" framing).
- `execute` close-out now suggests `soly verify`.

### Removed
- Inert `useSolyWorkerSubagents` flag + `__PI_SWITCH_AGENT__` plumbing.
- Redundant `soly_intent` tool; `soly_ask_user` deprecated in favor of `ask_pro`.

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