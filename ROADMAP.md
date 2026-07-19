# Roadmap

> **Last updated:** 2026-07-19
> **Branch state:** `feat/mode-system` (10 commits ahead of `master`)
> **Latest published:** `pi-soly-v3.0.0-alpha.1` (rename-only, awaits npm approval)
> **Next planned:** `pi-soly-v3.0.0-alpha.2` (mode system + settings registry + tool rendering)

---

## TL;DR — Where we are

**Soly 3.0.0-alpha.2 is functionally complete.** All 5 known bugs from the
`feat/mode-system` branch are fixed. 702/702 unit tests pass. The package
rename to `@dot-stbl/soly` is tagged and pending publish approval.

**What's blocking the alpha.2 release:** just the human steps (npm publish
approval, CHANGELOG polish, tag push). No code remaining.

**The big work ahead** (already designed, not started):
1. **Rulecheck** — the user's central feature. soly **does not** reimplement
   analyzers; it ships a small rules DSL and lets users plug in providers.
   First-class LLM tool for "check the code against project rules".
2. **Plugin architecture** — incremental migration from monolithic
   `index.ts` to capability-bag plugins (rules → intent → chrome → commands
   → ask/deck/artifact → mcp).
3. **Stable 3.0.0** — after alpha.2 lives clean for a week, bump to stable
   (drop `-alpha` suffix, no code changes).

---

## Current state — what shipped

### v3.0.0-alpha.1 (tagged, pending npm approval — 2026-07-12)

**Scope:** package rename only, zero code change.
- Package renamed `pi-soly` → `@dot-stbl/soly` on npm.
- Org `dot-stbl` reserved for future packages.
- Old `pi-soly` package to be deprecated immediately after alpha.1 publishes.

### Branch `feat/mode-system` → planned v3.0.0-alpha.2

10 commits on top of v2.6.1, all tests green, typecheck clean:

| Area | Commit | What |
|---|---|---|
| **Mode system** | `92da10f` | config loader (chain resolution + auto-detect) |
| | `b74d415` | resolve + persist + chrome.data + package.json fields |
| | `ad7e834` | picker semantics fix + system prompt integration |
| | `9a9df64` | **bug #4** — remove `defaultBranchPrefix` (LLM asks via `ask_pro`) |
| | `1121375` | **bug #3** — mode-based command gating (plans-vs-phases) |
| **Settings registry** | `23ef2ce` | 20 settings with TypeBox schema + sensitivity tiers (cosmetic/behavioral/structural) + LLM tools (`soly-config`, `soly-settings-set`) |
| **Custom rendering** | `cbd2c82` | OSC fix (`windowsHide: true`) — Windows ConPTY artifact gone |
| | `cad98ef` | working message — removed telemetry numbers, added rotating verbs |
| | `6f85a84` | `◈` glyph + one-line tool render via `renderCall`/`renderShell:"self"` |
| | `67b27d7` | tool rename `_` → `-` (all 15 tools: `soly-config`, `soly-read`, etc.) |
| | `7ba21c8` | rename propagated to docs/rules/skills/README (CHANGELOG intentionally NOT touched — historical record) |

**Bug status from this branch:**

| Bug | Status | Commit |
|---|---|---|
| #1 Picker semantics (auto-pin phases for existing repos) | ✅ Fixed | `ad7e834` |
| #2 System prompt integration | ✅ Fixed | `ad7e834` |
| #3 Command gating (plans-vs-phases) | ✅ Fixed | `1121375` |
| #4 `defaultBranchPrefix` removal | ✅ Fixed | `9a9df64` |
| #5 Picker timeout (auto-pin applies at init) | ✅ Fixed | `b74d415` |

---

## Next step — v3.0.0-alpha.2 release

### Code state
- ✅ All 5 bugs fixed
- ✅ 702/702 unit tests pass (`bun test packages/pi-soly/`)
- ✅ Typecheck clean (`bun run typecheck`)
- ✅ One known issue: 2 `real-git` integration tests fail on git ≥2.49 (default branch changed from `master` → `main`). Pre-existing, fails on `master` too.

### Remaining human steps
1. **CHANGELOG entry** for `3.0.0-alpha.2` — mode system + settings + tool render + 4 bug fixes.
2. **Push tag** `pi-soly-v3.0.0-alpha.2`.
3. **Merge** `feat/mode-system` → `master` (or cut a release branch).
4. **Approve npm publish** for `pi-soly-v3.0.0-alpha.1` in GitHub Environments (blocks alpha.2 too).
5. **Deprecate** old `pi-soly` package after alpha.1 lands: `npm deprecate pi-soly "Moved to @dot-stbl/soly"`.

### Optional — `writeSolyConfig` wiring

Currently `soly-settings-set` can write only the `mode` layer (`writeModeConfig`).
The full settings registry has 20 settings; full write coverage for the
`solyConfig`-layer (chrome, agent, artifacts, mcp) requires wiring
`writeSolyConfig` through `settings/tools.ts` deps. **Not blocking** for
alpha.2 — the LLM can read all 20 settings, only ~5 are writable today.

---

## v3.0.0-stable

Bump `3.0.0-alpha.2` → `3.0.0.0` after a clean week of usage:
- No code changes expected.
- Drop `-alpha` suffix.
- Document migration from `pi-soly` (rename) one final time.

---

## Major work — what's coming (designed, not started)

### v3.1.0 — Logging

A zero-dep structured logger for soly itself (the package currently uses
`pi.sendUserMessage` and `chrome.recordEvent` for diagnostics, but has
no persistent log file):
- NDJSON format, one event per line.
- Rotation: 10MB × 5 files.
- Ring buffer in memory: 200 most recent entries.
- Lives at `~/.pi/logs/soly/<date>.ndjson`.
- Useful for: post-mortem of agent runs, quota-debug traces, rulecheck
  audit trail.

**Why v3.1.0:** the user already runs `quota-debug.log` ad-hoc. A
proper logger removes the throwaway debug file pattern.

### v3.1.0 — Stash recall: `feat/docs-knowledge-base`

`git stash` holds WIP from a previous session:
- Intent docs: grouped index (tree-style nav, no more flat list).
- `/docs` command: full CRUD (new/edit/delete/move) — currently read-only
  in `commands/docs.ts`.
- `/rules` command: same CRUD treatment.

**Why v3.1.0:** orthogonal to mode/settings work, but small enough to
fit in a minor. Review the WIP, finish or fold into rulecheck (v3.2).

### v3.2.0 — Rulecheck (the user's central feature)

**Philosophy (stated explicitly by the user):**
> "главная цель soly — это удобство разработки, планы, фазы и ПРАВИЛА!
> соблюдения правил это самое главное"

soly **does not** reimplement linters/analyzers. It ships:
1. A small rules DSL: `auto_check` frontmatter block — declares which
   provider(s) to run against which globs.
2. Built-in `kind:grep` provider (regex over files, no deps).
3. `/rules check` command + `soly-check` LLM tool: run the project's
   rule set, report violations with file:line + suggested fix.
4. Skill `rulecheck-coach` (mirrors `agent-coach` pattern via
   `nudge.ts` active-injection): when an LLM writes code that would
   violate a known rule, surface the rule + severity before the code
   lands.

Plugins for AST providers ship separately:
- `@dot-stbl/rulecheck-cs` (Roslyn-based, .NET projects)
- `@dot-stbl/rulecheck-ts` (typescript-eslint AST, TS/JS projects)
- `@dot-stbl/rulecheck-ps` (PowerShell AST)

This is the work the user explicitly named the **main feature** — not
mode/plans/UI.

### v3.3.0 — Rule authoring wizard

LLM-assisted rule drafting at `/rules new`:
1. User describes the rule in natural language.
2. LLM asks 2-3 clarifying questions (severity, scope glob,
   what to flag).
3. LLM drafts `.md` rule + `auto_check` frontmatter + suggested
   `kind:grep` regex or AST query.
4. User reviews, edits, saves.

### v3.3.0–v3.4.0 — Plugin architecture

Current `index.ts` is a monolith (~2000 LOC). Incremental migration to
**capability-bag plugins**:

```
plugin-1: rules (already mostly isolated)
plugin-2: intent (read-only, side-effect-free)
plugin-3: chrome (footer, working indicator, quota, event-sink)
plugin-4: commands (soly, docs, rules, why, artifacts, manage)
plugin-5: ask/deck/artifact (interactive UI primitives)
plugin-6: mcp (MCP server adapter — only loaded if user enables MCP)
plugin-7: mode (mode resolver + picker + branch prompt)
plugin-8: settings (registry + tools)
plugin-9: workflows (new/execute/done/plan/discuss)
```

Each plugin is a `SolyPlugin` with explicit capability declarations
(`provides: ["chrome", "footer", "working"]`,
`consumes: ["mode", "config"]`). Migration is **forward-only** — each
minor version migrates one or two plugins, never a big-bang rewrite.

**Why v3.3+:** not blocking, but the `index.ts` is the largest single
file in the repo and the longest-lived pain point.

---

## Already-shipped features (for context)

### v2.x foundation (still in v3.0.0-alpha.2)

- **Mode system** (v2.5+): picker between `plans` (per-repo) and `phases`
  (legacy) modes. Auto-detect: existing `.agents/STATE.md` → phases;
  empty `.agents/` → plans.
- **Settings registry** (alpha.2): 20 settings, TypeBox-validated, with
  sensitivity tiers (cosmetic silent, behavioral announce, structural
  confirm).
- **LLM config tools**: `soly-config` (read), `soly-settings-set` (write).
- **Custom tool rendering**: `◈` glyph + one-line `format` per tool,
  replaces pi's default tool box.
- **Built-in rules**: `release-discipline.md` (CHANGELOG on version bump),
  `temp-files.md` (OS-aware temp paths, no `/tmp` literals).
- **Notifications**: only errors as popups; info/warning → `└─` sub-line
  (5s TTL, auto-clear on next agent_start).
- **Active complaint detection**: `agent-coach` skill + `nudge.ts`
  injection — when user says "agent keeps doing X", LLM gets a directive
  to propose a `.agents/rules/*.md` rule draft.
- **Working indicator**: rotating verbs (`thinking`/`crunching`/etc.,
  every 5s), removed token telemetry (was: `↑379k ↓2.4k · 2 tok/s`).
- **Quota panel**: shows USED% (matches MiniMax web dashboard) + threshold
  colors + time-to-reset (<30min yellow).
- **Picker semantics**: `/soly` modal groups subcommands by role
  (Status / Inspect / Manage).
- **Aliases**: `/soly` + `/sly` + `/s` — same body, three names.
- **OSC fix**: `windowsHide: true` on subprocess — no more
  `]0;Administrator:` artifacts in pi input on Windows.

### Older (v2.5 and earlier)

- **Workflows**: `soly new / plan / execute / done / discuss / migrate`.
- **MCP server**: `mcp/` module — separate pi-extension entry
  (`./mcp/index.ts`), bundled in the same npm package.
- **Built-in tools**: 15 tools (soly-read, soly-snippet, soly-doc-search,
  soly-todos, soly-config, soly-settings-set, soly-workflow, etc.).
- **Built-in skills**: `soly-framework` (workflow reference), `agent-coach`
  (complaint → rule draft).
- **Persistence**: `.agents/STATE.md`, `ROADMAP.md`, `soly.json`,
  `rule-mtimes.json` (hot-reload cache).
- **Iteration files**: `iteration.ts` — keeps last N plan sessions for
  post-mortem review.

---

## How to read this roadmap

| If you are… | Read |
|---|---|
| …wondering what's safe to merge | "Next step — v3.0.0-alpha.2 release" |
| …planning the next sprint | "v3.1.0" + "v3.2.0 — Rulecheck" |
| …confused why a feature exists | "Already-shipped features" |
| …looking for the user's stated priorities | "v3.2.0 — Rulecheck" (philosophy callout) |
| …a new contributor | README.md → packages/pi-soly/README.md → this file |

---

## Decision log (links)

- [CHANGELOG.md](CHANGELOG.md) — every shipped change with rationale.
- [packages/pi-soly/.agents/docs/architecture.md](packages/pi-soly/.agents/docs/architecture.md) — current architecture.
- [packages/pi-soly/.agents/docs/release-process.md](packages/pi-soly/.agents/docs/release-process.md) — tag → CI → npm flow.
- [packages/pi-soly/.agents/docs/dependencies.md](packages/pi-soly/.agents/docs/dependencies.md) — why each dep exists.

---

## Open questions for the user

1. **alpha.2 cut-off scope:** include the 4 bug fixes from this branch in
   alpha.2, or split them into alpha.2 + alpha.3? (My recommendation:
   single alpha.2 — they're all small, tested, and part of the mode
   system story.)
2. **`writeSolyConfig` wiring:** do it now (in alpha.2), or defer to v3.0.x?
   (My recommendation: defer — the user can set chrome/agent via the
   existing `/soly settings` UI; the LLM path is nice-to-have, not blocker.)
3. **3.0.0-stable timeline:** one week after alpha.2, or two?
   (My recommendation: one week — the package is internal to the user's
   own setup; slow rollout isn't buying safety.)